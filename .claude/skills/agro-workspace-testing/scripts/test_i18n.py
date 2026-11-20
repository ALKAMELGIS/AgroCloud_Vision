"""Language and direction: English left-to-right with the sidebar on the left, Arabic right-to-left mirrored."""
import sys, os, json, urllib.request, re
sys.path.insert(0, os.path.dirname(__file__))
from playwright.sync_api import sync_playwright, expect
import cdn_routes
S = os.environ.get('WORK', os.getcwd()) + '/'
API = 'http://localhost:4000/api/v1'
def call(m, p, b=None, tok=None):
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else None, method=m, headers={'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + tok} if tok else {})})
    return json.load(urllib.request.urlopen(r))
login = cdn_routes.fresh_login(); tok = login['accessToken']
farm = call('POST', '/farms', {'name': 'Liwa Farm'}, tok)
fc = json.load(open(S + 'fixtures/fields.geojson'))
names = ['Grid', 'Pivot 1', 'Nov block']
call('POST', '/fields/bulk', {'farmId': farm['id'], 'fields': [{'name': names[i], 'boundary': f['geometry']} for i, f in enumerate([f for f in fc['features'] if f['geometry']['type'] == 'Polygon'][:3])]}, tok)
ok = True
def check(label, cond, extra=''):
    global ok; ok &= bool(cond); print(('PASS ' if cond else 'FAIL ') + label, str(extra)[:200])
URL = f"https://alkamelgis.github.io/AgroCloud_Vision/workspace.html?farm={farm['id']}"
def xs(pg): return pg.evaluate("['navRail','sidePanel','mapMain'].map(id => Math.round(document.getElementById(id).getBoundingClientRect().left))")
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 1600, 'height': 900})
    ctx.add_init_script(f"localStorage.setItem('accessToken', {json.dumps(tok)}); localStorage.setItem('user', {json.dumps(json.dumps(login['user']))});")
    pg = ctx.new_page(); cdn_routes.install(pg); errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(URL); expect(pg.locator('#fieldsList .field-card')).to_have_count(3)
    nav, side, main = xs(pg)
    check('English: left-to-right', pg.evaluate("document.documentElement.dir") == 'ltr')
    check('English: sidebar left, panel, map right', nav < side < main, (nav, side, main))
    mb = pg.locator('#mapMain').bounding_box(); tb = pg.locator('#mapTools').bounding_box(); sb = pg.locator('#geoSearchWrap').bounding_box()
    check('English: search and tools on the right edge of the map', tb['x'] > mb['x'] + mb['width'] - 80 and sb['x'] > mb['x'] + mb['width'] - 80, (tb['x'], sb['x'], mb['x'] + mb['width']))
    cb = pg.locator('.map-credit').bounding_box(); sc = pg.locator('#mapContainer .leaflet-control-scale').bounding_box()
    check('English: scale and credits top left, clear of the search', cb['x'] < mb['x'] + 40 and sc['x'] < mb['x'] + 200, (cb['x'], sc['x'], mb['x']))
    check('language button offers Arabic', 'العربية' in pg.inner_text('[data-action=lang]'))
    pg.wait_for_timeout(1500); pg.screenshot(path=S + 'shots/l1_english.png')

    pg.click('[data-action=lang]'); pg.wait_for_load_state('load')
    expect(pg.locator('#fieldsList .field-card')).to_have_count(3)
    pg.wait_for_timeout(2500)
    nav, side, main = xs(pg)
    check('Arabic: right-to-left', pg.evaluate("[document.documentElement.dir, document.documentElement.lang]") == ['rtl', 'ar'])
    check('Arabic: sidebar on the right, map on the left', nav > side > main, (nav, side, main))
    check('Arabic: nav translated', 'الحقول' in pg.inner_text('#navItems') and 'الطقس' in pg.inner_text('#navItems'), pg.inner_text('#navItems')[:80])
    check('Arabic: placeholders translated', pg.get_attribute('#fieldSearch', 'placeholder') == 'ابحث في الحقول')
    check('Arabic: field names stay as typed', sorted(pg.locator('#fieldsList .field-card').nth(i).inner_text().split('\n')[0] for i in range(3)) == sorted(names), [pg.locator('#fieldsList .field-card').nth(i).inner_text().split('\n')[0] for i in range(3)])
    check('Arabic: farm name stays as typed', 'Liwa Farm' in pg.inner_text('#farmSwitcher'))
    mb = pg.locator('#mapMain').bounding_box(); tb = pg.locator('#mapTools').bounding_box(); ab = pg.locator('#addFieldBtn').bounding_box()
    check('Arabic: map tools on the left edge of the map', tb['x'] < mb['x'] + 80, (tb['x'], mb['x']))
    sc = pg.locator('#mapContainer .leaflet-control-scale').bounding_box()
    check('Arabic: scale on the right', sc['x'] > mb['x'] + mb['width'] - 250, (sc['x'], mb['x'] + mb['width']))
    check('Arabic: map stays left-to-right inside', pg.evaluate("getComputedStyle(document.querySelector('.leaflet-container')).direction") == 'ltr')
    check('Arabic: units and dates translated', 'هكتار' in pg.inner_text('#sidePanel') and re.search(r'(يناير|فبراير|مارس|أبريل|مايو|يونيو|يوليو|أغسطس|سبتمبر|أكتوبر|نوفمبر|ديسمبر)', pg.inner_text('#tlChips')), pg.inner_text('#tlChips')[:60])
    pg.screenshot(path=S + 'shots/l2_arabic.png')
    # draft card and field panel in Arabic
    pg.evaluate("() => { const ll=[[34.2,-102.2],[34.2,-102.19],[34.21,-102.19],[34.21,-102.2]]; mapInstance.fire(L.Draw.Event.CREATED, { layer: L.polygon(ll), layerType: 'polygon' }); }")
    expect(pg.locator('#draftPanel')).to_contain_text('حقل جديد')
    expect(pg.locator('#dfStatus')).to_contain_text('لا تداخل', timeout=10000)
    pg.screenshot(path=S + 'shots/l3_arabic_draft.png')
    pg.click('#dfCancel')
    pg.locator('#fieldsList .field-card').first.click()
    pg.click('#fieldPanel [data-tab=overview]'); pg.wait_for_timeout(1500)
    check('Arabic: field panel tabs', 'نظرة عامة' in pg.inner_text('#fieldPanel') and 'السجل' in pg.inner_text('#fieldPanel'))
    pg.screenshot(path=S + 'shots/l4_arabic_panel.png')
    # strings still in English (for review)
    left = pg.evaluate(r"""() => { const out = new Set(); const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (w.nextNode()) { const n = w.currentNode, p = n.parentElement; const t = n.nodeValue.trim();
        if (t && /[A-Za-z]{3}/.test(t) && p && p.offsetParent && !p.closest('[translate=no],script,style,.leaflet-control-scale')) out.add(t); } return [...out]; }""")
    print('still English:', [x for x in left if not any(n in x for n in names + ['Liwa Farm', 'NDVI', 'Sentinel', 'Earth Search', 'Esri', '@agrocloud', 'MSAVI', 'NDRE', 'NDMI', 'ReCI', 'VMI', 'CSV', 'GIS', 'GeoJSON', 'K-means', 'S2'])][:40])
    pg.click('[data-action=lang]'); pg.wait_for_load_state('load')
    check('back to English', pg.evaluate("document.documentElement.dir") == 'ltr' and 'Fields' in pg.inner_text('#navItems'))
    pg.evaluate("localStorage.setItem('lang', 'ar')")
    pg2 = b.new_context(viewport={'width': 1280, 'height': 800}).new_page(); cdn_routes.install(pg2)
    pg2.add_init_script("localStorage.setItem('lang', 'ar')")
    pg2.goto('https://alkamelgis.github.io/AgroCloud_Vision/main.html'); pg2.wait_for_timeout(800)
    check('sign-in page in Arabic', 'تسجيل الدخول' in pg2.inner_text('body') and pg2.evaluate("document.documentElement.dir") == 'rtl', pg2.inner_text('body')[:80])
    pg2.screenshot(path=S + 'shots/l5_signin_ar.png')
    pg.evaluate("localStorage.setItem('lang', 'en')")
    pg.click('[data-action=logout]'); pg.wait_for_load_state('load')
    check('language survives sign-out', pg.evaluate("localStorage.getItem('lang')") == 'en')
    check('no JS errors', not errors, errors)
    b.close()
print('ALL PASS' if ok else 'SOME FAILED')
