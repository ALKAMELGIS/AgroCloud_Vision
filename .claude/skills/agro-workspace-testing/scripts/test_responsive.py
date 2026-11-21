"""Phones and tablets (390, 768, 820 wide; English and Arabic): the compact layout.
Map full screen, sidebar as a drawer, fields panel as a bottom sheet (peek, half, full), time series as its own sheet.
Fails on: a control covering another, sideways scroll, a page error, a sheet that does not change height,
the drawer not opening/closing. Date chips scrolled under the timeline arrows are clipping, not overlap."""
import sys, os, json, urllib.request
sys.path.insert(0, os.path.dirname(__file__))
from playwright.sync_api import sync_playwright, expect
import cdn_routes
S = os.environ['WORK'] + '/'
login = cdn_routes.fresh_login(); tok = login['accessToken']
def call(m, p, b=None):
    r = urllib.request.Request('http://localhost:4000/api/v1' + p, data=json.dumps(b).encode() if b is not None else None, method=m, headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok})
    return json.load(urllib.request.urlopen(r))
farm = call('POST', '/farms', {'name': 'Al Khatim Farms North'})
fc = json.load(open(S + 'fixtures/fields.geojson'))
call('POST', '/fields/bulk', {'farmId': farm['id'], 'fields': [{'name': n, 'boundary': f['geometry']} for n, f in zip(['Pivot 1', 'Pivot 2', 'Strip'], [f for f in fc['features'] if f['geometry']['type'] == 'Polygon'])]})
JS = r"""(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 2 && r.height > 2 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth; };
  const name = (e) => (e.id ? '#' + e.id : e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '')) + (e.textContent ? ' "' + e.textContent.trim().replace(/\s+/g, ' ').slice(0, 24) + '"' : '');
  const top = (e) => { const r = e.getBoundingClientRect(); const pts = [[r.left + r.width / 2, r.top + r.height / 2], [r.left + 3, r.top + 3], [r.right - 3, r.bottom - 3]]; return pts.some(([x, y]) => { const h = document.elementFromPoint(x, y); return h && (h === e || e.contains(h)); }); };
  const els = [...document.querySelectorAll('button, select, input, a, .chip-bar, #imgLegend, #imageryDock, #imgDock, #tlBar, .leaflet-control, #mapTools > *, #panelToggle, .ts-key, .acct-row, .nav-row')].filter((e) => vis(e) && top(e));
  const out = [];
  for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
    const a = els[i], b = els[j]; if (a.contains(b) || b.contains(a)) continue;
    const r = a.getBoundingClientRect(), q = b.getBoundingClientRect();
    const w = Math.min(r.right, q.right) - Math.max(r.left, q.left), h = Math.min(r.bottom, q.bottom) - Math.max(r.top, q.top);
    const cx = Math.max(r.left, q.left) + w / 2, cy = Math.max(r.top, q.top) + h / 2;
    const hit = w > 3 && h > 3 && document.elementFromPoint(cx, cy);
    if (w > 3 && h > 3 && hit && (a.contains(hit) || b.contains(hit))) out.push(['overlap', name(a), name(b), Math.round(w) + 'x' + Math.round(h)]);
  }
  // text cut off inside its own box (no ellipsis meant)
  document.querySelectorAll('button, span, div, label, a').forEach((e) => {
    if (!vis(e) || e.children.length > 2) return; const cs = getComputedStyle(e);
    if (e.scrollWidth > e.clientWidth + 2 && cs.textOverflow !== 'ellipsis' && cs.overflowX !== 'auto' && cs.overflowX !== 'scroll' && e.clientWidth > 20 && e.textContent.trim().length > 1) out.push(['clipped', name(e), e.scrollWidth + '>' + e.clientWidth]);
  });
  // page wider than the screen
  if (document.documentElement.scrollWidth > innerWidth + 1) out.push(['hscroll', 'page', document.documentElement.scrollWidth + '>' + innerWidth]);
  return out;
})()"""
res = {}
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    for lang in ['en', 'ar']:
        for (w, h) in [(390, 844), (768, 1024), (820, 1180)]:
            ctx = b.new_context(viewport={'width': w, 'height': h}, has_touch=True)
            ctx.add_init_script(f"localStorage.setItem('lang', '{lang}'); localStorage.setItem('imgProvider', 'es'); localStorage.setItem('accessToken', {json.dumps(tok)}); localStorage.setItem('refreshToken', {json.dumps(login['refreshToken'])}); localStorage.setItem('user', {json.dumps(json.dumps(login['user']))});")
            pg = ctx.new_page(); cdn_routes.install(pg); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
            pg.goto(f"https://alkamelgis.github.io/AgroSyntra_One/workspace.html?farm={farm['id']}")
            try: expect(pg.locator('#fieldsList .field-card')).to_have_count(3, timeout=20000)
            except Exception: pass
            pg.wait_for_timeout(2500)
            r = {'peek': pg.evaluate(JS)}; pg.screenshot(path=S + f'shots/c_{lang}_{w}_1peek.png')
            h1 = pg.evaluate("document.getElementById('sidePanel').getBoundingClientRect().height")
            pg.click('#sheetHandle'); pg.wait_for_timeout(500)
            h2 = pg.evaluate("document.getElementById('sidePanel').getBoundingClientRect().height")
            if not (h2 > h1 + 100): r['sheet'] = [['sheet', 'handle did not raise the sheet', f'{h1}->{h2}']]
            r['half'] = pg.evaluate(JS); pg.screenshot(path=S + f'shots/c_{lang}_{w}_2half.png')
            try:
                pg.locator('#fieldsList .field-card').first.click(timeout=3000); pg.wait_for_timeout(1500)
                r['field'] = pg.evaluate(JS); pg.screenshot(path=S + f'shots/c_{lang}_{w}_3field.png')
                pg.click('#tsBtn', timeout=3000); pg.wait_for_timeout(2500)
                r['ts'] = pg.evaluate(JS); pg.screenshot(path=S + f'shots/c_{lang}_{w}_4ts.png')
                pg.click('#tsClose'); pg.wait_for_timeout(400)
            except Exception as e: r['err'] = [['error', str(e)[:160]]]
            pg.click('#navOpenBtn'); pg.wait_for_timeout(500)
            pg.screenshot(path=S + f'shots/c_{lang}_{w}_5nav.png')
            vis = pg.evaluate("(() => { const r = document.getElementById('navRail').getBoundingClientRect(); return r.right > 50 && r.left < innerWidth - 50; })()")
            pg.mouse.click(10 if lang == 'ar' else w - 10, h // 2); pg.wait_for_timeout(450)
            gone = pg.evaluate("(() => { const r = document.getElementById('navRail').getBoundingClientRect(); return r.right <= 2 || r.left >= innerWidth - 2; })()")
            if not (vis and gone): r['drawer'] = [['drawer', f'open {vis} closed {gone}']]
            if pg.evaluate('document.documentElement.scrollWidth') > w: r['hscroll'] = [['hscroll', 'page wider than screen']]
            r['pageerrors'] = [['pageerror', x] for x in errs]
            res[f'{lang} {w}x{h}'] = r
            ctx.close()
    b.close()
bad = 0
for k, v in res.items():
    for part, items in v.items():
        for it in items:
            if 'mapContainer' in it[1]: continue
            if it[0] == 'overlap' and 'tl-chip' in it[2] and any(x in it[1] for x in ('#tlPrev', '#tlNext', '#tlRangeBtn')): continue
            if it[0] == 'clipped': continue
            bad += 1; print('FAIL', k, part, it)
print('ALL PASS' if not bad else 'SOME FAILED')
