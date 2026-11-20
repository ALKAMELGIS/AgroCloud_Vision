"""New indices: SAVI, EVI, GNDVI, NDWI, BSI, SI — values on the map, ramps, groups, time series menu, sharpening support."""
import sys, os, json, urllib.request, math
sys.path.insert(0, os.path.dirname(__file__))
from playwright.sync_api import sync_playwright, expect
import cdn_routes
S = os.environ['WORK'] + '/'
login = cdn_routes.fresh_login(); tok = login['accessToken']
def call(m, p, b=None):
    r = urllib.request.Request('http://localhost:4000/api/v1' + p, data=json.dumps(b).encode() if b is not None else None, method=m, headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok})
    return json.load(urllib.request.urlopen(r))
farm = call('POST', '/farms', {'name': 'Idx'})
fc = json.load(open(S + 'fixtures/fields.geojson'))
rows = call('POST', '/fields/bulk', {'farmId': farm['id'], 'fields': [{'name': 'Pivot 1', 'boundary': [f for f in fc['features'] if f['geometry']['type'] == 'Polygon'][0]['geometry']}]})
fid = rows['fields'][0]['id']
ok = True
def check(label, cond, extra=''):
    global ok; ok &= bool(cond); print(('PASS ' if cond else 'FAIL ') + label, str(extra)[:220], flush=True)
errors = []
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 1600, 'height': 900})
    ctx.add_init_script(f"localStorage.setItem('imgProvider', 'es'); localStorage.setItem('accessToken', {json.dumps(tok)}); localStorage.setItem('user', {json.dumps(json.dumps(login['user']))});")
    pg = ctx.new_page(); cdn_routes.install(pg); pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(f"https://alkamelgis.github.io/AgroCloud_Vision/workspace.html?farm={farm['id']}")
    expect(pg.locator('#fieldsList .field-card')).to_have_count(1); pg.wait_for_timeout(2500)
    groups = pg.evaluate("[...document.querySelectorAll('#imgIndex optgroup')].map((g) => g.label + ':' + g.children.length)")
    check('layer list grouped: vegetation, water, soil, image', groups == ['Vegetation:8', 'Water:2', 'Soil:2', 'Image:1'], groups)
    # reflectances in the mock: blue = green = red (copied), so known answers
    for k, lo, hi in [('savi', 0, 0.9), ('evi', 0, 1.2), ('gndvi', 0, 0.9), ('ndwi', -0.9, 0.4), ('bsi', -0.9, 0.4), ('si', 0.0, 0.4)]:
        pg.select_option('#imgIndex', k)
        pg.wait_for_function(f"(() => {{ const r = Imagery.resultFor('{fid}'); return r && r.indexKey === '{k}'; }})()", timeout=30000)
        r = pg.evaluate(f"(() => {{ const r = Imagery.resultFor('{fid}'); return {{ mean: r.mean, p10: r.p10, p90: r.p90 }}; }})()")
        check(f'{k}: finite values in range', r['mean'] is not None and lo <= r['mean'] <= hi, r)
        leg = pg.inner_text('#imgLegend')
        check(f'{k}: legend', pg.evaluate("Imagery.indices['%s'].label" % k) in leg, leg.replace('\n', ' '))
    # cross-checks against NDVI from the same pixels
    vals = pg.evaluate(f"""(async () => {{ const f = state.fieldsById.get('{fid}'), s = Imagery.current(); const o = {{}};
      for (const k of ['ndvi', 'savi', 'gndvi', 'ndwi']) o[k] = (await Imagery.analyse(f, s, k)).mean; return o; }})()""")
    check('SAVI below NDVI (soil term damps it)', vals['savi'] < vals['ndvi'], vals)
    check('NDWI is about −GNDVI (same two bands)', abs(vals['ndwi'] + vals['gndvi']) < 0.02, vals)
    pg.select_option('#imgIndex', 'si'); pg.wait_for_timeout(800)
    pg.screenshot(path=S + 'shots/i1_si.png', clip={'x': 1000, 'y': 720, 'width': 600, 'height': 60})
    pg.select_option('#imgIndex', 'bsi'); pg.wait_for_timeout(800)
    pg.screenshot(path=S + 'shots/i2_bsi.png', clip={'x': 1000, 'y': 720, 'width': 600, 'height': 60})
    check('BSI cannot be sharpened (needs SWIR)', pg.locator('#imgRes').is_disabled())
    pg.select_option('#imgIndex', 'gndvi'); pg.wait_for_timeout(500)
    check('GNDVI can be sharpened', not pg.locator('#imgRes').is_disabled())
    # time series menu
    pg.locator('#fieldsList .field-card').first.click(); pg.wait_for_timeout(800)
    pg.click('#tsBtn'); pg.click('#tsIndex'); pg.wait_for_timeout(300)
    opts = pg.locator('#tsIndexMenu input').count()
    heads = pg.evaluate("[...document.querySelectorAll('#tsIndexMenu .ts-opt-group')].map((x) => x.textContent)")
    check('time series menu: 11 layers in groups', opts == 11 and heads == ['Vegetation', 'Water', 'Soil'], (opts, heads))
    pg.click('#tsIndexMenu input[value=si]'); pg.click('#tsIndexMenu input[value=bsi]'); pg.keyboard.press('Escape')
    expect(pg.locator('#tsStatus')).to_contain_text('clear dates', timeout=30000); pg.wait_for_timeout(1000)
    check('time series plots SI and BSI in their colours', pg.locator('#tsSvg path.ts-line').count() == 3, pg.locator('#tsSvg path.ts-line').count())
    pg.screenshot(path=S + 'shots/i3_ts.png', clip={'x': 560, 'y': 590, 'width': 1040, 'height': 310})
    check('no page errors', not errors, errors)
    b.close()
print('ALL PASS' if ok else 'SOME FAILED')
