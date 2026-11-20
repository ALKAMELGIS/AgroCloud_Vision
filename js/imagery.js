/*
 * AgroCloud Vision — satellite imagery engine and map timeline
 *
 * Sentinel-2 L2A from Element84 Earth Search (free, no key), read in the
 * browser with geotiff.js. Only each field's window is read from the
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
  };

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
  async function searchScenes(geoms, key, lookbackDays) {
    const cacheKey = key + '|' + lookbackDays;
    if (sceneCache.has(cacheKey)) return sceneCache.get(cacheKey);
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

  // ------------------------------------------------------------ state + map layers

  const state_ = {
    scenes: [], sceneId: null, leftSceneId: null, indexKey: 'ndvi', contrast: false, showCloudy: false,
    lookback: CONFIG.lookbackDays, farmKey: null, results: new Map(), risks: new Map(), busy: false, swipe: false,
  };
  const emit = (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail }));

  let panesReady = false, layersA = [], layersB = [], deltaLayer = null, deltaMarkers = [];
  function ensurePanes() {
    if (panesReady || !mapInstance) return;
    mapInstance.createPane('imgA').style.zIndex = 405;
    mapInstance.createPane('imgB').style.zIndex = 406;
    const s = document.createElement('style');
    s.textContent = '.leaflet-pane .img-px { image-rendering: pixelated; image-rendering: crisp-edges; }';
    document.head.appendChild(s);
    panesReady = true;
  }
  function clearLayers(list) { list.forEach((l) => mapInstance.removeLayer(l)); list.length = 0; }
  function addOverlay(list, pane, url, bounds) {
    list.push(L.imageOverlay(url, bounds, { pane, className: 'img-px', interactive: false }).addTo(mapInstance));
  }
  function clearDelta() {
    if (deltaLayer) { mapInstance.removeLayer(deltaLayer); deltaLayer = null; }
    deltaMarkers.forEach((m) => mapInstance.removeLayer(m)); deltaMarkers = [];
  }

  // ------------------------------------------------------------ dock UI (toolbar + timeline)

  const dock = document.getElementById('imageryDock');
  dock.innerHTML = `
    <div id="imgLegend" class="chip-bar pointer-events-auto hidden items-center gap-3 rounded-lg px-3 py-2 text-[11px] text-gray-500"></div>
    <div class="chip-bar pointer-events-auto flex h-11 items-center gap-1 rounded-xl px-1.5">
      <select id="imgSource" class="h-8 rounded-lg !border-0 !bg-transparent px-2 text-[13px] outline-none" title="Satellite"><option>Sentinel-2</option></select>
      <span class="h-5 w-px bg-white/10"></span>
      <select id="imgIndex" class="h-8 rounded-lg !border-0 !bg-transparent px-2 text-[13px] outline-none" title="Index">
        ${Object.entries(INDICES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}
      </select>
      <span class="h-5 w-px bg-white/10"></span>
      <button type="button" id="imgContrast" class="map-btn !h-8 !w-8 !rounded-lg !shadow-none !bg-transparent" aria-pressed="false" title="Contrast: stretch colours within each field">${icon('contrast')}</button>
      <button type="button" id="imgCloudy" class="map-btn !h-8 !w-8 !rounded-lg !shadow-none !bg-transparent" aria-pressed="false" title="Show cloudy dates">${icon('cloud')}</button>
      <button type="button" id="imgHide" class="map-btn !h-8 !w-8 !rounded-lg !shadow-none !bg-transparent" aria-pressed="false" title="Hide imagery">${icon('eye')}</button>
    </div>
    <div class="chip-bar pointer-events-auto flex h-14 w-full items-center gap-1 rounded-xl px-1.5">
      <div class="relative">
        <button type="button" id="tlRangeBtn" class="map-btn !h-11 !w-11 !rounded-lg !shadow-none !bg-transparent" title="Period">${icon('calendar')}</button>
        <div id="tlRangeMenu" class="chip-bar absolute bottom-12 left-0 hidden w-44 flex-col rounded-xl p-1">
          ${[[30, 'Last 30 days'], [90, 'Last 3 months'], [150, 'Last 5 months'], [365, 'Last 12 months']].map(([d, l]) => `<button type="button" data-days="${d}" class="menu-item">${l}</button>`).join('')}
        </div>
      </div>
      <button type="button" id="tlPrev" class="map-btn !h-11 !w-9 !rounded-lg !shadow-none !bg-transparent" title="Earlier">${icon('chevronLeft')}</button>
      <div id="tlChips" class="tl-scroll flex min-w-0 flex-1 gap-1 overflow-x-auto scroll-smooth"></div>
      <button type="button" id="tlNext" class="map-btn !h-11 !w-9 !rounded-lg !shadow-none !bg-transparent" title="Later">${icon('chevronRight')}</button>
    </div>`;
  const $ = (id) => document.getElementById(id);
  const fmtChip = (d) => { const t = new Date(d + 'T00:00:00Z'); return `${t.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' })}'${String(t.getUTCFullYear()).slice(2)}`; };
  const fmtDay = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

  function visibleScenes() {
    return state_.scenes.filter((s) => state_.showCloudy || s.tileCloud < CONFIG.cloudThreshold || s.id === state_.sceneId);
  }

  function renderTimeline(status) {
    const box = $('tlChips');
    if (status) { box.innerHTML = `<div class="flex h-11 items-center gap-2 px-3 text-[13px] text-gray-500">${status}</div>`; return; }
    const list = visibleScenes().slice().reverse(); // oldest → newest, like a timeline
    if (!list.length) { box.innerHTML = `<div class="flex h-11 items-center px-3 text-[13px] text-gray-500">No Sentinel-2 dates under ${CONFIG.cloudThreshold}% cloud in this period</div>`; return; }
    box.innerHTML = list.map((s) => `
      <button type="button" class="tl-chip ${s.tileCloud >= CONFIG.cloudThreshold ? 'is-cloudy' : ''}" data-scene="${s.id}" aria-current="${s.id === state_.sceneId}"
        title="${fmtDay(s.day)} · ${Math.round(s.tileCloud)}% cloud over the tile">
        <span>${fmtChip(s.day)}</span>
        <span class="flex items-center gap-1"><span class="badge-s2">S2</span><span class="num font-mono text-[10px] text-gray-400">${Math.round(s.tileCloud)}%</span></span>
      </button>`).join('');
    box.querySelectorAll('[data-scene]').forEach((b) => b.addEventListener('click', () => selectScene(b.dataset.scene)));
    const cur = box.querySelector('[aria-current="true"]');
    if (cur) cur.scrollIntoView({ block: 'nearest', inline: 'center' });
  }
  $('tlPrev').addEventListener('click', () => step(-1));
  $('tlNext').addEventListener('click', () => step(1));
  function step(dir) {
    const list = visibleScenes().slice().reverse();
    const i = list.findIndex((s) => s.id === state_.sceneId);
    const j = Math.max(0, Math.min(list.length - 1, (i < 0 ? list.length - 1 : i) + dir));
    if (list[j]) selectScene(list[j].id);
  }
  $('tlRangeBtn').addEventListener('click', (e) => { e.stopPropagation(); $('tlRangeMenu').classList.toggle('hidden'); $('tlRangeMenu').classList.toggle('flex'); });
  document.addEventListener('click', () => { $('tlRangeMenu').classList.add('hidden'); $('tlRangeMenu').classList.remove('flex'); });
  $('tlRangeMenu').querySelectorAll('[data-days]').forEach((b) => b.addEventListener('click', () => { state_.lookback = +b.dataset.days; loadFarm(true); }));
  $('imgIndex').addEventListener('change', (e) => { state_.indexKey = e.target.value; refresh(); });
  $('imgContrast').addEventListener('click', () => { state_.contrast = !state_.contrast; $('imgContrast').setAttribute('aria-pressed', String(state_.contrast)); refresh(); });
  $('imgCloudy').addEventListener('click', () => { state_.showCloudy = !state_.showCloudy; $('imgCloudy').setAttribute('aria-pressed', String(state_.showCloudy)); renderTimeline(); });
  let hidden = false;
  $('imgHide').addEventListener('click', () => {
    hidden = !hidden; $('imgHide').setAttribute('aria-pressed', String(hidden)); $('imgHide').innerHTML = icon(hidden ? 'eyeOff' : 'eye');
    ['imgA', 'imgB'].forEach((p) => { const el = mapInstance && mapInstance.getPane(p); if (el) el.style.display = hidden ? 'none' : ''; });
  });

  function renderLegend() {
    const el = $('imgLegend'); const idx = INDICES[state_.indexKey];
    if (idx.rgb) { el.classList.add('hidden'); el.classList.remove('flex'); return; }
    el.classList.remove('hidden'); el.classList.add('flex');
    const [lo, hi] = idx.range;
    el.innerHTML = idx.composite
      ? `<span class="text-gray-400">${idx.label}</span><span>R = MSAVI · G = NDRE · B = NDVI</span>`
      : `<span class="text-gray-400">${idx.label}${state_.contrast ? ' · contrast' : ''}</span>
         <span class="num font-mono">${state_.contrast ? 'P2' : lo}</span>
         <span class="h-2 w-32 rounded-full" style="background:${gradient(idx.ramp)}"></span>
         <span class="num font-mono">${state_.contrast ? 'P98' : hi}</span>
         <span class="flex items-center gap-1"><span class="h-2 w-2 rounded-sm" style="background:rgb(120,126,135)"></span>cloud</span>`;
  }

  // ------------------------------------------------------------ farm flow

  function currentFields() {
    return state.fieldsById ? [...state.fieldsById.values()].filter((f) => f.geometry && /Polygon/.test(f.geometry.type)) : [];
  }

  async function loadFarm(force) {
    const fields = currentFields();
    const farmKey = state.selectedFarmId + ':' + fields.map((f) => f.id).sort().join(',');
    if (!force && farmKey === state_.farmKey) return;
    state_.farmKey = farmKey; state_.results.clear(); state_.risks.clear();
    clearLayers(layersA); clearLayers(layersB); clearDelta();
    renderLegend();
    if (!fields.length) { state_.scenes = []; state_.sceneId = null; renderTimeline('Add fields to see satellite images'); emit('imagery:change'); return; }
    renderTimeline(`${icon('loader', 'spin')}<span>Searching Sentinel-2 dates</span>`);
    try {
      await libs();
      const scenes = await searchScenes(fields.map((f) => f.geometry), farmKey, state_.lookback);
      if (farmKey !== state_.farmKey) return;
      state_.scenes = scenes;
      const first = scenes.find((s) => s.tileCloud < 20 && s.covers) || scenes.find((s) => s.tileCloud < CONFIG.cloudThreshold) || scenes[0];
      state_.sceneId = first ? first.id : null;
      renderTimeline();
      if (first) await selectScene(first.id);
      else emit('imagery:change');
    } catch (err) {
      if (farmKey !== state_.farmKey) return;
      renderTimeline(escapeHtml(friendly(err)));
    }
  }

  function friendly(err) {
    const m = (err && err.message) || '';
    if (/fetch|network|cors|load failed/i.test(m)) return 'Could not reach the Sentinel-2 archive from this browser. Check the connection, or the image host may be blocking cross-site requests';
    return m || 'Satellite data is not available right now';
  }

  const sceneById = (id) => state_.scenes.find((s) => s.id === id);

  async function selectScene(id) {
    state_.sceneId = id;
    renderTimeline();
    await refresh();
  }

  /** Repaint all fields for the current date, index and contrast; then compute risks. */
  async function refresh() {
    renderLegend();
    const scene = sceneById(state_.sceneId);
    if (!scene || !mapInstance) return;
    ensurePanes(); clearDelta();
    const fields = currentFields();
    const token = (state_.token = (state_.token || 0) + 1);
    const done = [];
    let i = 0;
    const work = async () => {
      while (i < fields.length) {
        const f = fields[i++];
        try {
          const r = await analyse(f, scene, state_.indexKey);
          if (token !== state_.token) return;
          done.push(r);
          state_.results.set(f.id, r);
        } catch (err) {
          if (token !== state_.token) return;
          state_.results.delete(f.id);
          if (!done.length && i >= fields.length) showError(friendly(err));
        }
      }
    };
    await Promise.all([work(), work(), work()]);
    if (token !== state_.token) return;
    clearLayers(layersB);
    done.forEach((r) => addOverlay(layersB, 'imgB', paint(r, { contrast: state_.contrast }), r.bounds));
    if (state_.swipe) await paintSwipeLeft();
    emit('imagery:change');
    computeRisks(token);
  }

  async function computeRisks(token) {
    const scene = sceneById(state_.sceneId);
    if (!scene) return;
    for (const f of currentFields()) {
      if (token !== state_.token) return;
      try {
        const cur = await analyse(f, scene, 'ndvi');
        if (cur.cloudPct > CONFIG.clearFieldPct) { state_.risks.set(f.id, { kind: 'nodata', cur }); continue; }
        const prev = await previousClear(f, scene, 'ndvi');
        if (!prev) { state_.risks.set(f.id, { kind: 'nodata', cur }); continue; }
        const change = cur.mean - prev.mean;
        state_.risks.set(f.id, { kind: change <= CONFIG.highDrop ? 'high' : change <= CONFIG.lowDrop ? 'low' : 'none', change, cur, prev });
      } catch { state_.risks.set(f.id, { kind: 'nodata' }); }
    }
    if (token === state_.token) emit('imagery:risks');
  }

  // ------------------------------------------------------------ swipe (split view)

  const swipeBar = document.createElement('div');
  swipeBar.className = 'chip-bar pointer-events-auto absolute left-3 top-[68px] z-[565] hidden items-center gap-2 rounded-xl px-2 py-1.5 text-[12px]';
  swipeBar.innerHTML = `<span class="px-1 text-gray-400">Left</span><select id="swipeLeft" class="h-8 rounded-lg px-2 text-[12px] outline-none"></select>
    <span class="text-gray-500">${icon('split')}</span><span class="px-1 text-gray-400">Right</span><span id="swipeRightLabel" class="num px-1 font-mono text-gray-900"></span>`;
  document.getElementById('mapMain').appendChild(swipeBar);
  const handle = document.createElement('div');
  handle.className = 'swipe-handle hidden';
  document.getElementById('mapMain').appendChild(handle);
  let swipeX = 0.5;

  function clipPanes() {
    if (!mapInstance) return;
    const A = mapInstance.getPane('imgA'), B = mapInstance.getPane('imgB');
    if (!state_.swipe) { if (A) A.style.clip = ''; if (B) B.style.clip = ''; return; }
    const size = mapInstance.getSize();
    const nw = mapInstance.containerPointToLayerPoint([0, 0]);
    const se = mapInstance.containerPointToLayerPoint(size);
    const x = mapInstance.containerPointToLayerPoint([size.x * swipeX, 0]).x;
    A.style.clip = `rect(${nw.y}px, ${x}px, ${se.y}px, ${nw.x}px)`;
    B.style.clip = `rect(${nw.y}px, ${se.x}px, ${se.y}px, ${x}px)`;
    handle.style.left = (swipeX * 100) + '%';
  }

  async function paintSwipeLeft() {
    clearLayers(layersA);
    const left = sceneById(state_.leftSceneId);
    if (!left) return;
    for (const f of currentFields()) {
      try { const r = await analyse(f, left, state_.indexKey); if (state_.swipe) addOverlay(layersA, 'imgA', paint(r, { contrast: state_.contrast }), r.bounds); }
      catch { /* skip field */ }
    }
    clipPanes();
  }

  function setSwipe(on) {
    state_.swipe = on;
    clearDelta();
    const btn = document.getElementById('swipeBtn'); if (btn) btn.setAttribute('aria-pressed', String(on));
    swipeBar.classList.toggle('hidden', !on); swipeBar.classList.toggle('flex', on);
    handle.classList.toggle('hidden', !on);
    if (!on) { clearLayers(layersA); clipPanes(); return; }
    const cur = sceneById(state_.sceneId);
    const options = state_.scenes.filter((s) => s.id !== state_.sceneId && (!cur || s.tile === cur.tile) && s.tileCloud < 80);
    if (!state_.leftSceneId || !options.some((s) => s.id === state_.leftSceneId)) {
      const older = options.find((s) => cur && s.day < cur.day && s.tileCloud < CONFIG.cloudThreshold) || options[0];
      state_.leftSceneId = older ? older.id : null;
    }
    $('swipeLeft').innerHTML = options.map((s) => `<option value="${s.id}" ${s.id === state_.leftSceneId ? 'selected' : ''}>${fmtDay(s.day)} · ${Math.round(s.tileCloud)}%</option>`).join('');
    $('swipeRightLabel').textContent = cur ? fmtDay(cur.day) : '';
    paintSwipeLeft();
  }
  $('swipeLeft').addEventListener('change', (e) => { state_.leftSceneId = e.target.value; paintSwipeLeft(); });
  document.addEventListener('imagery:change', () => { if (state_.swipe) { const cur = sceneById(state_.sceneId); $('swipeRightLabel').textContent = cur ? fmtDay(cur.day) : ''; } });
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault(); handle.setPointerCapture(e.pointerId);
    mapInstance.dragging.disable();
    const rect = document.getElementById('mapContainer').getBoundingClientRect();
    const move = (ev) => { swipeX = Math.max(0.02, Math.min(0.98, (ev.clientX - rect.left) / rect.width)); clipPanes(); };
    const up = () => { handle.removeEventListener('pointermove', move); mapInstance.dragging.enable(); };
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up, { once: true });
  });

  // ------------------------------------------------------------ wiring

  function attachMap() {
    if (!mapInstance || attachMap.done) return;
    attachMap.done = true;
    ensurePanes();
    mapInstance.on('move zoom viewreset zoomend moveend', clipPanes);
  }
  document.addEventListener('workspace:fields', () => { attachMap(); loadFarm(false); });
  document.addEventListener('fieldpanel:close', () => clearDelta());

  window.Imagery = {
    config: CONFIG, indices: INDICES, state: state_, analyse, compare, paint, previousClear, searchScenes,
    sceneById, current: () => sceneById(state_.sceneId), selectScene, refresh, setSwipe, loadFarm,
    resultFor: (fieldId) => state_.results.get(fieldId), riskFor: (fieldId) => state_.risks.get(fieldId),
    rampAt, gradient, css, fmtDay, friendly,
    showDelta(res, delta) {
      clearDelta();
      deltaLayer = L.imageOverlay(paint(res, { delta }), res.bounds, { pane: 'imgB', className: 'img-px', interactive: false }).addTo(mapInstance);
      delta.clusters.slice(0, 5).forEach((cl, i) => deltaMarkers.push(L.circleMarker([cl.lat, cl.lng], { radius: 7, color: '#fff', weight: 2, fillColor: '#111827', fillOpacity: 0.9 })
        .bindTooltip(`Drop ${i + 1}: ${cl.ha.toFixed(2)} ha, ${cl.meanDrop.toFixed(2)}`, { direction: 'top' }).addTo(mapInstance)));
    },
    clearDelta,
    _caches: { sceneCache, resultCache, bandCache, imgCache },
  };
})();
