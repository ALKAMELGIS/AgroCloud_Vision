// node verify-shp.js <zip> → GDAL reads the zipped shapefile; prints count, attributes, validity checks and geodesic area
const path = require('path'); const initGdalJs = require('gdal3.js/node');
(async () => {
  const Gdal = await initGdalJs({ path: 'node_modules/gdal3.js/dist/package', useWorker: false });
  const r = await Gdal.open(path.relative(process.cwd(), process.argv[2]), [], ['vsizip']);
  if (!r.datasets.length) { console.log(JSON.stringify({ ok: false, errors: r.errors })); return; }
  const ds = r.datasets[0]; const info = await Gdal.getInfo(ds);
  const out = await Gdal.ogr2ogr(ds, ['-f', 'GeoJSON', '-lco', 'RFC7946=YES'], 'v');
  const fc = JSON.parse(new TextDecoder().decode(await Gdal.getFileBytes(out)));
  // geodesic area on the authalic sphere, outer minus holes
  const R = 6371007.2, rad = Math.PI / 180;
  const ring = (c) => { let a = 0; for (let i = 0; i < c.length - 1; i++) a += (c[i + 1][0] - c[i][0]) * rad * (2 + Math.sin(c[i][1] * rad) + Math.sin(c[i + 1][1] * rad)); return Math.abs(a * R * R / 2); };
  const polys = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates);
  console.log(JSON.stringify({ ok: true, driver: info.driverName, count: info.featureCount, srs: !!fc.features.length,
    props: fc.features.map((f) => ({ ...f.properties, geod_ha: polys(f.geometry).reduce((s, p) => s + ring(p[0]) - p.slice(1).reduce((t, h) => t + ring(h), 0), 0) / 10000,
      rings: polys(f.geometry).reduce((s, p) => s + p.length, 0), closed: polys(f.geometry).every((p) => p.every((rg) => rg[0][0] === rg[rg.length - 1][0] && rg[0][1] === rg[rg.length - 1][1])) })) }));
})().catch((e) => { console.log(JSON.stringify({ ok: false, error: String(e.message || e) })); });
