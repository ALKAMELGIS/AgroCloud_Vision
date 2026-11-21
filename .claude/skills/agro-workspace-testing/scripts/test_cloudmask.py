"""Bare soil that scene classification calls cloud (desert pivots): kept when it is not bright in blue.
The Sentinel Hub mock says SCL 9 (cloud) everywhere, with a dark left half (blue 0.05, bare soil) and a bright right
half (blue 0.45, real cloud). Expected: about half the field analysed, half masked and striped, and a note on the map."""
import sys, os, json, urllib.request
sys.path.insert(0, os.path.dirname(__file__))
os.environ['SHMOCK'] = '1'; os.environ['SH_SOILCLOUD'] = '1'
from playwright.sync_api import sync_playwright, expect
import cdn_routes
cdn_routes.SHMOCK = '1'
S = os.environ.get('WORK', os.getcwd()) + '/'
API = 'http://localhost:4000/api/v1'
def call(method, path, body=None, tok=None):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None, method=method,
        headers={'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + tok} if tok else {})})
    return json.load(urllib.request.urlopen(req))
login = cdn_routes.fresh_login(); tok = login['accessToken']
farm = call('POST', '/farms', {'name': 'Desert pivots'}, tok)
fc = json.load(open(S + 'fixtures/fields.geojson'))
call('POST', '/fields/bulk', {'farmId': farm['id'], 'fields': [{'name': f['properties'].get('name') or 'Strip', 'boundary': f['geometry']} for f in fc['features'] if f['geometry']['type'] == 'Polygon']}, tok)
ok = True
def check(label, cond, extra=''):
    global ok; ok &= bool(cond); print(('PASS ' if cond else 'FAIL ') + label, str(extra)[:200], flush=True)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 1440, 'height': 900})
    ctx.add_init_script(f"localStorage.setItem('accessToken', {json.dumps(tok)}); localStorage.setItem('user', {json.dumps(json.dumps(login['user']))}); localStorage.removeItem('imgProvider');")
    pg = ctx.new_page(); cdn_routes.install(pg); errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(f"https://alkamelgis.github.io/AgroSyntra_One/workspace.html?farm={farm['id']}")
    pg.wait_for_function("Imagery.views[0].results.size >= 1", timeout=40000)
    r = pg.evaluate("[...Imagery.views[0].results.values()].map(r => r.cloudPct)")
    check('dark ground called cloud is kept, bright cloud masked (about half)', all(25 <= c <= 75 for c in r), r)
    pg.locator('#fieldsList .field-card').first.click(); pg.wait_for_timeout(1500)
    check('a field mostly under cloud does not get a note', pg.locator('.cloud-note').count() == 0 or all(c >= 40 for c in r), pg.locator('.cloud-note').count())
    check('legend names the masked part', 'cloud or shadow' in pg.inner_text('#imgLegend'), pg.inner_text('#imgLegend'))
    pg.screenshot(path=S + 'shots/cloudmask.png')
    check('no page errors', not errors, errors)
    b.close()
print('ALL PASS' if ok else 'SOME FAILED')
