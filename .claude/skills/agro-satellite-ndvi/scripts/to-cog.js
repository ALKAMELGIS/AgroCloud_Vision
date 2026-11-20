const fs = require('fs'), path = require('path');
const initGdalJs = require('gdal3.js/node');
const DIR = process.argv[2];
(async () => {
  const Gdal = await initGdalJs({ path: 'node_modules/gdal3.js/dist/package', useWorker: false });
  const meta = JSON.parse(fs.readFileSync(path.join(DIR, 'georef.json')));
  for (const f of fs.readdirSync(DIR).filter((x) => /\.(pgm|ppm)$/.test(x))) {
    const base = f.replace(/\.(pgm|ppm)$/, '');
    const [ulx, uly, lrx, lry] = meta.files[base];
    const r = await Gdal.open(path.relative(process.cwd(), path.join(DIR, f)));
    if (!r.datasets.length) throw new Error('open failed ' + f + JSON.stringify(r.errors));
    const out = await Gdal.gdal_translate(r.datasets[0], ['-of', 'GTiff', '-a_srs', 'EPSG:' + meta.epsg, '-a_ullr', String(ulx), String(uly), String(lrx), String(lry), '-co', 'TILED=YES', '-co', 'COMPRESS=DEFLATE', '-co', 'BLOCKXSIZE=256', '-co', 'BLOCKYSIZE=256'], 'c_' + base);
    fs.writeFileSync(path.join(DIR, base + '.tif'), Buffer.from(await Gdal.getFileBytes(out)));
    fs.unlinkSync(path.join(DIR, f));
    await Gdal.close(r.datasets[0]);
  }
  console.log('converted', fs.readdirSync(DIR).filter((x) => x.endsWith('.tif')).length);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
