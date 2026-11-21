"""Field options menu (js/field-menu.js): every item does what it says.
⋮ on a card and right-click on the map open it; open, zoom, hide/show, favourites, rename, colour,
transparency & outline, settings, edit boundary, duplicate, move to farm, export (5 formats), archive, delete.
Then Arabic: the menu is translated and the page has no errors."""
import sys, os, json, urllib.request, zipfile, io
sys.path.insert(0, os.path.dirname(__file__))
from playwright.sync_api import sync_playwright, expect
import cdn_routes
S = os.environ.get('WORK', os.getcwd()) + '/'
API = 'http://localhost:4000/api/v1'
def call(method, path, body=None, tok=None):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None, method=method,
        headers={'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + tok} if tok else {})})
    return json.load(urllib.request.urlopen(req))
login = cdn_routes.fresh_login(); tok = login['accessToken']
farm = call('POST', '/farms', {'name': 'Menu pivots'}, tok)
farm2 = call('POST', '/farms', {'name': 'East block'}, tok)
fc = json.load(open(S + 'fixtures/fields.geojson'))
items = [{'name': f['properties'].get('name') or 'Strip', 'boundary': f['geometry']} for f in fc['features'] if f['geometry']['type'] == 'Polygon']
call('POST', '/fields/bulk', {'farmId': farm['id'], 'fields': items}, tok)
fields = lambda fid: call('GET', f'/fields/by-farm/{fid}', None, tok)
URL = f"https://alkamelgis.github.io/AgroSyntra_One/workspace.html?farm={farm['id']}"
ok = True
def check(label, cond, extra=''):
    global ok; ok &= bool(cond); print(('PASS ' if cond else 'FAIL ') + label, str(extra)[:300], flush=True)

ITEMS = ['open', 'zoom', 'hide', 'fav', 'rename', 'color', 'style', 'settings', 'edit', 'duplicate', 'move', 'export', 'archive', 'delete']
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
    ctx.add_init_script(f"localStorage.setItem('accessToken', {json.dumps(tok)}); localStorage.setItem('user', {json.dumps(json.dumps(login['user']))});")
    pg = ctx.new_page(); cdn_routes.install(pg); errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(URL)
    expect(pg.locator('#fieldsList .field-row')).to_have_count(3)
    expect(pg.locator('#tlChips [data-scene]')).to_have_count(4, timeout=30000)
    pg.wait_for_timeout(2500)
    row = lambda name: pg.locator('#fieldsList .field-row', has_text=name).first
    def menu(name):
        r = row(name); r.hover(); r.locator('.field-more').click()
        expect(pg.locator('.fm-menu:not(.fm-sub)')).to_be_visible()
    act = lambda a: pg.click(f'.fm-menu [data-act="{a}"]')
    fid = lambda name: [f for f in fields(farm['id']) if f['name'] == name][0]['id']

    menu('Pivot 1')
    got = pg.eval_on_selector_all('.fm-menu:not(.fm-sub) [data-act]', 'els => els.map(e => e.dataset.act)')
    check('menu has the 14 items in order', got == ITEMS, got)
    pg.keyboard.press('Escape'); check('Escape closes it', pg.locator('.fm-menu:not(.fm-sub)').is_hidden())

    menu('Pivot 1'); act('open'); expect(pg.locator('#fieldPanel')).to_be_visible()
    check('open field', 'Pivot 1' in pg.inner_text('#fpName'))
    pg.click('#fpClose')

    p1 = fid('Pivot 1')
    pg.evaluate("mapInstance.setView([0, 0], 3)")
    menu('Pivot 1'); act('zoom'); pg.wait_for_timeout(900)
    check('zoom to field', pg.evaluate(f"mapInstance.getBounds().intersects(state.fieldLayerById.get('{p1}').getBounds()) && mapInstance.getZoom() > 12"))

    menu('Pivot 1'); act('hide'); pg.wait_for_timeout(1500)
    check('hide: boundary off the map', pg.evaluate(f"!state.fieldsLayer.hasLayer(state.fieldLayerById.get('{p1}'))"))
    check('hide: imagery off the field', pg.evaluate(f"!Imagery.views[0].layerFor.has('{p1}')"))
    check('hide: marked in the list', row('Pivot 1').evaluate("r => r.classList.contains('is-hidden')"))
    menu('Pivot 1'); check('menu now says Show on map', 'Show on map' in pg.inner_text('.fm-menu [data-act="hide"]')); act('hide'); pg.wait_for_timeout(1500)
    check('show: boundary and imagery back', pg.evaluate(f"state.fieldsLayer.hasLayer(state.fieldLayerById.get('{p1}')) && Imagery.views[0].layerFor.has('{p1}')"))

    last = pg.eval_on_selector_all('#fieldsList .field-row .field-card span.truncate', 'els => els.map(e => e.textContent.trim())')[-2]
    menu(last); act('fav'); pg.wait_for_timeout(300)
    first = pg.locator('#fieldsList .field-row').first
    check('favourite goes first with a star', last in first.inner_text() and first.locator('.fm-flag').count() == 1, last)

    menu('Pivot 2'); act('rename'); pg.fill('#fmName', 'Pivot 2 South'); pg.click('.fm-dialog .fm-ok')
    expect(pg.locator('#toast')).to_contain_text('Pivot 2 South')
    check('rename saved on the server', any(f['name'] == 'Pivot 2 South' for f in fields(farm['id'])))

    menu('Pivot 1'); act('color'); pg.click('.fm-dialog [data-swatch="#0ea5e9"]'); pg.click('.fm-dialog .fm-ok'); pg.wait_for_timeout(300)
    check('colour applied to the boundary', pg.evaluate(f"fieldStyle('{p1}').color") == '#0ea5e9')
    menu('Pivot 1'); act('color'); pg.click('.fm-dialog [data-swatch="#dc2626"]'); pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
    check('colour cancelled puts it back', pg.evaluate(f"fieldStyle('{p1}').color") == '#0ea5e9')

    menu('Pivot 1'); act('style')
    pg.fill('#fmImg', '40'); pg.fill('#fmFill', '30'); pg.fill('#fmW', '4'); pg.click('.fm-dialog .fm-ok'); pg.wait_for_timeout(300)
    st = pg.evaluate(f"fieldStyle('{p1}')")
    check('fill and outline applied', abs(st['fillOpacity'] - 0.3) < 1e-6 and st['weight'] == 4, st)
    check('satellite layer transparency applied', abs(pg.evaluate(f"Imagery.views[0].layerFor.get('{p1}').options.opacity") - 0.4) < 1e-6)

    pg.reload(); expect(pg.locator('#fieldsList .field-row')).to_have_count(3); pg.wait_for_timeout(1500)
    check('display choices survive a reload', pg.evaluate(f"fieldStyle('{p1}').color") == '#0ea5e9' and pg.locator('#fieldsList .field-row').first.locator('.fm-flag').count() == 1)

    menu('Pivot 1'); act('settings'); expect(pg.locator('#fpNameInput')).to_be_visible()
    check('field settings open the overview with the name focused', pg.evaluate("document.activeElement.id") == 'fpNameInput')
    pg.click('#fpClose')

    menu('Pivot 1'); act('edit'); pg.wait_for_timeout(600)
    check('edit boundary starts the editor', pg.locator('#fpEditSave').is_visible())
    pg.click('#fpEditCancel'); pg.click('#fpClose')

    menu('Pivot 1'); act('duplicate'); expect(pg.locator('#toast')).to_contain_text('copy', timeout=15000)
    check('duplicate saved on the server', any(f['name'] == 'Pivot 1 copy' for f in fields(farm['id'])), [f['name'] for f in fields(farm['id'])])
    expect(pg.locator('#fieldsList .field-row')).to_have_count(4)

    menu('Pivot 1 copy'); act('move'); expect(pg.locator('.fm-sub')).to_be_visible()
    pg.click('.fm-sub [data-farm]'); expect(pg.locator('#toast')).to_contain_text('East block', timeout=15000)
    check('move to farm', any(f['name'] == 'Pivot 1 copy' for f in fields(farm2['id'])) and not any(f['name'] == 'Pivot 1 copy' for f in fields(farm['id'])))

    for fmt, ext in [('geojson', '.geojson'), ('kml', '.kml'), ('shp', '_shp.zip'), ('gpx', '.gpx'), ('csv', '.csv')]:
        menu('Pivot 1'); act('export')
        with pg.expect_download() as dl: pg.click(f'.fm-sub [data-exp="{fmt}"]')
        d = dl.value; path = d.path(); data = open(path, 'rb').read()
        good = d.suggested_filename.endswith(ext)
        if fmt == 'geojson': j = json.loads(data); good &= j['features'][0]['geometry']['type'] == 'Polygon' and j['features'][0]['properties']['name'] == 'Pivot 1'
        if fmt == 'kml': good &= b'<Polygon>' in data and b'Pivot 1' in data
        if fmt == 'shp': good &= sorted(n.rsplit('.', 1)[1] for n in zipfile.ZipFile(io.BytesIO(data)).namelist()) == ['cpg', 'dbf', 'prj', 'shp', 'shx']
        if fmt == 'gpx': good &= b'<trkpt' in data
        if fmt == 'csv': good &= b'POLYGON((' in data
        check(f'export {fmt}', good, d.suggested_filename)

    pg.locator('#fieldsList .field-row', has_text='Pivot 1').first.click(button='right')
    check('right-click on a card opens the menu', pg.locator('.fm-menu:not(.fm-sub)').is_visible()); pg.keyboard.press('Escape')
    pt = pg.evaluate(f"(() => {{ const c = state.fieldLayerById.get('{p1}').getBounds().getCenter(); const q = mapInstance.latLngToContainerPoint(c); const r = mapInstance.getContainer().getBoundingClientRect(); return [r.left + q.x, r.top + q.y]; }})()")
    pg.mouse.click(pt[0], pt[1], button='right'); pg.wait_for_timeout(300)
    check('right-click on the map opens the menu', pg.locator('.fm-menu:not(.fm-sub)').is_visible() and 'Pivot 1' in pg.inner_text('.fm-head'))
    pg.keyboard.press('Escape')

    menu('Pivot 2 South'); act('archive'); expect(pg.locator('#toast')).to_contain_text('archived', timeout=15000)
    check('archive: off the list, in Archived', not any(f['name'] == 'Pivot 2 South' for f in fields(farm['id'])) and 'Pivot 2 South' in (pg.text_content('#deletedSection') or ''))

    menu('Pivot 1'); act('delete'); expect(pg.locator('.fm-dialog')).to_be_visible(); pg.click('.fm-dialog .fm-ok')
    expect(pg.locator('#toast')).to_contain_text('deleted forever', timeout=15000)
    check('delete: gone for good', not any(f['name'] == 'Pivot 1' for f in fields(farm['id'])) and 'Pivot 1' not in (pg.text_content('#deletedSection') or '').replace('Pivot 1 copy', ''))
    check('no page errors (en)', not errors, errors)

    # Arabic, and a phone width
    for lang, w, h in [('ar', 1440, 900), ('ar', 390, 844)]:
        c2 = b.new_context(viewport={'width': w, 'height': h})
        c2.add_init_script(f"localStorage.setItem('lang','{lang}'); localStorage.setItem('accessToken', {json.dumps(tok)}); localStorage.setItem('user', {json.dumps(json.dumps(login['user']))});")
        p2 = c2.new_page(); cdn_routes.install(p2); e2 = []; p2.on('pageerror', lambda e: e2.append(str(e)))
        p2.goto(URL); p2.wait_for_timeout(3000)
        if w < 900: p2.evaluate("window.setSheet && setSheet('half')"); p2.wait_for_timeout(500)
        p2.locator('#fieldsList .field-more').first.click(); p2.wait_for_timeout(300)
        box = p2.locator('.fm-menu:not(.fm-sub)').bounding_box()
        txt = p2.inner_text('.fm-menu:not(.fm-sub)')
        check(f'{lang} {w}: menu translated and inside the screen', 'فتح الحقل' in txt and 'حذف الحقل' in txt and box['x'] >= 0 and box['x'] + box['width'] <= w and box['y'] + box['height'] <= h, box)
        p2.screenshot(path=S + f'shots/fieldmenu_{lang}_{w}.png')
        check(f'{lang} {w}: no page errors', not e2, e2); c2.close()
    pg.locator('#fieldsList .field-row').first.hover(); pg.locator('#fieldsList .field-more').first.click(); pg.wait_for_timeout(200)
    pg.screenshot(path=S + 'shots/fieldmenu_en_1440.png')
    b.close()
print('ALL PASS' if ok else 'SOME FAILED')
