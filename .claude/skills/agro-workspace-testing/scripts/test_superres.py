"""Sharpening (Sentinel-2 super-resolution): 10 m -> 5 m / 2.5 m in the browser with onnxruntime-web."""
import sys, os, json, urllib.request, time
sys.path.insert(0, os.path.dirname(__file__))
from playwright.sync_api import sync_playwright, expect
import cdn_routes
S = os.environ.get('WORK', '/tmp/claude-0/-home-claude/765c94d1-5370-5f2f-8b07-c1be612c5cd8/scratchpad') + '/'
API = 'http://localhost:4000/api/v1'
def call(m, p, b=None, tok=None):
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else None, method=m, headers={'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + tok} if tok else {})})
    return json.load(urllib.request.urlopen(r))
login = cdn_routes.fresh_login(); tok = login['accessToken']
farm = call('POST', '/farms', {'name': 'SR farm'}, tok)
fc = json.load(open(S + 'fixtures/fields.geojson'))
call('POST', '/fields/bulk', {'farmId': farm['id'], 'fields': [{'name': n, 'boundary': f['geometry']} for n, f in zip(['Pivot 1', 'Pivot 2', 'Strip'], [f for f in fc['features'] if f['geometry']['type'] == 'Polygon'])]}, tok)
ok = True
def check(label, cond, extra=''):
    global ok; ok &= bool(cond); print(('PASS ' if cond else 'FAIL ') + label, str(extra)[:220], flush=True)
model_hits = []
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 1600, 'height': 900})
    ctx.add_init_script(f"localStorage.setItem('imgProvider', 'es'); localStorage.setItem('accessToken', {json.dumps(tok)}); localStorage.setItem('user', {json.dumps(json.dumps(login['user']))});")
    pg = ctx.new_page(); cdn_routes.install(pg); errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('request', lambda r: model_hits.append(r.url) if r.url.endswith('.onnx') else None)
    pg.goto(f"https://alkamelgis.github.io/AgroCloud_Vision/workspace.html?farm={farm['id']}")
    expect(pg.locator('#fieldsList .field-card')).to_have_count(3); pg.wait_for_timeout(3000)
    check('pixel size control in the dock, 10 m by default', pg.input_value('#imgRes') == '10')
    pg.locator('#fieldsList .field-card', has_text='Pivot 1').click(); pg.wait_for_timeout(1500)
    r10 = pg.evaluate("(() => { const r = Imagery.views[0].results.get(window.__openFieldId); return r && { w: r.w, h: r.h, px: r.px || 10, mean: r.mean }; })()")
    t0 = time.time()
    pg.select_option('#imgRes', 'x4')
    expect(pg.locator('#imgSrNote')).to_be_visible()
    pg.wait_for_function("Imagery.views[0].sr.has(window.__openFieldId)", timeout=180000)
    dt = time.time() - t0
    r4 = pg.evaluate("(() => { const r = Imagery.views[0].sr.get(window.__openFieldId); return { w: r.w, h: r.h, px: r.px, mean: r.mean, cloud: r.cloudPct }; })()")
    check('open field sharpened to 2.5 m', r4['px'] == 2.5 and abs(r4['w'] - 4 * (r10['w'] - 4)) <= 8, (r10, r4, f'{dt:.1f}s'))
    check('sharpened NDVI keeps the 10 m mean (within 0.05)', abs(r4['mean'] - r10['mean']) < 0.05, (r10['mean'], r4['mean']))
    pg.wait_for_function("!document.getElementById('imgSrNote').classList.contains('busy')", timeout=300000)
    check('status says it is model output', 'model' in pg.inner_text('#imgSrNote'), pg.inner_text('#imgSrNote'))
    pg.screenshot(path=S + 'shots/sr1_ndvi_2_5m.png')
    # hover reads the fine grid
    box = pg.locator('#mapContainer').bounding_box()
    c = pg.evaluate("(() => { const f = state.fieldsById.get(window.__openFieldId); const b = L.geoJSON(f.geometry).getBounds().getCenter(); const p = mapInstance.latLngToContainerPoint(b); return [p.x, p.y]; })()")
    pg.mouse.move(box['x'] + c[0], box['y'] + c[1]); pg.wait_for_timeout(400)
    check('hover shows NDVI from the sharpened grid', 'NDVI' in pg.inner_text('#hoverA'), pg.inner_text('#hoverA').replace('\n', ' '))
    # natural colour
    pg.select_option('#imgIndex', 'rgb')
    pg.wait_for_function("Imagery.views[0].sr.has(window.__openFieldId) && Imagery.views[0].sr.get(window.__openFieldId).indexKey === 'rgb'", timeout=180000)
    check('natural colour sharpened', True)
    pg.screenshot(path=S + 'shots/sr2_rgb_2_5m.png')
    # unsupported index
    pg.select_option('#imgIndex', 'ndre'); pg.wait_for_timeout(1500)
    check('NDRE: control disabled, shows 10 m', pg.locator('#imgRes').is_disabled() and pg.input_value('#imgRes') == '10' and pg.locator('#imgSrNote').is_hidden())
    pg.select_option('#imgIndex', 'ndvi'); pg.wait_for_timeout(800)
    check('back to NDVI restores the chosen size', pg.input_value('#imgRes') == 'x4')
    # 5 m model
    pg.select_option('#imgRes', 'x2')
    pg.wait_for_function("(() => { const r = Imagery.views[0].sr.get(window.__openFieldId); return r && r.px === 5; })()", timeout=180000)
    check('5 m model works', True)
    # stats stay 10 m
    check('field stats still from 10 m', pg.evaluate("(Imagery.resultFor(window.__openFieldId).px || 10) === 10"))
    # choice remembered, model cached
    n_before = len(model_hits)
    pg.reload(); expect(pg.locator('#fieldsList .field-card')).to_have_count(3); pg.wait_for_timeout(2500)
    check('choice remembered after reload', pg.input_value('#imgRes') == 'x2')
    pg.locator('#fieldsList .field-card', has_text='Pivot 2').click()
    pg.wait_for_function("Imagery.views[0].sr.has(window.__openFieldId)", timeout=180000)
    cached = pg.evaluate("caches.open('agro-sr-v1').then(c => c.keys()).then(k => k.length)")
    check('model kept in browser cache', cached >= 2 and len(model_hits) == n_before, (cached, model_hits))
    # 10 m returns originals
    pg.select_option('#imgRes', '10'); pg.wait_for_timeout(1500)
    check('10 m shows the original pixels', pg.evaluate("Imagery.views[0].sr.size") == 0 and pg.locator('#imgSrNote').is_hidden())
    # Arabic
    pg.evaluate("localStorage.setItem('lang','ar')"); pg.reload(); expect(pg.locator('#fieldsList .field-card')).to_have_count(3); pg.wait_for_timeout(2000)
    pg.select_option('#imgRes', 'x4'); pg.locator('#fieldsList .field-card').first.click()
    pg.wait_for_function("Imagery.views[0].sr.size > 0", timeout=180000)
    pg.wait_for_function("!document.getElementById('imgSrNote').classList.contains('busy')", timeout=300000); pg.wait_for_timeout(500)
    check('Arabic status', 'تحسين' in pg.inner_text('#imgSrNote'), pg.inner_text('#imgSrNote'))
    pg.screenshot(path=S + 'shots/sr3_ar.png')
    check('no page errors', not errors, errors)
    b.close()
print('ALL PASS' if ok else 'SOME FAILED')
