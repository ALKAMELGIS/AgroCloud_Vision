"""Browser flow for registering and managing fields: draft card, live checks, overlap choices, history, delete/undo, import problems."""
import sys, os, json, urllib.request
sys.path.insert(0, os.path.dirname(__file__))
from playwright.sync_api import sync_playwright, expect
import cdn_routes
S = os.environ.get('WORK', os.getcwd()) + '/'
API = 'http://localhost:4000/api/v1'
def call(m, p, b=None, tok=None):
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else None, method=m, headers={'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + tok} if tok else {})})
    return json.load(urllib.request.urlopen(r))
login = cdn_routes.fresh_login(); tok = login['accessToken']
farm = call('POST', '/farms', {'name': 'Flow farm'}, tok)
def sq(x, y, d=0.01): return {'type': 'Polygon', 'coordinates': [[[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]]]}
call('POST', '/fields', {'farmId': farm['id'], 'name': 'North block', 'boundary': sq(-102.34, 34.11)}, tok)
ok = True
def check(label, cond, extra=''):
    global ok; ok &= bool(cond); print(('PASS ' if cond else 'FAIL ') + label, str(extra)[:160])
DRAW = "(c) => { const ll = c.map(([x, y]) => [y, x]); mapInstance.fire(L.Draw.Event.CREATED, { layer: L.polygon(ll), layerType: 'polygon' }); }"
def ring(x, y, d=0.01): return [[x, y], [x + d, y], [x + d, y + d], [x, y + d]]
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 1600, 'height': 900})
    ctx.add_init_script(f"localStorage.setItem('accessToken', {json.dumps(tok)}); localStorage.setItem('user', {json.dumps(json.dumps(login['user']))});")
    pg = ctx.new_page(); cdn_routes.install(pg); errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('dialog', lambda d: d.accept())
    pg.goto(f"https://alkamelgis.github.io/AgroSyntra_One/workspace.html?farm={farm['id']}")
    expect(pg.locator('#fieldsList .field-card')).to_have_count(1)

    # 1. draw: the draft card opens beside the map, the shape stays editable
    pg.evaluate(DRAW, ring(-102.30, 34.11))
    expect(pg.locator('#draftPanel')).to_be_visible()
    check('draft card is not a modal', pg.evaluate("!document.querySelector('dialog[open]')"))
    check('auto name suggested', pg.input_value('#dfName') == 'Field 1', pg.input_value('#dfName'))
    check('live area', 'ha' in pg.inner_text('#dfArea') and pg.inner_text('#dfCorners') == '4 corners', pg.inner_text('#dfArea'))
    expect(pg.locator('#dfStatus')).to_contain_text('No overlap', timeout=10000)
    check('corners are draggable', pg.locator('.leaflet-editing-icon').count() >= 4, pg.locator('.leaflet-editing-icon').count())

    # 2. move a corner onto the saved field: live overlap warning, saved field outlined
    pg.evaluate("""() => { const l = [...Object.values(mapInstance._layers)].find(x => x.editing && x.editing.enabled && x.editing.enabled() && x.getLatLngs);
      const ll = l.getLatLngs()[0]; ll[0] = L.latLng(34.115, -102.335); l.setLatLngs([ll]); l.editing.disable(); l.editing.enable(); mapInstance.fire('draw:editvertex', { layers: L.layerGroup() }); }""")
    expect(pg.locator('#dfStatus')).to_contain_text('Overlaps a saved field', timeout=10000)
    check('overlap lists the field', 'North block' in pg.inner_text('#dfStatus'))
    pg.fill('#dfName', 'East block')
    pg.click('#dfSave')
    expect(pg.locator('#dfChoice')).to_be_visible(timeout=10000)
    check('save offers cut / keep / keep editing', pg.locator('#dfChoice [data-ov]').count() == 3)
    pg.screenshot(path=S + 'shots/f1_overlap_choice.png')
    pg.click('#dfChoice [data-ov=clip]')
    expect(pg.locator('#toast')).to_contain_text('East block saved', timeout=10000)
    check('toast says the overlap was cut', 'cut away' in pg.inner_text('#toast'), pg.inner_text('#toast'))
    expect(pg.locator('#fieldsList .field-card')).to_have_count(2)
    check('draft closed after save', not pg.locator('#draftPanel').is_visible())

    # 3. duplicate: Save is disabled with the name of the saved field
    pg.evaluate(DRAW, ring(-102.34, 34.11))
    expect(pg.locator('#dfStatus')).to_contain_text('already saved as', timeout=10000)
    check('duplicate cannot be saved', pg.locator('#dfSave').is_disabled())
    pg.keyboard.press('Escape')
    expect(pg.locator('#draftPanel')).to_be_hidden()

    # 4. self-crossing shape: refused, Save disabled
    pg.evaluate(DRAW, [[-102.25, 34.11], [-102.24, 34.12], [-102.24, 34.11], [-102.25, 34.12]])
    expect(pg.locator('#dfStatus')).to_contain_text('crosses itself', timeout=10000)
    check('self-crossing cannot be saved', pg.locator('#dfSave').is_disabled())
    pg.click('#dfCancel')

    # 5. history and edit with overlap choice
    pg.locator('#fieldsList .field-card', has_text='East block').click()
    expect(pg.locator('#fieldPanel')).to_be_visible()
    pg.click('#fieldPanel [data-tab=overview]')
    expect(pg.locator('#fpHistory li')).to_have_count(1, timeout=10000)
    check('history shows the creation with the cut', 'Field added' in pg.inner_text('#fpHistory') and 'cut' in pg.inner_text('#fpHistory'), pg.inner_text('#fpHistory').replace('\n', ' '))
    pg.fill('#fpNameInput', 'East pivot'); pg.click('#fpSave'); pg.wait_for_timeout(800)
    pg.click('#fieldPanel [data-tab=overview]')
    expect(pg.locator('#fpHistory')).to_contain_text('Renamed', timeout=10000)
    pg.click('#fpEdit')
    expect(pg.locator('#fpEditSave')).to_be_visible()
    pg.evaluate("""() => { const l = FieldPanel.editLayer; const ll = l.getLatLngs()[0]; ll.forEach((p) => { p.lng -= 0.004; }); l.setLatLngs([ll]); l.editing.disable(); l.editing.enable(); mapInstance.fire('draw:editvertex', { layers: L.layerGroup() }); }""")
    expect(pg.locator('#fpEditStatus')).to_contain_text('Overlaps', timeout=10000)
    pg.click('#fpEditSave')
    expect(pg.locator('#fpEditStatus [data-ov=allow]')).to_be_visible(timeout=10000)
    pg.click('#fpEditStatus [data-ov=allow]')
    expect(pg.locator('#toast')).to_contain_text('Boundary saved', timeout=10000)
    pg.click('#fieldPanel [data-tab=overview]')
    expect(pg.locator('#fpHistory [data-restore]')).to_have_count(1, timeout=10000)
    pg.click('#fpHistory [data-show]'); pg.wait_for_timeout(300)
    pg.screenshot(path=S + 'shots/f2_history.png')
    pg.click('#fpHistory [data-restore]')
    expect(pg.locator('#toast')).to_contain_text('Earlier boundary restored', timeout=10000)

    # 6. delete with undo, then recently deleted
    check('panel shows the restored field', 'East pivot' in pg.inner_text('#fpName'))
    pg.click('#fpDelete')
    expect(pg.locator('#toast')).to_contain_text('East pivot deleted', timeout=10000)
    expect(pg.locator('#fieldsList .field-card')).to_have_count(1)
    pg.click('#toastAction')
    expect(pg.locator('#toast')).to_contain_text('restored', timeout=10000)
    expect(pg.locator('#fieldsList .field-card')).to_have_count(2)
    pg.locator('#fieldsList .field-card', has_text='North block').click()
    pg.click('#fpDelete')
    expect(pg.locator('#deletedSection')).to_be_visible(timeout=10000)
    pg.click('#deletedSection summary')
    check('recently deleted lists it', 'North block' in pg.inner_text('#deletedList'))
    check('owner can delete forever', pg.locator('#deletedList [data-purge]').count() == 1)
    pg.screenshot(path=S + 'shots/f3_deleted.png')
    pg.click('#deletedList [data-undel]')
    expect(pg.locator('#fieldsList .field-card')).to_have_count(2, timeout=10000)

    # 7. import with a duplicate: problems listed, skip imports the rest
    fc = {'type': 'FeatureCollection', 'features': [{'type': 'Feature', 'properties': {'name': 'Copy of North'}, 'geometry': sq(-102.34, 34.11)}, {'type': 'Feature', 'properties': {'name': 'West block'}, 'geometry': sq(-102.38, 34.11)}]}
    path = S + 'out/dup_import.geojson'; os.makedirs(S + 'out', exist_ok=True); json.dump(fc, open(path, 'w'))
    pg.set_input_files('#importInput', path)
    expect(pg.locator('#importBody')).to_be_visible(timeout=15000)
    pg.click('#importSaveBtn')
    expect(pg.locator('#importProblems')).to_be_visible(timeout=10000)
    check('import lists the duplicate', 'Copy of North' in pg.inner_text('#importProblems') and 'already saved' in pg.inner_text('#importProblems'), pg.inner_text('#importProblems')[:120])
    pg.screenshot(path=S + 'shots/f4_import_problems.png')
    pg.click('#importProblems [data-mode=skip]')
    expect(pg.locator('#toast')).to_contain_text('1 field imported · 1 skipped', timeout=10000)
    expect(pg.locator('#fieldsList .field-card')).to_have_count(3)
    check('no JS errors', not errors, errors)
    b.close()
print('ALL PASS' if ok else 'SOME FAILED')
