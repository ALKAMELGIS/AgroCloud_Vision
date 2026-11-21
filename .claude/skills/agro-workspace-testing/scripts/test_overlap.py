"""Layout audit: no control hides another at desktop sizes (1920 to 1024), en + ar, map and field + time series.
An overlap counts only when one element really covers the other (elementFromPoint at the shared area).
Phones (390) are reported, not failed: the phone layout is still to do."""
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
        for (w, h) in [(1920, 1080), (1440, 900), (1366, 768), (1280, 720), (1024, 768), (390, 844)]:
            ctx = b.new_context(viewport={'width': w, 'height': h})
            ctx.add_init_script(f"localStorage.setItem('lang', '{lang}'); localStorage.setItem('imgProvider', 'es'); localStorage.setItem('accessToken', {json.dumps(tok)}); localStorage.setItem('refreshToken', {json.dumps(login['refreshToken'])}); localStorage.setItem('user', {json.dumps(json.dumps(login['user']))});")
            pg = ctx.new_page(); cdn_routes.install(pg)
            pg.goto(f"https://alkamelgis.github.io/AgroSyntra_One/workspace.html?farm={farm['id']}")
            try: expect(pg.locator('#fieldsList .field-card')).to_have_count(3, timeout=20000)
            except Exception: pass
            pg.wait_for_timeout(2500)
            base = pg.evaluate(JS)
            pg.screenshot(path=S + f'shots/ov_{lang}_{w}x{h}.png')
            ts = []
            try:
                pg.locator('#fieldsList .field-card').first.click(timeout=3000); pg.wait_for_timeout(1200)
                pg.click('#tsBtn', timeout=3000); pg.wait_for_timeout(2500)
                ts = pg.evaluate(JS); pg.screenshot(path=S + f'shots/ov_{lang}_{w}x{h}_ts.png')
            except Exception as e: ts = [['error', str(e)[:80]]]
            res[f'{lang} {w}x{h}'] = {'map': base, 'field+timeseries': ts}
            ctx.close()
    b.close()
json.dump(res, open(S + 'overlap.json', 'w'), indent=1, ensure_ascii=False)
bad = 0
for k, v in res.items():
    for part, items in v.items():
        items = [it for it in items if 'mapContainer' not in it[1]]   # the scale bar inside the map box
        if '390' in k: print('report', k, part, len(items)); continue
        for it in items: bad += 1; print('FAIL', k, part, it)
print('ALL PASS' if not bad else 'SOME FAILED')
