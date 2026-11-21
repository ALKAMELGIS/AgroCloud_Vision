"""Public pages: index.html (landing) and main.html (sign in / register), English and Arabic.
Checks: no page errors, no sideways scroll at 1440 and 390, the ten tool tabs switch,
every English string has an Arabic translation, Start free opens registration,
registering and signing in both land on the workspace."""
import sys, os, json, re, time
sys.path.insert(0, os.path.dirname(__file__))
from playwright.sync_api import sync_playwright, expect
import cdn_routes
BASE = 'https://alkamelgis.github.io/AgroSyntra_One/'
ok = True
def check(label, cond, extra=''):
    global ok; ok &= bool(cond); print(('PASS ' if cond else 'FAIL ') + label, str(extra)[:300], flush=True)

# Latin words that stay Latin in Arabic (index names, formats, products, units)
KEEP = set('NDVI SAVI EVI GNDVI NDRE MSAVI ReCI NDMI NDWI BSI SI VMI S2 CSV PDF A4 ISO-XML GPX KML KMZ GeoJSON Shapefile GeoPackage File Geodatabase John Deere Trimble Sentinel-2 Sentinel L2A 2A Open-Meteo PostGIS WGS84 AgroSyntra One Pivot Copernicus ESA kg/ha L 3D English'.split())
LATIN = r"""(() => { const out = new Set(); const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) { const n = w.currentNode, t = n.nodeValue.trim(); if (t && /[A-Za-z]/.test(t) && !n.parentElement.closest('script,style,[translate="no"]')) out.add(t); }
  document.querySelectorAll('[placeholder],[aria-label]').forEach((e) => ['placeholder', 'aria-label'].forEach((a) => { const v = e.getAttribute(a); if (v && /[A-Za-z]/.test(v) && !e.closest('[translate="no"]')) out.add(v); }));
  return [...out]; })()"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    for lang in ['en', 'ar']:
        for w, h in [(1440, 900), (390, 844)]:
            ctx = b.new_context(viewport={'width': w, 'height': h})
            ctx.add_init_script(f"localStorage.setItem('lang', '{lang}')")
            pg = ctx.new_page(); cdn_routes.install(pg); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
            pg.goto(BASE + 'index.html'); pg.wait_for_timeout(1200)
            check(f'{lang} {w}: landing has no page errors', not errs, errs)
            check(f'{lang} {w}: no sideways scroll', pg.evaluate('document.documentElement.scrollWidth') <= w)
            check(f'{lang} {w}: hero map drawn', pg.locator('#heroMap rect').count() > 500)
            if w == 1440:
                tabs = pg.locator('.tool')
                check(f'{lang}: ten tools', tabs.count() == 10)
                for i in range(tabs.count()):
                    tabs.nth(i).click()
                    panel = tabs.nth(i).get_attribute('aria-controls')
                    if not pg.locator('#' + panel).is_visible() or pg.locator('.tool-panel:visible').count() != 1:
                        check(f'{lang}: tab {i} shows its panel', False); break
                else: check(f'{lang}: every tab shows its own panel', True)
                check(f'{lang}: art in every panel', pg.locator('.tool-art svg').count() == 10)
                if lang == 'ar':
                    left = [s for s in pg.evaluate(LATIN) if [x for x in re.findall(r'(?<![0-9A-Za-z])[A-Za-z][A-Za-z0-9\-/]*', s) if x not in KEEP]]
                    check('ar: every landing string is translated', not left, left)
                    pg.goto(BASE + 'main.html?mode=register'); pg.wait_for_timeout(800)
                    left = [s for s in pg.evaluate(LATIN) if [x for x in re.findall(r'[A-Za-z][A-Za-z0-9\-/@.]*', s) if x not in KEEP and '@' not in x]]
                    check('ar: every sign-in string is translated', not left, left)
            ctx.close()

    # Start free → registration → workspace; then sign out and sign in again
    ctx = b.new_context(viewport={'width': 1280, 'height': 800}); pg = ctx.new_page(); cdn_routes.install(pg)
    pg.goto(BASE + 'index.html'); pg.locator('.hero .hero-actions .btn-primary').click()
    expect(pg.locator('#organizationName')).to_be_visible()
    check('Start free opens registration', 'mode=register' in pg.url)
    stamp = str(int(time.time() * 1000)); email = f'land{stamp}@agrocloud.test'
    pg.fill('#organizationName', 'Landing ' + stamp); pg.fill('#fullName', 'Landing Test'); pg.fill('#email', email); pg.fill('#password', 'Landing123!')
    pg.click('#submitBtn'); pg.wait_for_url('**/workspace.html*', timeout=20000)
    check('registering opens the workspace', 'workspace.html' in pg.url)
    pg.evaluate('localStorage.clear()')
    pg.goto(BASE + 'main.html'); pg.fill('#email', email); pg.fill('#password', 'Landing123!'); pg.click('#submitBtn')
    pg.wait_for_url('**/workspace.html*', timeout=20000)
    check('signing in opens the workspace', 'workspace.html' in pg.url)
    pg.evaluate('localStorage.clear()'); pg.goto(BASE + 'main.html'); pg.fill('#email', email); pg.fill('#password', 'wrong-pass1'); pg.click('#submitBtn')
    expect(pg.locator('#errorMsg')).to_be_visible(timeout=10000)
    check('a wrong password shows a readable error', 'object' not in pg.inner_text('#errorMsg').lower(), pg.inner_text('#errorMsg'))
    b.close()
print('ALL PASS' if ok else 'SOME FAILED')
