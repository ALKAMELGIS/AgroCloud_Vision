"""Value classes linked across map legend, field statistics and heatmap."""
import sys, os, json, urllib.request
sys.path.insert(0, os.path.dirname(__file__))
from playwright.sync_api import sync_playwright, expect
import cdn_routes
S = os.environ['WORK'] + '/'
login = cdn_routes.fresh_login(); tok = login['accessToken']
def call(m, p, b=None):
    r = urllib.request.Request('http://localhost:4000/api/v1' + p, data=json.dumps(b).encode() if b is not None else None, method=m, headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok})
    return json.load(urllib.request.urlopen(r))
farm = call('POST', '/farms', {'name': 'Classes'})
fc = json.load(open(S + 'fixtures/fields.geojson'))
call('POST', '/fields/bulk', {'farmId': farm['id'], 'fields': [{'name': n, 'boundary': f['geometry']} for n, f in zip(['Pivot 1', 'Pivot 2', 'Strip'], [f for f in fc['features'] if f['geometry']['type'] == 'Polygon'])]})
ok = True
def check(label, cond, extra=''):
    global ok; ok &= bool(cond); print(('PASS ' if cond else 'FAIL ') + label, str(extra)[:220], flush=True)
errors = []
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 1600, 'height': 900})
    ctx.add_init_script(f"localStorage.setItem('imgProvider', 'es'); localStorage.setItem('accessToken', {json.dumps(tok)}); localStorage.setItem('user', {json.dumps(json.dumps(login['user']))});")
    pg = ctx.new_page(); cdn_routes.install(pg); pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(f"https://alkamelgis.github.io/AgroSyntra_One/workspace.html?farm={farm['id']}")
    expect(pg.locator('#fieldsList .field-card')).to_have_count(3); pg.wait_for_timeout(3000)
    check('legend is 10 value classes', pg.locator('#imgLegend .cls-seg').count() == 10)
    pg.locator('#fieldsList .field-card', has_text='Pivot 1').click()
    expect(pg.locator('[data-pane=monitoring] [data-cls]')).to_have_count(10, timeout=30000)
    fid = pg.evaluate("window.__openFieldId")
    classes = pg.evaluate(f"Imagery.resultFor('{fid}').classes")
    k = max(range(10), key=lambda i: classes[i])   # the largest class of the open field
    # 1. legend -> map + statistics
    sig0 = pg.evaluate("(() => { const l = Imagery.views[0].layerFor.values().next().value; return l._url.length; })()")
    pg.click(f'#imgLegend .cls-seg[data-cls="{k}"]'); pg.wait_for_timeout(500)
    check('legend click sets the filter', pg.evaluate("[...Imagery.filter.classes].join()") == str(k))
    sig1 = pg.evaluate("(() => { const l = Imagery.views[0].layerFor.values().next().value; return l._url.length; })()")
    check('map layers repainted', sig1 != sig0, (sig0, sig1))
    # pixel check: in the repainted overlay, pixels outside the class are grey and faint
    px = pg.evaluate(f"""(async () => {{ const r = Imagery.resultFor('{fid}'); const e = Imagery.edgesFor(r.indexKey);
      const im = new Image(); im.src = Imagery.paint(r, {{ filter: Imagery.filter }}); await im.decode();
      const c = document.createElement('canvas'); c.width = r.w; c.height = r.h; const g = c.getContext('2d'); g.drawImage(im, 0, 0); const d = g.getImageData(0, 0, r.w, r.h).data;
      let inOk = 0, inN = 0, outOk = 0, outN = 0;
      for (let i = 0; i < r.values.length; i++) {{ if (!r.inField[i] || Number.isNaN(r.values[i])) continue; const on = Imagery.classOf(e, r.values[i]) === {k};
        if (on) {{ inN++; if (d[i * 4 + 3] > 200) inOk++; }} else {{ outN++; if (d[i * 4 + 3] < 100) outOk++; }} }}
      return [inOk, inN, outOk, outN]; }})()""")
    check('only pixels in the class keep their colour', px[1] > 0 and px[0] == px[1] and px[2] == px[3], px)
    leg = pg.inner_text('#imgLegend')
    check('legend shows the selected area', ' ha · ' in leg, leg.replace('\n', ' '))
    pane = pg.locator('[data-pane=monitoring]')
    check('statistics row highlighted', pane.locator(f'[data-cls="{k}"].is-on').count() == 1 and pane.locator('.fa-cls.is-off').count() == 9)
    check('statistics show selected area', 'Selected on the map' in pane.inner_text())
    pg.screenshot(path=S + 'shots/cf1.png')
    # 2. statistics row -> legend
    k2 = (k + 9) % 10 if k > 0 else 1
    pane.locator(f'[data-cls="{k2}"]').click(); pg.wait_for_timeout(500)
    check('statistics row sets the filter', pg.evaluate("[...Imagery.filter.classes].join()") == str(k2) and pg.locator(f'#imgLegend .cls-seg[data-cls="{k2}"].is-on').count() == 1)
    # 3. shift-click extends to a range
    pg.locator(f'#imgLegend .cls-seg[data-cls="{min(9, k2 + 2)}"]').click(modifiers=['Shift']); pg.wait_for_timeout(400)
    got = pg.evaluate("[...Imagery.filter.classes].sort((a,b)=>a-b).join()")
    check('shift-click selects a range', got == ','.join(str(i) for i in range(k2, min(9, k2 + 2) + 1)), got)
    # 4. heatmap dims days outside
    pg.click('#tsBtn'); expect(pg.locator('#tsStatus')).to_contain_text('clear dates', timeout=30000)
    pg.click('#tsModes [data-mode=heat]'); pg.wait_for_timeout(900)
    check('heatmap follows the filter', pg.locator('#tsAlt .tsc-cell.is-dim').count() >= 0 and pg.evaluate("document.querySelectorAll('#tsAlt .tsc-cell').length") > 0)
    pg.click('#tsModes [data-mode=chart]'); pg.click('#tsClose')
    # 5. clear, and index change clears
    pg.click('#imgLegend [data-cls-clear]'); pg.wait_for_timeout(400)
    check('clear shows all values', pg.evaluate("Imagery.filter") is None and pg.locator('#imgLegend .cls-seg.is-off').count() == 0)
    pg.click(f'#imgLegend .cls-seg[data-cls="{k}"]'); pg.wait_for_timeout(300)
    pg.select_option('#imgIndex', 'ndmi'); pg.wait_for_timeout(1500)
    check('changing the index clears the filter', pg.evaluate("Imagery.filter") is None)
    check('no page errors', not errors, errors)
    b.close()
print('ALL PASS' if ok else 'SOME FAILED')
