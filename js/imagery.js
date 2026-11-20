/*
 * AgroCloud Vision — satellite imagery engine and map timeline
 *
 * Sentinel-2 L2A from one of two sources, both read in the browser with geotiff.js:
 * - Sentinel Hub (default): configuration instance below. Dates come from WFS
 *   (DSS2 = Sentinel-2 L2A); each field is one WMS GetMap FLOAT32 GeoTIFF on its
 *   UTM 10 m grid with an evalscript that returns B02 B03 B04 B05 B08 B8A B11 SCL.
 *   The instance needs at least one layer; the evalscript overrides it.
 * - Element84 Earth Search (free, no key): STAC + Cloud-Optimized GeoTIFFs.
 * If the chosen source cannot list dates, the other one is tried.
 * Only each field's window is read from the
 * Cloud-Optimized GeoTIFFs (HTTP range requests); geotiff's block cache shares
 * tiles between neighbouring fields.
 *
 * - Scenes: STAC search over the farm's fields, one scene per day (full
 *   coverage, then the farm's main MGRS tile, then least cloud). Scenes over
 *   the tile cloud threshold (default 50%) are hidden unless "Show cloudy" is on.
 * - Indices: NDVI, NDRE, MSAVI, NDMI, ReCI, VMI (RGB = MSAVI, NDRE, NDVI) and
 *   natural colour. 20 m bands are sampled on the 10 m grid.
 * - Reflectance = DN * scale + offset from raster:bands; the 2022 BOA offset
 *   fallback is (DN - 1000) / 10000.
 * - Cloud mask: SCL classes 4 vegetation, 5 bare soil, 6 water, 7 unclassified.
 *   Cloud % is measured inside each field.
 * - Risks per field: NDVI change between the selected date and the previous
 *   clear date of that field (high drop <= -0.10, low drop <= -0.03).
 *
 * Exposes window.Imagery for the field panel, leaderboard, reports and VRA.
 */
(function () {
  'use strict';

  const CONFIG = {
    stac: 'https://earth-search.aws.element84.com/v1/search',
    collection: 'sentinel-2-c1-l2a',          // Earth Search v2 renames this to sentinel-2-l2a
    lookbackDays: 150,
    cloudThreshold: 50,
    geotiff: 'https://cdn.jsdelivr.net/npm/geotiff@2.1.3/dist-browser/geotiff.js',
    proj4: 'https://cdn.jsdelivr.net/npm/proj4@2.11.0/dist/proj4.js',
    keepScl: new Set([4, 5, 6, 7]),
    anomalyDrop: 0.10,
    anomalyMinHa: 0.1,
    highDrop: -0.10,
    lowDrop: -0.03,
    clearFieldPct: 30,
    // Sentinel Hub OGC configuration instance (meant to be used from web pages)
    sentinelHub: { base: 'https://services.sentinel-hub.com/ogc', instance: '60de79ca-16a7-4afd-bcbd-0261bf0156fa', layer: null },
  };
  const PROVIDERS = { sh: 'Sentinel Hub', es: 'Earth Search' };
  let provider = 'sh';
  try { if (PROVIDERS[localStorage.getItem('imgProvider')]) provider = localStorage.getItem('imgProvider'); } catch { /* storage off */ }

  // ------------------------------------------------------------ colour ramps

  const RDYLGN = [[0, [165, 0, 38]], [0.1, [215, 48, 39]], [0.2, [244, 109, 67]], [0.3, [253, 174, 97]], [0.4, [254, 224, 139]],
    [0.5, [255, 255, 191]], [0.6, [217, 239, 139]], [0.7, [166, 217, 106]], [0.8, [102, 189, 99]], [0.9, [26, 152, 80]], [1, [0, 104, 55]]];
  const MOIST = [[0, [140, 81, 10]], [0.25, [216, 179, 101]], [0.45, [246, 232, 195]], [0.6, [199, 234, 229]], [0.8, [90, 180, 172]], [1, [1, 102, 94]]];
  const DIVERGE = [[0, [178, 24, 43]], [0.33, [244, 165, 130]], [0.5, [247, 247, 247]], [0.67, [166, 219, 160]], [1, [27, 120, 55]]];
  function rampAt(stops, t) {
    t = Math.max(0, Math.min(1, t));
    for (let i = 1; i < stops.length; i++) {
      if (t <= stops[i][0]) {
        const [a, ca] = stops[i - 1], [b, cb] = stops[i]; const k = (t - a) / (b - a || 1);
        return [0, 1, 2].map((j) => Math.round(ca[j] + (cb[j] - ca[j]) * k));
      }
    }
    return stops[stops.length - 1][1];
  }
  const css = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
  const gradient = (stops) => `linear-gradient(90deg,${stops.map(([t, c]) => `${css(c)} ${Math.round(t * 100)}%`).join(',')})`;

  // ------------------------------------------------------------ indices

  const msavi = (r, n) => (2 * n + 1 - Math.sqrt(Math.max(0, (2 * n + 1) ** 2 - 8 * (n - r)))) / 2;
  const nd = (a, b) => (a + b > 0 ? (a - b) / (a + b) : NaN);
  const INDICES = {
    ndvi: { label: 'NDVI', name: 'Vegetation', bands: ['red', 'nir'], f: (b) => nd(b.nir, b.red), range: [0, 1], ramp: RDYLGN },
    ndre: { label: 'NDRE', name: 'Chlorophyll (red edge)', bands: ['rededge1', 'nir08'], f: (b) => nd(b.nir08, b.rededge1), range: [0, 0.7], ramp: RDYLGN },
    msavi: { label: 'MSAVI', name: 'Early growth, soil adjusted', bands: ['red', 'nir'], f: (b) => msavi(b.red, b.nir), range: [0, 1], ramp: RDYLGN },
    ndmi: { label: 'NDMI', name: 'Water content', bands: ['nir08', 'swir16'], f: (b) => nd(b.nir08, b.swir16), range: [-0.4, 0.6], ramp: MOIST },
    reci: { label: 'ReCI', name: 'Chlorophyll content', bands: ['nir', 'rededge1'], f: (b) => (b.rededge1 > 0 ? b.nir / b.rededge1 - 1 : NaN), range: [0, 8], ramp: RDYLGN },
    vmi: { label: 'VMI', name: 'MSAVI · NDRE · NDVI composite', bands: ['red', 'nir', 'rededge1', 'nir08'], composite: true,
      f: (b) => nd(b.nir, b.red), range: [0, 1], ramp: RDYLGN },
    rgb: { label: 'Natural colour', name: 'True colour image', bands: [], rgb: true },
  };

  // ------------------------------------------------------------ loading

  const pending = {};
  function loadScript(url, globalName) {
    if (window[globalName]) return Promise.resolve(window[globalName]);
    if (!pending[url]) {
      pending[url] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = url; s.async = true;
        s.onload = () => (window[globalName] ? resolve(window[globalName]) : reject(new Error('Could not start ' + globalName)));
        s.onerror = () => { delete pending[url]; reject(new Error('Could not download ' + globalName)); };
        document.head.appendChild(s);
      });
    }
    return pending[url];
  }
  const libs = () => Promise.all([loadScript(CONFIG.geotiff, 'GeoTIFF'), loadScript(CONFIG.proj4, 'proj4')]);

  // ------------------------------------------------------------ geometry helpers

  function ringsOf(geometry) {
    if (!geometry) return [];
    if (geometry.type === 'Polygon') return [geometry.coordinates];
    if (geometry.type === 'MultiPolygon') return geometry.coordinates;
    return [];
  }
  function bboxOfGeoms(geoms) {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    geoms.forEach((g) => ringsOf(g).forEach((poly) => poly[0].forEach(([x, y]) => { a = Math.min(a, x); c = Math.max(c, x); b = Math.min(b, y); d = Math.max(d, y); })));
    return [a, b, c, d];
  }
  const contains = (o, i) => o[0] <= i[0] && o[1] <= i[1] && o[2] >= i[2] && o[3] >= i[3];
  function pointInRings(x, y, rings) {
    let inside = false;
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
    }
    return inside;
  }
  function utmDef(code) {
    if (code >= 32601 && code <= 32660) return `+proj=utm +zone=${code - 32600} +datum=WGS84 +units=m +no_defs`;
    if (code >= 32701 && code <= 32760) return `+proj=utm +zone=${code - 32700} +south +datum=WGS84 +units=m +no_defs`;
    throw new Error('Unsupported projection EPSG:' + code);
  }
  function epsgOf(item) {
    const p = item.properties;
    const code = p['proj:epsg'] ?? (p['proj:code'] ? +String(p['proj:code']).split(':')[1] : null);
    if (!code) throw new Error('Scene has no projection code');
    return code;
  }

  // ------------------------------------------------------------ STAC

  const sceneCache = new Map();
  async function searchScenes(geoms, key, lookbackDays, src = provider) {
    const cacheKey = src + '|' + key + '|' + lookbackDays;
    if (sceneCache.has(cacheKey)) return sceneCache.get(cacheKey);
    if (src === 'sh') { const sc = await shSearch(geoms, lookbackDays); sceneCache.set(cacheKey, sc); return sc; }
    const box = bboxOfGeoms(geoms);
    const end = new Date(), start = new Date(Date.now() - lookbackDays * 86400000);
    const body = {
      collections: [CONFIG.collection],
      bbox: box,
      datetime: start.toISOString() + '/' + end.toISOString(),
      query: { 'eo:cloud_cover': { lt: 95 } },
      sortby: [{ field: 'properties.datetime', direction: 'desc' }],
      limit: 250,
    };
    const res = await fetch(CONFIG.stac, { method: 'POST', headers: { 'Content-Type': 'application/geo+json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error('The Sentinel-2 catalogue did not answer (' + res.status + ')');
    const fc = await res.json();
    const tileOf = (it) => it.properties['s2:mgrs_tile'] || it.properties['grid:code'] || String(it.properties['proj:epsg'] || '');
    const counts = new Map();
    (fc.features || []).forEach((it) => { if (!it.bbox || contains(it.bbox, box)) counts.set(tileOf(it), (counts.get(tileOf(it)) || 0) + 1); });
    const mainTile = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const rank = (c) => (c.covers ? 2 : 0) + (c.tile === mainTile ? 1 : 0);
    const byDay = new Map();
    (fc.features || []).forEach((it) => {
      const day = (it.properties.datetime || '').slice(0, 10);
      const cand = { item: it, id: it.id, day, covers: it.bbox ? contains(it.bbox, box) : true, tile: tileOf(it), tileCloud: +(it.properties['eo:cloud_cover'] ?? 100) };
      const prev = byDay.get(day);
      if (!prev || rank(cand) > rank(prev) || (rank(cand) === rank(prev) && cand.tileCloud < prev.tileCloud)) byDay.set(day, cand);
    });
    const scenes = [...byDay.values()].sort((a, b) => (a.day < b.day ? 1 : -1));
    sceneCache.set(cacheKey, scenes);
    return scenes;
  }

  // ------------------------------------------------------------ Sentinel Hub

  const SH = CONFIG.sentinelHub;
  const shUrl = (svc, params) => `${SH.base}/${svc}/${SH.instance}?` + new URLSearchParams(params).toString();
  async function shText(res) { try { const t = await res.text(); const m = t.match(/<ServiceException[^>]*>([\s\S]*?)<\/ServiceException>/); return (m ? m[1] : t).trim().slice(0, 200); } catch { return ''; } }
  async function shLayer() {
    if (SH.layer) return SH.layer;
    const res = await fetch(shUrl('wms', { SERVICE: 'WMS', REQUEST: 'GetCapabilities', VERSION: '1.3.0' }));
    if (!res.ok) throw new Error('Sentinel Hub did not accept the configuration ID (' + res.status + ') ' + (await shText(res)));
    const xml = new DOMParser().parseFromString(await res.text(), 'text/xml');
    const names = [...xml.getElementsByTagName('Layer')].map((l) => [...l.children].find((c) => c.localName === 'Name')).filter(Boolean).map((n) => n.textContent.trim());
    if (!names.length) throw new Error('The Sentinel Hub configuration has no layers. Add one (any Sentinel-2 L2A layer) in the Sentinel Hub dashboard');
    SH.layer = names.find((n) => /NDVI/i.test(n)) || names.find((n) => /TRUE|COLOR|COLOUR/i.test(n)) || names[0];
    return SH.layer;
  }
  const merc = ([lng, lat]) => [lng * 20037508.342789244 / 180, Math.log(Math.tan((90 + lat) * Math.PI / 360)) * 6378137];
  function utmCodeFor(geoms) {
    const [a, b, c, d] = bboxOfGeoms(geoms); const lng = (a + c) / 2, lat = (b + d) / 2;
    return (lat >= 0 ? 32600 : 32700) + Math.min(60, Math.floor((lng + 180) / 6) + 1);
  }
  async function shSearch(geoms, lookbackDays) {
    await shLayer();
    const box = bboxOfGeoms(geoms); const lo = merc([box[0], box[1]]), hi = merc([box[2], box[3]]);
    const end = new Date(), start = new Date(Date.now() - lookbackDays * 86400000);
    const code = utmCodeFor(geoms);
    const byDay = new Map();
    for (let offset = 0, page = 0; page < 6; page++, offset += 100) {
      const res = await fetch(shUrl('wfs', {
        SERVICE: 'WFS', REQUEST: 'GetFeature', VERSION: '2.0.0', TYPENAMES: 'DSS2', OUTPUTFORMAT: 'application/json',
        SRSNAME: 'EPSG:3857', BBOX: [lo[0], lo[1], hi[0], hi[1]].join(','), TIME: start.toISOString().slice(0, 10) + '/' + end.toISOString().slice(0, 10),
        MAXFEATURES: '100', FEATURE_OFFSET: String(offset),
      }));
      if (!res.ok) throw new Error('Sentinel Hub could not list dates (' + res.status + ') ' + (await shText(res)));
      const feats = (await res.json()).features || [];
      feats.forEach((f) => {
        const p = f.properties || {}; const day = String(p.date || '').slice(0, 10); if (!day) return;
        const cloud = +(p.cloudCoverPercentage ?? 100); const prev = byDay.get(day);
        if (!prev || cloud < prev.tileCloud) {
          byDay.set(day, { id: 'sh:' + day, day, covers: true, tile: 'sh', tileCloud: cloud, sh: true,
            item: { id: 'sh:' + day, properties: { datetime: day + 'T' + (p.time || '00:00:00'), 'proj:epsg': code, 'eo:cloud_cover': cloud }, assets: {} } });
        }
      });
      if (feats.length < 100) break;
    }
    return [...byDay.values()].sort((a, b) => (a.day < b.day ? 1 : -1));
  }
  const SH_SCRIPT = `//VERSION=3
function setup() {
  return { input: [{ bands: ["B02", "B03", "B04", "B05", "B08", "B8A", "B11", "SCL"] }], output: { bands: 8, sampleType: "FLOAT32" } };
}
function evaluatePixel(s) { return [s.B02, s.B03, s.B04, s.B05, s.B08, s.B8A, s.B11, s.SCL]; }`;
  const SH_BANDS = ['blue', 'green', 'red', 'rededge1', 'nir', 'nir08', 'swir16', 'scl'];
  const shCache = new Map(); // scene|field -> { band: sampler }
  function shRead(scene, fieldKey, ubox) {
    const k = scene.id + '|' + fieldKey;
    if (shCache.has(k)) return shCache.get(k);
    const p = (async () => {
      const layer = await shLayer();
      const x0 = Math.floor((ubox[0] - 20) / 10) * 10, x1 = Math.ceil((ubox[2] + 20) / 10) * 10;
      const y0 = Math.floor((ubox[1] - 20) / 10) * 10, y1 = Math.ceil((ubox[3] + 20) / 10) * 10;
      const w = (x1 - x0) / 10, h = (y1 - y0) / 10;
      if (w > 2500 || h > 2500) throw new Error('The field is too large for one Sentinel Hub request');
      const res = await fetch(shUrl('wms', {
        SERVICE: 'WMS', REQUEST: 'GetMap', VERSION: '1.3.0', LAYERS: layer, CRS: 'EPSG:' + epsgOf(scene.item),
        BBOX: [x0, y0, x1, y1].join(','), WIDTH: String(w), HEIGHT: String(h), FORMAT: 'image/tiff',
        TIME: scene.day + '/' + scene.day, MAXCC: '100', SHOWLOGO: 'false', TRANSPARENT: 'false', EVALSCRIPT: btoa(SH_SCRIPT),
      }));
      if (!res.ok || !/tiff/i.test(res.headers.get('content-type') || '')) throw new Error('Sentinel Hub image request failed (' + res.status + ') ' + (await shText(res)));
      const img = await (await GeoTIFF.fromArrayBuffer(await res.arrayBuffer())).getImage();
      const rasters = await img.readRasters();
      if (rasters.length < 8 || img.getWidth() !== w || img.getHeight() !== h) throw new Error('Sentinel Hub returned an unexpected image');
      const at = (x, y) => { const c = Math.floor((x - x0) / 10), r = Math.floor((y1 - y) / 10); return c < 0 || r < 0 || c >= w || r >= h ? -1 : r * w + c; };
      const mk = (data) => ({ ox: x0, oy: y1, rx: 10, ry: -10, c0: 0, r0: 0, w, h, data, sc: { scale: 1, offset: 0 }, at });
      const out = {}; SH_BANDS.forEach((b, i) => { out[b] = mk(rasters[i]); });
      const vis = new Uint8ClampedArray(w * h * 3), [R, G, B] = [rasters[2], rasters[1], rasters[0]];
      for (let i = 0; i < w * h; i++) { vis[i * 3] = R[i] * 2.5 * 255; vis[i * 3 + 1] = G[i] * 2.5 * 255; vis[i * 3 + 2] = B[i] * 2.5 * 255; }
      out.visual = mk(vis);
      return out;
    })();
    shCache.set(k, p);
    p.catch(() => shCache.delete(k));
    return p;
  }

  // ------------------------------------------------------------ band reading

  const imgCache = new Map();
  function openImage(href) {
    if (!imgCache.has(href)) {
      imgCache.set(href, GeoTIFF.fromUrl(href, { allowFullFile: false }).then((t) => t.getImage()).catch((e) => { imgCache.delete(href); throw e; }));
    }
    return imgCache.get(href);
  }
  function scaling(item, asset) {
    const b = asset['raster:bands'] && asset['raster:bands'][0];
    if (b && (b.scale != null || b.offset != null)) return { scale: b.scale ?? 1, offset: b.offset ?? 0 };
    const pb = parseFloat(item.properties['s2:processing_baseline'] || '0');
    if (pb >= 4 && item.properties['earthsearch:boa_offset_applied'] !== true) return { scale: 1e-4, offset: -0.1 };
    return { scale: 1e-4, offset: 0 };
  }
  const ASSET_ALIASES = { red: ['red', 'B04'], nir: ['nir', 'B08'], nir08: ['nir08', 'B8A'], rededge1: ['rededge1', 'B05'], swir16: ['swir16', 'B11'], scl: ['scl', 'SCL'], visual: ['visual', 'TCI'] };
  function assetOf(item, band) {
    for (const n of ASSET_ALIASES[band] || [band]) if (item.assets[n]) return item.assets[n];
    throw new Error('Scene is missing the ' + band + ' band');
  }

  const bandCache = new Map(); // scene|field|band -> sampler
  async function readBand(scene, fieldKey, band, ubox) {
    const k = scene.id + '|' + fieldKey + '|' + band;
    if (bandCache.has(k)) return bandCache.get(k);
    const p = (async () => {
      if (scene.sh) return (await shRead(scene, fieldKey, ubox))[band];
      const asset = assetOf(scene.item, band);
      const img = await openImage(asset.href);
      const [ox, oy] = img.getOrigin(); const [rx, ry] = img.getResolution();
      const W = img.getWidth(), H = img.getHeight(), pad = Math.abs(rx) * 2;
      const c0 = Math.max(0, Math.floor((ubox[0] - pad - ox) / rx)), c1 = Math.min(W, Math.ceil((ubox[2] + pad - ox) / rx));
      const r0 = Math.max(0, Math.floor((ubox[3] + pad - oy) / ry)), r1 = Math.min(H, Math.ceil((ubox[1] - pad - oy) / ry));
      if (c1 <= c0 || r1 <= r0) throw new Error('The field is outside this scene');
      const w = c1 - c0, h = r1 - r0;
      const data = band === 'visual'
        ? await img.readRasters({ window: [c0, r0, c1, r1], interleave: true })
        : (await img.readRasters({ window: [c0, r0, c1, r1], samples: [0] }))[0];
      const sc = band === 'scl' || band === 'visual' ? { scale: 1, offset: 0 } : scaling(scene.item, asset);
      const at = (x, y) => {
        const c = Math.floor((x - ox) / rx) - c0, r = Math.floor((y - oy) / ry) - r0;
        return c < 0 || r < 0 || c >= w || r >= h ? -1 : r * w + c;
      };
      return { ox, oy, rx, ry, c0, r0, w, h, data, sc, at };
    })();
    bandCache.set(k, p);
    p.catch(() => bandCache.delete(k));
    return p;
  }

  // ------------------------------------------------------------ analysis

  const resultCache = new Map();
  const CLASS_EDGES = { ndvi: [0, .1, .2, .3, .4, .5, .6, .7, .8, .9, 1.01] };

  /** field: { id, geometry }. Returns index values on a 10 m grid inside the field. */
  async function analyse(field, scene, indexKey) {
    const key = scene.id + '|' + field.id + '|' + indexKey;
    if (resultCache.has(key)) return resultCache.get(key);
    const p = (async () => {
      await libs();
      const index = INDICES[indexKey];
      const code = epsgOf(scene.item);
      const toUtm = proj4('EPSG:4326', utmDef(code));
      const polys = ringsOf(field.geometry).map((poly) => poly.map((ring) => ring.map(([lng, lat]) => toUtm.forward([lng, lat]))));
      const xs = polys.flatMap((p) => p[0].map((q) => q[0])), ys = polys.flatMap((p) => p[0].map((q) => q[1]));
      const ubox = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      const scl = await readBand(scene, field.id, 'scl', ubox);
      // 10 m output grid aligned with the tile
      const gx0 = Math.floor((ubox[0] - 20 - scl.ox) / 10) * 10 + scl.ox, gy0 = scl.oy - Math.floor((scl.oy - ubox[3] - 20) / 10) * 10;
      const w = Math.ceil((ubox[2] + 20 - gx0) / 10), h = Math.ceil((gy0 - (ubox[1] - 20)) / 10);
      const bands = index.rgb ? { visual: await readBand(scene, field.id, 'visual', ubox) }
        : Object.fromEntries(await Promise.all(index.bands.map(async (b) => [b, await readBand(scene, field.id, b, ubox)])));
      const n = w * h;
      const values = new Float32Array(n).fill(NaN);
      const inField = new Uint8Array(n);
      const rgba = index.rgb || index.composite ? new Uint8ClampedArray(n * 4) : null;
      let fieldPx = 0, validPx = 0;
      const refl = {};
      for (let r = 0; r < h; r++) {
        const y = gy0 - (r + 0.5) * 10;
        for (let c = 0; c < w; c++) {
          const x = gx0 + (c + 0.5) * 10;
          if (!polys.some((poly) => pointInRings(x, y, poly))) continue;
          const i = r * w + c; inField[i] = 1; fieldPx++;
          const si = scl.at(x, y);
          if (si < 0 || !CONFIG.keepScl.has(scl.data[si])) continue;
          if (index.rgb) {
            const vi = bands.visual.at(x, y); if (vi < 0) continue;
            const d = bands.visual.data;
            rgba[i * 4] = d[vi * 3]; rgba[i * 4 + 1] = d[vi * 3 + 1]; rgba[i * 4 + 2] = d[vi * 3 + 2]; rgba[i * 4 + 3] = 255;
            values[i] = 1; validPx++; continue;
          }
          let ok = true;
          for (const b of index.bands) {
            const bb = bands[b]; const bi = bb.at(x, y);
            const dn = bi < 0 ? 0 : bb.data[bi];
            if (!dn) { ok = false; break; }
            refl[b] = dn * bb.sc.scale + bb.sc.offset;
          }
          if (!ok) continue;
          const v = index.f(refl);
          if (!Number.isFinite(v)) continue;
          values[i] = v; validPx++;
          if (index.composite) {
            const t = (q) => Math.round(255 * Math.max(0, Math.min(1, q)));
            rgba[i * 4] = t(msavi(refl.red, refl.nir)); rgba[i * 4 + 1] = t(nd(refl.nir08, refl.rededge1) / 0.7); rgba[i * 4 + 2] = t(v); rgba[i * 4 + 3] = 255;
          }
        }
      }
      const pxHa = 0.01;
      const sorted = []; for (let i = 0; i < n; i++) if (!Number.isNaN(values[i])) sorted.push(values[i]);
      sorted.sort((a, b) => a - b);
      const q = (pp) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(pp * sorted.length))] : NaN);
      const mean = sorted.length ? sorted.reduce((s, v) => s + v, 0) / sorted.length : NaN;
      const [lo, hi] = index.range || [0, 1];
      const edges = CLASS_EDGES[indexKey] || Array.from({ length: 11 }, (_, k) => lo + ((hi - lo) * k) / 10).map((e, k, a) => (k === a.length - 1 ? e + 1e-6 : e));
      const classes = edges.slice(0, -1).map((e, k) => sorted.filter((v) => (k === 0 ? v < edges[1] : v >= e && v < edges[k + 1]) || (k === edges.length - 2 && v >= edges[k])).length * pxHa);
      const fromUtm = proj4(utmDef(code), 'EPSG:4326');
      const sw = fromUtm.forward([gx0, gy0 - h * 10]), ne = fromUtm.forward([gx0 + w * 10, gy0]);
      return {
        key, field, scene, indexKey, values, inField, rgba, w, h, pxHa, gx0, gy0, code,
        bounds: [[sw[1], sw[0]], [ne[1], ne[0]]],
        fieldHa: fieldPx * pxHa, validHa: validPx * pxHa,
        cloudPct: fieldPx ? Math.round(100 * (1 - validPx / fieldPx)) : 100,
        mean, p02: q(0.02), p10: q(0.1), p50: q(0.5), p90: q(0.9), p98: q(0.98), classes, edges,
      };
    })();
    resultCache.set(key, p);
    p.catch(() => resultCache.delete(key));
    return p;
  }

  /** Previous date on the same tile where the field is at least (100 - clearFieldPct)% clear. */
  async function previousClear(field, scene, indexKey) {
    const list = state_.scenes.filter((s) => s.day < scene.day && s.tile === scene.tile && s.tileCloud < 80);
    for (const s of list.slice(0, 8)) {
      try { const r = await analyse(field, s, indexKey); if (r.cloudPct <= CONFIG.clearFieldPct) return r; } catch { /* next */ }
    }
    return null;
  }

  function compare(cur, prev) {
    if (cur.w !== prev.w || cur.h !== prev.h || cur.gx0 !== prev.gx0 || cur.gy0 !== prev.gy0) {
      throw new Error('These two dates come from different tiles, so they cannot be compared pixel by pixel');
    }
    const n = cur.w * cur.h, W = cur.w, H = cur.h;
    const d = new Float32Array(n).fill(NaN); const ds = [];
    for (let i = 0; i < n; i++) {
      if (!cur.inField[i] || Number.isNaN(cur.values[i]) || Number.isNaN(prev.values[i])) continue;
      d[i] = cur.values[i] - prev.values[i]; ds.push(d[i]);
    }
    if (ds.length < 10) throw new Error('Too few clear pixels on both dates to compare');
    ds.sort((a, b) => a - b);
    const median = ds[Math.floor(ds.length / 2)];
    const flag = new Uint8Array(n);
    for (let r = 1; r < H - 1; r++) for (let c = 1; c < W - 1; c++) {
      const i = r * W + c;
      if (Number.isNaN(d[i]) || d[i] - median > -CONFIG.anomalyDrop) continue;
      if (!cur.inField[i - 1] || !cur.inField[i + 1] || !cur.inField[i - W] || !cur.inField[i + W]) continue;
      flag[i] = 1;
    }
    const minPx = Math.max(1, Math.round(CONFIG.anomalyMinHa / cur.pxHa));
    const seen = new Uint8Array(n), keep = new Uint8Array(n), clusters = [];
    for (let i = 0; i < n; i++) {
      if (!flag[i] || seen[i]) continue;
      const stack = [i], members = []; seen[i] = 1;
      while (stack.length) {
        const k = stack.pop(); members.push(k);
        const r = Math.floor(k / W), c = k % W;
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr, cc = c + dc; if ((!dr && !dc) || rr < 0 || cc < 0 || rr >= H || cc >= W) continue;
          const j = rr * W + cc; if (flag[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
        }
      }
      if (members.length < minPx) continue;
      members.forEach((k) => { keep[k] = 1; });
      let sx = 0, sy = 0, sd = 0;
      members.forEach((k) => { sx += k % W; sy += Math.floor(k / W); sd += d[k]; });
      clusters.push({ ha: members.length * cur.pxHa, col: sx / members.length, row: sy / members.length, meanDrop: sd / members.length - median });
    }
    clusters.sort((a, b) => b.ha - a.ha);
    const fromUtm = proj4(utmDef(cur.code), 'EPSG:4326');
    clusters.forEach((cl) => { const [lng, lat] = fromUtm.forward([cur.gx0 + (cl.col + 0.5) * 10, cur.gy0 - (cl.row + 0.5) * 10]); cl.lat = lat; cl.lng = lng; });
    return { d, median, flag: keep, clusters, anomalyHa: clusters.reduce((s, c) => s + c.ha, 0), comparedHa: ds.length * cur.pxHa };
  }

  // ------------------------------------------------------------ painting

  function paint(res, opts = {}) {
    const { contrast, delta } = opts;
    const c = document.createElement('canvas'); c.width = res.w; c.height = res.h;
    const ctx = c.getContext('2d'); const out = ctx.createImageData(res.w, res.h);
    const idx = INDICES[res.indexKey];
    const [lo, hi] = contrast && Number.isFinite(res.p02) ? [res.p02, res.p98] : idx.range || [0, 1];
    for (let i = 0; i < res.w * res.h; i++) {
      if (!res.inField[i]) continue;
      if (delta) {
        if (delta.flag[i]) { out.data.set([220, 38, 38, 255], i * 4); continue; }
        const v = delta.d[i];
        if (Number.isNaN(v)) { out.data.set([120, 126, 135, 150], i * 4); continue; }
        const col = rampAt(DIVERGE, (v + 0.3) / 0.6); out.data.set([col[0], col[1], col[2], 170], i * 4); continue;
      }
      const v = res.values[i];
      if (Number.isNaN(v)) { out.data.set([120, 126, 135, 150], i * 4); continue; }   // cloud
      if (res.rgba) { out.data.set(res.rgba.subarray(i * 4, i * 4 + 4), i * 4); continue; }
      const col = rampAt(idx.ramp, (v - lo) / (hi - lo || 1));
      out.data.set([col[0], col[1], col[2], 240], i * 4);
    }
    ctx.putImageData(out, 0, 0);
    return c.toDataURL();
  }

  // ------------------------------------------------------------ shared state

  const state_ = {
    scenes: [], farmKey: null, lookback: CONFIG.lookbackDays, showCloudy: false,
    results: new Map(), risks: new Map(), split: false, mode: 'off', token: 0,
  };
  const emit = (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail }));
  const fmtChip = (d) => { const t = new Date(d + 'T00:00:00Z'); return `${t.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' })}'${String(t.getUTCFullYear()).slice(2)}`; };
  const fmtDay = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const sceneById = (id) => state_.scenes.find((s) => s.id === id);
  function friendly(err) {
    const m = (err && err.message) || '';
    if (/fetch|network|cors|load failed/i.test(m)) return `Could not reach ${PROVIDERS[provider]} from this browser. Check the connection, or switch the source to ${PROVIDERS[provider === 'sh' ? 'es' : 'sh']}`;
    return m || 'Satellite data is not available right now';
  }
  function currentFields() {
    return state.fieldsById ? [...state.fieldsById.values()].filter((f) => f.geometry && /Polygon/.test(f.geometry.type)) : [];
  }
  function visibleScenes(v) {
    return state_.scenes.filter((s) => state_.showCloudy || s.tileCloud < CONFIG.cloudThreshold || s.id === v.sceneId);
  }

  // ------------------------------------------------------------ views (one per screen)

  /**
   * A view is one screen: its own map, date, index, contrast and layers, with its
   * own toolbar and timeline. View A is the main map; view B exists in split view.
   */
  const views = [];
  function createView(key, getMap, dockEl, sfx) {
    const v = { key, getMap, dockEl, sfx, sceneId: null, indexKey: 'ndvi', contrast: false, hidden: false, layers: [], results: new Map(), token: 0 };
    const id = (n) => n + sfx;
    dockEl.innerHTML = `
      <div id="${id('imgLegend')}" class="chip-bar pointer-events-auto hidden items-center gap-3 rounded-lg px-3 py-2 text-[11px] text-gray-500"></div>
      <div class="chip-bar pointer-events-auto flex h-11 items-center gap-1 rounded-xl px-1.5">
        <select id="${id('imgSource')}" class="h-8 rounded-lg !border-0 !bg-transparent px-2 text-[13px] outline-none" title="Sentinel-2 source">${Object.entries(PROVIDERS).map(([k, l]) => `<option value="${k}"${k === provider ? ' selected' : ''}>Sentinel-2 · ${l}</option>`).join('')}</select>
        <span class="h-5 w-px bg-white/10"></span>
        <select id="${id('imgIndex')}" class="h-8 rounded-lg !border-0 !bg-transparent px-2 text-[13px] font-medium outline-none" title="Layer">
          ${Object.entries(INDICES).map(([k, x]) => `<option value="${k}">${x.label}</option>`).join('')}
        </select>
        <span class="h-5 w-px bg-white/10"></span>
        <button type="button" id="${id('imgContrast')}" class="map-btn !h-8 !w-8 !rounded-lg !shadow-none !bg-transparent" aria-pressed="false" title="Contrast: stretch colours within each field">${icon('contrast')}</button>
        <button type="button" id="${id('imgCloudy')}" class="map-btn !h-8 !w-8 !rounded-lg !shadow-none !bg-transparent" aria-pressed="false" title="Show cloudy dates">${icon('cloud')}</button>
        <button type="button" id="${id('imgHide')}" class="map-btn !h-8 !w-8 !rounded-lg !shadow-none !bg-transparent" aria-pressed="false" title="Hide imagery">${icon('eye')}</button>
      </div>
      <div class="chip-bar pointer-events-auto flex h-14 w-full items-center gap-1 rounded-xl px-1.5">
        <div class="relative">
          <button type="button" id="${id('tlRangeBtn')}" class="map-btn !h-11 !w-11 !rounded-lg !shadow-none !bg-transparent" title="Period">${icon('calendar')}</button>
          <div id="${id('tlRangeMenu')}" class="chip-bar absolute bottom-12 left-0 hidden w-44 flex-col rounded-xl p-1">
            ${[[30, 'Last 30 days'], [90, 'Last 3 months'], [150, 'Last 5 months'], [365, 'Last 12 months']].map(([d, l]) => `<button type="button" data-days="${d}" class="menu-item">${l}</button>`).join('')}
          </div>
        </div>
        <button type="button" id="${id('tlPrev')}" class="map-btn !h-11 !w-9 !rounded-lg !shadow-none !bg-transparent" title="Earlier">${icon('chevronLeft')}</button>
        <div id="${id('tlChips')}" class="tl-scroll flex min-w-0 flex-1 gap-1 overflow-x-auto scroll-smooth"></div>
        <button type="button" id="${id('tlNext')}" class="map-btn !h-11 !w-9 !rounded-lg !shadow-none !bg-transparent" title="Later">${icon('chevronRight')}</button>
      </div>`;
    const $ = (n) => document.getElementById(id(n));
    v.$ = $;
    $('tlPrev').addEventListener('click', () => step(v, -1));
    $('tlNext').addEventListener('click', () => step(v, 1));
    $('tlRangeBtn').addEventListener('click', (e) => { e.stopPropagation(); $('tlRangeMenu').classList.toggle('hidden'); $('tlRangeMenu').classList.toggle('flex'); });
    document.addEventListener('click', () => { $('tlRangeMenu').classList.add('hidden'); $('tlRangeMenu').classList.remove('flex'); });
    $('tlRangeMenu').querySelectorAll('[data-days]').forEach((b) => b.addEventListener('click', () => { state_.lookback = +b.dataset.days; loadFarm(true); }));
    $('imgSource').addEventListener('change', (e) => setProvider(e.target.value));
    $('imgIndex').addEventListener('change', (e) => { v.indexKey = e.target.value; refresh(v); });
    $('imgContrast').addEventListener('click', () => { v.contrast = !v.contrast; $('imgContrast').setAttribute('aria-pressed', String(v.contrast)); refresh(v); });
    $('imgCloudy').addEventListener('click', () => {
      state_.showCloudy = !state_.showCloudy;
      views.forEach((w) => { w.$('imgCloudy').setAttribute('aria-pressed', String(state_.showCloudy)); renderTimeline(w); });
    });
    $('imgHide').addEventListener('click', () => {
      v.hidden = !v.hidden; $('imgHide').setAttribute('aria-pressed', String(v.hidden)); $('imgHide').innerHTML = icon(v.hidden ? 'eyeOff' : 'eye');
      const pane = v.getMap() && v.getMap().getPane('img'); if (pane) pane.style.display = v.hidden ? 'none' : '';
    });
    views.push(v);
    return v;
  }

  function ensurePane(map) {
    if (!map || map.getPane('img')) return;
    map.createPane('img').style.zIndex = 395;   // below the field outlines (overlayPane 400)
    if (!document.getElementById('imgPxStyle')) {
      const st = document.createElement('style'); st.id = 'imgPxStyle';
      st.textContent = '.leaflet-pane .img-px { image-rendering: pixelated; image-rendering: crisp-edges; }';
      document.head.appendChild(st);
    }
  }
  function clearLayers(v) { const m = v.getMap(); v.layers.forEach((l) => m && m.removeLayer(l)); v.layers.length = 0; }

  function renderTimeline(v, status) {
    const box = v.$('tlChips');
    if (status) { box.innerHTML = `<div class="flex h-11 items-center gap-2 px-3 text-[13px] text-gray-500">${status}</div>`; return; }
    const list = visibleScenes(v).slice().reverse();
    if (!list.length) { box.innerHTML = `<div class="flex h-11 items-center px-3 text-[13px] text-gray-500">No Sentinel-2 dates under ${CONFIG.cloudThreshold}% cloud in this period</div>`; return; }
    box.innerHTML = list.map((s) => `
      <button type="button" class="tl-chip ${s.tileCloud >= CONFIG.cloudThreshold ? 'is-cloudy' : ''}" data-scene="${s.id}" aria-current="${s.id === v.sceneId}"
        title="${fmtDay(s.day)} · ${Math.round(s.tileCloud)}% cloud over the tile">
        <span>${fmtChip(s.day)}</span>
        <span class="flex items-center gap-1"><span class="badge-s2">S2</span><span class="num font-mono text-[10px] text-gray-400">${Math.round(s.tileCloud)}%</span></span>
      </button>`).join('');
    box.querySelectorAll('[data-scene]').forEach((b) => b.addEventListener('click', () => selectScene(v, b.dataset.scene)));
    const cur = box.querySelector('[aria-current="true"]');
    if (cur) cur.scrollIntoView({ block: 'nearest', inline: 'center' });
  }
  function step(v, dir) {
    const list = visibleScenes(v).slice().reverse();
    const i = list.findIndex((s) => s.id === v.sceneId);
    const j = Math.max(0, Math.min(list.length - 1, (i < 0 ? list.length - 1 : i) + dir));
    if (list[j]) selectScene(v, list[j].id);
  }
  function renderLegend(v) {
    const el = v.$('imgLegend'); const idx = INDICES[v.indexKey];
    v.$('imgIndex').value = v.indexKey;
    if (idx.rgb) { el.classList.add('hidden'); el.classList.remove('flex'); return; }
    el.classList.remove('hidden'); el.classList.add('flex');
    const [lo, hi] = idx.range;
    el.innerHTML = idx.composite
      ? `<span class="text-gray-400">${idx.label}</span><span>R = MSAVI · G = NDRE · B = NDVI</span>`
      : `<span class="text-gray-400">${idx.label}${v.contrast ? ' · contrast' : ''}</span>
         <span class="num font-mono">${v.contrast ? 'P2' : lo}</span>
         <span class="h-2 w-32 rounded-full" style="background:${gradient(idx.ramp)}"></span>
         <span class="num font-mono">${v.contrast ? 'P98' : hi}</span>
         <span class="flex items-center gap-1"><span class="h-2 w-2 rounded-sm" style="background:rgb(120,126,135)"></span>cloud</span>`;
  }

  async function selectScene(v, id) {
    v.sceneId = id;
    renderTimeline(v);
    await refresh(v);
  }

  /** Repaint every field of the farm for this view's date, index and contrast. */
  async function refresh(v) {
    if (!v) v = views[0];
    renderLegend(v);
    const scene = sceneById(v.sceneId), map = v.getMap();
    if (!scene || !map) return;
    ensurePane(map);
    if (v === views[0]) clearDelta();
    const fields = currentFields();
    const token = ++v.token;
    const done = [];
    let i = 0, lastErr = null;
    const work = async () => {
      while (i < fields.length) {
        const f = fields[i++];
        try {
          const r = await analyse(f, scene, v.indexKey);
          if (token !== v.token) return;
          done.push(r); v.results.set(f.id, r);
        } catch (err) { if (token !== v.token) return; v.results.delete(f.id); lastErr = err; }
      }
    };
    await Promise.all([work(), work(), work()]);
    if (token !== v.token) return;
    if (!done.length && lastErr) showError(friendly(lastErr));
    clearLayers(v);
    done.forEach((r) => v.layers.push(L.imageOverlay(paint(r, { contrast: v.contrast }), r.bounds, { pane: 'img', className: 'img-px', interactive: false }).addTo(map)));
    if (v === views[0]) {
      state_.results = v.results;
      emit('imagery:change');
      computeRisks(token);
    } else emit('imagery:change-b');
  }

  async function computeRisks(token) {
    const A = views[0]; const scene = sceneById(A.sceneId);
    if (!scene) return;
    for (const f of currentFields()) {
      if (token !== A.token) return;
      try {
        const cur = await analyse(f, scene, 'ndvi');
        if (cur.cloudPct > CONFIG.clearFieldPct) { state_.risks.set(f.id, { kind: 'nodata', cur }); continue; }
        const prev = await previousClear(f, scene, 'ndvi');
        if (!prev) { state_.risks.set(f.id, { kind: 'nodata', cur }); continue; }
        const change = cur.mean - prev.mean;
        state_.risks.set(f.id, { kind: change <= CONFIG.highDrop ? 'high' : change <= CONFIG.lowDrop ? 'low' : 'none', change, cur, prev });
      } catch { state_.risks.set(f.id, { kind: 'nodata' }); }
    }
    if (token === A.token) emit('imagery:risks');
  }

  // ------------------------------------------------------------ farm flow

  function setProvider(p) {
    if (!PROVIDERS[p] || p === provider) return;
    provider = p;
    try { localStorage.setItem('imgProvider', p); } catch { /* storage off */ }
    views.forEach((w) => { w.$('imgSource').value = p; });
    resultCache.clear(); bandCache.clear(); shCache.clear();
    loadFarm(true);
  }

  async function loadFarm(force) {
    const fields = currentFields();
    const farmKey = state.selectedFarmId + ':' + fields.map((f) => f.id).sort().join(',');
    if (!force && farmKey === state_.farmKey) return;
    state_.farmKey = farmKey; state_.risks.clear();
    views.forEach((v) => { v.results.clear(); clearLayers(v); renderLegend(v); });
    clearDelta();
    if (!fields.length) { state_.scenes = []; views.forEach((v) => { v.sceneId = null; renderTimeline(v, 'Add fields to see satellite images'); }); emit('imagery:change'); return; }
    views.forEach((v) => renderTimeline(v, `${icon('loader', 'spin')}<span>Searching Sentinel-2 dates</span>`));
    try {
      await libs();
      const geoms = fields.map((f) => f.geometry);
      let scenes;
      try { scenes = await searchScenes(geoms, farmKey, state_.lookback); } catch (err) {
        // the chosen source is unreachable: try the other one before giving up
        const other = provider === 'sh' ? 'es' : 'sh';
        try { scenes = await searchScenes(geoms, farmKey, state_.lookback, other); } catch { throw err; }
        if (farmKey !== state_.farmKey) return;
        provider = other; views.forEach((w) => { w.$('imgSource').value = other; });
        console.warn('Imagery: ' + (err && err.message) + ' — using ' + PROVIDERS[other]);
      }
      if (farmKey !== state_.farmKey) return;
      state_.scenes = scenes;
      const first = scenes.find((s) => s.tileCloud < 20 && s.covers) || scenes.find((s) => s.tileCloud < CONFIG.cloudThreshold) || scenes[0];
      views[0].sceneId = first ? first.id : null;
      if (views[1]) views[1].sceneId = defaultCompareScene();
      views.forEach((v) => renderTimeline(v));
      await Promise.all(views.filter((v) => v.sceneId && (v === views[0] || state_.split)).map((v) => refresh(v)));
      if (!first) emit('imagery:change');
    } catch (err) {
      if (farmKey !== state_.farmKey) return;
      views.forEach((v) => renderTimeline(v, escapeHtml(friendly(err))));
    }
  }
  function defaultCompareScene() {
    const cur = sceneById(views[0].sceneId);
    const older = state_.scenes.find((s) => cur && s.day < cur.day && s.tile === cur.tile && s.tileCloud < CONFIG.cloudThreshold);
    return (older || cur || {}).id || null;
  }

  // ------------------------------------------------------------ split view (two screens)

  let map2 = null, outline2 = null, syncing = false;
  const paneB = document.getElementById('mapPaneB');
  function buildMap2() {
    map2 = L.map(document.getElementById('mapContainer2'), { zoomControl: false, attributionControl: false });
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }).addTo(map2);
    L.control.scale({ position: 'topright', imperial: false, maxWidth: 120 }).addTo(map2);
    ensurePane(map2);
    const sync = (from, to) => from.on('move', () => { if (syncing) return; syncing = true; to.setView(from.getCenter(), from.getZoom(), { animate: false }); syncing = false; });
    sync(mapInstance, map2); sync(map2, mapInstance);
    hoverBind(map2);
  }
  function drawOutline2() {
    if (!map2) return;
    if (outline2) map2.removeLayer(outline2);
    if (!state.fieldsLayer) return;
    outline2 = L.geoJSON(state.fieldsLayer.toGeoJSON(), {
      style: (f) => fieldStyle((f.properties || {}).id || f.id),
      onEachFeature: (f, layer) => layer.on('click', () => openFieldPanel((f.properties || {}).id || f.id)),
    }).addTo(map2);
  }
  // ------------------------------------------------------------ swipe (one map, a draggable divider)

  const row = document.getElementById('mapRow');
  const divider = document.getElementById('swipeDivider');
  const handle = document.getElementById('swipeHandle');
  let swipeFrac = 0.5;
  function setSwipe(frac) {
    swipeFrac = Math.max(0.02, Math.min(0.98, frac));
    row.style.setProperty('--swipe-x', (swipeFrac * 100).toFixed(2) + '%');
    handle.setAttribute('aria-valuenow', String(Math.round(swipeFrac * 100)));
  }
  if (handle) {
    let dragging = false;
    const at = (e) => { const r = row.getBoundingClientRect(); setSwipe((e.clientX - r.left) / r.width); };
    divider.addEventListener('pointerdown', (e) => { dragging = true; divider.setPointerCapture(e.pointerId); divider.classList.add('dragging'); hideHover(); at(e); e.preventDefault(); });
    divider.addEventListener('pointermove', (e) => { if (dragging) at(e); });
    const stop = (e) => { if (!dragging) return; dragging = false; divider.classList.remove('dragging'); try { divider.releasePointerCapture(e.pointerId); } catch { /* released */ } };
    divider.addEventListener('pointerup', stop); divider.addEventListener('pointercancel', stop);
    handle.addEventListener('keydown', (e) => {
      const d = { ArrowLeft: -0.02, ArrowRight: 0.02, Home: -1, End: 1 }[e.key];
      if (d !== undefined) { e.preventDefault(); setSwipe(Math.abs(d) === 1 ? (d < 0 ? 0 : 1) : swipeFrac + d); }
    });
  }

  /** mode: 'off' | 'swipe' (one map, divider) | 'split' (side by side) */
  async function setCompare(mode) {
    if (!['off', 'swipe', 'split'].includes(mode)) mode = 'off';
    state_.mode = mode;
    row.classList.toggle('swipe', mode === 'swipe');
    divider.classList.toggle('hidden', mode !== 'swipe');
    if (mode === 'swipe') setSwipe(swipeFrac);
    document.querySelectorAll('#compareMenu [data-compare]').forEach((b) => {
      b.setAttribute('aria-current', String(b.dataset.compare === mode));
      if (b.dataset.compare === 'off') b.classList.toggle('hidden', mode === 'off');
    });
    return setSplit(mode !== 'off', true);
  }

  async function setSplit(on, fromCompare) {
    if (!fromCompare) return setCompare(on ? 'split' : 'off');
    state_.split = on;
    const btn = document.getElementById('swipeBtn'); if (btn) btn.setAttribute('aria-pressed', String(on));
    paneB.classList.toggle('hidden', !on);
    if (on) {
      if (!map2) buildMap2();
      if (!views[1]) createView('B', () => map2, document.getElementById('imageryDock2'), '2');
      const B = views[1];
      if (!B.sceneId || !sceneById(B.sceneId)) B.sceneId = defaultCompareScene();
      if (!B.indexKey) B.indexKey = views[0].indexKey;
      drawOutline2();
      setTimeout(() => { mapInstance.invalidateSize(); map2.invalidateSize(); map2.setView(mapInstance.getCenter(), mapInstance.getZoom(), { animate: false }); }, 30);
      renderTimeline(B);
      await refresh(B);
    } else {
      hideHover();
      setTimeout(() => mapInstance.invalidateSize(), 30);
    }
  }
  function invalidate() { if (mapInstance) mapInstance.invalidateSize(); if (map2 && state_.split) map2.invalidateSize(); }

  // ------------------------------------------------------------ hover readout on both screens

  function labelFor(indexKey, v) {
    if (Number.isNaN(v)) return 'Cloud or shadow';
    if (indexKey === 'ndvi' || indexKey === 'msavi' || indexKey === 'vmi') return v < 0.2 ? 'Bare soil or stress' : v < 0.4 ? 'Sparse vegetation' : v < 0.6 ? 'Moderate vegetation' : v < 0.8 ? 'Healthy vegetation' : 'Dense vegetation';
    if (indexKey === 'ndre') return v < 0.2 ? 'Low chlorophyll' : v < 0.4 ? 'Moderate chlorophyll' : 'High chlorophyll';
    if (indexKey === 'ndmi') return v < -0.2 ? 'Water stress' : v < 0 ? 'Low water content' : v < 0.2 ? 'Moderate water content' : v < 0.4 ? 'High water content' : 'Very high water content';
    if (indexKey === 'reci') return v < 2 ? 'Low chlorophyll' : v < 4 ? 'Moderate chlorophyll' : 'High chlorophyll';
    return '';
  }
  function fieldAt(latlng) {
    for (const f of currentFields()) {
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      if (polys.some((p) => pointInRings(latlng.lng, latlng.lat, p))) return f;
    }
    return null;
  }
  function valueAt(r, latlng) {
    const [x, y] = proj4('EPSG:4326', utmDef(r.code)).forward([latlng.lng, latlng.lat]);
    const c = Math.floor((x - r.gx0) / 10), row = Math.floor((r.gy0 - y) / 10);
    if (c < 0 || row < 0 || c >= r.w || row >= r.h) return undefined;
    const i = row * r.w + c;
    return r.inField[i] ? r.values[i] : undefined;
  }
  const hoverEls = { A: document.getElementById('hoverA'), B: document.getElementById('hoverB') };
  function hideHover() { Object.values(hoverEls).forEach((el) => el && el.classList.add('hidden')); }
  let raf = 0;
  function showHover(latlng) {
    const f = fieldAt(latlng);
    if (!f || !window.proj4) { hideHover(); return; }
    const name = (state.fieldList || []).find((x) => x.id === f.id)?.name || f.name || 'Field';
    const swipeSide = state_.mode === 'swipe' && mapInstance
      ? (mapInstance.latLngToContainerPoint(latlng).x < swipeFrac * mapInstance.getSize().x ? 0 : 1) : -1;
    views.forEach((v, k) => {
      const el = hoverEls[v.key]; const map = v.getMap();
      if (!el || !map || (k === 1 && !state_.split)) return;
      if (swipeSide >= 0 && swipeSide !== k) { el.classList.add('hidden'); return; }
      const r = v.results.get(f.id); const idx = INDICES[v.indexKey];
      let lines = `<div class="font-medium">${escapeHtml(name)}</div>`;
      if (r && !idx.rgb) {
        const val = valueAt(r, latlng);
        if (val !== undefined) lines += Number.isNaN(val)
          ? `<div>${idx.label}: —</div><div class="text-white/70">Cloud or shadow</div>`
          : `<div class="num">${idx.label}: ${val.toFixed(2)}</div><div class="text-white/70">${labelFor(v.indexKey, val)}</div>`;
      } else if (r) lines += `<div class="text-white/70">${idx.label} · ${fmtDay(r.scene.day)}</div>`;
      const pt = map.latLngToContainerPoint(latlng);
      el.innerHTML = lines + '<span class="hr-dot"></span>';
      el.style.left = pt.x + 'px'; el.style.top = pt.y + 'px';
      el.classList.remove('hidden');
    });
  }
  function hoverBind(map) {
    map.on('mousemove', (e) => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => showHover(e.latlng)); });
    map.on('mouseout movestart zoomstart', hideHover);
  }

  // ------------------------------------------------------------ delta overlay (field compare, main screen)

  let deltaLayer = null, deltaMarkers = [];
  function clearDelta() {
    if (!mapInstance) return;
    if (deltaLayer) { mapInstance.removeLayer(deltaLayer); deltaLayer = null; }
    deltaMarkers.forEach((m) => mapInstance.removeLayer(m)); deltaMarkers = [];
  }

  // ------------------------------------------------------------ wiring

  createView('A', () => mapInstance, document.getElementById('imageryDock'), '');
  let attached = false;
  document.addEventListener('workspace:fields', () => {
    if (!attached && mapInstance) { attached = true; ensurePane(mapInstance); hoverBind(mapInstance); }
    drawOutline2();
    loadFarm(false);
  });
  document.addEventListener('fieldpanel:close', () => clearDelta());

  window.Imagery = {
    config: CONFIG, indices: INDICES, state: state_, views, analyse, compare, paint, previousClear, searchScenes, sceneById,
    current: () => sceneById(views[0].sceneId),
    selectScene: (id) => selectScene(views[0], id),
    refresh: () => refresh(views[0]),
    setSplit, setCompare, setSwipe, swipe: () => swipeFrac, loadFarm,
    /** Opens a scene on the main screen even if it is older than the timeline's period (time series). */
    showScene(scene) {
      if (!scene) return;
      if (!sceneById(scene.id)) {
        state_.scenes.push(scene);
        state_.scenes.sort((a, b) => (a.day < b.day ? 1 : -1));
      }
      selectScene(views[0], scene.id);
    }, invalidate, labelFor, setProvider, provider: () => provider,
    resultFor: (fieldId) => views[0].results.get(fieldId), riskFor: (fieldId) => state_.risks.get(fieldId),
    rampAt, gradient, css, fmtDay, friendly,
    showDelta(res, delta) {
      clearDelta();
      deltaLayer = L.imageOverlay(paint(res, { delta }), res.bounds, { pane: 'img', className: 'img-px', interactive: false }).addTo(mapInstance);
      delta.clusters.slice(0, 5).forEach((cl, i) => deltaMarkers.push(L.circleMarker([cl.lat, cl.lng], { radius: 7, color: '#fff', weight: 2, fillColor: '#111827', fillOpacity: 0.9 })
        .bindTooltip(`Drop ${i + 1}: ${cl.ha.toFixed(2)} ha, ${cl.meanDrop.toFixed(2)}`, { direction: 'top' }).addTo(mapInstance)));
    },
    clearDelta,
    _caches: { sceneCache, resultCache, bandCache, imgCache, shCache },
  };
  // compatibility: older callers read the main screen's settings from state
  Object.defineProperty(state_, 'sceneId', { get: () => views[0].sceneId });
  Object.defineProperty(state_, 'indexKey', { get: () => views[0].indexKey });
  Object.defineProperty(state_, 'contrast', { get: () => views[0].contrast });
})();
