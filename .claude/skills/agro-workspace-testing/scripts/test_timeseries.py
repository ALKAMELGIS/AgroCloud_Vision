"""Time series panel: opens from the map tools, plots clear dates, hover, click-to-open, zoom strip, weather, CSV."""
import sys, os, json, urllib.request, datetime, math
sys.path.insert(0, os.path.dirname(__file__))
from playwright.sync_api import sync_playwright, expect
import cdn_routes
S = os.environ.get('WORK', os.getcwd()) + '/'
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
    ctx.add_init_script(f"localStorage.setItem('imgProvider', 'es'); localStorage.setItem('accessToken', {json.dumps(tok)}); localStorage.setItem('user', {json.dumps(json.dumps(login['user']))});")
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
    check('smooth line and P10-P90 band drawn', pg.locator('#tsSvg path[stroke="#4ade80"]').count() >= 1 and pg.locator('#tsSvg path[opacity=".08"]').count() == 1)
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
    for w, sel in [('rain', 'rect[fill="#60a5fa"]'), ('temp', 'path[stroke="#f59e0b"]'), ('soil', 'path[stroke="#a78bfa"]')]:
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
    pg.select_option('#tsIndex', 'ndmi')
    expect(pg.locator('#tsStatus')).to_contain_text('clear dates', timeout=30000)
    check('index switch redraws in NDMI', 'NDMI' in pg.inner_text('#tsLegend'))
    with pg.expect_download() as dl:
        pg.click('#tsCsv')
    csv = open(dl.value.path(), encoding='utf-8-sig').read().splitlines()
    check('CSV has a row per clear date with weather', csv[0].startswith('date,NDMI mean') and len(csv) >= 2 and csv[1].count(',') == 7, csv[:2])
    pg.select_option('#tsField', label='Pivot 2')
    expect(pg.locator('#tsStatus')).to_contain_text('clear dates', timeout=30000)
    check('field switch', pg.evaluate("TimeSeries.state.fieldId") != pivot['id'])
    pg.click('#tsClose')
    check('close gives the map back', abs(pg.locator('#mapRow').bounding_box()['height'] - h0) < 2)
    check('no JS errors', not errors, errors)
    b.close()
print('ALL PASS' if ok else 'SOME FAILED')
