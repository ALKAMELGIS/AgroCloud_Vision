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
login = cdn_routes.fresh_login(); tok = login['accessToken']
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
    check('search starts as a small button', pg.locator('#geoSearchForm').bounding_box()['width'] <= 46 and not pg.locator('#geoSearch').is_visible())
    pg.screenshot(path=SH + 'search_closed.png', clip={'x': 0, 'y': 0, 'width': 520, 'height': 120})
    pg.click('#geoSearchToggle'); pg.wait_for_timeout(300)
    check('click opens the search box', pg.locator('#geoSearchForm').bounding_box()['width'] > 300 and pg.evaluate("document.activeElement.id") == 'geoSearch')
    pg.screenshot(path=SH + 'search_open.png', clip={'x': 0, 'y': 0, 'width': 520, 'height': 120})
    pg.fill('#geoSearch', '34.12, -102.33'); pg.press('#geoSearch', 'Enter'); pg.wait_for_timeout(400)
    check('coordinate search zooms', abs(pg.evaluate('mapInstance.getCenter().lat') - 34.12) < 0.01)
    pg.press('#geoSearch', 'Escape'); pg.wait_for_timeout(300)
    check('Esc closes the search back to a button', pg.locator('#geoSearchForm').bounding_box()['width'] <= 46)

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

    # fields panel folds away and comes back
    w0 = pg.locator('#mapMain').bounding_box()['width']
    pg.screenshot(path=SH + 'p1_panel_open.png', clip={'x': 200, 'y': 300, 'width': 520, 'height': 300})
    pg.click('#panelToggle'); pg.wait_for_timeout(450)
    check('panel folds to zero width', pg.locator('#sidePanel').bounding_box()['width'] < 1 and pg.locator('#mapMain').bounding_box()['width'] > w0 + 300, pg.locator('#sidePanel').bounding_box()['width'])
    check('tab stays on the map edge to reopen', pg.locator('#panelToggle').is_visible() and pg.get_attribute('#panelToggle', 'aria-expanded') == 'false')
    pg.screenshot(path=SH + 'p2_panel_folded.png', clip={'x': 200, 'y': 300, 'width': 520, 'height': 300})
    pg.click('#panelToggle'); pg.wait_for_timeout(450)
    check('panel opens again', abs(pg.locator('#sidePanel').bounding_box()['width'] - 320) < 2)
    pg.click('#panelToggle'); pg.wait_for_timeout(450)
    pg.click('#navItems [data-view=leaderboard]'); pg.wait_for_timeout(450)
    check('choosing a view reopens the panel', abs(pg.locator('#sidePanel').bounding_box()['width'] - 320) < 2)
    pg.click('#navItems [data-view=fields]')

    # split view: two screens, each with its own date and layer
    pg.click('#navItems [data-view=fields]')
    pg.click('#swipeBtn'); pg.click('#compareMenu [data-compare=split]')
    expect(pg.locator('#mapPaneB')).to_be_visible()
    expect(pg.locator('#tlChips2 [data-scene]')).to_have_count(4, timeout=30000)
    pg.wait_for_function("document.querySelectorAll('#mapPaneB .leaflet-pane .img-px').length === 3", timeout=30000)
    check('right screen defaults to the previous clear date', '05 Nov' in pg.locator('#tlChips2 [aria-current=true]').inner_text(), pg.locator('#tlChips2 [aria-current=true]').inner_text().replace('\n', ' '))
    pg.select_option('#imgIndex2', 'ndmi')
    expect(pg.locator('#imgLegend2')).to_contain_text('NDMI')
    pg.wait_for_timeout(1500)
    check('each screen keeps its own layer', pg.locator('#imgIndex').input_value() == 'ndvi' and pg.locator('#imgIndex2').input_value() == 'ndmi')
    pg.evaluate("mapInstance.setView([34.12, -102.33], 15, {animate:false})"); pg.wait_for_timeout(400)
    c1 = pg.evaluate("[mapInstance.getCenter().lat.toFixed(4), mapInstance.getZoom()]")
    pt = pg.evaluate("() => { const p = mapInstance.latLngToContainerPoint([34.1185, -102.3285]); const r = document.getElementById('mapContainer').getBoundingClientRect(); return [r.left + p.x, r.top + p.y]; }")
    pg.mouse.move(pt[0], pt[1]); pg.wait_for_timeout(250); pg.mouse.move(pt[0] + 1, pt[1] + 1); pg.wait_for_timeout(300)
    ha_, hb_ = pg.inner_text('#hoverA'), pg.inner_text('#hoverB')
    check('hover readout on both screens', 'NDVI' in ha_ and 'NDMI' in hb_, (ha_ + ' | ' + hb_).replace('\n', ' '))
    check('screens stay in sync', pg.evaluate("Imagery.views[1].getMap().getZoom()") == c1[1])
    pg.screenshot(path=SH + 's3_split.png')

    # swipe: one map, screen B right of a draggable divider
    pg.click('#swipeBtn'); pg.click('#compareMenu [data-compare=swipe]'); pg.wait_for_timeout(400)
    expect(pg.locator('#swipeHandle')).to_be_visible()
    ba, bb = pg.locator('#mapPaneA').bounding_box(), pg.locator('#mapPaneB').bounding_box()
    check('swipe overlays the two screens on one map', abs(ba['x'] - bb['x']) < 1 and abs(ba['width'] - bb['width']) < 1, (ba['width'], bb['width']))
    check('swipe keeps both layers', pg.locator('#imgIndex').input_value() == 'ndvi' and pg.locator('#imgIndex2').input_value() == 'ndmi')
    hb = pg.locator('#swipeHandle').bounding_box(); hx, hy = hb['x'] + hb['width'] / 2, hb['y'] + hb['height'] / 2
    check('divider starts in the middle', abs(hx - (ba['x'] + ba['width'] / 2)) < 3, (hx, ba['x'] + ba['width'] / 2))
    pg.mouse.move(hx, hy); pg.mouse.down(); pg.mouse.move(hx - 150, hy, steps=8); pg.mouse.move(ba['x'] + ba['width'] * 0.3, hy, steps=8); pg.mouse.up()
    frac = pg.evaluate("Imagery.swipe()")
    da, db = pg.locator('#tlChips').bounding_box(), pg.locator('#tlChips2').bounding_box()
    pg.evaluate("Imagery.setSwipe(0.8)"); pg.wait_for_timeout(200)
    da2, db2 = pg.locator('#tlChips').bounding_box(), pg.locator('#tlChips2').bounding_box()
    check('docks stay put while the divider moves', abs(da['x'] - da2['x']) < 1 and abs(da['width'] - da2['width']) < 1 and abs(db['x'] - db2['x']) < 1, (da['width'], da2['width']))
    pg.evaluate("Imagery.setSwipe(%f)" % frac); pg.wait_for_timeout(100)
    check('dragging the handle moves the divider', abs(frac - 0.3) < 0.02, frac)
    check('screen B is clipped at the divider', '30' in pg.evaluate("getComputedStyle(document.getElementById('mapContainer2')).clipPath"), pg.evaluate("getComputedStyle(document.getElementById('mapContainer2')).clipPath"))
    pg.focus('#swipeHandle'); pg.keyboard.press('ArrowRight')
    check('arrow keys nudge the divider', abs(pg.evaluate("Imagery.swipe()") - 0.32) < 0.005)
    pg.evaluate("Imagery.setSwipe(0.5)"); pg.wait_for_timeout(200)
    pg.evaluate("mapInstance.setView([34.12, -102.33], 15, {animate:false})"); pg.wait_for_timeout(400)
    def side_hover(lng):
        pt = pg.evaluate(f"() => {{ const p = mapInstance.latLngToContainerPoint([34.1185, {lng}]); const r = document.getElementById('mapContainer').getBoundingClientRect(); return [r.left + p.x, r.top + p.y]; }}")
        pg.mouse.move(pt[0], pt[1]); pg.wait_for_timeout(250); pg.mouse.move(pt[0] + 1, pt[1] + 1); pg.wait_for_timeout(300)
        return pg.locator('#hoverA').is_visible(), pg.locator('#hoverB').is_visible(), pt[0]
    mid = ba['x'] + ba['width'] / 2
    lngs = pg.evaluate("(() => { const b = mapInstance.getBounds(); return [b.getWest(), b.getEast()]; })()")
    # pick field points either side of the divider
    l = side_hover(-102.3285)
    check('hover shows only the layer under the cursor', (l[0] and not l[1]) if l[2] < mid else (l[1] and not l[0]), l)
    import io
    from PIL import Image
    shot = Image.open(io.BytesIO(pg.screenshot())).convert('RGB')
    px = shot.getpixel((int(l[2]) + 12, int(pg.evaluate("(() => { const p = mapInstance.latLngToContainerPoint([34.1185, -102.3285]); return document.getElementById('mapContainer').getBoundingClientRect().top + p.y; })()")) + 30))
    check('right of the divider paints screen B (NDMI teal, not NDVI green)', px[2] > 0.8 * px[1], px)
    pg.mouse.move(mid + 300, ba['y'] + 40); pg.wait_for_timeout(200)
    pg.screenshot(path=SH + 's3_swipe.png')
    pg.click('#swipeBtn'); pg.click('#compareMenu [data-compare=off]')
    expect(pg.locator('#mapPaneB')).to_be_hidden()
    check('stop comparing hides the divider', not pg.locator('#swipeHandle').is_visible())

    # leaderboard + notifications + reports
    pg.click('#navItems [data-view=leaderboard]')
    expect(pg.locator('#moduleBody [data-open]')).to_have_count(3, timeout=30000)
    check('leaderboard ranks 3 fields', True, pg.locator('#moduleBody [data-open]').first.inner_text().replace('\n', ' '))
    pg.click('#navItems [data-view=reports]')
    expect(pg.locator('#moduleBody')).to_contain_text('Crop area', timeout=15000)
    check('season report', 'Activities' in pg.inner_text('#moduleBody'))
    pg.click('#navItems [data-view=notifications]')
    expect(pg.locator('#moduleBody')).to_contain_text('New Sentinel-2 image')

    # VRA vegetation
    pg.click('#navItems [data-toggle=vra]'); pg.wait_for_timeout(350); pg.click('#navItems [data-view=vra-vegetation]')
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
    pg.click('#navItems [data-view=vra-sowing]')
    pg.click('#vraCalc')
    expect(pg.locator('#vraOut table')).to_be_visible(timeout=60000)
    check('sowing map from productivity', pg.locator('#vraOut tbody tr').count() >= 2, pg.inner_text('#vraOut').split('\n')[0])

    # soil sampling
    pg.click('#navItems [data-view=soil-sampling]')
    pg.click('#ssCalc')
    expect(pg.locator('#ssOut [data-p]').first).to_be_visible(timeout=60000)
    npts = pg.locator('#ssOut [data-p]').count()
    check('grid 2.5 ha sampling points (≈ field/2.5)', 20 <= npts <= 40, npts)
    with pg.expect_download() as dl: pg.click('[data-sx=gpx]')
    gpx = open(dl.value.path()).read()
    check('GPX export', gpx.count('<wpt') == npts)
    pg.screenshot(path=SH + 's5_soil.png')

    # weather forecast view renders (external API may be unreachable here)
    pg.click('#navItems [data-toggle=weather]'); pg.wait_for_timeout(350); pg.click('#navItems [data-view=weather-forecast]'); pg.wait_for_timeout(1500)
    check('forecast view renders', pg.locator('#moduleBody').inner_text().strip() != '')
    # command palette and collapsed sidebar
    pg.keyboard.press('Control+k')
    expect(pg.locator('#cmdk')).to_be_visible()
    pg.fill('#cmdkInput', 'pivot 2'); pg.keyboard.press('Enter')
    expect(pg.locator('#fpName')).to_have_text('Pivot 2', timeout=15000)
    check('command palette opens a field', True)
    pg.click('#navCollapse'); pg.wait_for_timeout(400)
    check('sidebar collapses to an icon rail', pg.evaluate("document.getElementById('navRail').getBoundingClientRect().width") <= 64)
    pg.screenshot(path=SH + 's6_collapsed.png')
    pg.click('#navCollapse'); pg.wait_for_timeout(300)
    check('no JS errors', not errors, errors)
    b.close()
print('ALL PASS' if ok else 'SOME FAILED')
