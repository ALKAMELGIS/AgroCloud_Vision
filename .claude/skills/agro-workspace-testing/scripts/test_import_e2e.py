import sys, os, json, time, urllib.request
sys.path.insert(0, os.path.dirname(__file__))
from playwright.sync_api import sync_playwright, expect
import cdn_routes
S = os.environ.get('WORK', os.getcwd()) + '/'
FX = S + 'fixtures/'; SH = S + 'shots/'
API = 'http://localhost:4000/api/v1'
def post(path, body, tok=None):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode(), headers={'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + tok} if tok else {})})
    return json.load(urllib.request.urlopen(req))
login = cdn_routes.fresh_login()
tok = login['accessToken']
farm = post('/farms', {'name': 'Texas pivots'}, tok)
URL = f"https://alkamelgis.github.io/AgroSyntra_One/workspace.html?farm={farm['id']}"

def fields_count(page):
    return page.locator('#fieldsList .field-item').count()

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 1440, 'height': 900})
    ctx.add_init_script(f"localStorage.setItem('accessToken', {json.dumps(tok)}); localStorage.setItem('user', {json.dumps(json.dumps(login['user']))});")
    pg = ctx.new_page()
    cdn_routes.install(pg)
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'favicon' not in m.text else None)
    pg.goto(URL)
    expect(pg.locator('#currentFarmName')).to_have_text('Texas pivots')

    # 1. Menu
    pg.click('#addFieldBtn')
    expect(pg.locator('#addMenu')).to_be_visible()
    print('menu items:', pg.locator('#addMenu .menu-item').all_inner_texts())
    pg.screenshot(path=SH + '1_menu.png')

    # 2. Upload a zipped File Geodatabase (UTM 14N)
    with pg.expect_file_chooser() as fc:
        pg.click('[data-action=upload]')
    t0 = time.time()
    fc.value.set_files(FX + 'Farm_gdb.zip')
    expect(pg.locator('#importBody')).to_be_visible(timeout=60000)
    print('gdb ready in %.1fs' % (time.time() - t0), '|', pg.inner_text('#importMeta'), '|', pg.inner_text('#importSummary'))
    rows = pg.locator('#importRows .row-name')
    print('names:', [rows.nth(i).input_value() for i in range(rows.count())])
    rows.nth(4).fill('South block')
    pg.locator('#importRows .row-check').nth(3).uncheck()
    pg.select_option('#importIrrigationSelect', 'pivot')
    print('button:', pg.inner_text('#importSaveBtn'), '|', pg.inner_text('#importSummary'))
    pg.screenshot(path=SH + '2_import_dialog.png')
    pg.click('#importSaveBtn')
    expect(pg.locator('#toast')).to_contain_text('4 fields imported', timeout=20000)
    expect(pg.locator('#fieldsList .field-item')).to_have_count(4)
    print('after gdb:', pg.locator('#fieldsList .field-item').all_inner_texts())
    pg.screenshot(path=SH + '3_after_import.png')

    # 3. Loose shapefile parts picked together
    with pg.expect_file_chooser() as fc:
        pg.click('#addFieldBtn'); pg.click('[data-action=upload]')
    fc.value.set_files([FX + 'loose_shp/' + f for f in os.listdir(FX + 'loose_shp')])
    expect(pg.locator('#importBody')).to_be_visible(timeout=30000)
    print('loose shp:', pg.inner_text('#importMeta'), '|', pg.inner_text('#importSummary'))
    pg.click('#importDialog [data-close] >> nth=0')

    # 4. Bad file
    with pg.expect_file_chooser() as fc:
        pg.click('#addFieldBtn'); pg.click('[data-action=upload]')
    fc.value.set_files(FX + 'notes.txt')
    expect(pg.locator('#importError')).to_be_visible()
    print('bad file:', pg.inner_text('#importError'))
    pg.keyboard.press('Escape')

    # 5. Add GIS data (GeoPackage, Web Mercator) then Select on map
    with pg.expect_file_chooser() as fc:
        pg.click('#addFieldBtn'); pg.click('[data-action=gis]')
    fc.value.set_files(FX + 'fields.gpkg')
    expect(pg.locator('#layersList > div')).to_have_count(1, timeout=60000)
    print('layer row:', pg.inner_text('#layersList'))
    pg.click('#addFieldBtn'); pg.click('[data-action=select]')
    expect(pg.locator('#selectBar')).to_be_visible()
    # click the centre of the unnamed rectangle feature (-102.337, 34.1075) via Leaflet projection
    pt = pg.evaluate("() => { const p = mapInstance.latLngToContainerPoint([34.1075, -102.337]); const r = document.getElementById('mapContainer').getBoundingClientRect(); return [r.left + p.x, r.top + p.y]; }")
    pg.mouse.click(pt[0], pt[1])
    print('select bar:', pg.inner_text('#selectHint'))
    pg.screenshot(path=SH + '4_select_on_map.png')
    pg.click('#selectUseBtn')
    expect(pg.locator('#importBody')).to_be_visible()
    print('selected import:', pg.inner_text('#importSummary'))
    pg.locator('#importRows .row-name').nth(0).fill('Sorghum strip')
    pg.click('#importSaveBtn')
    # this rectangle was already imported from fields.geojson: it must not be saved twice
    expect(pg.locator('#importProblems')).to_contain_text('already saved', timeout=20000)
    print('duplicate blocked:', pg.inner_text('#importProblems').split('\n')[0])
    pg.keyboard.press('Escape')
    expect(pg.locator('#fieldsList .field-item')).to_have_count(4)

    # 6. Draw circle (simulate Leaflet.draw finishing a circle)
    pg.evaluate("() => { const c = L.circle([34.13, -102.32], { radius: 400 }); mapInstance.fire(L.Draw.Event.CREATED, { layer: c, layerType: 'circle' }); }")
    expect(pg.locator('#draftPanel')).to_be_visible()
    print('draft area:', pg.inner_text('#dfArea'))
    pg.fill('#dfName', 'Pivot 7')
    pg.select_option('#dfIrr', 'pivot')
    expect(pg.locator('#dfStatus')).to_contain_text('No overlap', timeout=10000)
    pg.screenshot(path=SH + '5_new_field.png')
    pg.click('#dfSave')
    expect(pg.locator('#toast')).to_contain_text('Pivot 7 saved')
    expect(pg.locator('#fieldsList .field-item')).to_have_count(5)

    # 7. Create group
    pg.click('#addFieldBtn'); pg.click('[data-action=group]')
    pg.fill('#groupNameInput', 'North pivots')
    pg.click('#groupSaveBtn')
    expect(pg.locator('#currentFarmName')).to_have_text('North pivots')
    print('farms:', pg.locator('#farmsList .farm-item').all_inner_texts())
    pg.goto(URL)
    expect(pg.locator('#fieldsList .field-item')).to_have_count(5)
    pg.wait_for_timeout(500)
    pg.screenshot(path=SH + '6_final.png')
    print('JS errors:', errors)
    b.close()
