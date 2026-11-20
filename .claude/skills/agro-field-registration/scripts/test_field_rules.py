"""API rules for saving fields: validation, repair, overlaps, history, delete/restore. Uses a fresh organization."""
import json, time, urllib.request, urllib.error
API = 'http://localhost:4000/api/v1'
def call(m, p, b=None, tok=None):
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else None, method=m,
        headers={'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + tok} if tok else {})})
    try:
        x = urllib.request.urlopen(r); return x.status, json.loads(x.read() or 'null')
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        try: return e.code, json.loads(body)
        except Exception: return e.code, body
ok = True
def check(label, cond, extra=''):
    global ok; ok &= bool(cond); print(('PASS ' if cond else 'FAIL ') + label, str(extra)[:180])
stamp = str(int(time.time() * 1000))
s, reg = call('POST', '/auth/register', {'organizationName': 'Rules ' + stamp, 'fullName': 'Rules', 'email': f'rules{stamp}@agrocloud.test', 'password': 'Rules12345!'})
t = reg.get('accessToken') or call('POST', '/auth/login', {'email': f'rules{stamp}@agrocloud.test', 'password': 'Rules12345!'})[1]['accessToken']
farm = call('POST', '/farms', {'name': 'North'}, t)[1]; fid = farm['id']
farm2 = call('POST', '/farms', {'name': 'South'}, t)[1]
def sq(x, y, d=0.01): return {'type': 'Polygon', 'coordinates': [[[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]]]}

s, a = call('POST', '/fields', {'farmId': fid, 'boundary': sq(55.30, 25.20)}, t)
check('blank name gets "Field 1"', s == 201 and a['name'] == 'Field 1', a)
s, b = call('POST', '/fields', {'farmId': fid, 'name': '  ', 'boundary': sq(55.40, 25.20)}, t)
check('next blank name gets "Field 2"', s == 201 and b['name'] == 'Field 2', b.get('name'))
s, r = call('POST', '/fields', {'farmId': farm2['id'], 'name': 'Copy', 'boundary': sq(55.30, 25.20)}, t)
check('duplicate refused, even in another farm', s == 409 and r.get('code') == 'FIELD_DUPLICATE' and 'Field 1' in r['message'], r)
s, r = call('POST', '/fields', {'farmId': fid, 'name': 'Half', 'boundary': sq(55.305, 25.20)}, t)
check('overlap answers 409 with the list', s == 409 and r.get('code') == 'FIELD_OVERLAP' and r['conflicts'][0]['name'] == 'Field 1' and 50 < r['conflicts'][0]['overlapHa'] < 60, r)
s, r = call('POST', '/fields', {'farmId': fid, 'name': 'Half', 'boundary': sq(55.305, 25.20), 'overlap': 'clip'}, t)
check('clip cuts the overlap away', s == 201 and 50 < r['areaHectares'] < 60 and r['clippedHa'] > 50, {k: r.get(k) for k in ('areaHectares', 'clippedHa')})
s, r = call('POST', '/fields', {'farmId': fid, 'name': 'Shared', 'boundary': sq(55.395, 25.205), 'overlap': 'allow'}, t)
check('allow keeps the overlap', s == 201 and r['overlapsKept'] == 1, r.get('overlapsKept'))
s, r = call('POST', '/fields', {'farmId': fid, 'name': 'Edge', 'boundary': sq(55.315, 25.20)}, t)
check('touching edges are not an overlap', s == 201, r if s != 201 else '')
s, r = call('POST', '/fields', {'farmId': fid, 'name': 'Bow', 'boundary': {'type': 'Polygon', 'coordinates': [[[55.5, 25.2], [55.51, 25.21], [55.51, 25.2], [55.5, 25.21], [55.5, 25.2]]]}}, t)
check('self-crossing refused with a place', s == 400 and 'crosses itself' in r['message'] and r.get('where'), r)
s, r = call('POST', '/fields', {'farmId': fid, 'name': 'Open', 'boundary': {'type': 'Polygon', 'coordinates': [[[55.6, 25.2], [55.61, 25.2], [55.61, 25.21], [55.6, 25.21]]]}}, t)
check('open ring is closed', s == 201 and 100 < r['areaHectares'] < 120, r.get('areaHectares'))
spike = {'type': 'Polygon', 'coordinates': [[[55.7, 25.2], [55.71, 25.2], [55.71, 25.21], [55.71, 25.22], [55.71, 25.21], [55.7, 25.21], [55.7, 25.2]]]}
s, r = call('POST', '/fields', {'farmId': fid, 'name': 'Spike', 'boundary': spike}, t)
check('a spike is repaired', s == 201 and r.get('repaired') is True, r)
s, r = call('POST', '/fields', {'farmId': fid, 'name': 'Tiny', 'boundary': sq(55.8, 25.2, 0.00001)}, t)
check('too small refused', s == 400 and 'too small' in r['message'], r.get('message'))
s, r = call('POST', '/fields', {'farmId': fid, 'name': 'Huge', 'boundary': sq(50, 20, 6)}, t)
check('too large refused', s == 400 and 'too large' in r['message'], r.get('message'))
s, r = call('POST', '/fields', {'farmId': fid, 'name': 'Line', 'boundary': {'type': 'Polygon', 'coordinates': [[[55.9, 25.2], [55.91, 25.2], [55.92, 25.2], [55.9, 25.2]]]}}, t)
check('corners on one line refused', s == 400 and 'no area' in r['message'], r.get('message'))

s, r = call('POST', '/fields/check', {'boundary': sq(55.305, 25.205)}, t)
check('check reports overlaps without saving', s in (200, 201) and r['ok'] and len(r['conflicts']) >= 1, r.get('conflicts'))
s, r = call('POST', '/fields/check', {'boundary': sq(55.30, 25.20), 'excludeId': a['id']}, t)
check('check ignores the field being edited', s in (200, 201) and r['ok'] and not any(c['id'] == a['id'] for c in r['conflicts']), r)

# history
s, r = call('PATCH', f"/fields/{b['id']}", {'name': 'Pivot B', 'boundary': sq(55.40, 25.20, 0.012), 'overlap': 'allow'}, t)
check('edit boundary + rename', s == 200 and r['name'] == 'Pivot B' and r['areaHectares'] > 150, r.get('areaHectares'))
s, r = call('PATCH', f"/fields/{b['id']}", {'boundary': sq(55.30, 25.20)}, t)
check('edit onto another field is refused', s == 409 and r.get('code') == 'FIELD_DUPLICATE', r.get('code'))
s, h = call('GET', f"/fields/{b['id']}/history", None, t)
events = [x['event'] for x in h]
check('history lists created, edit and rename', events[:3] == ['boundary_edited', 'renamed', 'created'] or set(events) >= {'created', 'boundary_edited', 'renamed'}, events)
first = [x for x in h if x['event'] == 'created'][0]
s, r = call('POST', f"/fields/{b['id']}/history/{first['id']}/restore", {'overlap': 'allow'}, t)
check('restore an earlier boundary', s in (200, 201) and 105 < r['areaHectares'] < 120, r)
s, h = call('GET', f"/fields/{b['id']}/history", None, t)
check('restore is recorded', h[0]['event'] == 'boundary_restored' and h[0]['boundary'], h[0]['event'])

# delete and restore
s, r = call('DELETE', f"/fields/{a['id']}", None, t)
check('delete moves to recently deleted', s == 200 and r['permanent'] is False, r)
s, lst = call('GET', f'/fields/by-farm/{fid}', None, t)
check('deleted field leaves the farm list', all(x['id'] != a['id'] for x in lst), len(lst))
s, fc = call('GET', f'/fields/by-farm/{fid}/boundaries.geojson', None, t)
check('and the map', all(f['id'] != a['id'] for f in fc['features']))
s, farms = call('GET', '/farms', None, t)
check('and the farm count', all(x['id'] != a['id'] for fm in farms for x in fm['fields']))
s, arch = call('GET', f'/fields/archived?farmId={fid}', None, t)
check('recently deleted lists it', s == 200 and arch[0]['id'] == a['id'], arch)
s, r = call('POST', '/fields', {'farmId': fid, 'name': 'Over deleted', 'boundary': sq(55.30, 25.20, 0.004)}, t)
check('deleted fields do not block new ones', s == 201, r.get('message') if isinstance(r, dict) else r)
s, r = call('POST', f"/fields/{a['id']}/restore", {}, t)
check('restore checks overlaps', s == 409 and r.get('code') == 'FIELD_OVERLAP', r.get('code'))
s, r = call('POST', f"/fields/{a['id']}/restore", {'overlap': 'allow'}, t)
check('restore with allow', s in (200, 201) and r['id'] == a['id'], r)
s, lst = call('GET', f'/fields/by-farm/{fid}', None, t)
check('restored field is back', any(x['id'] == a['id'] for x in lst))
s, r = call('DELETE', f"/fields/{a['id']}?permanent=true", None, t)
s2, r2 = call('GET', f"/fields/{a['id']}", None, t)
check('permanent delete removes it', s == 200 and r['permanent'] and s2 == 404, (s, s2))

# bulk
items = [{'name': 'B1', 'boundary': sq(56.0, 25.2)}, {'name': 'B1 again', 'boundary': sq(56.0, 25.2)}, {'name': 'Bad', 'boundary': {'type': 'Polygon', 'coordinates': [[[56.1, 25.2], [56.11, 25.21], [56.11, 25.2], [56.1, 25.21], [56.1, 25.2]]]}}, {'name': 'B2', 'boundary': sq(56.2, 25.2)}]
s, r = call('POST', '/fields/bulk', {'farmId': fid, 'fields': items}, t)
check('bulk reject lists every problem and saves nothing', s == 409 and len(r['problems']) == 2 and {p['index'] for p in r['problems']} == {1, 2}, r.get('message'))
s, lst = call('GET', f'/fields/by-farm/{fid}', None, t)
check('nothing was saved', not any(x['name'] in ('B1', 'B2') for x in lst))
s, r = call('POST', '/fields/bulk', {'farmId': fid, 'fields': items, 'overlap': 'skip'}, t)
check('bulk skip saves the good ones', s == 201 and [x['name'] for x in r['fields']] == ['B1', 'B2'] and len(r['skipped']) == 2, {k: len(r[k]) for k in ('fields', 'skipped')} if isinstance(r, dict) else r)
s, r = call('POST', '/fields/bulk', {'farmId': fid, 'fields': [{'boundary': sq(56.4, 25.2)}, {'boundary': sq(56.5, 25.2)}], 'overlap': 'skip'}, t)
check('bulk names unnamed fields in order', [x['name'] for x in r['fields']] == ['Field 1', 'Field 2'], [x['name'] for x in r['fields']])

# isolation
s2, other = call('POST', '/auth/login', {'email': 'demo@agrocloud.test', 'password': 'Demo12345!'})
s, r = call('GET', f"/fields/{b['id']}/history", None, other['accessToken'])
check('another organization cannot read the history', s == 404, s)
print('ALL PASS' if ok else 'SOME FAILED')
