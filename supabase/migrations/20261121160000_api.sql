-- AgroSyntra One on Supabase: the API that the NestJS server on Render used to answer.
--
-- The site keeps calling the same REST paths (/farms, /fields/by-farm/:id, …). js/supa.js sends
-- each one to public.api(method, path, query, body) through supabase.rpc, and this function answers
-- with { status, body } exactly as the server did, including the field rules (validation, repair,
-- overlaps, duplicates, clip, history, archive/restore, permanent delete) and the roles.
--
-- Security: every table keeps RLS on with no policies, so the browser can reach the data only
-- through these SECURITY DEFINER functions, which check the signed-in user (auth.uid()) and keep
-- every read and write inside that user's organization.

-- ------------------------------------------------------------------ helpers

alter table public.users alter column "passwordHash" drop not null;

create or replace function public._fail(p_status int, p_body jsonb) returns void
language plpgsql as $$
begin
  raise exception using errcode = 'P0001', message = p_body::text, hint = 'api:' || p_status;
end $$;

create or replace function public._msg(p_status int, p_message text, p_extra jsonb default '{}'::jsonb) returns void
language plpgsql as $$
begin
  perform public._fail(p_status, jsonb_build_object('message', p_message) || coalesce(p_extra, '{}'::jsonb));
end $$;

create or replace function public._fmt_ha(ha double precision) returns text
language sql immutable as $$
  select case when ha < 1 then round(ha * 10000)::text || ' m²' else to_char(ha, 'FM999999990.00') || ' ha' end
$$;

create or replace function public._role_in(p_role text, variadic p_roles text[]) returns void
language plpgsql as $$
begin
  if not (p_role = any(p_roles)) then
    perform public._msg(403, 'Your role cannot do this. Ask the owner or a manager');
  end if;
end $$;

create or replace function public._farm_of_org(p_farm text, p_org uuid) returns uuid
language plpgsql stable set search_path = public as $$
declare v uuid;
begin
  select id into v from farms where id::text = p_farm and "organizationId" = p_org;
  if v is null then perform public._msg(404, 'The farm does not exist'); end if;
  return v;
end $$;

create or replace function public._field_of_org(p_field text, p_org uuid) returns uuid
language plpgsql stable set search_path = public as $$
declare v uuid;
begin
  select f.id into v from fields f join farms fa on fa.id = f."farmId" where f.id::text = p_field and fa."organizationId" = p_org;
  if v is null then perform public._msg(404, 'The field does not exist'); end if;
  return v;
end $$;

create or replace function public._field_json(p_id uuid) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object('id', id, 'name', name, 'farmId', "farmId", 'irrigation', irrigation,
                            'areaHectares', "areaHectares", 'createdAt', "createdAt", 'archivedAt', "archivedAt")
  from fields where id = p_id
$$;

-- ------------------------------------------------------------------ geometry pipeline

-- Shape checks without the database: polygon, WGS84 range, at least three corners; open rings
-- are closed and repeated points dropped. Returns the cleaned GeoJSON polygon.
create or replace function public._normalize_polygon(b jsonb) returns jsonb
language plpgsql immutable as $$
declare
  rings jsonb := '[]'::jsonb; ring jsonb; p jsonb; pts jsonb; r int := 0;
  lng double precision; lat double precision; last_lng double precision; last_lat double precision;
begin
  if b is null or b->>'type' is distinct from 'Polygon' or jsonb_typeof(b->'coordinates') <> 'array' or jsonb_array_length(b->'coordinates') = 0 then
    perform public._msg(400, 'The boundary must be a polygon', '{"code":"FIELD_GEOMETRY"}');
  end if;
  for ring in select value from jsonb_array_elements(b->'coordinates') loop
    if jsonb_typeof(ring) <> 'array' then perform public._msg(400, 'The boundary is not a valid polygon', '{"code":"FIELD_GEOMETRY"}'); end if;
    pts := '[]'::jsonb; last_lng := null; last_lat := null;
    for p in select value from jsonb_array_elements(ring) loop
      if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) < 2 then
        perform public._msg(400, 'The boundary has an invalid point', '{"code":"FIELD_GEOMETRY"}');
      end if;
      begin
        lng := (p->>0)::double precision; lat := (p->>1)::double precision;
      exception when others then
        perform public._msg(400, 'Coordinates must be WGS84 longitude and latitude', '{"code":"FIELD_GEOMETRY"}');
      end;
      if lng is null or lat is null or abs(lng) > 180 or abs(lat) > 90 or lng = 'NaN' or lat = 'NaN' then
        perform public._msg(400, 'Coordinates must be WGS84 longitude and latitude', '{"code":"FIELD_GEOMETRY"}');
      end if;
      if last_lng is null or last_lng <> lng or last_lat <> lat then
        pts := pts || jsonb_build_array(jsonb_build_array(lng, lat)); last_lng := lng; last_lat := lat;
      end if;
    end loop;
    if jsonb_array_length(pts) > 1 and pts->0 = pts->(jsonb_array_length(pts) - 1) then
      pts := pts - (jsonb_array_length(pts) - 1);
    end if;
    if jsonb_array_length(pts) < 3 then
      perform public._msg(400, case when r = 0 then 'A field needs at least three corners' else 'A cut-out needs at least three corners' end, '{"code":"FIELD_GEOMETRY"}');
    end if;
    rings := rings || jsonb_build_array(pts || jsonb_build_array(pts->0));
    r := r + 1;
  end loop;
  return jsonb_build_object('type', 'Polygon', 'coordinates', rings);
end $$;

-- Validates in PostGIS. Shapes PostGIS can fix into one polygon are repaired; shapes whose edges
-- cross are refused with the crossing point. 100 m² … 10,000 ha.
create or replace function public._prepare(b jsonb) returns jsonb
language plpgsql stable set search_path = public, extensions as $$
declare
  poly jsonb := public._normalize_polygon(b);
  g geometry; ok boolean; reason text; parts int; ha double precision; gj text; m text[];
begin
  begin
    g := ST_SetSRID(ST_Force2D(ST_GeomFromGeoJSON(poly::text)), 4326);
    ok := ST_IsValid(g); reason := ST_IsValidReason(g);
    if not ok then g := ST_CollectionExtract(ST_MakeValid(g), 3); end if;
    parts := coalesce(ST_NumGeometries(g), 0);
    ha := coalesce(ST_Area(g::geography) / 10000, 0);
    gj := ST_AsGeoJSON(case when parts = 1 then ST_GeometryN(g, 1) else g end);
  exception when others then
    perform public._msg(400, 'The boundary is not a valid polygon', '{"code":"FIELD_GEOMETRY"}');
  end;
  if parts = 0 or not (ha > 0) then perform public._msg(400, 'The boundary has no area. Its corners lie on one line', '{"code":"FIELD_GEOMETRY"}'); end if;
  if not ok and parts <> 1 then
    m := regexp_match(coalesce(reason, ''), '\[([-0-9.eE]+) ([-0-9.eE]+)\]');
    if coalesce(reason, '') ~* '(self-intersection|ring self)' then
      perform public._msg(400, 'The boundary crosses itself. Move the points so the edges do not cross',
        jsonb_build_object('code', 'FIELD_GEOMETRY') || case when m is null then '{}'::jsonb else jsonb_build_object('where', jsonb_build_object('lng', m[1]::double precision, 'lat', m[2]::double precision)) end);
    end if;
    perform public._msg(400, 'The boundary is not a valid polygon',
      jsonb_build_object('code', 'FIELD_GEOMETRY') || case when m is null then '{}'::jsonb else jsonb_build_object('where', jsonb_build_object('lng', m[1]::double precision, 'lat', m[2]::double precision)) end);
  end if;
  if ha < 0.01 then
    perform public._msg(400, format('The field is too small (%s). The smallest field is 100 m²', public._fmt_ha(ha)), jsonb_build_object('code', 'FIELD_GEOMETRY', 'areaHa', ha));
  end if;
  if ha > 10000 then
    perform public._msg(400, format('The field is too large (%s ha). The largest field is 10,000 ha, so split it into several fields', to_char(round(ha), 'FM999,999,999')), jsonb_build_object('code', 'FIELD_GEOMETRY', 'areaHa', ha));
  end if;
  return jsonb_build_object('geojson', gj, 'areaHa', ha, 'repaired', not ok);
end $$;

-- Saved, live fields of the organization that this shape overlaps (shared edges ignored), largest first.
create or replace function public._conflicts(p_geojson text, p_area double precision, p_org uuid, p_exclude uuid) returns jsonb
language sql stable set search_path = public, extensions as $$
  with s as (select ST_SetSRID(ST_GeomFromGeoJSON(p_geojson), 4326) as g),
  o as (
    select f.id, f.name, coalesce(f."areaHectares", 0) as "areaHa",
           coalesce(ST_Area(ST_Intersection(ST_MakeValid(f.boundary), s.g)::geography) / 10000, 0) as "overlapHa"
    from fields f join farms fa on fa.id = f."farmId", s
    where fa."organizationId" = p_org and f."archivedAt" is null and f.boundary is not null
      and f.boundary && s.g and ST_Intersects(f.boundary, s.g) and (p_exclude is null or f.id <> p_exclude)
  ),
  k as (
    select *, ("overlapHa" >= 0.9 * p_area and "overlapHa" >= 0.9 * coalesce(nullif("areaHa", 0), p_area)) as duplicate
    from o where "overlapHa" >= 0.01 and "overlapHa" >= 0.01 * least(p_area, coalesce(nullif("areaHa", 0), p_area))
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'areaHa', "areaHa", 'overlapHa', "overlapHa", 'duplicate', duplicate) order by "overlapHa" desc), '[]'::jsonb) from k
$$;

-- Validate → overlaps → apply the choice (reject | skip | clip | allow). A copy may sit on its source.
create or replace function public._resolve_shape(p_boundary jsonb, p_org uuid, p_exclude uuid, p_mode text, p_copy_of uuid default null) returns jsonb
language plpgsql set search_path = public, extensions as $$
declare
  prep jsonb := public._prepare(p_boundary); fnd jsonb; u geometry; dup jsonb; n int; list text; clipped double precision := 0;
  cut_g geometry; orig geometry;
begin
  fnd := public._conflicts(prep->>'geojson', (prep->>'areaHa')::double precision, p_org, p_exclude);
  select value into dup from jsonb_array_elements(fnd) where (value->>'duplicate')::boolean and (p_copy_of is null or (value->>'id')::uuid <> p_copy_of) limit 1;
  if dup is not null then
    perform public._msg(409, format('This field is already saved as “%s”', dup->>'name'), jsonb_build_object('code', 'FIELD_DUPLICATE', 'conflicts', fnd, 'areaHa', (prep->>'areaHa')::double precision));
  end if;
  n := jsonb_array_length(fnd);
  if n > 0 then
    if p_mode in ('reject', 'skip') then
      select string_agg(format('%s (%s)', value->>'name', public._fmt_ha((value->>'overlapHa')::double precision)), ', ') into list
      from (select value from jsonb_array_elements(fnd) limit 3) x;
      if n > 3 then list := list || format(' and %s more', n - 3); end if;
      perform public._msg(409, format('The field overlaps %s: %s', case when n = 1 then 'a saved field' else n || ' saved fields' end, list),
        jsonb_build_object('code', 'FIELD_OVERLAP', 'conflicts', fnd, 'areaHa', (prep->>'areaHa')::double precision));
    end if;
    if p_mode = 'clip' then
      orig := ST_SetSRID(ST_GeomFromGeoJSON(prep->>'geojson'), 4326);
      select ST_Union(ST_MakeValid(f.boundary)) into u from fields f where f.id in (select (value->>'id')::uuid from jsonb_array_elements(fnd));
      select dp.geom into cut_g from ST_Dump(ST_CollectionExtract(ST_MakeValid(ST_Difference(orig, u)), 3)) dp order by ST_Area(dp.geom::geography) desc limit 1;
      if cut_g is null then perform public._msg(400, 'Nothing is left of the field after cutting the overlap', '{"code":"FIELD_GEOMETRY"}'); end if;
      clipped := (ST_Area(orig::geography) - coalesce(ST_Area(cut_g::geography), 0)) / 10000;
      prep := public._prepare(ST_AsGeoJSON(cut_g)::jsonb) || jsonb_build_object('repaired', (prep->>'repaired')::boolean);
    end if;
  end if;
  return prep || jsonb_build_object('clippedHa', clipped, 'overlapsKept', case when p_mode = 'allow' then n else 0 end);
end $$;

create or replace function public._next_name(p_org uuid, p_taken text[] default '{}') returns text
language sql stable set search_path = public as $$
  select 'Field ' || (greatest(
    coalesce((select max(substring(f.name from 7)::int) from fields f join farms fa on fa.id = f."farmId" where fa."organizationId" = p_org and f.name ~ '^Field [0-9]{1,9}$'), 0),
    coalesce((select max(substring(t from 7)::int) from unnest(p_taken) t where t ~ '^Field [0-9]{1,9}$'), 0)) + 1)::text
$$;

create or replace function public._log(p_field uuid, p_event text, p_user uuid, p_detail jsonb, p_with_shape boolean) returns void
language sql set search_path = public as $$
  insert into field_history ("fieldId", event, boundary, "areaHectares", detail, "userId")
  select id, p_event, case when p_with_shape then boundary end, case when p_with_shape then "areaHectares" end,
         nullif(p_detail, '{}'::jsonb), p_user::text
  from fields where id = p_field
$$;

create or replace function public._ensure_baseline(p_field uuid) returns void
language sql set search_path = public as $$
  insert into field_history ("fieldId", event, boundary, "areaHectares", detail, "createdAt")
  select f.id, 'created', f.boundary, f."areaHectares", '{"baseline":true}'::jsonb, f."createdAt"
  from fields f where f.id = p_field and not exists (select 1 from field_history h where h."fieldId" = p_field and h.boundary is not null)
$$;

create or replace function public._insert_field(p_name text, p_farm uuid, p_irrigation text, p_geojson text) returns uuid
language sql set search_path = public, extensions as $$
  insert into fields (name, "farmId", irrigation, boundary, "areaHectares")
  select p_name, p_farm, p_irrigation, g, ST_Area(g::geography) / 10000
  from (select ST_SetSRID(ST_GeomFromGeoJSON(p_geojson), 4326) as g) s
  returning id
$$;

-- ------------------------------------------------------------------ the router

create or replace function public.api(p_method text, p_path text, p_query jsonb default '{}'::jsonb, p_body jsonb default null)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  me users; org uuid; role text; uid uuid;
  m text := upper(p_method); path text := regexp_replace(coalesce(p_path, ''), '/+$', '');
  q jsonb := coalesce(p_query, '{}'::jsonb); b jsonb := coalesce(p_body, '{}'::jsonb);
  seg text[]; res jsonb; st int := 200; v uuid; fid uuid; rec record; shape jsonb; mode text; tmp jsonb;
  writers text[] := array['owner','manager','gis_analyst','agronomist','field_supervisor'];
  msg text; hint text; problems jsonb; names text[]; saved jsonb; repaired int; clipped int; item jsonb; i int;
begin
  uid := auth.uid();
  if uid is null then return jsonb_build_object('status', 401, 'body', jsonb_build_object('statusCode', 401, 'message', 'Sign in again')); end if;
  select * into me from users where id = uid and "isActive";
  if me.id is null then return jsonb_build_object('status', 401, 'body', jsonb_build_object('statusCode', 401, 'message', 'This account has no organization. Sign in again')); end if;
  org := me."organizationId"; role := me.role::text;
  seg := string_to_array(trim(both '/' from path), '/');

  begin
    -- organizations ------------------------------------------------
    if m = 'GET' and path = '/organizations/me' then
      select to_jsonb(o) into res from organizations o where o.id = org;

    -- farms --------------------------------------------------------
    elsif m = 'GET' and path = '/farms' then
      select coalesce(jsonb_agg(to_jsonb(fa) || jsonb_build_object('fields', coalesce((
               select jsonb_agg(public._field_json(f.id) order by f."createdAt") from fields f where f."farmId" = fa.id and f."archivedAt" is null), '[]'::jsonb))
             order by fa."createdAt" desc), '[]'::jsonb)
      into res from farms fa where fa."organizationId" = org;
    elsif m = 'POST' and path = '/farms' then
      perform public._role_in(role, 'owner', 'manager');
      if coalesce(trim(b->>'name'), '') = '' then perform public._msg(400, 'name should not be empty'); end if;
      insert into farms (name, "organizationId", latitude, longitude, address)
      values (left(trim(b->>'name'), 200), org, (b->>'latitude')::double precision, (b->>'longitude')::double precision, b->>'address')
      returning to_jsonb(farms.*) || '{"fields":[]}'::jsonb into res;
      st := 201;
    elsif m = 'GET' and seg[1] = 'farms' and array_length(seg, 1) = 2 then
      v := public._farm_of_org(seg[2], org);
      select to_jsonb(fa) || jsonb_build_object('fields', coalesce((
               select jsonb_agg(public._field_json(f.id) order by f."createdAt") from fields f where f."farmId" = fa.id and f."archivedAt" is null), '[]'::jsonb))
      into res from farms fa where fa.id = v;

    -- fields: reads -----------------------------------------------
    elsif m = 'GET' and path = '/fields/archived' then
      v := public._farm_of_org(q->>'farmId', org);
      select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'areaHectares', "areaHectares", 'archivedAt', "archivedAt") order by "archivedAt" desc), '[]'::jsonb)
      into res from fields where "farmId" = v and "archivedAt" is not null;
    elsif m = 'GET' and seg[1] = 'fields' and seg[2] = 'by-farm' and array_length(seg, 1) = 4 and seg[4] = 'boundaries.geojson' then
      v := public._farm_of_org(seg[3], org);
      select jsonb_build_object('type', 'FeatureCollection', 'features', coalesce(jsonb_agg(jsonb_build_object(
               'type', 'Feature', 'id', id,
               'properties', jsonb_build_object('id', id, 'name', name, 'areaHectares', "areaHectares", 'irrigation', irrigation),
               'geometry', ST_AsGeoJSON(boundary)::jsonb) order by "createdAt"), '[]'::jsonb))
      into res from fields where "farmId" = v and boundary is not null and "archivedAt" is null;
    elsif m = 'GET' and seg[1] = 'fields' and seg[2] = 'by-farm' and array_length(seg, 1) = 3 then
      v := public._farm_of_org(seg[3], org);
      select coalesce(jsonb_agg(public._field_json(f.id) || jsonb_build_object('crops', coalesce((
               select jsonb_agg(to_jsonb(c) order by c."plantingDate" desc) from crops c where c."fieldId" = f.id), '[]'::jsonb))
             order by f."createdAt"), '[]'::jsonb)
      into res from fields f where f."farmId" = v and f."archivedAt" is null;
    elsif m = 'GET' and seg[1] = 'fields' and array_length(seg, 1) = 3 and seg[3] = 'boundary.geojson' then
      fid := public._field_of_org(seg[2], org);
      select ST_AsGeoJSON(boundary)::jsonb into res from fields where id = fid;
    elsif m = 'GET' and seg[1] = 'fields' and array_length(seg, 1) = 3 and seg[3] = 'history' then
      fid := public._field_of_org(seg[2], org);
      perform public._ensure_baseline(fid);
      select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'event', h.event, 'areaHectares', h."areaHectares", 'detail', h.detail,
               'createdAt', h."createdAt", 'userEmail', u.email,
               'boundary', case when h.boundary is null then null else ST_AsGeoJSON(h.boundary)::jsonb end)
             order by h."createdAt" desc, h.id), '[]'::jsonb)
      into res from field_history h left join users u on u.id::text = h."userId" where h."fieldId" = fid;
    elsif m = 'GET' and seg[1] = 'fields' and array_length(seg, 1) = 2 then
      fid := public._field_of_org(seg[2], org);
      res := public._field_json(fid)
        || jsonb_build_object('crops', coalesce((select jsonb_agg(to_jsonb(c) order by c."plantingDate" desc) from crops c where c."fieldId" = fid), '[]'::jsonb))
        || jsonb_build_object('activities', coalesce((select jsonb_agg(to_jsonb(a) order by a.date desc) from activity_logs a where a."fieldId" = fid), '[]'::jsonb))
        || jsonb_build_object('farm', (select to_jsonb(fa) from farms fa join fields f on f."farmId" = fa.id where f.id = fid));

    -- fields: check, create, bulk ---------------------------------
    elsif m = 'POST' and path = '/fields/check' then
      begin
        shape := public._prepare(b->'boundary');
        tmp := public._conflicts(shape->>'geojson', (shape->>'areaHa')::double precision, org, nullif(b->>'excludeId', '')::uuid);
        res := jsonb_build_object('ok', true, 'areaHa', (shape->>'areaHa')::double precision, 'repaired', (shape->>'repaired')::boolean,
               'conflicts', tmp, 'duplicate', exists (select 1 from jsonb_array_elements(tmp) e where (e.value->>'duplicate')::boolean));
      exception when sqlstate 'P0001' then
        get stacked diagnostics msg = message_text, hint = pg_exception_hint;
        if hint is null or hint not like 'api:%' then raise; end if;
        res := jsonb_build_object('ok', false) || (msg::jsonb);
      end;
      st := 201;
    elsif m = 'POST' and path = '/fields' then
      perform public._role_in(role, 'owner', 'manager', 'gis_analyst');
      v := public._farm_of_org(b->>'farmId', org);
      if b->>'copyOf' is not null then perform public._field_of_org(b->>'copyOf', org); end if;
      shape := public._resolve_shape(b->'boundary', org, null, case when b->>'copyOf' is not null then 'allow' else coalesce(b->>'overlap', 'reject') end, nullif(b->>'copyOf', '')::uuid);
      fid := public._insert_field(coalesce(nullif(left(trim(b->>'name'), 200), ''), public._next_name(org)), v, nullif(b->>'irrigation', ''), shape->>'geojson');
      perform public._log(fid, 'created', uid,
        jsonb_strip_nulls(jsonb_build_object('repaired', case when (shape->>'repaired')::boolean then true end,
          'clippedHa', nullif((shape->>'clippedHa')::double precision, 0), 'overlapsKept', nullif((shape->>'overlapsKept')::int, 0), 'copyOf', b->>'copyOf')), true);
      res := public._field_json(fid) || jsonb_build_object('repaired', (shape->>'repaired')::boolean, 'clippedHa', (shape->>'clippedHa')::double precision, 'overlapsKept', (shape->>'overlapsKept')::int);
      st := 201;
    elsif m = 'POST' and path = '/fields/bulk' then
      perform public._role_in(role, 'owner', 'manager', 'gis_analyst');
      v := public._farm_of_org(b->>'farmId', org);
      mode := coalesce(b->>'overlap', 'reject');
      problems := '[]'::jsonb; names := '{}'; saved := '[]'::jsonb; repaired := 0; clipped := 0; i := 0;
      for item in select value from jsonb_array_elements(coalesce(b->'fields', '[]'::jsonb)) loop
        begin
          shape := public._resolve_shape(item->'boundary', org, null, mode);
          msg := coalesce(nullif(left(trim(item->>'name'), 200), ''), public._next_name(org, names));
          names := names || msg;
          fid := public._insert_field(msg, v, nullif(coalesce(b->>'irrigation', ''), ''), shape->>'geojson');
          perform public._log(fid, 'created', uid, jsonb_strip_nulls(jsonb_build_object('imported', true,
            'repaired', case when (shape->>'repaired')::boolean then true end, 'clippedHa', nullif((shape->>'clippedHa')::double precision, 0))), true);
          if (shape->>'repaired')::boolean then repaired := repaired + 1; end if;
          if (shape->>'clippedHa')::double precision > 0 then clipped := clipped + 1; end if;
          saved := saved || jsonb_build_array(public._field_json(fid));
        exception when sqlstate 'P0001' then
          get stacked diagnostics msg = message_text, hint = pg_exception_hint;
          if hint is null or hint not like 'api:%' then raise; end if;
          tmp := msg::jsonb;
          problems := problems || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('index', i,
            'name', coalesce(nullif(trim(item->>'name'), ''), format('Field %s in the file', i + 1)),
            'code', tmp->>'code', 'message', tmp->>'message', 'conflicts', tmp->'conflicts')));
        end;
        i := i + 1;
      end loop;
      if mode = 'reject' and jsonb_array_length(problems) > 0 then
        declare g int; d int; o int; parts text[] := '{}';
        begin
          select count(*) filter (where value->>'code' = 'FIELD_GEOMETRY'), count(*) filter (where value->>'code' = 'FIELD_DUPLICATE') into g, d from jsonb_array_elements(problems);
          o := jsonb_array_length(problems) - g;
          if d > 0 then parts := parts || (d || ' already saved'); end if;
          if o - d > 0 then parts := parts || ((o - d) || ' overlapping saved fields or each other'); end if;
          if g > 0 then parts := parts || (g || ' with an invalid shape'); end if;
          perform public._msg(case when o > 0 then 409 else 400 end,
            format('Nothing was imported: %s of %s fields need a decision (%s)', jsonb_array_length(problems), i, array_to_string(parts, ', ')),
            jsonb_build_object('code', 'FIELD_IMPORT_PROBLEMS', 'problems', problems));
        end;
      end if;
      res := jsonb_build_object('fields', saved, 'skipped', problems, 'repaired', repaired, 'clipped', clipped);
      st := 201;

    -- fields: edit, history restore, archive, restore, delete ----
    elsif m = 'PATCH' and seg[1] = 'fields' and array_length(seg, 1) = 2 then
      perform public._role_in(role, 'owner', 'manager', 'gis_analyst');
      fid := public._field_of_org(seg[2], org);
      if b ? 'farmId' and b->>'farmId' is not null then perform public._farm_of_org(b->>'farmId', org); end if;
      if b ? 'name' and coalesce(trim(b->>'name'), '') = '' then perform public._msg(400, 'A field needs a name'); end if;
      select name, "farmId", irrigation into rec from fields where id = fid;
      shape := null;
      if b ? 'boundary' and b->'boundary' <> 'null'::jsonb then
        shape := public._resolve_shape(b->'boundary', org, fid, coalesce(b->>'overlap', 'reject'));
        perform public._ensure_baseline(fid);
      end if;
      update fields set
        name = coalesce(nullif(left(trim(b->>'name'), 200), ''), name),
        "farmId" = coalesce(nullif(b->>'farmId', '')::uuid, "farmId"),
        irrigation = case when b ? 'irrigation' then nullif(b->>'irrigation', '') else irrigation end,
        boundary = coalesce(ST_SetSRID(ST_GeomFromGeoJSON(shape->>'geojson'), 4326), boundary)
      where id = fid;
      update fields set "areaHectares" = ST_Area(boundary::geography) / 10000 where id = fid;
      if shape is not null then
        perform public._log(fid, 'boundary_edited', uid, jsonb_strip_nulls(jsonb_build_object('repaired', case when (shape->>'repaired')::boolean then true end,
          'clippedHa', nullif((shape->>'clippedHa')::double precision, 0), 'overlapsKept', nullif((shape->>'overlapsKept')::int, 0))), true);
      end if;
      if nullif(trim(b->>'name'), '') is not null and trim(b->>'name') <> rec.name then
        perform public._log(fid, 'renamed', uid, jsonb_build_object('from', rec.name, 'to', trim(b->>'name')), false);
      end if;
      if nullif(b->>'farmId', '') is not null and (b->>'farmId')::uuid <> rec."farmId" then
        perform public._log(fid, 'moved', uid, jsonb_build_object('fromFarmId', rec."farmId", 'toFarmId', b->>'farmId'), false);
      end if;
      if b ? 'irrigation' and nullif(b->>'irrigation', '') is distinct from rec.irrigation then
        perform public._log(fid, 'irrigation', uid, jsonb_build_object('from', rec.irrigation, 'to', nullif(b->>'irrigation', '')), false);
      end if;
      res := public._field_json(fid) || case when shape is null then '{}'::jsonb else jsonb_build_object('repaired', (shape->>'repaired')::boolean, 'clippedHa', (shape->>'clippedHa')::double precision, 'overlapsKept', (shape->>'overlapsKept')::int) end;
    elsif m = 'POST' and seg[1] = 'fields' and array_length(seg, 1) = 5 and seg[3] = 'history' and seg[5] = 'restore' then
      perform public._role_in(role, 'owner', 'manager', 'gis_analyst');
      fid := public._field_of_org(seg[2], org);
      select ST_AsGeoJSON(boundary) as gj, "createdAt" into rec from field_history where id::text = seg[4] and "fieldId" = fid and boundary is not null;
      if rec.gj is null then perform public._msg(404, 'This boundary version does not exist'); end if;
      shape := public._resolve_shape(rec.gj::jsonb, org, fid, coalesce(b->>'overlap', 'reject'));
      perform public._ensure_baseline(fid);
      update fields set boundary = ST_SetSRID(ST_GeomFromGeoJSON(shape->>'geojson'), 4326) where id = fid;
      update fields set "areaHectares" = ST_Area(boundary::geography) / 10000 where id = fid;
      perform public._log(fid, 'boundary_restored', uid, jsonb_strip_nulls(jsonb_build_object('from', rec."createdAt", 'clippedHa', nullif((shape->>'clippedHa')::double precision, 0))), true);
      res := public._field_json(fid); st := 201;
    elsif m = 'POST' and seg[1] = 'fields' and array_length(seg, 1) = 3 and seg[3] = 'restore' then
      perform public._role_in(role, 'owner', 'manager');
      fid := public._field_of_org(seg[2], org);
      select ST_AsGeoJSON(boundary) as gj, "archivedAt" into rec from fields where id = fid;
      if rec."archivedAt" is not null then
        if rec.gj is not null then
          shape := public._resolve_shape(rec.gj::jsonb, org, fid, coalesce(b->>'overlap', 'reject'));
          if (shape->>'clippedHa')::double precision > 0 then
            perform public._ensure_baseline(fid);
            update fields set boundary = ST_SetSRID(ST_GeomFromGeoJSON(shape->>'geojson'), 4326), "areaHectares" = (shape->>'areaHa')::double precision where id = fid;
          end if;
        end if;
        update fields set "archivedAt" = null where id = fid;
        perform public._log(fid, 'restored', uid, null, true);
      end if;
      res := public._field_json(fid); st := 201;
    elsif m = 'DELETE' and seg[1] = 'fields' and array_length(seg, 1) = 2 then
      perform public._role_in(role, 'owner', 'manager');
      fid := public._field_of_org(seg[2], org);
      if coalesce(q->>'permanent', '') in ('true', '1') then
        delete from weather_snapshots where "fieldId" = fid::text;
        delete from scout_tasks where "fieldId" = fid;
        delete from activity_logs where "fieldId" = fid;
        delete from crops where "fieldId" = fid;
        delete from field_history where "fieldId" = fid;
        delete from fields where id = fid;
        res := jsonb_build_object('id', fid, 'deleted', true, 'permanent', true);
      else
        update fields set "archivedAt" = now() where id = fid and "archivedAt" is null;
        if found then perform public._log(fid, 'archived', uid, null, false); end if;
        res := jsonb_build_object('id', fid, 'deleted', true, 'permanent', false);
      end if;

    -- crops --------------------------------------------------------
    elsif m = 'GET' and seg[1] = 'crops' and seg[2] = 'by-field' and array_length(seg, 1) = 3 then
      fid := public._field_of_org(seg[3], org);
      select coalesce(jsonb_agg(to_jsonb(c) order by c."plantingDate" desc), '[]'::jsonb) into res from crops c where c."fieldId" = fid;
    elsif m = 'POST' and path = '/crops' then
      perform public._role_in(role, 'owner', 'manager', 'agronomist');
      fid := public._field_of_org(b->>'fieldId', org);
      if coalesce(trim(b->>'cropType'), '') = '' then perform public._msg(400, 'cropType should not be empty'); end if;
      insert into crops ("fieldId", "cropType", variety, "plantingDate", "expectedHarvestDate", "growthStage")
      values (fid, left(trim(b->>'cropType'), 100), nullif(b->>'variety', ''), (b->>'plantingDate')::date, nullif(b->>'expectedHarvestDate', '')::date,
              coalesce(nullif(b->>'growthStage', ''), 'planted')::crops_growthstage_enum)
      returning to_jsonb(crops.*) into res;
      st := 201;
    elsif m = 'PATCH' and seg[1] = 'crops' and array_length(seg, 1) in (2, 3) then
      if array_length(seg, 1) = 3 and seg[3] = 'growth-stage' then perform public._role_in(role, 'owner', 'manager', 'agronomist', 'field_supervisor');
      else perform public._role_in(role, 'owner', 'manager', 'agronomist'); end if;
      select c.id into v from crops c join fields f on f.id = c."fieldId" join farms fa on fa.id = f."farmId" where c.id::text = seg[2] and fa."organizationId" = org;
      if v is null then perform public._msg(404, 'The crop does not exist'); end if;
      update crops set
        "cropType" = coalesce(nullif(trim(b->>'cropType'), ''), "cropType"),
        variety = case when b ? 'variety' then nullif(b->>'variety', '') else variety end,
        "plantingDate" = coalesce(nullif(b->>'plantingDate', '')::date, "plantingDate"),
        "expectedHarvestDate" = case when b ? 'expectedHarvestDate' then nullif(b->>'expectedHarvestDate', '')::date else "expectedHarvestDate" end,
        "growthStage" = coalesce(nullif(b->>'growthStage', '')::crops_growthstage_enum, "growthStage")
      where id = v returning to_jsonb(crops.*) into res;
    elsif m = 'DELETE' and seg[1] = 'crops' and array_length(seg, 1) = 2 then
      perform public._role_in(role, 'owner', 'manager', 'agronomist');
      select c.id into v from crops c join fields f on f.id = c."fieldId" join farms fa on fa.id = f."farmId" where c.id::text = seg[2] and fa."organizationId" = org;
      if v is null then perform public._msg(404, 'The crop does not exist'); end if;
      delete from crops where id = v;
      res := jsonb_build_object('id', v, 'deleted', true);

    -- activities ---------------------------------------------------
    elsif m = 'GET' and seg[1] = 'activities' and seg[2] = 'by-field' and array_length(seg, 1) = 3 then
      fid := public._field_of_org(seg[3], org);
      select coalesce(jsonb_agg(to_jsonb(a) || jsonb_build_object('date', to_char(a.date, 'YYYY-MM-DD')) order by a.date desc, a."createdAt" desc), '[]'::jsonb)
      into res from activity_logs a where a."fieldId" = fid;
    elsif m = 'GET' and seg[1] = 'activities' and seg[2] = 'by-farm' and array_length(seg, 1) = 3 then
      v := public._farm_of_org(seg[3], org);
      select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'fieldId', a."fieldId", 'fieldName', f.name, 'type', a.type, 'date', to_char(a.date, 'YYYY-MM-DD'),
               'notes', a.notes, 'product', a.product, 'rate', a.rate, 'unit', a.unit, 'createdAt', a."createdAt") order by a.date desc, a."createdAt" desc), '[]'::jsonb)
      into res
      from activity_logs a join fields f on f.id = a."fieldId"
      where f."farmId" = v and f."archivedAt" is null
        and (nullif(q->>'from', '') is null or a.date >= (q->>'from')::date)
        and (nullif(q->>'to', '') is null or a.date <= (q->>'to')::date);
    elsif m = 'POST' and path = '/activities' then
      perform public._role_in(role, variadic writers);
      fid := public._field_of_org(b->>'fieldId', org);
      insert into activity_logs ("fieldId", type, date, notes, product, rate, unit, "performedByUserId")
      values (fid, (b->>'type')::activity_logs_type_enum, (b->>'date')::date, nullif(b->>'notes', ''), nullif(b->>'product', ''),
              nullif(b->>'rate', '')::double precision, nullif(b->>'unit', ''), uid::text)
      returning to_jsonb(activity_logs.*) || jsonb_build_object('date', to_char(activity_logs.date, 'YYYY-MM-DD')) into res;
      st := 201;
    elsif m = 'DELETE' and seg[1] = 'activities' and array_length(seg, 1) = 2 then
      perform public._role_in(role, variadic writers);
      select a.id into v from activity_logs a join fields f on f.id = a."fieldId" join farms fa on fa.id = f."farmId" where a.id::text = seg[2] and fa."organizationId" = org;
      if v is null then perform public._msg(404, 'The activity does not exist'); end if;
      delete from activity_logs where id = v;
      res := jsonb_build_object('id', v, 'deleted', true);

    -- scout tasks --------------------------------------------------
    elsif m = 'GET' and seg[1] = 'scout-tasks' and seg[2] = 'by-farm' and array_length(seg, 1) = 3 then
      v := public._farm_of_org(seg[3], org);
      select coalesce(jsonb_agg(to_jsonb(t) || jsonb_build_object('dueDate', to_char(t."dueDate", 'YYYY-MM-DD'), 'fieldName', f.name)
             order by (t.status = 'done'), t."dueDate" nulls last, t."createdAt" desc), '[]'::jsonb)
      into res from scout_tasks t join fields f on f.id = t."fieldId" where f."farmId" = v and f."archivedAt" is null;
    elsif m = 'POST' and path = '/scout-tasks' then
      perform public._role_in(role, variadic writers);
      fid := public._field_of_org(b->>'fieldId', org);
      if coalesce(trim(b->>'title'), '') = '' then perform public._msg(400, 'title should not be empty'); end if;
      insert into scout_tasks ("fieldId", title, issue, priority, "dueDate", lat, lng, assignee, notes, "createdByUserId")
      values (fid, left(trim(b->>'title'), 200), coalesce(nullif(b->>'issue', ''), 'other'), coalesce(nullif(b->>'priority', ''), 'medium'),
              nullif(b->>'dueDate', '')::date, (b->>'lat')::double precision, (b->>'lng')::double precision, nullif(b->>'assignee', ''), nullif(b->>'notes', ''), uid::text)
      returning to_jsonb(scout_tasks.*) || jsonb_build_object('dueDate', to_char(scout_tasks."dueDate", 'YYYY-MM-DD')) into res;
      st := 201;
    elsif m in ('PATCH', 'DELETE') and seg[1] = 'scout-tasks' and array_length(seg, 1) = 2 then
      perform public._role_in(role, variadic writers);
      select t.id into v from scout_tasks t join fields f on f.id = t."fieldId" join farms fa on fa.id = f."farmId" where t.id::text = seg[2] and fa."organizationId" = org;
      if v is null then perform public._msg(404, 'The task does not exist'); end if;
      if m = 'DELETE' then
        delete from scout_tasks where id = v; res := jsonb_build_object('id', v, 'deleted', true);
      else
        update scout_tasks set
          title = coalesce(nullif(trim(b->>'title'), ''), title), issue = coalesce(nullif(b->>'issue', ''), issue),
          priority = coalesce(nullif(b->>'priority', ''), priority), status = coalesce(nullif(b->>'status', ''), status),
          "dueDate" = case when b ? 'dueDate' then nullif(b->>'dueDate', '')::date else "dueDate" end,
          assignee = case when b ? 'assignee' then nullif(b->>'assignee', '') else assignee end,
          notes = case when b ? 'notes' then nullif(b->>'notes', '') else notes end,
          "closedAt" = case when b ? 'status' then case when b->>'status' = 'done' then now() else null end else "closedAt" end
        where id = v returning to_jsonb(scout_tasks.*) || jsonb_build_object('dueDate', to_char(scout_tasks."dueDate", 'YYYY-MM-DD')) into res;
      end if;

    else
      perform public._msg(404, format('Cannot %s /api/v1%s', m, path));
    end if;
  exception
    when sqlstate 'P0001' then
      get stacked diagnostics msg = message_text, hint = pg_exception_hint;
      if hint is null or hint not like 'api:%' then
        return jsonb_build_object('status', 400, 'body', jsonb_build_object('statusCode', 400, 'message', msg));
      end if;
      st := substring(hint from 5)::int;
      return jsonb_build_object('status', st, 'body', jsonb_build_object('statusCode', st) || msg::jsonb);
    when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or not_null_violation or check_violation
         or numeric_value_out_of_range or string_data_right_truncation or foreign_key_violation then
      get stacked diagnostics msg = message_text;
      return jsonb_build_object('status', 400, 'body', jsonb_build_object('statusCode', 400, 'message', msg));
  end;
  return jsonb_build_object('status', st, 'body', res);
end $$;

revoke all on function public.api(text, text, jsonb, jsonb) from public, anon;
grant execute on function public.api(text, text, jsonb, jsonb) to authenticated;

-- ------------------------------------------------------------------ accounts

-- The signed-in user's profile for the page header and roles.
create or replace function public.me() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', u.id, 'email', u.email, 'fullName', u."fullName", 'role', u.role, 'organizationId', u."organizationId",
                            'organizationName', o.name)
  from users u join organizations o on o.id = u."organizationId" where u.id = auth.uid() and u."isActive"
$$;
revoke all on function public.me() from public, anon;
grant execute on function public.me() to authenticated;

-- One Supabase sign-in (auth.users + auth.identities) for a profile row, with a bcrypt hash.
create or replace function public._auth_account(p_id uuid, p_email text, p_hash text) returns void
language plpgsql security definer set search_path = public, extensions, auth as $$
begin
  delete from auth.identities where user_id <> p_id and provider = 'email' and lower(identity_data->>'email') = lower(p_email);
  delete from auth.users where id <> p_id and lower(email) = lower(p_email);
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current,
                          phone_change, phone_change_token, reauthentication_token,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous)
  values ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated', lower(p_email), p_hash, now(),
          '', '', '', '', '', '', '', '',
          '{"provider":"email","providers":["email"]}', '{}', now(), now(), false, false)
  on conflict (id) do update set email = excluded.email, encrypted_password = excluded.encrypted_password,
                                 email_confirmed_at = coalesce(auth.users.email_confirmed_at, now()), updated_at = now();
  insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), p_id, p_id::text, 'email',
          jsonb_build_object('sub', p_id::text, 'email', lower(p_email), 'email_verified', true, 'phone_verified', false), now(), now(), now())
  on conflict (provider_id, provider) do update set identity_data = excluded.identity_data, updated_at = now();
end $$;
revoke all on function public._auth_account(uuid, text, text) from public, anon, authenticated;

-- After copying users from the old server: every profile gets a sign-in with its old password.
create or replace function public.sync_auth_users() returns int
language plpgsql security definer set search_path = public, extensions, auth as $$
declare u record; n int := 0;
begin
  for u in select id, email, "passwordHash" from public.users where "passwordHash" is not null loop
    perform public._auth_account(u.id, u.email, u."passwordHash"); n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.sync_auth_users() from public, anon, authenticated;

-- "Create an organization": the organization, its owner profile and the sign-in, in one step.
-- The page then signs in with the same email and password.
create or replace function public.register_account(p_organization text, p_full_name text, p_email text, p_password text) returns jsonb
language plpgsql security definer set search_path = public, extensions, auth as $$
declare oid uuid; uid uuid := gen_random_uuid(); em text := lower(trim(coalesce(p_email, '')));
begin
  if coalesce(trim(p_organization), '') = '' then return jsonb_build_object('ok', false, 'message', 'organizationName should not be empty'); end if;
  if coalesce(trim(p_full_name), '') = '' then return jsonb_build_object('ok', false, 'message', 'fullName should not be empty'); end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return jsonb_build_object('ok', false, 'message', 'email must be an email'); end if;
  if length(coalesce(p_password, '')) < 8 then return jsonb_build_object('ok', false, 'message', 'password must be longer than or equal to 8 characters'); end if;
  if exists (select 1 from public.users where lower(email) = em) or exists (select 1 from auth.users where lower(email) = em) then
    return jsonb_build_object('ok', false, 'message', 'This email is already registered. Sign in instead');
  end if;
  insert into organizations (name) values (left(trim(p_organization), 200)) returning id into oid;
  insert into users (id, email, "passwordHash", "fullName", role, "organizationId")
  values (uid, em, null, left(trim(p_full_name), 200), 'owner', oid);
  perform public._auth_account(uid, em, crypt(p_password, gen_salt('bf', 10)));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.register_account(text, text, text, text) from public;
grant execute on function public.register_account(text, text, text, text) to anon, authenticated;

-- The owner account the sign-in page offers (demo@agrocloud.test / Demo12345!), as the old server
-- seeded it on every start. Change its password in Supabase for any real use.
create or replace function public.ensure_owner() returns void
language plpgsql security definer set search_path = public, extensions, auth as $$
declare oid uuid; uid uuid;
begin
  select id into uid from public.users where lower(email) = 'demo@agrocloud.test';
  if uid is null then
    insert into organizations (name) values ('AgroSyntra One') returning id into oid;
    insert into users (email, "passwordHash", "fullName", role, "organizationId")
    values ('demo@agrocloud.test', crypt('Demo12345!', gen_salt('bf', 10)), 'Owner', 'owner', oid) returning id into uid;
  end if;
  if not exists (select 1 from auth.users where id = uid) then
    perform public._auth_account(uid, 'demo@agrocloud.test', (select "passwordHash" from public.users where id = uid));
  end if;
end $$;
revoke all on function public.ensure_owner() from public, anon, authenticated;

-- The helpers run only inside api() and the account functions (as their owner); nobody calls them directly.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like '\_%' escape '\' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

-- fixed search_path on the remaining helpers (Supabase advisor: function_search_path_mutable)
alter function public._fail(int, jsonb) set search_path = public;
alter function public._msg(int, text, jsonb) set search_path = public;
alter function public._fmt_ha(double precision) set search_path = public;
alter function public._normalize_polygon(jsonb) set search_path = public;
alter function public._role_in(text, text[]) set search_path = public;
