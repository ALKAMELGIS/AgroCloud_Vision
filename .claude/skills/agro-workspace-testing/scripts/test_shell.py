import sys, os, json, re, subprocess, zipfile, urllib.request, xml.etree.ElementTree as ET
sys.path.insert(0, os.path.dirname(__file__))
from playwright.sync_api import sync_playwright, expect
import cdn_routes
S = os.environ.get('WORK', os.getcwd()) + '/'
SH = S + 'shots/'; API = 'http://localhost:4000/api/v1'
def call(method, path, body=None, tok=None):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None, method=method,
        headers={'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + tok} if tok else {})})
    return json.load(urllib.request.urlopen(req))
login = call('POST', '/auth/login', {'email': 'demo@agrocloud.test', 'password': 'Demo12345!'}); tok = login['accessToken']
farm = call('POST', '/farms', {'name': 'Texas pivots'}, tok)
fc = json.load(open(S + 'fixtures/fields.geojson'))
call('POST', '/fields/bulk', {'farmId': farm['id'], 'fields': [{'name': f['properties'].get('name') or 'Fodder strip', 'boundary': f['geometry']} for f in fc['features'] if f['geometry']['type'] == 'Polygon']}, tok)
ok = True
def check(label, cond, extra=''):
    global ok; ok &= bool(cond); print(('PASS ' if cond else 'FAIL ') + label, str(extra)[:160])
def num(txt, pat): m = re.search(pat, txt); return float(m.group(1)) if m else None

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 1600, 'height': 900}, accept_downloads=True)
    ctx.add_init_script(f"localStorage.setItem('accessToken', {json.dumps(tok)}); localStorage.setItem('user', {json.dumps(json.dumps(login['user']))});")
    pg = ctx.new_page(); cdn_routes.install(pg)
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('dialog', lambda d: d.accept())
    pg.goto(f"https://alkamelgis.github.io/AgroCloud_Vision/workspace.html?farm={farm['id']}")
    expect(pg.locator('#fieldsList .field-card')).to_have_count(3)
    expect(pg.locator('#tlChips [data-scene]')).to_have_count(4, timeout=30000)
    check('newest clear date selected (15 Nov)', "15 Nov" in pg.locator('#tlChips [aria-current=true]').inner_text())
    pg.wait_for_function("document.querySelectorAll('.leaflet-pane .img-px').length === 3", timeout=30000)
    check('NDVI painted on all 3 fields', True)
    expect(pg.locator('#riskChips')).to_contain_text(re.compile(r'No risks\s*3'), timeout=30000)
    check('risk chips computed', True, pg.inner_text('#riskChips').replace('\n', ' '))
    cards = pg.inner_text('#fieldsList')
    check('cards show NDVI', '0.75' in cards or '0.74' in cards, cards.replace('\n', ' | ')[:120])

    # search by coordinates
    pg.fill('#geoSearch', '34.12, -102.33'); pg.press('#geoSearch', 'Enter'); pg.wait_for_timeout(400)
    check('coordinate search zooms', abs(pg.evaluate('mapInstance.getCenter().lat') - 34.12) < 0.01)

    # index switch
    pg.select_option('#imgIndex', 'ndmi')
    expect(pg.locator('#imgLegend')).to_contain_text('NDMI')
    pg.wait_for_timeout(1500)
    pg.locator('#fieldsList .field-card', has_text='Pivot 1').click()
    expect(pg.locator('#fieldPanel [data-pane=monitoring]')).to_contain_text('NDMI', timeout=30000)
    ndmi = num(pg.inner_text('[data-pane=monitoring]'), r'NDMI · .*\n([-\d.]+)')
    check('NDMI Pivot 1 ≈ 0.34 (0.357 crop, 0.152 stress patch)', ndmi is not None and 0.31 <= ndmi <= 0.36, ndmi)
    pg.select_option('#imgIndex', 'ndre'); pg.wait_for_timeout(300)
    expect(pg.locator('[data-pane=monitoring]')).to_contain_text('NDRE', timeout=30000)
    ndre = num(pg.inner_text('[data-pane=monitoring]'), r'NDRE · .*\n([-\d.]+)')
    check('NDRE Pivot 1 ≈ 0.52', ndre is not None and abs(ndre - 0.52) < 0.03, ndre)
    pg.select_option('#imgIndex', 'ndvi')
    expect(pg.locator('[data-pane=monitoring]')).to_contain_text('NDVI ·', timeout=30000)
    pg.wait_for_timeout(500)
    ndvi = num(pg.inner_text('[data-pane=monitoring]'), r'NDVI · .*\n([-\d.]+)')
    check('NDVI Pivot 1 ≈ 0.75', ndvi is not None and abs(ndvi - 0.75) < 0.02, ndvi)
    check('10 value classes', pg.locator('[data-pane=monitoring] .space-y-1 > div').count() == 10)
    pg.screenshot(path=SH + 's2_field.png')

    # compare + scout task from anomaly
    pg.select_option('#faCmp', index=1)
    expect(pg.locator('#faCmpOut')).to_contain_text('compared' if False else 'Field change', timeout=30000)
    ha = num(pg.inner_text('#faCmpOut'), r'([\d.]+) ha dropped')
    check('anomaly ≈ 7 ha', ha is not None and 5.5 <= ha <= 7.5, ha)
    pg.click('#faTask')
    expect(pg.locator('#scDraft')).to_be_visible()
    pg.fill('#scWho', 'Ahmed'); pg.click('#scDraft button[type=submit]')
    expect(pg.locator('#toast')).to_contain_text('Scout task created')
    expect(pg.locator('#moduleBody [data-task]')).to_have_count(1)
    check('scout pin on map', pg.evaluate("document.querySelectorAll('.leaflet-marker-pane svg path').length") >= 1)
    pg.select_option('#moduleBody [data-status]', 'done'); pg.wait_for_timeout(800)
    pg.click('#moduleBody [data-f=done]')
    check('task marked done', pg.locator('#moduleBody [data-task]').count() == 1)

    # swipe
    pg.click('#swipeBtn')
    expect(pg.locator('.swipe-handle')).to_be_visible()
    pg.wait_for_function("document.querySelectorAll('.leaflet-pane .img-px').length >= 4", timeout=30000)
    clip = pg.evaluate("mapInstance.getPane('imgA').style.clip")
    check('swipe clips left/right panes', clip.startswith('rect('), clip)
    pg.screenshot(path=SH + 's3_swipe.png')
    pg.click('#swipeBtn')

    # leaderboard + notifications + reports
    pg.locator('.nav-sub', has_text='Leaderboard').click()
    expect(pg.locator('#moduleBody [data-open]')).to_have_count(3, timeout=30000)
    check('leaderboard ranks 3 fields', True, pg.locator('#moduleBody [data-open]').first.inner_text().replace('\n', ' '))
    pg.locator('.nav-sub', has_text='Reports').click()
    expect(pg.locator('#moduleBody')).to_contain_text('Crop area', timeout=15000)
    check('season report', 'Activities' in pg.inner_text('#moduleBody'))
    pg.locator('.nav-item', has_text='Notifications').click()
    expect(pg.locator('#moduleBody')).to_contain_text('New Sentinel-2 image')

    # VRA vegetation
    pg.locator('.nav-sub', has_text='Vegetation').click()
    pg.select_option('#vraField', label=pg.locator('#vraField option', has_text='Pivot 1').inner_text())
    pg.click('#vraCalc')
    expect(pg.locator('#vraOut table')).to_be_visible(timeout=60000)
    rows = pg.locator('#vraOut tbody tr').count()
    check('vegetation map: 3 zones', rows == 3, rows)
    zone_ha = [num(t, r'([\d.]+) ha') for t in pg.locator('#vraOut tbody tr td:nth-child(2)').all_inner_texts()]
    check('zone areas add up to the field (≈81 ha)', abs(sum(zone_ha) - 81.3) < 1.5, zone_ha)
    check('weakest zone holds the stress patch (≥ 6 ha)', zone_ha[-1] >= 6, zone_ha[-1])
    rates = [float(x) for x in pg.eval_on_selector_all('#vraOut [data-rate]', 'els => els.map(e => e.value)')]
    check('inverse strategy: weak zone gets more N', rates[-1] > rates[0], rates)
    tot = pg.inner_text('#vraOut')
    avg = num(tot, r'Average\n([\d.]+)')
    check('area-weighted average = 120 kg/ha', avg is not None and abs(avg - 120) < 1.5, avg)
    pg.screenshot(path=SH + 's4_vra.png')
    with pg.expect_download() as dl: pg.click('[data-exp=shp]')
    shp_zip = dl.value.path(); names = zipfile.ZipFile(shp_zip).namelist()
    check('shapefile zip has shp/shx/dbf/prj', all(any(n.endswith(e) for n in names) for e in ['.shp', '.shx', '.dbf', '.prj']), names)
    os.makedirs(S + 'out', exist_ok=True); import shutil; shutil.copy(shp_zip, S + 'out/rx.zip')
    v = json.loads(subprocess.run(['node', 'verify-shp.js', S + 'out/rx.zip'], cwd=S + 'libs', capture_output=True, text=True).stdout.strip().splitlines()[-1])
    check('GDAL reads the shapefile, closed rings', v.get('ok') and v['count'] == 3 and all(x['closed'] for x in v['props']), str(v)[:150])
    if v.get('ok'):
        gd = sum(x['geod_ha'] for x in v['props'])
        check('GDAL area of zones ≈ field area', abs(gd - 81.3) < 2.5, round(gd, 2))
        check('RATE/ZONE attributes', all('RATE' in x and 'ZONE' in x for x in v['props']), v['props'][0])
    with pg.expect_download() as dl: pg.click('[data-exp=iso]')
    z = zipfile.ZipFile(dl.value.path()); xmlt = z.read('TASKDATA/TASKDATA.XML').decode()
    root = ET.fromstring(xmlt)
    pdv = [int(e.get('B')) for e in root.iter('PDV')]
    check('ISO-XML: 3 treatment zones, DDI 6 kg/ha×100', len(list(root.iter('TZN'))) == 3 and all(e.get('A') == '0006' for e in root.iter('PDV')) and [round(x / 100) for x in pdv] == [round(r) for r in rates], pdv)

    # VRA sowing (productivity)
    pg.locator('.nav-sub', has_text='Sowing').click()
    pg.click('#vraCalc')
    expect(pg.locator('#vraOut table')).to_be_visible(timeout=60000)
    check('sowing map from productivity', pg.locator('#vraOut tbody tr').count() >= 2, pg.inner_text('#vraOut').split('\n')[0])

    # soil sampling
    pg.locator('.nav-sub', has_text='Soil sampling').click()
    pg.click('#ssCalc')
    expect(pg.locator('#ssOut [data-p]').first).to_be_visible(timeout=60000)
    npts = pg.locator('#ssOut [data-p]').count()
    check('grid 2.5 ha sampling points (≈ field/2.5)', 20 <= npts <= 40, npts)
    with pg.expect_download() as dl: pg.click('[data-sx=gpx]')
    gpx = open(dl.value.path()).read()
    check('GPX export', gpx.count('<wpt') == npts)
    pg.screenshot(path=SH + 's5_soil.png')

    # weather forecast view renders (external API may be unreachable here)
    pg.locator('.nav-sub', has_text='Forecast').click(); pg.wait_for_timeout(1500)
    check('forecast view renders', pg.locator('#moduleBody').inner_text().strip() != '')
    check('no JS errors', not errors, errors)
    b.close()
print('ALL PASS' if ok else 'SOME FAILED')
