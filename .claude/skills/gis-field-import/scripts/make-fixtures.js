const fs = require('fs'), path = require('path');
const JSZip = require('jszip');
const initGdalJs = require('gdal3.js/node');
// Usage: node make-fixtures.js <outDir>   (run where gdal3.js, jszip are installed, or set NODE_PATH)
const OUT = path.resolve(process.argv[2] || 'fixtures');
// gdal3.js (node) prefixes the path with './', so it must be relative to the cwd.
const GDAL_PATH = path.relative(process.cwd(), path.join(path.dirname(require.resolve('gdal3.js/package.json')), 'dist/package')) || '.';

// Pivot circles near the screenshot area (Texas high plains), lon/lat.
function circle(lng, lat, rM, n = 48) {
  const R = 6378137, ring = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * 2 * Math.PI;
    ring.push([lng + (rM * Math.cos(a) / (R * Math.cos(lat * Math.PI / 180))) * 180 / Math.PI,
               lat + (rM * Math.sin(a) / R) * 180 / Math.PI]);
  }
  ring[n] = ring[0];
  return ring;
}
const base = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { name: 'Pivot 1', crop: 'Wheat' }, geometry: { type: 'Polygon', coordinates: [circle(-102.330, 34.120, 510)] } },
    { type: 'Feature', properties: { name: 'Pivot 2', crop: 'Corn' }, geometry: { type: 'Polygon', coordinates: [circle(-102.318, 34.115, 505), circle(-102.318, 34.115, 40).reverse()] } },
    { type: 'Feature', properties: { name: 'East block', crop: 'Cotton' }, geometry: { type: 'MultiPolygon', coordinates: [[circle(-102.305, 34.110, 500)], [circle(-102.305, 34.122, 300)]] } },
    { type: 'Feature', properties: { crop: 'Sorghum' }, geometry: { type: 'Polygon', coordinates: [[[-102.340,34.105],[-102.334,34.105],[-102.334,34.110],[-102.340,34.110],[-102.340,34.105]]] } },
    { type: 'Feature', properties: { name: 'Well 3' }, geometry: { type: 'Point', coordinates: [-102.325, 34.118] } },
  ],
};
// Expected: Pivot 1, Pivot 2 (with hole), East block (2 parts), unnamed rect => 5 fields; point ignored.

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'fields.geojson'), JSON.stringify(base));
  const Gdal = await initGdalJs({ path: GDAL_PATH, useWorker: false });
  const src = await Gdal.open(path.join(OUT, 'fields.geojson'));
  const ds = src.datasets[0];
  const conv = async (args, name) => {
    const out = await Gdal.ogr2ogr(ds, args, name);
    return out;
  };
  const bytes = async (o) => Buffer.from(await Gdal.getFileBytes(o));
  const allFiles = async () => (await Gdal.getOutputFiles());

  // GeoJSON in Web Mercator with a crs member
  let o = await conv(['-f', 'GeoJSON', '-t_srs', 'EPSG:3857', '-lco', 'WRITE_NAME=NO'], 'fields_3857');
  fs.writeFileSync(path.join(OUT, 'fields_3857.geojson'), await bytes(o));

  // Shapefile in UTM 14N, uppercase NAME attribute
  o = await conv(['-f', 'ESRI Shapefile', '-t_srs', 'EPSG:32614', '-sql', "SELECT name AS NAME, crop AS CROP FROM fields WHERE OGR_GEOMETRY='POLYGON' OR OGR_GEOMETRY='MULTIPOLYGON'", '-nlt', 'PROMOTE_TO_MULTI'], 'pivots_utm');
  // ogr2ogr with -sql ignores -where; filter points separately
  let zip = new JSZip();
  for (const f of await allFiles()) {
    if (/pivots_utm\.(shp|shx|dbf|prj|cpg)$/i.test(f.path)) zip.file(path.basename(f.path), Buffer.from(await Gdal.getFileBytes(f.path)));
  }
  fs.writeFileSync(path.join(OUT, 'pivots_utm_shapefile.zip'), await zip.generateAsync({ type: 'nodebuffer' }));

  // KML and KMZ
  o = await conv(['-f', 'KML'], 'fields_kml');
  const kml = await bytes(o);
  fs.writeFileSync(path.join(OUT, 'fields.kml'), kml);
  zip = new JSZip(); zip.file('doc.kml', kml);
  fs.writeFileSync(path.join(OUT, 'fields.kmz'), await zip.generateAsync({ type: 'nodebuffer' }));

  // GeoPackage in Web Mercator
  o = await conv(['-f', 'GPKG', '-t_srs', 'EPSG:3857', '-nln', 'farm_fields'], 'fields_gpkg');
  fs.writeFileSync(path.join(OUT, 'fields.gpkg'), await bytes(o));

  // File Geodatabase in UTM 14N, zipped as a .gdb folder
  o = await conv(['-f', 'OpenFileGDB', '-t_srs', 'EPSG:32614', '-nln', 'Pivots', '-nlt', 'MULTIPOLYGON', '-where', "OGR_GEOMETRY <> 'POINT'"], 'Farm');
  zip = new JSZip();
  for (const f of await allFiles()) {
    const m = f.path.match(/\/(Farm\.gdb\/.*)$/);
    if (m) zip.file(m[1], Buffer.from(await Gdal.getFileBytes(f.path)));
  }
  fs.writeFileSync(path.join(OUT, 'Farm_gdb.zip'), await zip.generateAsync({ type: 'nodebuffer' }));

  console.log(fs.readdirSync(OUT).map(f => f + ' ' + fs.statSync(path.join(OUT, f)).size).join('\n'));
})().catch(e => { console.error('ERR', e); process.exit(1); });
