"""Two-page field report: opens from Reports, maps, zones add up to the field, prints as exactly 2 A4 pages."""
import sys, os, json, urllib.request, datetime, re
sys.path.insert(0, os.path.dirname(__file__))
from playwright.sync_api import sync_playwright, expect
import cdn_routes
S = os.environ['WORK'] + '/'
API = 'http://localhost:4000/api/v1'
login = cdn_routes.fresh_login(); tok = login['accessToken']
def call(m, p, b=None):
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else None, method=m, headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok})
    return json.load(urllib.request.urlopen(r))
farm = call('POST', '/farms', {'name': 'Al Khatim Farms'})
fc = json.load(open(S + 'fixtures/fields.geojson'))
rows = call('POST', '/fields/bulk', {'farmId': farm['id'], 'fields': [{'name': n, 'boundary': f['geometry']} for n, f in zip(['Pivot 1', 'Pivot 2', 'Strip'], [f for f in fc['features'] if f['geometry']['type'] == 'Polygon'])]})
pivot = [r for r in rows['fields'] if r['name'] == 'Pivot 1'][0]
today = datetime.date.today()
call('POST', '/crops', {'fieldId': pivot['id'], 'cropType': 'Alfalfa', 'variety': 'CUF 101', 'plantingDate': (today - datetime.timedelta(days=120)).isoformat()})
for d, t, extra in [(10, 'irrigation', {'rate': 12, 'unit': 'mm'}), (20, 'fertilization', {'product': 'Urea 46%', 'rate': 80, 'unit': 'kg/ha'}), (40, 'harvest', {})]:
    try: call('POST', '/activities', {'fieldId': pivot['id'], 'type': t, 'date': (today - datetime.timedelta(days=d)).isoformat(), 'notes': '', **extra})
    except Exception as e: print('activity', e)
ok = True
def check(label, cond, extra=''):
    global ok; ok &= bool(cond); print(('PASS ' if cond else 'FAIL ') + label, str(extra)[:220], flush=True)
errors = []
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 1440, 'height': 900})
    ctx.add_init_script(f"localStorage.setItem('imgProvider', 'es'); localStorage.setItem('accessToken', {json.dumps(tok)}); localStorage.setItem('user', {json.dumps(json.dumps(login['user']))});")
    cdn_routes.install(ctx) if hasattr(cdn_routes, 'install_ctx') else None
    pg = ctx.new_page(); cdn_routes.install(pg); pg.on('pageerror', lambda e: errors.append(str(e)))
    def weather(route):
        from urllib.parse import urlparse, parse_qs
        q = parse_qs(urlparse(route.request.url).query); a = datetime.date.fromisoformat(q['start_date'][0]); e = datetime.date.fromisoformat(q['end_date'][0])
        t, hi, lo, rain, wind = [], [], [], [], []; d = a
        while d <= e:
            k = (d - a).days; t.append(d.isoformat()); hi.append(41 if k % 4 == 0 else 34); lo.append(24); rain.append(3.0 if k == 9 else 0); wind.append(10); d += datetime.timedelta(days=1)
        hourly = {'time': [x + 'T12:00' for x in t], 'soil_moisture_0_to_7cm': [0.14] * len(t)}
        route.fulfill(body=json.dumps({'daily': {'time': t, 'temperature_2m_max': hi, 'temperature_2m_min': lo, 'precipitation_sum': rain, 'windspeed_10m_max': wind}, 'hourly': hourly}), headers={'content-type': 'application/json', 'access-control-allow-origin': '*'})
    pg.route('https://archive-api.open-meteo.com/**', weather)
    pg.goto(f"https://alkamelgis.github.io/AgroSyntra_One/workspace.html?farm={farm['id']}")
    expect(pg.locator('#fieldsList .field-card')).to_have_count(3); pg.wait_for_timeout(2500)
    check('light theme by default', pg.evaluate("document.documentElement.dataset.theme") == 'light')
    pg.locator('#fieldsList .field-card', has_text='Pivot 1').click(); pg.wait_for_timeout(1500)
    pg.click('#navItems [data-view=reports]'); expect(pg.locator('#rpField')).to_be_visible(timeout=15000)
    check('report picks the open field', pg.locator('#rpField option:checked').inner_text() == 'Pivot 1')
    with ctx.expect_page() as newp:
        pg.click('#rpField2')
    rp = newp.value
    rp.route('https://archive-api.open-meteo.com/**', weather)
    cdn_routes.install(rp); rp.on('pageerror', lambda e: errors.append('report: ' + str(e)))
    expect(rp.locator('section.page')).to_have_count(2, timeout=90000)
    rp.wait_for_timeout(1200)
    txt = rp.inner_text('body')
    check('title, crop and area', 'Pivot 1' in txt and 'Alfalfa' in txt and '81.' in txt, txt[:160].replace('\n', ' '))
    zones = [float(x.replace(',', '')) for x in re.findall(r'(?:Low|Medium|High)\t[\d.–]+\t[\d.]+\t([\d.,]+)', txt)]
    total = float(re.search(r'Field\t[\d.–]+\t[\d.]+\t([\d.,]+)', txt).group(1).replace(',', ''))
    check('zone areas add up to the field', len(zones) == 3 and abs(sum(zones) - total) < 0.05 and not all(abs(z - total / 3) < 0.5 for z in zones), (zones, total))
    check('two maps with field outline', rp.locator('svg.map').count() == 2 and rp.locator('svg.map image').count() >= 2)
    check('season curve drawn', rp.locator('.page:nth-of-type(2) svg path[stroke="#2f7a29"]').count() == 1 or 'Not enough clear dates' in txt)
    check('indices table', all(re.search(r'\b' + k + r'\b', txt) for k in ['NDVI', 'SAVI', 'GNDVI', 'NDRE', 'NDMI', 'BSI', 'SI']))
    check('operations listed', 'Fertilizer' in txt and 'Urea' in txt, '')
    check('forage note: drop can be a cut', 'Alfalfa' in txt and ('cut' in txt or 'Stable' in txt or 'growing' in txt))
    check('recommended actions', 'Recommended actions' in txt)
    check('weather summary with heat days', 'Days ≥ 40 °C' in txt and 'Rain' in txt and '3.0 mm' in txt, '')
    h = rp.evaluate("[...document.querySelectorAll('section.page')].map((s) => [s.scrollHeight, s.clientHeight])")
    check('nothing overflows a page', all(sh <= ch + 1 for sh, ch in h), h)
    rp.screenshot(path=S + 'shots/r1_report.png', full_page=True)
    pdf = rp.pdf(path=S + 'shots/field_report.pdf', format='A4', print_background=True, prefer_css_page_size=True)
    n = len(re.findall(rb'/Type\s*/Page[^s]', pdf))
    check('PDF is exactly 2 A4 pages', n == 2, n)
    check('no page errors', not errors, errors)
    b.close()
print('ALL PASS' if ok else 'SOME FAILED')
