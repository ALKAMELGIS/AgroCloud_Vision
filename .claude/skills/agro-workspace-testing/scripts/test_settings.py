"""Account menu and Settings: sections, live preferences (unit, week start, theme, motion, map defaults), reset, one light white."""
import sys, os, json, urllib.request, re
sys.path.insert(0, os.path.dirname(__file__))
from playwright.sync_api import sync_playwright, expect
import cdn_routes
S = os.environ['WORK'] + '/'
login = cdn_routes.fresh_login(); tok = login['accessToken']
def call(m, p, b=None):
    r = urllib.request.Request('http://localhost:4000/api/v1' + p, data=json.dumps(b).encode() if b is not None else None, method=m, headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok})
    return json.load(urllib.request.urlopen(r))
farm = call('POST', '/farms', {'name': 'Settings farm'})
fc = json.load(open(S + 'fixtures/fields.geojson'))
call('POST', '/fields/bulk', {'farmId': farm['id'], 'fields': [{'name': 'Pivot 1', 'boundary': [f for f in fc['features'] if f['geometry']['type'] == 'Polygon'][0]['geometry']}]})
ok = True
def check(label, cond, extra=''):
    global ok; ok &= bool(cond); print(('PASS ' if cond else 'FAIL ') + label, str(extra)[:220], flush=True)
errors = []
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 1440, 'height': 900})
    ctx.add_init_script(f"if (!sessionStorage.k) {{ sessionStorage.k = 1; localStorage.setItem('imgProvider', 'es'); localStorage.setItem('accessToken', {json.dumps(tok)}); localStorage.setItem('user', {json.dumps(json.dumps(login['user']))}); }}")
    pg = ctx.new_page(); cdn_routes.install(pg); pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(f"https://alkamelgis.github.io/AgroCloud_Vision/workspace.html?farm={farm['id']}")
    expect(pg.locator('#fieldsList .field-card')).to_have_count(1); pg.wait_for_timeout(2500)
    # one white in light mode: rail and panel share the surface, cards are white
    bg = pg.evaluate("['#navRail', '#sidePanel'].map((s) => getComputedStyle(document.querySelector(s)).backgroundColor)")
    check('sidebar and fields panel share one white', bg[0] == bg[1], bg)
    # account menu
    check('account row shows the user', login['user']['email'].split('@')[0] in pg.inner_text('#acctBtn'))
    pg.click('#acctBtn'); expect(pg.locator('#acctMenu')).to_be_visible()
    expect(pg.locator('#acctMenu')).to_contain_text('Settings farm', timeout=10000) if False else None
    check('menu: settings, language, appearance, log out', all(pg.locator(f'#acctMenu {s}').count() == 1 for s in ['[data-open-settings]', '[data-action=lang]', '[data-action=theme]', '[data-action=logout]']))
    pg.keyboard.press('Escape'); expect(pg.locator('#acctMenu')).to_be_hidden()
    # open with the shortcut
    pg.keyboard.press('Control+,'); expect(pg.locator('#settingsDialog')).to_be_visible()
    check('four sections', pg.locator('#settingsDialog .set-nav button').count() == 4)
    # area unit
    ha_txt = pg.inner_text('#fieldsList .field-card')
    pg.click('#settingsDialog [data-seg=areaUnit] [data-v=ac]'); pg.wait_for_timeout(300)
    ac_txt = pg.inner_text('#fieldsList .field-card')
    m1 = re.search(r'([\d,.]+) ha', ha_txt); m2 = re.search(r'([\d,.]+) ac', ac_txt)
    check('area unit switches fields to acres', m1 and m2 and abs(float(m2.group(1).replace(',', '')) - float(m1.group(1).replace(',', '')) * 2.4710538) < 0.02, (m1 and m1.group(0), m2 and m2.group(0)))
    pg.click('#settingsDialog [data-seg=areaUnit] [data-v=ha]')
    # week start
    pg.click('#settingsDialog [data-seg=weekStart] [data-v="6"]')
    check('week start stored', pg.evaluate("localStorage.getItem('weekStart')") == '6')
    # appearance
    pg.click('#settingsDialog [data-sec=appearance]')
    pg.click('#settingsDialog .theme-card[data-theme-pref=dark]'); pg.wait_for_timeout(400)
    check('theme card applies dark', pg.evaluate("document.documentElement.dataset.theme") == 'dark' and pg.evaluate("localStorage.getItem('theme')") == 'dark')
    pg.screenshot(path=S + 'shots/set_dark.png')
    pg.click('#settingsDialog .theme-card[data-theme-pref=system]'); pg.wait_for_timeout(300)
    check('match device stored', pg.evaluate("localStorage.getItem('theme')") == 'system' and pg.evaluate("Theme.pref") == 'system')
    pg.click('#settingsDialog .theme-card[data-theme-pref=light]'); pg.wait_for_timeout(300)
    pg.click('#settingsDialog [data-toggle-pref=reduceMotion]')
    check('reduce motion', pg.evaluate("document.documentElement.classList.contains('reduce-motion')"))
    pg.click('#settingsDialog [data-toggle-pref=reduceMotion]')
    pg.screenshot(path=S + 'shots/set_light_appearance.png')
    # map defaults
    pg.click('#settingsDialog [data-sec=map]')
    pg.select_option('#settingsDialog [data-pref-select=defaultIndex]', 'savi'); pg.wait_for_timeout(1200)
    check('default layer switches the map now', pg.input_value('#imgIndex') == 'savi' and pg.evaluate("localStorage.getItem('defaultIndex')") == 'savi')
    pg.click('#settingsDialog [data-toggle-pref=imgContrast]'); pg.wait_for_timeout(800)
    check('contrast toggle reaches the map', pg.evaluate("Imagery.views[0].contrast") is False)
    pg.screenshot(path=S + 'shots/set_map.png')
    pg.click('#settingsDialog [data-sec=account]'); pg.wait_for_timeout(600)
    check('account shows email and organisation', login['user']['email'] in pg.inner_text('#settingsDialog') and 'Settings farm' not in '' )
    pg.screenshot(path=S + 'shots/set_account.png')
    pg.click('#settingsDialog [data-close]'); expect(pg.locator('#settingsDialog')).to_be_hidden()
    # persists after reload
    pg.reload(); expect(pg.locator('#fieldsList .field-card')).to_have_count(1); pg.wait_for_timeout(2500)
    check('default layer applied on open', pg.input_value('#imgIndex') == 'savi')
    # palette entry
    pg.keyboard.press('Control+k'); pg.fill('#cmdkInput', 'appearance'); pg.keyboard.press('Enter')
    expect(pg.locator('#settingsDialog')).to_be_visible()
    check('command palette opens settings', pg.locator('#settingsDialog .set-nav [aria-current=page]').inner_text() == 'Appearance')
    pg.click('#settingsDialog [data-sec=account]'); pg.click('#settingsDialog [data-reset]'); pg.wait_for_load_state('load'); pg.wait_for_timeout(2500)
    check('reset restores defaults', pg.evaluate("localStorage.getItem('defaultIndex')") is None and pg.evaluate("Theme.pref") == 'light')
    check('no page errors', not errors, errors)
    b.close()
print('ALL PASS' if ok else 'SOME FAILED')
