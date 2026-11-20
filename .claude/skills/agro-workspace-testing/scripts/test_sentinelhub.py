import sys, os, json, urllib.request, base64
sys.path.insert(0, os.path.dirname(__file__))
os.environ['SHMOCK'] = '1'
from playwright.sync_api import sync_playwright, expect
import cdn_routes
cdn_routes.SHMOCK = '1'
S = os.environ.get('WORK', os.getcwd()) + '/'
API = 'http://localhost:4000/api/v1'
def call(method, path, body=None, tok=None):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None, method=method,
        headers={'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + tok} if tok else {})})
    return json.load(urllib.request.urlopen(req))
login = call('POST', '/auth/login', {'email': 'demo@agrocloud.test', 'password': 'Demo12345!'}); tok = login['accessToken']
farm = call('POST', '/farms', {'name': 'SH farm'}, tok)
fc = json.load(open(S + 'fixtures/fields.geojson'))
call('POST', '/fields/bulk', {'farmId': farm['id'], 'fields': [{'name': f['properties'].get('name') or 'Strip', 'boundary': f['geometry']} for f in fc['features'] if f['geometry']['type'] == 'Polygon']}, tok)
ok = True
def check(label, cond, extra=''):
    global ok; ok &= bool(cond); print(('PASS ' if cond else 'FAIL ') + label, str(extra)[:200])
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 1600, 'height': 900})
    ctx.add_init_script(f"localStorage.setItem('accessToken', {json.dumps(tok)}); localStorage.setItem('user', {json.dumps(json.dumps(login['user']))}); localStorage.removeItem('imgProvider');")
    pg = ctx.new_page(); cdn_routes.install(pg); errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(f"https://alkamelgis.github.io/AgroCloud_Vision/workspace.html?farm={farm['id']}")
    expect(pg.locator('#tlChips [data-scene]')).to_have_count(2, timeout=30000)   # 60% cloud date hidden
    check('Sentinel Hub is the default source', pg.evaluate("Imagery.provider()") == 'sh' and pg.locator('#imgSource').input_value() == 'sh')
    check('dates come from WFS DSS2', any(q.get('TYPENAMES') == 'DSS2' for q in cdn_routes.SHLOG))
    check('ID kept out of query strings', all('60de79ca' not in json.dumps(q) for q in cdn_routes.SHLOG))  # id sits in the path, not the query
    pg.wait_for_function("Imagery.views[0].results.size >= 1", timeout=30000)
    r = pg.evaluate("(() => { const r = [...Imagery.views[0].results.values()][0]; return { mean: r.mean, cloud: r.cloudPct, ha: r.fieldHa, code: r.code }; })()")
    # nir 0.3..0.6, red 0.05 -> NDVI 0.71..0.85
    check('NDVI from Sentinel Hub pixels', 0.7 < r['mean'] < 0.86, r)
    check('cloud mask from SCL', r['cloud'] == 0, r)
    gm = [q for q in cdn_routes.SHLOG if q.get('REQUEST') == 'GetMap'][0]
    check('GetMap on UTM 10 m grid, layer from capabilities', gm['CRS'].startswith('EPSG:326') and gm['LAYERS'] == 'NDVI' and 'FLOAT32' in base64.b64decode(gm['EVALSCRIPT']).decode(), gm['CRS'])
    pg.wait_for_function("Imagery.riskFor && [...document.querySelectorAll('#fieldsList .field-card')].length && Imagery.state.risks.size >= 1", timeout=30000)
    risk = pg.evaluate("(() => { const v = [...Imagery.state.risks.values()][0]; return { kind: v.kind, change: v.change }; })()")
    check('risk vs previous clear date works', risk['kind'] in ('high', 'low') and risk['change'] < -0.03, risk)
    pg.select_option('#imgIndex', 'rgb'); pg.wait_for_timeout(1500)
    check('natural colour renders', pg.evaluate("Imagery.views[0].results.size") >= 1)
    pg.select_option('#imgSource', 'es')
    check('source switch remembered', pg.evaluate("localStorage.getItem('imgProvider')") == 'es')
    check('no JS errors', not errors, errors)
    b.close()
print('ALL PASS' if ok else 'SOME FAILED')
