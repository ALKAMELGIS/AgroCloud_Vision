import proj4 from 'proj4';
import fs from 'fs';
const OUT = process.argv[2];
const EPSG = 32613;
const utm = proj4('EPSG:4326', '+proj=utm +zone=13 +datum=WGS84 +units=m +no_defs');
const [minx, miny] = utm.forward([-102.36, 34.09]), [maxx, maxy] = utm.forward([-102.28, 34.14]);
const ox = Math.floor(minx / 60) * 60, oy = Math.ceil(maxy / 60) * 60;
const W = Math.ceil((maxx - ox) / 60) * 6, H = Math.ceil((oy - miny) / 60) * 6;
const pivot1 = utm.forward([-102.330, 34.120]);
const pivots = [[-102.330, 34.120, 510], [-102.318, 34.115, 505], [-102.305, 34.110, 500], [-102.305, 34.122, 300]].map(([a, b, r]) => [...utm.forward([a, b]), r]);
// dates: [day, healthyNdvi, stress(bool), cloudWestHalfOfPivot1(bool)]
const DATES = [['2026-11-15', 0.78, true, false], ['2026-11-05', 0.76, false, false], ['2026-10-26', 0.72, false, true], ['2026-10-16', 0.55, false, false]];
const scale = 1e-4, offset = -0.1;
const dn = (refl) => Math.round((refl - offset) / scale);
function geo(res, w, h, bands, bits, fmt) {
  return { width: w, height: h, ModelPixelScale: [res, res, 0], ModelTiepoint: [0, 0, 0, ox, oy, 0],
    GTModelTypeGeoKey: 1, GTRasterTypeGeoKey: 1, ProjectedCSTypeGeoKey: EPSG, SamplesPerPixel: bands,
    BitsPerSample: Array(bands).fill(bits), SampleFormat: Array(bands).fill(fmt), PhotometricInterpretation: bands === 3 ? 2 : 1 };
}
const items = [];
const geoMeta = {};
for (const [day, v, stress, cloud] of DATES) {
  const red = new Uint16Array(W * H), nir = new Uint16Array(W * H), vis = new Uint8Array(W * H * 3);
  const Ws = W / 2, Hs = H / 2, scl = new Uint8Array(Ws * Hs).fill(5);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const x = ox + (c + 0.5) * 10, y = oy - (r + 0.5) * 10;
    let ndvi = 0.12, n = 0.30, veg = false;
    for (const [px, py, rad] of pivots) if ((x - px) ** 2 + (y - py) ** 2 <= rad * rad) { ndvi = v; n = 0.40; veg = true; }
    // stress patch: SE quadrant of pivot 1, 150 m radius disc centred 250 m SE
    if (stress && (x - (pivot1[0] + 180)) ** 2 + (y - (pivot1[1] - 180)) ** 2 <= 150 ** 2) ndvi = 0.42;
    const rr = (n * (1 - ndvi)) / (1 + ndvi);
    const i = r * W + c;
    red[i] = dn(rr); nir[i] = dn(n);
    vis.set(veg ? [70, 110 + Math.round(60 * ndvi), 50] : [205, 190, 160], i * 3);
    if (veg && r % 2 === 0 && c % 2 === 0) scl[(r / 2) * Ws + c / 2] = 4;
  }
  for (let r = 0; r < Hs; r++) for (let c = 0; c < Ws; c++) {
    const x = ox + (c + 0.5) * 20, y = oy - (r + 0.5) * 20;
    if (cloud && x < pivot1[0] && Math.abs(y - pivot1[1]) < 700 && Math.abs(x - pivot1[0]) < 700) scl[r * Ws + c] = 9;
  }
  const id = `S2B_13SGR_${day.replace(/-/g, '')}_0_L2A`;
  // PNM (big-endian for 16 bit); georeferencing is added by GDAL in to-cog.js
  const write = (name, arr, res, w, h, bands, bits) => {
    const head = Buffer.from(`${bands === 3 ? 'P6' : 'P5'}\n${w} ${h}\n${bits === 16 ? 65535 : 255}\n`);
    let body;
    if (bits === 16) { body = Buffer.alloc(arr.length * 2); arr.forEach((v, i) => body.writeUInt16BE(v, i * 2)); }
    else body = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
    fs.writeFileSync(`${OUT}/${id}_${name}.${bands === 3 ? 'ppm' : 'pgm'}`, Buffer.concat([head, body]));
    geoMeta[`${id}_${name}`] = [ox, oy, ox + w * res, oy - h * res];
  };
  write('red', red, 10, W, H, 1, 16, 1); write('nir', nir, 10, W, H, 1, 16, 1);
  write('scl', scl, 20, Ws, Hs, 1, 8, 1); write('visual', vis, 10, W, H, 3, 8, 1);
  const base = `https://e84-earth-search-sentinel-data.s3.us-west-2.amazonaws.com/sentinel-2-c1-l2a/13/S/GR/mock/${id}`;
  const band = { 'raster:bands': [{ scale, offset, nodata: 0, data_type: 'uint16' }] };
  items.push({ type: 'Feature', id, bbox: [-102.40, 34.05, -102.25, 34.18],
    geometry: { type: 'Polygon', coordinates: [[[-102.40, 34.05], [-102.25, 34.05], [-102.25, 34.18], [-102.40, 34.18], [-102.40, 34.05]]] },
    properties: { datetime: day + 'T17:35:00Z', 'eo:cloud_cover': cloud ? 42.5 : 3.1, 'proj:epsg': EPSG, 's2:mgrs_tile': '13SGR', 's2:processing_baseline': '05.11' },
    assets: { red: { href: `${base}_red.tif`, ...band }, nir: { href: `${base}_nir.tif`, ...band },
      scl: { href: `${base}_scl.tif` }, visual: { href: `${base}_visual.tif` } } });
}
fs.writeFileSync(`${OUT}/georef.json`, JSON.stringify({ epsg: EPSG, files: geoMeta }));
fs.writeFileSync(`${OUT}/search.json`, JSON.stringify({ type: 'FeatureCollection', features: items }));
console.log('grid', W, 'x', H, 'files', fs.readdirSync(OUT).length);
