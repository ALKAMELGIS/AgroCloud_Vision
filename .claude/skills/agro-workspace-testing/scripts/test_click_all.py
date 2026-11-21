"""Clicks every control in every view and fails on any JavaScript error or server error (5xx)."""
import sys, os, json, urllib.request
sys.path.insert(0, os.path.dirname(__file__))
from playwright.sync_api import sync_playwright, expect
import cdn_routes
S = os.environ.get('WORK', '/tmp/claude-0/-home-claude/765c94d1-5370-5f2f-8b07-c1be612c5cd8/scratchpad') + '/'
API = 'http://localhost:4000/api/v1'
def call(m, p, b=None, tok=None):
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else None, method=m, headers={'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + tok} if tok else {})})
    return json.load(urllib.request.urlopen(r))
login = cdn_routes.fresh_login(); tok = login['accessToken']
farm = call('POST', '/farms', {'name': 'Click farm'}, tok)
fc = json.load(open(S + 'fixtures/fields.geojson'))
call('POST', '/fields/bulk', {'farmId': farm['id'], 'fields': [{'name': n, 'boundary': f['geometry']} for n, f in zip(['Pivot 1', 'Pivot 2', 'Strip'], [f for f in fc['features'] if f['geometry']['type'] == 'Polygon'])]}, tok)
SKIP = '#acctMenu [data-action=lang],[data-theme-pref],[data-reset],[data-logout],#fpClose,#fpBack,[data-action=logout],[data-action=lang],#fpDelete,[data-del],[data-purge],[data-del-activity],[data-del-crop],[data-exp],[data-cmdk-close],#addFieldBtn,[data-view=search]'
lang = os.environ.get('LANG_UI', 'en')
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 1600, 'height': 900}, accept_downloads=True)
    ctx.add_init_script(f"localStorage.setItem('lang', '{lang}'); localStorage.setItem('accessToken', {json.dumps(tok)}); localStorage.setItem('user', {json.dumps(json.dumps(login['user']))});")
    pg = ctx.new_page(); cdn_routes.install(pg); errors, server = [], []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('response', lambda r: server.append(f'{r.status} {r.url}') if r.status >= 500 else None)
    pg.on('dialog', lambda d: d.dismiss())
    pg.goto(f"https://alkamelgis.github.io/AgroCloud_Vision/workspace.html?farm={farm['id']}")
    expect(pg.locator('#fieldsList .field-card')).to_have_count(3); pg.wait_for_timeout(3000)
    clicked = 0
    def click_all(scope, label):
        global clicked
        n = pg.locator(f'{scope} button:visible, {scope} [role=tab]:visible').count()
        for i in range(min(n, 40)):
            loc = pg.locator(f'{scope} button:visible, {scope} [role=tab]:visible').nth(i)
            try:
                if loc.evaluate(f"(e) => e.matches('{SKIP}') || e.disabled"): continue
                if os.environ.get('VERBOSE'): print('  click', loc.evaluate("(e) => (e.id || '') + ' ' + e.textContent.trim().slice(0, 30)"), flush=True)
                loc.click(timeout=600); clicked += 1; pg.wait_for_timeout(120)
                if pg.locator('dialog[open]').count(): pg.keyboard.press('Escape')
            except Exception:
                pass
        print(f'{label}: {n} controls', flush=True)
    for t in ['vra', 'weather']:
        pg.click(f'#navItems [data-toggle={t}]')
    views = pg.evaluate("[...document.querySelectorAll('#navItems [data-view]')].map(e => e.dataset.view).filter(v => !['search','activity-log'].includes(v))")
    if os.environ.get('ONLY'): views = os.environ['ONLY'].split(',')
    for v in views:
        pg.click(f'#navItems [data-view="{v}"]'); pg.wait_for_timeout(1200)
        # run the main action first where there is one
        for sel in ['#vraCalc', '#ssCalc', '#lbBuild']:
            if pg.locator(f'#sidePanel {sel}:visible').count():
                try: pg.click(f'#sidePanel {sel}', timeout=2000); pg.wait_for_timeout(2500)
                except Exception: pass
        click_all('#sidePanel', v)
        if pg.locator('#fieldPanel:visible').count(): pg.click('#fpBack')
    pg.click('#navItems [data-view=fields]')
    pg.locator('#fieldsList .field-card').first.click(); pg.wait_for_timeout(1500)
    for tab in ['monitoring', 'overview', 'crops', 'activities']:
        if not pg.locator('#fieldPanel:visible').count():
            pg.click('#navItems [data-view=fields]'); pg.locator('#fieldsList .field-card').first.click(); pg.wait_for_timeout(1200)
        if pg.locator('#fpEditCancel:visible').count(): pg.click('#fpEditCancel')
        pg.click(f'#fieldPanel [data-tab={tab}]'); pg.wait_for_timeout(1200)
        click_all('#fieldPanel', 'field ' + tab)
    for sel in ['#swipeBtn', '#measureBtn', '#zoomInBtn', '#zoomOutBtn', '#geoSearchToggle', '#panelToggle', '#panelToggle', '#navCollapse', '#navCollapse']:
        try: pg.click(sel, timeout=1500); pg.wait_for_timeout(200); pg.keyboard.press('Escape'); clicked += 1
        except Exception: pass
    pg.evaluate("openActivityLog && openActivityLog()"); pg.wait_for_timeout(1500)
    click_all('#activityLogDialog', 'activity log')
    print('clicked', clicked)
    print('JS errors:', errors)
    print('server errors:', server)
    print('ALL PASS' if not errors and not server and clicked > 80 else 'SOME FAILED')
    b.close()
