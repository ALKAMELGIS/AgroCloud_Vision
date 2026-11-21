import sys, json, os
sys.path.insert(0, os.path.dirname(__file__))
from playwright.sync_api import sync_playwright
import cdn_routes
# Usage: GIS_LIBS=<node_modules> python3 test_import.py <fixturesDir>   (CHROME=/path/to/chrome optional)
FX = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else 'fixtures') + '/'
CHROME = os.environ.get('CHROME', '/usr/bin/google-chrome')
HARNESS = '<!doctype html><meta charset="utf-8"><body><script src="https://alkamelgis.github.io/AgroSyntra_One/js/gis-import.js"></script></body>'
cases = [['fields.geojson'], ['fields_3857.geojson'], ['pivots_utm_shapefile.zip'], ['fields.kml'], ['fields.kmz'], ['fields.gpkg'], ['Farm_gdb.zip']]
results = {}
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=['--no-sandbox'])
    pg = b.new_page()
    cdn_routes.install(pg)
    pg.on('console', lambda m: print('  console:', m.text) if m.type in ('error',) else None)
    pg.set_content(HARNESS)
    pg.wait_for_function('window.GisImport')
    for files in cases:
        handle = pg.evaluate_handle('() => { const i = document.createElement("input"); i.type="file"; i.multiple=true; document.body.appendChild(i); return i; }')
        handle.as_element().set_input_files([FX + f for f in files])
        res = pg.evaluate('''async (input) => {
            const t0 = performance.now();
            try {
              const r = await GisImport.readFiles(input.files);
              const fields = GisImport.toFieldPolygons(r);
              return { ok: true, ms: Math.round(performance.now()-t0), format: r.format, crs: r.crs,
                       fields: fields.map(f => [f.name, +f.areaHa.toFixed(2), f.geometry.coordinates.length]),
                       sample: fields[0] && fields[0].geometry.coordinates[0][0] };
            } catch (e) { return { ok: false, error: e.message }; }
        }''', handle)
        print(files[0], json.dumps(res))
        results[files[0]] = res
    b.close()

# Every format must yield the same fields as the WGS84 GeoJSON baseline:
# same count, same named fields, areas within 0.5% (projection round-trips).
base = results['fields.geojson']
failed = []
for name, r in results.items():
    if not r.get('ok'):
        failed.append(f'{name}: {r.get("error")}'); continue
    if len(r['fields']) != len(base['fields']):
        failed.append(f'{name}: {len(r["fields"])} fields, expected {len(base["fields"])}'); continue
    for (n1, a1, h1), (n2, a2, h2) in zip(r['fields'], base['fields']):
        named = not n2.startswith('fields')
        if named and n1 != n2: failed.append(f'{name}: name {n1!r} != {n2!r}')
        if abs(a1 - a2) > 0.005 * a2: failed.append(f'{name}: {n1} area {a1} vs {a2}')
        if h1 != h2: failed.append(f'{name}: {n1} has {h1} rings, expected {h2}')
print('PASS: all formats match the baseline' if not failed else 'FAIL:\n  ' + '\n  '.join(failed))
sys.exit(1 if failed else 0)
