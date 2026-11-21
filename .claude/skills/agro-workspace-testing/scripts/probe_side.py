import sys, os, json
sys.path.insert(0, os.path.dirname(__file__))
from playwright.sync_api import sync_playwright, expect
import cdn_routes
S = os.environ['WORK'] + '/'
login = cdn_routes.fresh_login(); tok = login['accessToken']
import urllib.request
def call(m, p, b=None):
    r = urllib.request.Request('http://localhost:4000/api/v1' + p, data=json.dumps(b).encode() if b is not None else None, method=m, headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok})
    return json.load(urllib.request.urlopen(r))
farm = call('POST', '/farms', {'name': 'Side'})
fc = json.load(open(S + 'fixtures/fields.geojson'))
call('POST', '/fields/bulk', {'farmId': farm['id'], 'fields': [{'name': 'AOI1', 'boundary': [f for f in fc['features'] if f['geometry']['type'] == 'Polygon'][0]['geometry']}]})
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    for lang in ['en', 'ar']:
        ctx = b.new_context(viewport={'width': 1366, 'height': 650})
        ctx.add_init_script(f"localStorage.setItem('lang', '{lang}'); localStorage.setItem('imgProvider', 'es'); localStorage.setItem('accessToken', {json.dumps(tok)}); localStorage.setItem('user', {json.dumps(json.dumps(login['user']))});")
        pg = ctx.new_page(); cdn_routes.install(pg)
        pg.goto(f"https://alkamelgis.github.io/AgroSyntra_One/workspace.html?farm={farm['id']}")
        expect(pg.locator('#fieldsList .field-card')).to_have_count(1); pg.wait_for_timeout(2000)
        pg.click('#tsBtn'); expect(pg.locator('#tsStatus')).not_to_be_empty(timeout=30000); pg.wait_for_timeout(1500)
        r = pg.evaluate("(() => { const s = document.querySelector('.ts-side'); const to = document.getElementById('tsTo').getBoundingClientRect(), sb = s.getBoundingClientRect(); return { sh: s.scrollHeight, ch: s.clientHeight, toBottom: to.bottom, sideBottom: sb.bottom, toW: to.width, val: document.getElementById('tsTo').value }; })()")
        print(lang, r, 'FITS' if r['sh'] <= r['ch'] and r['toBottom'] <= r['sideBottom'] else 'CLIPPED')
        pg.screenshot(path=S + f'shots/side_{lang}.png', clip={'x': 0, 'y': 330, 'width': 1366, 'height': 320})
        ctx.close()
    b.close()
