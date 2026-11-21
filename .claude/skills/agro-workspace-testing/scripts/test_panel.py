import sys, os, json, re, urllib.request, time
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
farm = call('POST', '/farms', {'name': 'Panel pivots'}, tok)
fc = json.load(open(S + 'fixtures/fields.geojson'))
items = []
for f in fc['features']:
    g = f['geometry']
    if g['type'] == 'Polygon': items.append({'name': f['properties'].get('name') or 'Strip', 'boundary': g})
call('POST', '/fields/bulk', {'farmId': farm['id'], 'fields': items}, tok)
URL = f"https://alkamelgis.github.io/AgroSyntra_One/workspace.html?farm={farm['id']}"
ok = True
def check(label, cond, extra=''):
    global ok; ok &= bool(cond); print(('PASS ' if cond else 'FAIL ') + label, extra)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
    ctx.add_init_script(f"localStorage.setItem('accessToken', {json.dumps(tok)}); localStorage.setItem('user', {json.dumps(json.dumps(login['user']))});")
    pg = ctx.new_page(); cdn_routes.install(pg)
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('dialog', lambda d: d.accept())
    pg.goto(URL)
    expect(pg.locator('#fieldsList .field-item')).to_have_count(3)
    expect(pg.locator('#tlChips [data-scene]')).to_have_count(4, timeout=30000)

    # open panel from the list
    pg.locator('#fieldsList .field-item', has_text='Pivot 1').click()
    expect(pg.locator('#fieldPanel')).to_be_visible()
    check('panel header', 'Pivot 1' in pg.inner_text('#fpName'), pg.inner_text('#fpMeta'))

    # overview: rename + irrigation
    pg.click('.fp-tab[data-tab=overview]')
    pg.fill('#fpNameInput', 'Pivot 1 North'); pg.select_option('#fpIrr', 'pivot'); pg.click('#fpSave')
    expect(pg.locator('#toast')).to_contain_text('Pivot 1 North saved')
    expect(pg.locator('#fpMeta')).to_contain_text('Center pivot')
    check('rename + irrigation saved', pg.locator('#fieldsList .field-item', has_text='Pivot 1 North').count() == 1)

    # crops
    pg.click('.fp-tab[data-tab=crops]')
    pg.fill('#fpCropType', 'Alfalfa'); pg.fill('#fpVariety', 'CUF 101'); pg.fill('#fpPlanted', '2026-10-01'); pg.click('#fpCropForm button[type=submit]')
    expect(pg.locator('#toast')).to_contain_text('Alfalfa added')
    pg.select_option('[data-stage]', 'vegetative'); pg.wait_for_timeout(400)
    check('crop stage', pg.locator('[data-stage]').input_value() == 'vegetative')

    # activities
    pg.click('.fp-tab[data-tab=activities]')
    pg.select_option('#fpActType', 'fertilization'); pg.fill('#fpActDate', '2026-11-03'); pg.fill('#fpProduct', 'Urea 46%'); pg.fill('#fpRate', '120')
    check('unit default kg/ha', pg.locator('#fpUnit').input_value() == 'kg/ha')
    pg.click('#fpActForm button[type=submit]'); expect(pg.locator('#toast')).to_contain_text('Fertilizer logged')
    pg.select_option('#fpActType', 'irrigation'); pg.fill('#fpActDate', '2026-11-10'); pg.fill('#fpRate', '35')
    check('unit default mm', pg.locator('#fpUnit').input_value() == 'mm')
    pg.click('#fpActForm button[type=submit]'); expect(pg.locator('#toast')).to_contain_text('Irrigation logged')
    expect(pg.locator('[data-pane=activities] .fp-row')).to_have_count(2)
    check('activity list newest first', 'Irrigation' in pg.locator('[data-pane=activities] .fp-row').first.inner_text(), pg.locator('[data-pane=activities] .fp-row').first.inner_text().replace('\n', ' | '))
    pg.click('.fp-tab[data-tab=overview]'); pg.wait_for_timeout(300)
    pg.screenshot(path=SH + 'p1_overview.png')

    # activity log
    pg.click('#navItems [data-view=activity-log]')
    expect(pg.locator('#activityLogDialog')).to_be_visible()
    expect(pg.locator('#alBody table')).to_be_visible()
    dots = pg.locator('#alBody tbody span.rounded-full').count()
    check('calendar shows 2 activities (fertilizer, irrigation)', dots == 2, dots)
    pg.screenshot(path=SH + 'p5_activity_log.png')
    with pg.expect_download() as dl:
        pg.click('#alCsv')
    csv = open(dl.value.path(), encoding='utf-8-sig').read()
    check('CSV has rows', csv.count('\n') == 2 and 'Urea 46%' in csv, csv.splitlines()[1])
    pg.select_option('#alType', 'irrigation'); check('filter by type', pg.locator('#alBody tbody span.rounded-full').count() == 1)
    pg.locator('#alBody [data-field]', has_text='Pivot 1 North').click()
    expect(pg.locator('#fieldPanel')).to_be_visible()

    # edit boundary: shrink the polygon toward its centre
    pg.click('#fpEdit')
    expect(pg.locator('#fpEditSave')).to_be_visible()
    pg.evaluate("""() => { const l = FieldPanel.editLayer; const c = l.getBounds().getCenter();
      l.setLatLngs(l.getLatLngs()[0].map(p => L.latLng(c.lat + (p.lat - c.lat) * 0.5, c.lng + (p.lng - c.lng) * 0.5))); }""")
    pg.click('#fpEditSave'); expect(pg.locator('#toast')).to_contain_text('Boundary saved')
    meta = pg.inner_text('#fpMeta'); area = float(re.search(r'([\d.]+) ha', meta).group(1))
    check('area ≈ quarter after shrink (≈20.3 ha)', 19.5 < area < 21, meta)

    # delete field
    pg.click('#fpDelete'); expect(pg.locator('#toast')).to_contain_text('archived')
    expect(pg.locator('#fieldsList .field-item')).to_have_count(2)
    check('panel closed after delete', not pg.locator('#fieldPanel').is_visible())
    check('no JS errors', not errors, errors)
    b.close()
print('ALL PASS' if ok else 'SOME FAILED')
