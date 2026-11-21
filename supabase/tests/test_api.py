"""Checks public.api() (supabase/migrations/*_api.sql) the way the site calls it.

Runs against a Postgres with PostGIS and the migration applied:
  SB_DSN=postgresql://postgres@localhost/sbtest python3 supabase/tests/test_api.py
Each call sets request.jwt.claim.sub, which auth.uid() reads, inside its own transaction that is rolled back
at the end unless KEEP=1, so it can run on the real project without leaving data behind.
"""
import json, os, sys, uuid
import psycopg2

DSN = os.environ.get('SB_DSN', 'dbname=sbtest user=postgres')
conn = psycopg2.connect(DSN); conn.autocommit = False
cur = conn.cursor()
ok = True
def check(label, cond, extra=''):
    global ok; ok &= bool(cond); print(('PASS ' if cond else 'FAIL ') + label, str(extra)[:400], flush=True)

def as_user(uid):
    cur.execute("select set_config('request.jwt.claim.sub', %s, true)", (str(uid) if uid else '',))
def api(uid, method, path, body=None, query=None):
    as_user(uid)
    cur.execute('select public.api(%s, %s, %s::jsonb, %s::jsonb)', (method, path, json.dumps(query or {}), json.dumps(body) if body is not None else None))
    r = cur.fetchone()[0]
    return r['status'], r['body']

def sq(lng, lat, d=0.003):   # a square of about d degrees
    return {'type': 'Polygon', 'coordinates': [[[lng, lat], [lng + d, lat], [lng + d, lat + d], [lng, lat + d], [lng, lat]]]}

# two organizations made through register_account, like the sign-in page does
tag = uuid.uuid4().hex[:8]
def register(org, email):
    cur.execute('select public.register_account(%s, %s, %s, %s)', (org, 'Tester', email, 'Secret123!'))
    r = cur.fetchone()[0]
    cur.execute('select id from public.users where email = %s', (email,))
    return r, cur.fetchone()[0]
r, A = register('Org A ' + tag, f'a{tag}@test.local')
check('register: ok', r.get('ok'), r)
cur.execute('select count(*) from auth.users where id = %s', (A,)); check('register: sign-in created', cur.fetchone()[0] == 1)
cur.execute('select count(*) from auth.identities where user_id = %s', (A,)); check('register: identity created', cur.fetchone()[0] == 1)
r2, B = register('Org B ' + tag, f'b{tag}@test.local')
r3, _ = (lambda: (cur.execute('select public.register_account(%s,%s,%s,%s)', ('X', 'Y', f'a{tag}@test.local', 'Secret123!')), cur.fetchone()[0])[1])(), None
check('register: same email refused', r3 and r3.get('ok') is False, r3)
cur.execute('select public.register_account(%s,%s,%s,%s)', ('X', 'Y', 'not-an-email', 'Secret123!')); check('register: bad email refused', cur.fetchone()[0]['ok'] is False)
cur.execute('select public.register_account(%s,%s,%s,%s)', ('X', 'Y', f'c{tag}@test.local', 'short')); check('register: short password refused', cur.fetchone()[0]['ok'] is False)

s, b = api(None, 'GET', '/farms'); check('no sign-in → 401', s == 401, b)
s, b = api(A, 'GET', '/organizations/me'); check('organization of the user', s == 200 and b['name'] == 'Org A ' + tag, b)
as_user(A); cur.execute('select public.me()'); me = cur.fetchone()[0]; check('me(): owner of Org A', me['role'] == 'owner' and me['organizationName'] == 'Org A ' + tag, me)

s, farm = api(A, 'POST', '/farms', {'name': 'North'}); check('create farm 201', s == 201 and farm['name'] == 'North', farm)
s, farm2 = api(A, 'POST', '/farms', {'name': 'South'})
s, b = api(A, 'POST', '/farms', {'name': ' '}); check('farm needs a name', s == 400, b)
s, farms = api(A, 'GET', '/farms'); check('list farms', s == 200 and len(farms) == 2 and farms[0]['fields'] == [], [f['name'] for f in farms])
s, b = api(B, 'GET', '/farms/' + farm['id']); check('other organization cannot read the farm', s == 404, b)

L0, T0 = 54.30, 24.40
s, f1 = api(A, 'POST', '/fields', {'farmId': farm['id'], 'boundary': sq(L0, T0)}); check('create field, auto name', s == 201 and f1['name'] == 'Field 1' and 8 < f1['areaHectares'] < 12, f1)
s, f2 = api(A, 'POST', '/fields', {'farmId': farm['id'], 'boundary': sq(L0 + 0.01, T0), 'name': 'Pivot 2', 'irrigation': 'pivot'}); check('create named field', s == 201 and f2['name'] == 'Pivot 2' and f2['irrigation'] == 'pivot', f2)
s, b = api(A, 'POST', '/fields', {'farmId': farm['id'], 'boundary': sq(L0 + 0.05, T0, 0.00005)}); check('too small → 400 FIELD_GEOMETRY', s == 400 and b['code'] == 'FIELD_GEOMETRY' and 'too small' in b['message'], b)
bow = {'type': 'Polygon', 'coordinates': [[[L0 + .1, T0], [L0 + .103, T0 + .003], [L0 + .103, T0], [L0 + .1, T0 + .003], [L0 + .1, T0]]]}
s, b = api(A, 'POST', '/fields', {'farmId': farm['id'], 'boundary': bow}); check('crossing edges → 400 with where', s == 400 and 'crosses itself' in b['message'] and 'where' in b, b)
s, b = api(A, 'POST', '/fields', {'farmId': farm['id'], 'boundary': {'type': 'Polygon', 'coordinates': [[[L0, T0], [L0 + 1, T0]]]}}); check('two corners → 400', s == 400 and 'three corners' in b['message'], b)
s, b = api(A, 'POST', '/fields', {'farmId': farm['id'], 'boundary': {'type': 'Polygon', 'coordinates': [[[200, T0], [L0 + 1, T0], [L0, T0 + 1]]]}}); check('out of range → 400', s == 400 and 'WGS84' in b['message'], b)
s, b = api(A, 'POST', '/fields', {'farmId': farm['id'], 'boundary': sq(L0 + 0.0015, T0)}); check('overlap → 409 FIELD_OVERLAP', s == 409 and b['code'] == 'FIELD_OVERLAP' and b['conflicts'][0]['name'] == 'Field 1', b)
s, c = api(A, 'POST', '/fields', {'farmId': farm['id'], 'boundary': sq(L0 + 0.0015, T0), 'overlap': 'clip', 'name': 'Clipped'}); check('clip cuts the overlap', s == 201 and c['clippedHa'] > 1 and c['areaHectares'] < 6, c)
s, b = api(A, 'POST', '/fields', {'farmId': farm['id'], 'boundary': sq(L0, T0)}); check('duplicate → 409 FIELD_DUPLICATE', s == 409 and b['code'] == 'FIELD_DUPLICATE', b)
s, cp = api(A, 'POST', '/fields', {'farmId': farm['id'], 'boundary': sq(L0, T0), 'name': 'Field 1 copy', 'copyOf': f1['id']}); check('copy of a field is allowed', s == 201 and cp['overlapsKept'] >= 1, cp)
s, b = api(A, 'POST', '/fields', {'farmId': farm['id'], 'boundary': sq(L0, T0), 'name': 'x', 'copyOf': f2['id']}); check('copy may not sit on a third field', s == 409, b)
s, b = api(A, 'POST', '/fields/check', {'boundary': sq(L0 + 0.0015, T0)}); check('check: overlaps listed', s == 201 and b['ok'] and len(b['conflicts']) >= 1, b)
s, b = api(A, 'POST', '/fields/check', {'boundary': bow}); check('check: invalid shape reported, not thrown', s == 201 and b['ok'] is False and b['code'] == 'FIELD_GEOMETRY', b)
s, b = api(B, 'POST', '/fields/check', {'boundary': sq(L0, T0)}); check('check: other organizations are not conflicts', b['conflicts'] == [], b)

s, b = api(A, 'POST', '/fields/bulk', {'farmId': farm['id'], 'fields': [{'boundary': sq(L0 + .02, T0)}, {'boundary': sq(L0, T0)}, {'boundary': bow, 'name': 'Bad'}]})
check('bulk reject: nothing saved, problems listed', s == 409 and b['code'] == 'FIELD_IMPORT_PROBLEMS' and len(b['problems']) == 2, b)
s, fl = api(A, 'GET', '/fields/by-farm/' + farm['id']); n0 = len(fl)
s, b = api(A, 'POST', '/fields/bulk', {'farmId': farm['id'], 'overlap': 'skip', 'fields': [{'boundary': sq(L0 + .02, T0)}, {'boundary': sq(L0 + .03, T0)}, {'boundary': sq(L0, T0)}]})
check('bulk skip: two saved, one skipped, names continue', s == 201 and len(b['fields']) == 2 and len(b['skipped']) == 1 and [x['name'] for x in b['fields']] == ['Field 2', 'Field 3'], b)

s, b = api(A, 'PATCH', '/fields/' + f2['id'], {'name': 'Pivot 2 North', 'irrigation': ''}); check('rename + clear irrigation', s == 200 and b['name'] == 'Pivot 2 North' and b['irrigation'] is None, b)
s, b = api(A, 'PATCH', '/fields/' + f2['id'], {'name': '  '}); check('empty name refused', s == 400, b)
s, b = api(A, 'PATCH', '/fields/' + f2['id'], {'boundary': sq(L0 + 0.01, T0, 0.004)}); check('boundary edit recomputes area', s == 200 and b['areaHectares'] > 15, b)
s, h = api(A, 'GET', f"/fields/{f2['id']}/history"); ev = [x['event'] for x in h]
check('history: created, edited, renamed, irrigation', {'created', 'boundary_edited', 'renamed', 'irrigation'} <= set(ev), ev)
first = [x for x in h if x['event'] == 'created'][0]
s, b = api(A, 'POST', f"/fields/{f2['id']}/history/{first['id']}/restore", {}); check('restore an old boundary', s == 201 and 8 < b['areaHectares'] < 12, b)
s, b = api(A, 'PATCH', '/fields/' + cp['id'], {'farmId': farm2['id']}); check('move to another farm', s == 200 and b['farmId'] == farm2['id'], b)
s, b = api(A, 'PATCH', '/fields/' + cp['id'], {'farmId': str(uuid.uuid4())}); check('move to a farm of nobody → 404', s == 404, b)

s, crop = api(A, 'POST', '/crops', {'fieldId': f1['id'], 'cropType': 'Alfalfa', 'plantingDate': '2026-10-01'}); check('add crop', s == 201 and crop['growthStage'] == 'planted', crop)
s, b = api(A, 'PATCH', f"/crops/{crop['id']}", {'growthStage': 'vegetative'}); check('crop stage', s == 200 and b['growthStage'] == 'vegetative', b)
s, b = api(A, 'PATCH', f"/crops/{crop['id']}", {'growthStage': 'nonsense'}); check('bad stage → 400', s == 400, b)
s, b = api(A, 'GET', '/fields/by-farm/' + farm['id']); check('fields list carries crops', any(x['crops'] for x in b))
s, act = api(A, 'POST', '/activities', {'fieldId': f1['id'], 'type': 'fertilization', 'date': '2026-11-03', 'product': 'Urea', 'rate': 120, 'unit': 'kg/ha'}); check('log activity', s == 201 and act['date'] == '2026-11-03', act)
s, b = api(A, 'GET', '/activities/by-farm/' + farm['id'], query={'from': '2026-11-01', 'to': '2026-11-30'}); check('activities by farm in range', s == 200 and len(b) == 1 and b[0]['fieldName'] == 'Field 1', b)
s, b = api(A, 'GET', '/activities/by-farm/' + farm['id'], query={'from': '2026-12-01'}); check('activities out of range', b == [], b)
s, task = api(A, 'POST', '/scout-tasks', {'fieldId': f1['id'], 'title': 'Check pump', 'lat': T0, 'lng': L0}); check('scout task', s == 201 and task['status'] == 'open', task)
s, b = api(A, 'PATCH', f"/scout-tasks/{task['id']}", {'status': 'done'}); check('scout task done', b['status'] == 'done' and b['closedAt'], b)
s, b = api(B, 'DELETE', f"/scout-tasks/{task['id']}"); check('other organization cannot delete the task', s == 404, b)

s, b = api(A, 'POST', f"/fields/{f1['id']}/restore", {}); check('restore of a live field is a no-op', s == 201)
api(A, 'DELETE', '/fields/' + cp['id'], query={'permanent': 'true'})
s, b = api(A, 'DELETE', '/fields/' + f1['id']); check('archive', s == 200 and b['permanent'] is False, b)
s, b = api(A, 'GET', '/fields/archived', query={'farmId': farm['id']}); check('archived list', [x['id'] for x in b] == [f1['id']], b)
s, b = api(A, 'GET', '/fields/by-farm/' + farm['id']); check('archived field off the farm', f1['id'] not in [x['id'] for x in b])
s, b = api(A, 'POST', f"/fields/{f1['id']}/restore", {}); check('restore', s == 201 and b['archivedAt'] is None, b)
s, b = api(A, 'DELETE', '/fields/' + f1['id'], query={'permanent': 'true'}); check('delete forever with crops, activities, tasks', s == 200 and b['permanent'], b)
s, b = api(A, 'GET', '/fields/' + f1['id']); check('gone', s == 404, b)

s, fc = api(A, 'GET', f"/fields/by-farm/{farm['id']}/boundaries.geojson"); check('boundaries as GeoJSON', fc['type'] == 'FeatureCollection' and all(x['geometry']['type'] == 'Polygon' for x in fc['features']), len(fc['features']))
s, b = api(A, 'GET', f"/fields/{f2['id']}/boundary.geojson"); check('one boundary', b['type'] == 'Polygon')
s, b = api(A, 'GET', '/nothing/here'); check('unknown route → 404 "Cannot"', s == 404 and b['message'].startswith('Cannot GET'), b)

# roles: a viewer in Org A reads but cannot write
V = str(uuid.uuid4())
cur.execute("insert into public.users (id, email, \"fullName\", role, \"organizationId\") select %s, %s, 'Viewer', 'viewer', \"organizationId\" from public.users where id = %s", (V, f'v{tag}@test.local', A))
s, b = api(V, 'GET', '/farms'); check('viewer reads', s == 200 and len(b) == 2)
s, b = api(V, 'POST', '/fields', {'farmId': farm['id'], 'boundary': sq(L0 + .5, T0)}); check('viewer cannot add fields → 403', s == 403, b)
s, b = api(V, 'DELETE', '/fields/' + f2['id']); check('viewer cannot delete → 403', s == 403, b)

if os.environ.get('KEEP') == '1': conn.commit()
else: conn.rollback()
print('ALL PASS' if ok else 'SOME FAILED')
