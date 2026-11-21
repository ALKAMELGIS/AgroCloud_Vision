"""Public demo: workspace.html?demo&tour on its own and inside index.html, English and Arabic.
Needs SHMOCK=1 (the mock draws six pivots for the demo's EPSG:3857 request).
Checks: pivots are detected from the image (not the fixed fallback), the tour walks through a field,
indices and the time series modes without page errors or a crashed tab, the demo never writes a session
into real storage, and the landing page shows the live demo with its step captions."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from playwright.sync_api import sync_playwright
import cdn_routes
BASE = 'https://alkamelgis.github.io/AgroSyntra_One/'
ok = True
def check(label, cond, extra=''):
    global ok; ok &= bool(cond); print(('PASS ' if cond else 'FAIL ') + label, str(extra)[:240], flush=True)
assert os.environ.get('SHMOCK'), 'run with SHMOCK=1'
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    for lang in ['en', 'ar']:
        ctx = b.new_context(viewport={'width': 1440, 'height': 900}); pg = ctx.new_page(); cdn_routes.install(pg)
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e))); crashed = []; pg.on('crash', lambda: crashed.append(1))
        pg.goto(BASE + f'workspace.html?demo&tour&lang={lang}'); pg.wait_for_timeout(9000)
        check(f'{lang}: pivots detected from the image', pg.locator('#fieldsList .field-card').count() == 6 and str(pg.evaluate('DEMO.source')).startswith('detected'), pg.evaluate('DEMO.source'))
        seen = set()
        for _ in range(44):
            pg.wait_for_timeout(900)
            if crashed: break
            seen.add(pg.evaluate("(() => { const i = document.getElementById('imgIndex'); const m = document.querySelector('#tsModes [aria-selected=\"true\"], #tsModes [aria-pressed=\"true\"]'); return (i ? i.value : '') + '|' + (m ? m.dataset.mode : ''); })()"))
        check(f'{lang}: the tab did not crash', not crashed)
        idx = {s.split('|')[0] for s in seen}
        check(f'{lang}: the tour switched indices', {'ndvi', 'ndmi', 'ndwi', 'bsi'} <= idx, sorted(idx))
        check(f'{lang}: no page errors', not errs, errs[:3])
        pg.goto(BASE + 'index.html#none'); pg.wait_for_timeout(500)
        check(f'{lang}: no session written to real storage', pg.evaluate("localStorage.getItem('accessToken')") is None)
        ctx.close()
    for lang, w in [('en', 1440), ('ar', 1440), ('en', 390)]:
        ctx = b.new_context(viewport={'width': w, 'height': 900}); ctx.add_init_script(f"localStorage.setItem('lang','{lang}')")
        pg = ctx.new_page(); cdn_routes.install(pg); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(BASE + 'index.html'); pg.wait_for_timeout(1500)
        pg.evaluate("document.getElementById('demo').scrollIntoView({block:'start'})"); pg.wait_for_timeout(15000)
        ready = pg.evaluate("!!document.querySelector('.demo-frame.is-ready')")
        step = pg.inner_text('#demoStep')
        check(f'landing {lang} {w}: live demo ready with a caption', ready and step.strip(), step)
        check(f'landing {lang} {w}: no sideways scroll, no errors', pg.evaluate('document.documentElement.scrollWidth') <= w and not errs, errs[:2])
        ctx.close()
    b.close()
print('ALL PASS' if ok else 'SOME FAILED')
