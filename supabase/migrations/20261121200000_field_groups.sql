-- Field groups (a layer tree like ArcGIS Online group layers): a field belongs to at most one named group per farm.
alter table public.fields add column if not exists "groupName" varchar(120);

create or replace function public._field_json(p_id uuid) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object('id', id, 'name', name, 'farmId', "farmId", 'irrigation', irrigation, 'groupName', "groupName",
                            'areaHectares', "areaHectares", 'createdAt', "createdAt", 'archivedAt', "archivedAt")
  from fields where id = p_id
$$;
revoke all on function public._field_json(uuid) from public, anon, authenticated;

-- api() gains "groupName" on PATCH /fields/:id ('' or null leaves the group); everything else is the existing router.
do $$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = '_api_core') then
    alter function public.api(text, text, jsonb, jsonb) rename to _api_core;
  end if;
end $$;
revoke all on function public._api_core(text, text, jsonb, jsonb) from public, anon, authenticated;

create or replace function public.api(p_method text, p_path text, p_query jsonb default '{}'::jsonb, p_body jsonb default null)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  seg text[] := string_to_array(trim(both '/' from coalesce(p_path, '')), '/');
  me users; fid uuid; g text; rest jsonb;
begin
  if upper(p_method) = 'PATCH' and seg[1] = 'fields' and array_length(seg, 1) = 2 and p_body ? 'groupName' then
    select * into me from users where id = auth.uid() and "isActive";
    if me.id is null then return jsonb_build_object('status', 401, 'body', jsonb_build_object('statusCode', 401, 'message', 'Sign in again')); end if;
    if not (me.role::text = any (array['owner', 'manager', 'gis_analyst'])) then
      return jsonb_build_object('status', 403, 'body', jsonb_build_object('statusCode', 403, 'message', 'Your role cannot do this. Ask the owner or a manager'));
    end if;
    select f.id into fid from fields f join farms fa on fa.id = f."farmId" where f.id::text = seg[2] and fa."organizationId" = me."organizationId";
    if fid is null then return jsonb_build_object('status', 404, 'body', jsonb_build_object('statusCode', 404, 'message', 'The field does not exist')); end if;
    g := nullif(left(trim(coalesce(p_body->>'groupName', '')), 120), '');
    update fields set "groupName" = g where id = fid;
    rest := p_body - 'groupName';
    if rest = '{}'::jsonb then return jsonb_build_object('status', 200, 'body', public._field_json(fid)); end if;
    return public._api_core(p_method, p_path, p_query, rest);
  end if;
  return public._api_core(p_method, p_path, p_query, p_body);
end $$;
revoke all on function public.api(text, text, jsonb, jsonb) from public, anon;
grant execute on function public.api(text, text, jsonb, jsonb) to authenticated;
