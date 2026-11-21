"""Session renewal: an expired access token is renewed with the refresh token, silently; a bad refresh token signs out but keeps preferences."""
import sys, os, json, urllib.request, urllib.error
sys.path.insert(0, os.path.dirname(__file__))
from playwright.sync_api import sync_playwright, expect
import cdn_routes
S = os.environ['WORK'] + '/'
API = 'http://localhost:4000/api/v1'
login = cdn_routes.fresh_login(); tok = login['accessToken']; rt = login['refreshToken']
def call(m, p, b=None, t=None):
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else None, method=m, headers={'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + t} if t else {})})
    return json.load(urllib.request.urlopen(r))
farm = call('POST', '/farms', {'name': 'Session farm'}, tok)
fc = json.load(open(S + 'fixtures/fields.geojson'))
call('POST', '/fields/bulk', {'farmId': farm['id'], 'fields': [{'name': 'Pivot 1', 'boundary': [f for f in fc['features'] if f['geometry']['type'] == 'Polygon'][0]['geometry']}]}, tok)
ok = True
def check(label, cond, extra=''):
    global ok; ok &= bool(cond); print(('PASS ' if cond else 'FAIL ') + label, str(extra)[:200], flush=True)
# API
r = call('POST', '/auth/refresh', {'refreshToken': rt})
check('refresh returns a new pair', r.get('accessToken') and r.get('refreshToken') and r['user']['email'] == login['user']['email'])
try: call('POST', '/auth/refresh', {'refreshToken': 'not-a-real-token-xyz'}); bad = False
except urllib.error.HTTPError as e: bad = e.code == 401
check('bad refresh token is refused with 401', bad)
try: call('POST', '/auth/refresh', {'refreshToken': tok}); acc = False
except urllib.error.HTTPError as e: acc = e.code == 401
check('an access token is not accepted as a refresh token', acc)
# an expired-looking access token: signed elsewhere, so the API answers 401
EXPIRED = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ4IiwiZXhwIjoxfQ.c2lnbmF0dXJl'
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 1400, 'height': 850})
    ctx.add_init_script(f"if (!sessionStorage.k) {{ sessionStorage.k = 1; localStorage.setItem('imgProvider', 'es'); localStorage.setItem('areaUnit', 'ac'); localStorage.setItem('theme', 'dark'); localStorage.setItem('accessToken', '{EXPIRED}'); localStorage.setItem('refreshToken', {json.dumps(r['refreshToken'])}); localStorage.setItem('user', {json.dumps(json.dumps(login['user']))}); }}")
    pg = ctx.new_page(); cdn_routes.install(pg); errors = []; pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(f"https://alkamelgis.github.io/AgroCloud_Vision/workspace.html?farm={farm['id']}")
    expect(pg.locator('#fieldsList .field-card')).to_have_count(1, timeout=30000)
    check('expired token renewed silently, fields load', 'workspace.html' in pg.url and pg.evaluate("localStorage.getItem('accessToken')") != EXPIRED)
    check('area unit preference applied (acres)', ' ac' in pg.inner_text('#fieldsList .field-card'))
    # break the refresh token too: next 401 signs out but keeps preferences
    pg.evaluate(f"localStorage.setItem('refreshToken', 'broken-refresh-token'); token = '{EXPIRED}';")
    with pg.expect_navigation(timeout=30000):
        pg.evaluate("apiGet('/farms').catch(() => {})")
    pg.wait_for_timeout(800)
    check('failed renewal goes to sign-in', 'main.html' in pg.url, pg.url)
    keep = pg.evaluate("[localStorage.getItem('areaUnit'), localStorage.getItem('theme'), localStorage.getItem('accessToken')]")
    check('preferences kept, tokens removed', keep[0] == 'ac' and keep[1] == 'dark' and keep[2] is None, keep)
    check('no page errors', not errors, errors)
    b.close()
print('ALL PASS' if ok else 'SOME FAILED')
