import sys, os, json, urllib.request
sys.path.insert(0, os.path.dirname(__file__))
from playwright.sync_api import sync_playwright, expect
import cdn_routes
S = os.environ['WORK'] + '/'
API = 'http://localhost:4000/api/v1'
def call(m, p, b=None, tok=None):
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else None, method=m, headers={'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + tok} if tok else {})})
    return json.load(urllib.request.urlopen(r))
login = cdn_routes.fresh_login(); tok = login['accessToken']
farm = call('POST', '/farms', {'name': 'Cal farm'}, tok)
fc = json.load(open(S + 'fixtures/fields.geojson'))
call('POST', '/fields/bulk', {'farmId': farm['id'], 'fields': [{'name': 'Pivot 1', 'boundary': [f for f in fc['features'] if f['geometry']['type'] == 'Polygon'][0]['geometry']}]}, tok)
errors = []
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 1600, 'height': 900}, device_scale_factor=1)
    ctx.add_init_script(f"localStorage.setItem('imgProvider', 'es'); localStorage.setItem('accessToken', {json.dumps(tok)}); localStorage.setItem('user', {json.dumps(json.dumps(login['user']))});")
    pg = ctx.new_page(); cdn_routes.install(pg); pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(f"https://alkamelgis.github.io/AgroCloud_Vision/workspace.html?farm={farm['id']}")
    expect(pg.locator('#fieldsList .field-card')).to_have_count(1); pg.wait_for_timeout(2000)
    pg.click('#tsBtn'); pg.click('#tsQuick [data-m="12"]')
    expect(pg.locator('#tsStatus')).to_contain_text('clear dates', timeout=30000)
    # synthetic year: a clear date every 5 days, two crop cycles
    pg.evaluate("""(() => { const ts = TimeSeries.state; const DAY = 864e5; const a = Date.parse(ts.from + 'T00:00:00Z'), b = Date.parse(ts.to + 'T00:00:00Z');
      ts.points = []; let i = 0; for (let t = a + 2 * DAY; t <= b; t += 5 * DAY) { if (Math.sin(i * 7.3) > 0.75) { i++; continue; }
        const ph = (t - a) / (b - a); const v = 0.2 + 0.6 * Math.max(0, Math.sin(ph * Math.PI * 2 - 0.3)) ** 1.3 + 0.04 * Math.sin(i);
        const day = new Date(t).toISOString().slice(0, 10);
        ts.points.push({ day, t, sceneId: 'x' + i, scene: Imagery.current(), cloud: 0, v: { ndvi: { mean: v, p10: v - .05, p90: v + .05 }, ndre: { mean: v * .7, p10: v * .65, p90: v * .75 } } }); i++; }
      ts.indices = ['ndvi', 'ndre']; ts.total = ts.done = ts.points.length; })()""")
    pg.evaluate("TimeSeries.setMode('heat')"); pg.wait_for_timeout(180)
    pg.screenshot(path=S + 'shots/c1_heat_mid.png', clip={'x': 560, 'y': 590, 'width': 1040, 'height': 310})
    pg.wait_for_timeout(1200)
    pg.screenshot(path=S + 'shots/c2_heat.png', clip={'x': 560, 'y': 590, 'width': 1040, 'height': 310})
    cell = pg.locator('.tsc-cell.is-clear').nth(30).bounding_box()
    pg.mouse.move(cell['x'] + 4, cell['y'] + 4); pg.wait_for_timeout(200)
    print('heat tip:', pg.inner_text('#tsTip').replace('\n', ' '))
    est = pg.locator('.tsc-cell:not(.is-clear)').nth(40).bounding_box()
    pg.mouse.move(est['x'] + 4, est['y'] + 4); pg.wait_for_timeout(200)
    print('heat est tip:', pg.inner_text('#tsTip').replace('\n', ' '))
    pg.evaluate("TimeSeries.setMode('sky')"); pg.wait_for_timeout(350)
    pg.screenshot(path=S + 'shots/c3_sky_mid.png', clip={'x': 560, 'y': 590, 'width': 1040, 'height': 310})
    pg.wait_for_timeout(2000)
    pg.screenshot(path=S + 'shots/c4_sky.png', clip={'x': 560, 'y': 590, 'width': 1040, 'height': 310})
    cv = pg.locator('.tsc-canvas').bounding_box()
    pg.mouse.move(cv['x'] + cv['width'] * .5, cv['y'] + cv['height'] * .5); pg.wait_for_timeout(200)
    print('sky tip visible:', pg.locator('#tsTip').is_visible(), pg.inner_text('#tsTip').replace('\n', ' ') if pg.locator('#tsTip').is_visible() else '')
    pg.mouse.down(); pg.mouse.move(cv['x'] + cv['width'] * .5 + 120, cv['y'] + cv['height'] * .5, steps=6); pg.mouse.up(); pg.wait_for_timeout(300)
    pg.screenshot(path=S + 'shots/c5_sky_turned.png', clip={'x': 560, 'y': 590, 'width': 1040, 'height': 310})
    # map index follows: switch map to NDRE -> heatmap shows NDRE colours; chip NDVI -> map back to NDVI
    pg.evaluate("TimeSeries.setMode('heat')"); pg.wait_for_timeout(900)
    pg.select_option('#imgIndex', 'ndre'); pg.wait_for_timeout(1500)
    print('heat follows map index:', pg.locator('.tsc-chips [aria-pressed=true]').inner_text())
    pg.screenshot(path=S + 'shots/c6_heat_ndre.png', clip={'x': 560, 'y': 590, 'width': 1040, 'height': 310})
    pg.click('.tsc-chips [data-hk=ndvi]'); pg.wait_for_timeout(1200)
    print('map follows chip:', pg.input_value('#imgIndex'))
    print('current date outlined:', pg.locator('.tsc-cell.is-cur').count())
    pg.evaluate("TimeSeries.setMode('chart')"); pg.wait_for_timeout(1200)
    print('chart back:', pg.locator('#tsSvg path.ts-line').count(), 'brush visible', pg.locator('#tsBrush').is_visible())
    print('errors', errors)
    b.close()
