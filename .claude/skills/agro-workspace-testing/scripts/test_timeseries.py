"""Time series panel: opens from the map tools, plots clear dates, hover, click-to-open, zoom strip, weather, CSV."""
import sys, os, json, urllib.request, datetime, math
sys.path.insert(0, os.path.dirname(__file__))
from playwright.sync_api import sync_playwright, expect
import cdn_routes
S = os.environ.get('WORK', '/tmp/claude-0/-home-claude/765c94d1-5370-5f2f-8b07-c1be612c5cd8/scratchpad') + '/'
API = 'http://localhost:4000/api/v1'
def call(m, p, b=None, tok=None):
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else None, method=m, headers={'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + tok} if tok else {})})
    return json.load(urllib.request.urlopen(r))
login = cdn_routes.fresh_login(); tok = login['accessToken']
farm = call('POST', '/farms', {'name': 'TS farm'}, tok)
fc = json.load(open(S + 'fixtures/fields.geojson'))
rows = call('POST', '/fields/bulk', {'farmId': farm['id'], 'fields': [{'name': n, 'boundary': f['geometry']} for n, f in zip(['Pivot 1', 'Pivot 2', 'Strip'], [f for f in fc['features'] if f['geometry']['type'] == 'Polygon'])]}, tok)
pivot = [r for r in rows['fields'] if r['name'] == 'Pivot 1'][0]
call('POST', '/crops', {'fieldId': pivot['id'], 'cropType': 'Alfalfa', 'plantingDate': (datetime.date.today() - datetime.timedelta(days=200)).isoformat()}, tok)
ok = True
def check(label, cond, extra=''):
    global ok; ok &= bool(cond); print(('PASS ' if cond else 'FAIL ') + label, str(extra)[:200])
def weather(route):
    from urllib.parse import urlparse, parse_qs
    q = parse_qs(urlparse(route.request.url).query)
    a = datetime.date.fromisoformat(q['start'][0]); b = datetime.date.fromisoformat(q['end'][0])
    days = []
    d = a
    while d <= b:
        k = (d - a).days
        days.append({'date': d.isoformat(), 'temperatureMaxC': 32 + 6 * math.sin(k / 30), 'temperatureMinC': 20 + 5 * math.sin(k / 30), 'precipitationMm': 4.0 if k % 17 == 0 else 0, 'soilMoisture': 0.18 + 0.05 * math.sin(k / 20)})
        d += datetime.timedelta(days=1)
    route.fulfill(body=json.dumps({'fieldId': 'x', 'source': 'open-meteo', 'days': days}), headers={'content-type': 'application/json', 'access-control-allow-origin': '*'})
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 1600, 'height': 900}, accept_downloads=True)
    ctx.add_init_script(f"localStorage.setItem('theme', 'dark'); localStorage.setItem('imgProvider', 'es'); localStorage.setItem('accessToken', {json.dumps(tok)}); localStorage.setItem('user', {json.dumps(json.dumps(login['user']))});")
    pg = ctx.new_page(); cdn_routes.install(pg); errors = []
    pg.route('**/weather/field/*/history*', weather)
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(f"https://alkamelgis.github.io/AgroCloud_Vision/workspace.html?farm={farm['id']}")
    expect(pg.locator('#fieldsList .field-card')).to_have_count(3); pg.wait_for_timeout(2500)
    tb = pg.locator('#tsBtn').bounding_box(); mb = pg.locator('#measureBtn').bounding_box()
    check('chart button sits under the ruler', abs(tb['x'] - mb['x']) < 1 and tb['y'] > mb['y'], (tb['y'], mb['y']))
    h0 = pg.locator('#mapRow').bounding_box()['height']
    pg.locator('#fieldsList .field-card', has_text='Pivot 1').click(); pg.wait_for_timeout(800)
    pg.click('#tsBtn')
    expect(pg.locator('#tsPanel')).to_be_visible()
    check('map makes room for the panel', pg.locator('#mapRow').bounding_box()['height'] < h0 - 250)
    check('opens on the selected field', pg.locator('#tsField option:checked').inner_text() == 'Pivot 1', pg.locator('#tsField option:checked').inner_text())
    expect(pg.locator('#tsSvg .ts-dot')).to_have_count(3, timeout=30000)   # 26 Oct is cloudy over the field
    check('status counts clear dates', 'clear dates' in pg.inner_text('#tsStatus'), pg.inner_text('#tsStatus'))
    check('progress bar gone once loaded', pg.locator('#tsProgress').is_hidden())
    pg.select_option('#tsChartType', 'line'); pg.wait_for_timeout(120)
    still = pg.evaluate("(() => { const l = document.querySelector('#tsSvg path.ts-line'); return l && !l.classList.contains('is-enter') && parseFloat(getComputedStyle(l).strokeDashoffset || '0') === 0 && !document.querySelector('#tsSvg .is-enter'); })()")
    check('chart drawn at once, no animation', still)
    pg.select_option('#tsChartType', 'area'); pg.wait_for_timeout(900)
    check('smooth line and P10-P90 band drawn', pg.locator('#tsSvg path.ts-line[stroke="url(#tsRamp-ndvi)"]').count() == 1 and pg.locator('#tsSvg path.ts-band').count() == 1)
    stops = pg.evaluate("[...document.querySelectorAll('#tsRamp-ndvi stop')].map((s) => s.getAttribute('stop-color'))")
    dots = pg.evaluate("[...document.querySelectorAll('#tsSvg .ts-dot')].map((d) => d.style.getPropertyValue('--c'))")
    exp = pg.evaluate("TimeSeries.state.points.filter((p) => p.v.ndvi).map((p) => Imagery.css(Imagery.rampAt(Imagery.indices.ndvi.ramp, (() => { const v = Imagery.views[0]; const vals = TimeSeries.state.points.filter((q) => q.v.ndvi).map((q) => q.v.ndvi.mean); const [lo, hi] = v.contrast && Math.max(...vals) > Math.min(...vals) ? [Math.min(...vals), Math.max(...vals)] : [0, 1]; return Math.max(0, Math.min(1, (p.v.ndvi.mean - lo) / (hi - lo))); })())))")
    check('line and points coloured by value with the map ramp', stops == exp and dots == exp, (stops, dots, exp))
    r0 = pg.evaluate("document.querySelector('#tsSvg .ts-dot').getAttribute('r')")
    d0 = pg.locator('#tsSvg .ts-dot').first.bounding_box(); pg.mouse.move(d0['x'] + 3, d0['y'] + 3); pg.wait_for_timeout(200)
    check('points do not grow on hover', pg.evaluate("[...document.querySelectorAll('#tsSvg .ts-dot')].every((d) => d.getAttribute('r') === '3')"), r0)
    pg.mouse.move(5, 5)
    # map index leads the chart
    pg.select_option('#imgIndex', 'savi'); expect(pg.locator('#tsLegend')).to_contain_text('SAVI', timeout=30000); pg.wait_for_timeout(800)
    check('chart follows the map index', pg.evaluate("TimeSeries.state.indices.join()") == 'savi', pg.evaluate("TimeSeries.state.indices.join()"))
    pg.click('#tsLegend .ts-key[data-k=savi]')
    pg.select_option('#imgIndex', 'ndvi'); expect(pg.locator('#tsLegend')).to_contain_text('NDVI', timeout=30000); pg.wait_for_timeout(800)
    # class filter fades points outside
    pg.click('#imgLegend .cls-seg[data-cls="0"]'); pg.wait_for_timeout(400)
    check('points outside the selected values fade', pg.locator('#tsSvg .ts-dot.is-faded').count() == pg.locator('#tsSvg .ts-dot').count())
    pg.click('#imgLegend [data-cls-clear]'); pg.wait_for_timeout(300)
    check('crop season band', 'Alfalfa' in pg.text_content('#tsSvg'))
    check('month labels on the axis', pg.locator('#tsSvg text.ts-axis').count() >= 10)
    dot = pg.locator('#tsSvg .ts-dot').nth(1).bounding_box()
    pg.mouse.move(dot['x'] + dot['width'] / 2, dot['y'] + dot['height'] / 2); pg.wait_for_timeout(250)
    expect(pg.locator('#tsTip')).to_be_visible()
    check('hover tooltip with date and value', 'NDVI' in pg.inner_text('#tsTip') and '2026' in pg.inner_text('#tsTip'), pg.inner_text('#tsTip').replace('\n', ' '))
    pg.screenshot(path=S + 'shots/t1_timeseries.png')
    dot = pg.locator('#tsSvg .ts-dot').nth(0).bounding_box()
    before = pg.evaluate("Imagery.current().day")
    pg.mouse.click(dot['x'] + dot['width'] / 2, dot['y'] + dot['height'] / 2); pg.wait_for_timeout(800)
    after = pg.evaluate("Imagery.current().day")
    check('clicking a point opens that date on the map', after != before and pg.locator('#tlChips [aria-current=true]').count() == 1, (before, after))
    # weather
    for w, sel in [('rain', 'rect.ts-weather'), ('temp', 'path.ts-weather'), ('soil', 'path.ts-weather')]:
        pg.click(f'#tsWeather [data-w={w}]'); pg.wait_for_timeout(700)
        check(f'weather overlay: {w}', pg.locator(f'#tsSvg {sel}').count() >= 1)
    check('weather legend and right axis', 'Soil moisture' in pg.inner_text('#tsLegend'))
    pg.screenshot(path=S + 'shots/t2_timeseries_weather.png')
    # zoom strip
    wb = pg.locator('#tsWindow').bounding_box()
    pg.mouse.move(wb['x'] + 1, wb['y'] + wb['height'] / 2); pg.mouse.down(); pg.mouse.move(wb['x'] + wb['width'] * 0.6, wb['y'] + wb['height'] / 2, steps=8); pg.mouse.up(); pg.wait_for_timeout(300)
    check('dragging the strip handle zooms in', pg.evaluate("!!TimeSeries.state.view") and not pg.locator('#tsReset').is_disabled())
    pg.click('#tsReset'); pg.wait_for_timeout(200)
    check('reset shows the whole period', pg.evaluate("TimeSeries.state.view") is None)
    # period and index
    pg.click('#tsQuick [data-m="3"]'); pg.wait_for_timeout(300)
    check('quick period 3M', pg.input_value('#tsFrom') > (datetime.date.today() - datetime.timedelta(days=100)).isoformat(), pg.input_value('#tsFrom'))
    expect(pg.locator('#tsStatus')).to_contain_text('clear dates', timeout=30000)
    def toggle(k):
        if pg.locator('#tsIndexMenu').is_hidden(): pg.click('#tsIndex')
        pg.click(f'#tsIndexMenu input[value={k}]')
        expect(pg.locator('#tsStatus')).to_contain_text('clear dates', timeout=30000); pg.wait_for_timeout(300)
    toggle('ndre')
    check('two layers: two lines, own colours, no band', pg.locator('#tsSvg path.ts-line').count() == 2 and pg.locator('#tsSvg path.ts-line[stroke="#e08a5b"]').count() == 1 and pg.locator('#tsSvg path.ts-band').count() == 0)
    check('layer button lists both', 'NDVI, NDRE' in pg.inner_text('#tsIndex'), pg.inner_text('#tsIndex'))
    dot = pg.locator('#tsSvg .ts-dot').nth(1).bounding_box()
    pg.mouse.move(dot['x'] + 3, dot['y'] + 3); pg.wait_for_timeout(250)
    check('tooltip shows both layers', 'NDVI' in pg.inner_text('#tsTip') and 'NDRE' in pg.inner_text('#tsTip'), pg.inner_text('#tsTip').replace('\n', ' '))
    pg.mouse.move(5, 5)
    for kind, sel, n in [('line', 'path.ts-line', 2), ('bar', 'rect.ts-bar', 1), ('scatter', 'circle.ts-dot.is-solid', 1), ('change', 'rect.ts-bar', 1), ('area', 'path.ts-line', 2)]:
        pg.select_option('#tsChartType', kind); pg.wait_for_timeout(250)
        check(f'chart type {kind}', pg.locator(f'#tsSvg {sel}').count() >= n, pg.locator(f'#tsSvg {sel}').count())
        if kind == 'change': check('change chart has a zero line and signed ticks', pg.locator('#tsSvg .ts-zero').count() == 1 and '+' in pg.text_content('#tsSvg'))
    pg.select_option('#tsChartType', 'scatter'); pg.wait_for_timeout(200)
    pg.screenshot(path=S + 'shots/t3_timeseries_multi_points.png')
    pg.select_option('#tsChartType', 'area'); pg.wait_for_timeout(200)
    pg.screenshot(path=S + 'shots/t3b_timeseries_multi_area.png')
    toggle('reci')
    check('ReCI next to others moves to the right axis, weather off', 'right axis' in pg.inner_text('#tsLegend') and pg.locator('#tsWeather [data-w=temp]').is_disabled() and pg.locator('#tsSvg .ts-weather').count() == 0)
    toggle('ndre'); toggle('reci')
    toggle('ndmi'); toggle('ndvi')
    check('last layer cannot be unticked', pg.locator('#tsIndexMenu input[value=ndmi]').is_disabled())
    pg.keyboard.press('Escape')
    check('index switch redraws in NDMI', 'NDMI' in pg.inner_text('#tsLegend') and pg.evaluate("TimeSeries.state.indices.join()") == 'ndmi', pg.evaluate("TimeSeries.state.indices.join()"))
    with pg.expect_download() as dl:
        pg.click('#tsCsv')
    csv = open(dl.value.path(), encoding='utf-8-sig').read().splitlines()
    check('CSV has a row per clear date with weather', csv[0].startswith('date,NDMI mean') and len(csv) >= 2 and csv[1].count(',') == 7, csv[:2])
    pg.select_option('#tsField', label='Pivot 2')
    expect(pg.locator('#tsStatus')).to_contain_text('clear dates', timeout=30000)
    check('field switch', pg.evaluate("TimeSeries.state.fieldId") != pivot['id'])
    # heatmap and 3D skyline tabs
    pg.click('#tsModes [data-mode=heat]'); pg.wait_for_timeout(900)
    n = pg.locator('#tsAlt .tsc-cell').count()
    check('heatmap: a cell per day, chart and zoom strip hidden', n >= 80 and pg.locator('#tsSvg').is_hidden() and pg.locator('#tsBrush').is_hidden(), n)
    check('heatmap stats', 'Peak' in pg.inner_text('#tsAlt .tsc-stats') and 'Latest' in pg.inner_text('#tsAlt .tsc-stats'))
    c = pg.locator('#tsAlt .tsc-cell.is-clear').first.bounding_box()
    pg.mouse.move(c['x'] + c['width'] / 2, c['y'] + c['height'] / 2); pg.wait_for_timeout(200)
    check('heatmap hover reads a clear date', 'Click to open' in pg.inner_text('#tsTip'), pg.inner_text('#tsTip').replace('\n', ' '))
    pg.click('#tsModes [data-mode=sky]'); pg.wait_for_timeout(2200)
    lit = pg.evaluate("(() => { const c = document.querySelector('#tsAlt canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; })()")
    check('3D skyline drawn on canvas', lit > 5000, lit)
    check('choice of view remembered', pg.evaluate("localStorage.getItem('tsMode')") == 'sky')
    pg.click('#tsModes [data-mode=ring]'); pg.wait_for_timeout(2200)
    lit = pg.evaluate("(() => { const c = document.querySelector('#tsAlt canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; })()")
    check('3D ring drawn', lit > 5000 and pg.locator('#tsAlt.tsc-ringmode').count() == 1, lit)
    cv = pg.locator('#tsAlt canvas').bounding_box(); hit = False
    for dx in range(-150, 151, 15):
        for fy in (0.62, 0.72, 0.8):
            pg.mouse.move(cv['x'] + cv['width'] / 2 + dx, cv['y'] + cv['height'] * fy); pg.wait_for_timeout(30)
            if pg.locator('#tsTip').is_visible(): hit = True; break
        if hit: break
    check('ring hover reads a day', hit)
    pg.click('#tsModes [data-mode=chart]'); pg.wait_for_timeout(900)
    check('back to chart', pg.locator('#tsSvg path.ts-line').count() >= 1 and pg.locator('#tsBrush').is_visible())
    pg.click('#tsClose')
    check('close gives the map back', abs(pg.locator('#mapRow').bounding_box()['height'] - h0) < 2)
    check('no JS errors', not errors, errors)
    b.close()
print('ALL PASS' if ok else 'SOME FAILED')
