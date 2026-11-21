import sys, os, json, urllib.request
sys.path.insert(0, os.path.dirname(__file__))
from playwright.sync_api import sync_playwright, expect
import cdn_routes
S = os.environ['WORK'] + '/'
API = 'http://localhost:4000/api/v1'
def call(m, p, b=None, tok=None):
    r = urllib.request.Request(API + p, data=json.dumps(b).encode() if b is not None else None, method=m, headers={'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + tok} if tok else {})})
    return json.load(urllib.request.urlopen(r))
login = cdn_routes.fresh_login(); tok = login['accessToken']
farm = call('POST', '/farms', {'name': 'Theme farm'}, tok)
fc = json.load(open(S + 'fixtures/fields.geojson'))
call('POST', '/fields/bulk', {'farmId': farm['id'], 'fields': [{'name': n, 'boundary': f['geometry']} for n, f in zip(['Pivot 1', 'Pivot 2', 'Strip'], [f for f in fc['features'] if f['geometry']['type'] == 'Polygon'])]}, tok)
errors = []
ok = True
def check(label, cond, extra=''):
    global ok; ok &= bool(cond); print(('PASS ' if cond else 'FAIL ') + label, str(extra)[:200], flush=True)
def contrast(pg, sel):
    return pg.evaluate("""(sel) => { const el = document.querySelector(sel); const lum = (c) => { const m = c.match(/[\\d.]+/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * m[0] + .7152 * m[1] + .0722 * m[2]; };
      let bg = 'rgba(0, 0, 0, 0)', e = el; while (e && /rgba\\(0, 0, 0, 0\\)|transparent/.test(bg)) { bg = getComputedStyle(e).backgroundColor; e = e.parentElement; }
      const a = lum(getComputedStyle(el).color), b = lum(bg); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); }""", sel)
theme = os.environ.get('THEME', 'light')
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 1600, 'height': 900})
    ctx.add_init_script(f"if (!sessionStorage.k) {{ sessionStorage.k = 1; localStorage.setItem('theme', '{theme}'); localStorage.setItem('imgProvider', 'es'); localStorage.setItem('accessToken', {json.dumps(tok)}); localStorage.setItem('user', {json.dumps(json.dumps(login['user']))}); }}")
    pg = ctx.new_page(); cdn_routes.install(pg); pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(f"https://alkamelgis.github.io/AgroSyntra_One/workspace.html?farm={farm['id']}")
    expect(pg.locator('#fieldsList .field-card')).to_have_count(3); pg.wait_for_timeout(3000)
    pg.screenshot(path=S + f'shots/th_{theme}_1_main.png')
    check(f'{theme}: theme applied before paint', pg.evaluate("document.documentElement.dataset.theme") == theme)
    for sel in ['#fieldsList .field-card', '.nav-row[data-view=leaderboard]', '#tlChips', '#imgIndex', '.acct-name']:
        cr = contrast(pg, sel); check(f'{theme}: text contrast {sel} ≥ 4.5', cr >= 4.5, round(cr, 2))
    pg.locator('#fieldsList .field-card', has_text='Pivot 1').click(); pg.wait_for_timeout(1500)
    pg.click('#tsBtn'); expect(pg.locator('#tsStatus')).to_contain_text('clear dates', timeout=30000); pg.wait_for_timeout(1200)
    pg.screenshot(path=S + f'shots/th_{theme}_2_field_ts.png')
    pg.click('#tsModes [data-mode=sky]'); pg.wait_for_timeout(2000)
    pg.screenshot(path=S + f'shots/th_{theme}_3_sky.png', clip={'x': 560, 'y': 590, 'width': 1040, 'height': 310})
    pg.click('#tsModes [data-mode=chart]'); pg.click('#tsClose')
    pg.click('#navItems [data-view=leaderboard]'); pg.wait_for_timeout(800)
    pg.screenshot(path=S + f'shots/th_{theme}_4_leader.png')
    pg.keyboard.press('Escape')
    pg.click('#acctBtn'); pg.click(f'[data-theme-pref={"dark" if theme == "light" else "light"}]'); pg.wait_for_timeout(500)
    other = 'dark' if theme == 'light' else 'light'
    check('switch toggles and stores', pg.evaluate("document.documentElement.dataset.theme") == other and pg.evaluate("localStorage.getItem('theme')") == other)
    pg.reload(); expect(pg.locator('#fieldsList .field-card')).to_have_count(3)
    check('choice kept after reload', pg.evaluate("document.documentElement.dataset.theme") == other)
    pg.screenshot(path=S + f'shots/th_{theme}_5_toggled.png')
    check('no page errors', not errors, errors)
    b.close()
print('ALL PASS' if ok else 'SOME FAILED')
