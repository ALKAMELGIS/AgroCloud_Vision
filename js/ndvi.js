/*
 * AgroCloud Vision — satellite monitoring (NDVI) for one field
 *
 * Data: Sentinel-2 L2A from Element84 Earth Search (free, no key). The STAC
 * API lists scenes over the field; geotiff.js reads only the field's window
 * from each Cloud-Optimized GeoTIFF with HTTP range requests (red, nir, scl;
 * visual for true colour). Everything runs in the browser.
 *
 * Method
 *  - Reflectance = DN * scale + offset from the asset's raster:bands. When
 *    that metadata is missing and the processing baseline is >= 04.00 with
 *    the offset not applied, (DN - 1000) / 10000 (the 2022 BOA offset).
 *  - Cloud mask from the scene classification layer (SCL, 20 m): keep
 *    4 vegetation, 5 bare soil, 6 water, 7 unclassified. Cloud cover is
 *    computed inside the field, not taken from the 110 km tile.
 *  - Compare: dNDVI per pixel minus the field-wide median change; pixels that
 *    dropped by more than 0.10, at least one pixel from the edge, in clusters
 *    of >= 0.1 ha are flagged. Starting values to tune (see the research
 *    report); vendors do not publish theirs.
 *
 * Renders into the field panel's Monitoring tab: window.NdviMonitor.render(el, field).
 */
(function () {
  'use strict';

  const CONFIG = {
    stac: 'https://earth-search.aws.element84.com/v1/search',
    collection: 'sentinel-2-c1-l2a',          // Earth Search v2 will rename this to sentinel-2-l2a
    lookbackDays: 150,
    maxTileCloud: 80,
    geotiff: 'https://cdn.jsdelivr.net/npm/geotiff@2.1.3/dist-browser/geotiff.js',
    proj4: 'https://cdn.jsdelivr.net/npm/proj4@2.11.0/dist/proj4.js',
    keepScl: new Set([4, 5, 6, 7]),
    anomalyDrop: 0.10,
    anomalyMinHa: 0.1,
    chartMaxDates: 16,
    chartMinValid: 0.6,
  };
  window.NdviConfig = CONFIG;

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

  // ------------------------------------------------------------ STAC

  const sceneCache = new Map();   // fieldId -> scenes
  const resultCache = new Map();  // fieldId|itemId -> result
  const tiffCache = new Map();    // href -> Promise<GeoTIFFImage>

  function bboxOf(geometry) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    geometry.coordinates[0].forEach(([x, y]) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); });
    return [minX, minY, maxX, maxY];
  }
  const contains = (outer, inner) => outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3];

  async function searchScenes(field) {
    if (sceneCache.has(field.id)) return sceneCache.get(field.id);
    const end = new Date();
    const start = new Date(Date.now() - CONFIG.lookbackDays * 86400000);
    const body = {
      collections: [CONFIG.collection],
      intersects: field.geometry,
      datetime: start.toISOString() + '/' + end.toISOString(),
      query: { 'eo:cloud_cover': { lt: CONFIG.maxTileCloud } },
      sortby: [{ field: 'properties.datetime', direction: 'desc' }],
      limit: 100,
    };
    const res = await fetch(CONFIG.stac, { method: 'POST', headers: { 'Content-Type': 'application/geo+json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error('The Sentinel-2 catalogue did not answer (' + res.status + ')');
    const fc = await res.json();
    const fbox = bboxOf(field.geometry);
    const tileOf = (it) => it.properties['s2:mgrs_tile'] || it.properties['grid:code'] || it.properties['proj:epsg'] || '';
    // The tile that most often covers the whole field: dates on it can be compared pixel by pixel.
    const counts = new Map();
    (fc.features || []).forEach((it) => { if (!it.bbox || contains(it.bbox, fbox)) counts.set(tileOf(it), (counts.get(tileOf(it)) || 0) + 1); });
    const mainTile = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    // One scene per day: prefer full coverage, then the main tile, then the least cloudy.
    const rank = (c) => (c.covers ? 2 : 0) + (c.tile === mainTile ? 1 : 0);
    const byDay = new Map();
    (fc.features || []).forEach((it) => {
      const day = (it.properties.datetime || '').slice(0, 10);
      const covers = it.bbox ? contains(it.bbox, fbox) : true;
      const cand = { item: it, day, covers, tile: tileOf(it), tileCloud: +(it.properties['eo:cloud_cover'] ?? 100) };
      const prev = byDay.get(day);
      if (!prev || rank(cand) > rank(prev) || (rank(cand) === rank(prev) && cand.tileCloud < prev.tileCloud)) byDay.set(day, cand);
    });
    const scenes = [...byDay.values()].sort((a, b) => (a.day < b.day ? 1 : -1));
    sceneCache.set(field.id, scenes);
    return scenes;
  }

  // ------------------------------------------------------------ raster reading

  function epsgOf(item) {
    const p = item.properties;
    const code = p['proj:epsg'] ?? (p['proj:code'] ? +String(p['proj:code']).split(':')[1] : null);
    if (!code) throw new Error('Scene has no projection code');
    return code;
  }
  function utmDef(code) {
    if (code >= 32601 && code <= 32660) return `+proj=utm +zone=${code - 32600} +datum=WGS84 +units=m +no_defs`;
    if (code >= 32701 && code <= 32760) return `+proj=utm +zone=${code - 32700} +south +datum=WGS84 +units=m +no_defs`;
    throw new Error('Unsupported projection EPSG:' + code);
  }
  function assetHref(item, ...names) {
    for (const n of names) if (item.assets[n]) return item.assets[n];
    throw new Error('Scene is missing band ' + names[0]);
  }
  function scaling(item, asset) {
    const b = asset['raster:bands'] && asset['raster:bands'][0];
    if (b && (b.scale != null || b.offset != null)) return { scale: b.scale ?? 1, offset: b.offset ?? 0 };
    const pb = parseFloat(item.properties['s2:processing_baseline'] || '0');
    const applied = item.properties['earthsearch:boa_offset_applied'];
    if (pb >= 4 && applied !== true) return { scale: 1e-4, offset: -0.1 };
    return { scale: 1e-4, offset: 0 };
  }
  function openImage(href) {
    if (!tiffCache.has(href)) {
      tiffCache.set(href, GeoTIFF.fromUrl(href, { allowFullFile: false }).then((t) => t.getImage()).catch((e) => { tiffCache.delete(href); throw e; }));
    }
    return tiffCache.get(href);
  }
  // Pixel window [c0, r0, c1, r1] of an image that covers bbox (in the image CRS), padded by pad metres.
  function windowFor(img, bbox, pad) {
    const [ox, oy] = img.getOrigin();
    const [rx, ry] = img.getResolution();
    const W = img.getWidth(), H = img.getHeight();
    const c0 = Math.max(0, Math.floor((bbox[0] - pad - ox) / rx));
    const c1 = Math.min(W, Math.ceil((bbox[2] + pad - ox) / rx));
    const r0 = Math.max(0, Math.floor((bbox[3] + pad - oy) / ry));   // ry < 0
    const r1 = Math.min(H, Math.ceil((bbox[1] - pad - oy) / ry));
    if (c1 <= c0 || r1 <= r0) throw new Error('The field is outside this scene');
    return { win: [c0, r0, c1, r1], ox, oy, rx, ry, w: c1 - c0, h: r1 - r0 };
  }

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

  /**
   * Reads one scene for the field. Returns per-pixel NDVI (NaN = outside / masked),
   * the window geometry, stats and the lat/lng bounds for an overlay.
   */
  async function analyseScene(field, scene) {
    const key = field.id + '|' + scene.item.id;
    if (resultCache.has(key)) return resultCache.get(key);
    await libs();
    const item = scene.item;
    const code = epsgOf(item);
    const toUtm = proj4('EPSG:4326', utmDef(code));
    const rings = field.geometry.coordinates.map((r) => r.map(([lng, lat]) => toUtm.forward([lng, lat])));
    const xs = rings[0].map((p) => p[0]), ys = rings[0].map((p) => p[1]);
    const ubox = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];

    const redA = assetHref(item, 'red', 'B04'), nirA = assetHref(item, 'nir', 'B08'), sclA = assetHref(item, 'scl', 'SCL');
    const [redImg, nirImg, sclImg] = await Promise.all([openImage(redA.href), openImage(nirA.href), openImage(sclA.href)]);
    const g = windowFor(redImg, ubox, 20);
    const gs = windowFor(sclImg, ubox, 40);
    const [red, nir, scl] = await Promise.all([
      redImg.readRasters({ window: g.win, samples: [0] }).then((r) => r[0]),
      nirImg.readRasters({ window: windowFor(nirImg, ubox, 20).win, samples: [0] }).then((r) => r[0]),
      sclImg.readRasters({ window: gs.win, samples: [0] }).then((r) => r[0]),
    ]);
    const sr = scaling(item, redA), sn = scaling(item, nirA);

    const n = g.w * g.h;
    const ndvi = new Float32Array(n).fill(NaN);
    const inField = new Uint8Array(n);
    let fieldPx = 0, validPx = 0;
    for (let row = 0; row < g.h; row++) {
      const y = g.oy + (g.win[1] + row + 0.5) * g.ry;
      for (let col = 0; col < g.w; col++) {
        const x = g.ox + (g.win[0] + col + 0.5) * g.rx;
        if (!pointInRings(x, y, rings)) continue;
        const i = row * g.w + col;
        inField[i] = 1; fieldPx++;
        const sc = Math.floor((x - gs.ox) / gs.rx) - gs.win[0];
        const srow = Math.floor((y - gs.oy) / gs.ry) - gs.win[1];
        const cls = sc >= 0 && sc < gs.w && srow >= 0 && srow < gs.h ? scl[srow * gs.w + sc] : 0;
        if (!CONFIG.keepScl.has(cls)) continue;
        const r = red[i] * sr.scale + sr.offset, v = nir[i] * sn.scale + sn.offset;
        if (red[i] === 0 || nir[i] === 0 || r + v <= 0) continue;
        ndvi[i] = Math.max(-1, Math.min(1, (v - r) / (v + r)));
        validPx++;
      }
    }
    const pxHa = Math.abs(g.rx * g.ry) / 10000;
    const vals = [];
    for (let i = 0; i < n; i++) if (!Number.isNaN(ndvi[i])) vals.push(ndvi[i]);
    vals.sort((a, b) => a - b);
    const q = (p) => (vals.length ? vals[Math.min(vals.length - 1, Math.floor(p * vals.length))] : NaN);
    const mean = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : NaN;
    const CLASSES = [[-1, 0.2], [0.2, 0.4], [0.4, 0.6], [0.6, 0.8], [0.8, 1.01]];
    const classes = CLASSES.map(([a, b]) => vals.filter((v) => v >= a && v < b).length * pxHa);

    const fromUtm = proj4(utmDef(code), 'EPSG:4326');
    const x0 = g.ox + g.win[0] * g.rx, x1 = g.ox + g.win[2] * g.rx;
    const y0 = g.oy + g.win[1] * g.ry, y1 = g.oy + g.win[3] * g.ry;
    const sw = fromUtm.forward([x0, y1]), ne = fromUtm.forward([x1, y0]);

    const result = {
      key, scene, ndvi, inField, w: g.w, h: g.h, pxHa,
      bounds: [[sw[1], sw[0]], [ne[1], ne[0]]],
      fieldHa: fieldPx * pxHa, validHa: validPx * pxHa,
      cloudPct: fieldPx ? Math.round(100 * (1 - validPx / fieldPx)) : 100,
      mean, p10: q(0.1), p50: q(0.5), p90: q(0.9), p02: q(0.02), p98: q(0.98), classes,
      utm: { code, win: g.win, ox: g.ox, oy: g.oy, rx: g.rx, ry: g.ry },
    };
    resultCache.set(key, result);
    return result;
  }

  async function trueColor(field, scene, res) {
    await libs();
    const asset = scene.item.assets.visual;
    if (!asset) throw new Error('This scene has no true-colour image');
    const img = await openImage(asset.href);
    const rgb = await img.readRasters({ window: res.utm.win, interleave: true });
    const c = document.createElement('canvas'); c.width = res.w; c.height = res.h;
    const ctx = c.getContext('2d'); const out = ctx.createImageData(res.w, res.h);
    for (let i = 0; i < res.w * res.h; i++) {
      out.data[i * 4] = rgb[i * 3]; out.data[i * 4 + 1] = rgb[i * 3 + 1]; out.data[i * 4 + 2] = rgb[i * 3 + 2];
      out.data[i * 4 + 3] = res.inField[i] ? 255 : 0;
    }
    ctx.putImageData(out, 0, 0);
    return c.toDataURL();
  }

  // ------------------------------------------------------------ colour

  const RAMP = [ // RdYlGn, NDVI
    [0.0, [165, 0, 38]], [0.2, [215, 48, 39]], [0.3, [244, 109, 67]], [0.4, [253, 174, 97]], [0.5, [254, 224, 139]],
    [0.6, [217, 239, 139]], [0.7, [166, 217, 106]], [0.8, [102, 189, 99]], [0.9, [26, 152, 80]], [1.0, [0, 104, 55]],
  ];
  const DIVERGE = [[-0.3, [178, 24, 43]], [-0.1, [244, 165, 130]], [0, [247, 247, 247]], [0.1, [166, 219, 160]], [0.3, [27, 120, 55]]];
  function ramp(stops, v) {
    if (v <= stops[0][0]) return stops[0][1];
    for (let i = 1; i < stops.length; i++) {
      if (v <= stops[i][0]) {
        const [a, ca] = stops[i - 1], [b, cb] = stops[i]; const t = (v - a) / (b - a);
        return [0, 1, 2].map((k) => Math.round(ca[k] + (cb[k] - ca[k]) * t));
      }
    }
    return stops[stops.length - 1][1];
  }
  function paint(res, valueAt, colorOf, flag) {
    const c = document.createElement('canvas'); c.width = res.w; c.height = res.h;
    const ctx = c.getContext('2d'); const out = ctx.createImageData(res.w, res.h);
    for (let i = 0; i < res.w * res.h; i++) {
      if (!res.inField[i]) continue;
      const v = valueAt(i);
      if (Number.isNaN(v)) { out.data.set([156, 163, 175, 140], i * 4); continue; }  // masked by cloud
      if (flag && flag[i]) { out.data.set([220, 38, 38, 255], i * 4); continue; }   // flagged drop
      const col = colorOf(v);
      out.data.set([col[0], col[1], col[2], flag ? 150 : 235], i * 4);
    }
    ctx.putImageData(out, 0, 0);
    return c.toDataURL();
  }

  // ------------------------------------------------------------ compare / anomalies

  function compare(cur, prev) {
    if (cur.w !== prev.w || cur.h !== prev.h || cur.utm.code !== prev.utm.code || cur.utm.win.join() !== prev.utm.win.join()) {
      throw new Error('These two dates come from different tiles, so they cannot be compared pixel by pixel');
    }
    const n = cur.w * cur.h;
    const d = new Float32Array(n).fill(NaN);
    const ds = [];
    for (let i = 0; i < n; i++) {
      if (!cur.inField[i] || Number.isNaN(cur.ndvi[i]) || Number.isNaN(prev.ndvi[i])) continue;
      d[i] = cur.ndvi[i] - prev.ndvi[i]; ds.push(d[i]);
    }
    if (ds.length < 10) throw new Error('Too few clear pixels on both dates to compare');
    ds.sort((a, b) => a - b);
    const median = ds[Math.floor(ds.length / 2)];
    // flag pixels that dropped more than the threshold relative to the field trend, away from the edge
    const flag = new Uint8Array(n);
    const W = cur.w, H = cur.h;
    for (let r = 1; r < H - 1; r++) for (let c = 1; c < W - 1; c++) {
      const i = r * W + c;
      if (Number.isNaN(d[i]) || d[i] - median > -CONFIG.anomalyDrop) continue;
      if (!cur.inField[i - 1] || !cur.inField[i + 1] || !cur.inField[i - W] || !cur.inField[i + W]) continue;
      flag[i] = 1;
    }
    // keep connected clusters >= anomalyMinHa
    const minPx = Math.max(1, Math.round(CONFIG.anomalyMinHa / cur.pxHa));
    const seen = new Uint8Array(n); const keep = new Uint8Array(n); const clusters = [];
    for (let i = 0; i < n; i++) {
      if (!flag[i] || seen[i]) continue;
      const stack = [i], members = []; seen[i] = 1;
      while (stack.length) {
        const k = stack.pop(); members.push(k);
        const r = Math.floor(k / W), c = k % W;
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          const rr = r + dr, cc = c + dc; if (rr < 0 || cc < 0 || rr >= H || cc >= W) continue;
          const j = rr * W + cc; if (flag[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
        }
      }
      if (members.length >= minPx) {
        members.forEach((k) => { keep[k] = 1; });
        let sx = 0, sy = 0, sd = 0;
        members.forEach((k) => { sx += k % W; sy += Math.floor(k / W); sd += d[k]; });
        clusters.push({ px: members.length, ha: members.length * cur.pxHa, col: sx / members.length, row: sy / members.length, meanDrop: sd / members.length - median });
      }
    }
    clusters.sort((a, b) => b.ha - a.ha);
    const fromUtm = proj4(utmDef(cur.utm.code), 'EPSG:4326');
    clusters.forEach((cl) => {
      const x = cur.utm.ox + (cur.utm.win[0] + cl.col + 0.5) * cur.utm.rx;
      const y = cur.utm.oy + (cur.utm.win[1] + cl.row + 0.5) * cur.utm.ry;
      const [lng, lat] = fromUtm.forward([x, y]);
      cl.lat = lat; cl.lng = lng;
    });
    const anomalyHa = clusters.reduce((s, c) => s + c.ha, 0);
    return { d, median, flag: keep, clusters, anomalyHa, comparedHa: ds.length * cur.pxHa };
  }

  // ------------------------------------------------------------ map overlay

  let overlay = null, markers = [];
  function showOverlay(url, bounds) {
    clearOverlay();
    overlay = L.imageOverlay(url, bounds, { opacity: 1, interactive: false, className: 'ndvi-overlay' }).addTo(mapInstance);
    const fl = state.fieldsLayer; if (fl) fl.bringToFront();
  }
  function clearOverlay() {
    if (overlay) { mapInstance.removeLayer(overlay); overlay = null; }
    markers.forEach((m) => mapInstance.removeLayer(m)); markers = [];
  }
  document.addEventListener('fieldpanel:close', clearOverlay);
  const s = document.createElement('style');
  s.textContent = '.ndvi-overlay { image-rendering: pixelated; image-rendering: crisp-edges; }';
  document.head.appendChild(s);

  // ------------------------------------------------------------ UI

  const fmtDay = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : '—');
  const CLASS_LABELS = [['< 0.2', 'Bare soil or stress', RAMP[1][1]], ['0.2 – 0.4', 'Weak growth', RAMP[3][1]], ['0.4 – 0.6', 'Moderate growth', RAMP[5][1]], ['0.6 – 0.8', 'Good growth', RAMP[7][1]], ['≥ 0.8', 'Dense vegetation', RAMP[9][1]]];
  const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;

  const ui = { fieldId: null, el: null, field: null, scenes: [], sel: null, layer: 'ndvi', contrast: false, cmp: '', series: null, crops: [] };

  function render(el, field, ctx) {
    const changed = ui.fieldId !== field.id;
    ui.el = el; ui.field = field; ui.crops = (ctx && ctx.crops) || [];
    if (changed) { ui.fieldId = field.id; ui.scenes = []; ui.sel = null; ui.cmp = ''; ui.series = null; clearOverlay(); }
    if (!field.geometry || field.geometry.type !== 'Polygon') { el.innerHTML = '<p class="text-[13px] text-gray-400">Monitoring needs a single polygon boundary</p>'; return; }
    if (changed || !ui.scenes.length) start(); else draw();
  }

  async function start() {
    const id = ui.fieldId;
    ui.el.innerHTML = status('Searching Sentinel-2 scenes for this field');
    try {
      const scenes = await searchScenes(ui.field);
      if (id !== ui.fieldId) return;
      ui.scenes = scenes;
      if (!scenes.length) { ui.el.innerHTML = `<p class="text-[13px] text-gray-500">No Sentinel-2 scenes under ${CONFIG.maxTileCloud}% cloud in the last ${CONFIG.lookbackDays} days</p>`; return; }
      // first scene whose tile is reasonably clear
      ui.sel = (scenes.find((s) => s.tileCloud < 30 && s.covers) || scenes[0]).item.id;
      draw();
      await selectScene(ui.sel);
    } catch (err) {
      if (id !== ui.fieldId) return;
      ui.el.innerHTML = `<div class="rounded-lg bg-red-50 p-3 text-[13px] text-red-700 ring-1 ring-red-100">${escapeHtml(err.message || 'Satellite data is not available right now')}</div>
        <p class="mt-2 text-[12px] text-gray-500">Source: ${CONFIG.collection} on Element84 Earth Search</p>`;
    }
  }

  function status(text) {
    return `<div class="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2.5 text-[13px] text-gray-600">${icon('loader', 'spin text-gray-400')}<span>${escapeHtml(text)}</span></div>`;
  }

  function sceneById(id) { return ui.scenes.find((s) => s.item.id === id); }

  function draw() {
    const el = ui.el; if (!el) return;
    const cur = ui.sel && resultCache.get(ui.fieldId + '|' + ui.sel);
    const others = ui.scenes.filter((s) => s.item.id !== ui.sel);
    el.innerHTML = `
      <div class="space-y-5">
        <div>
          <div class="mb-2 flex items-center justify-between"><span class="fp-h !mb-0">Sentinel-2 dates</span><span class="text-[11px] text-gray-400">tile cloud %</span></div>
          <div id="ndDates" class="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
            ${ui.scenes.map((s) => {
              const r = resultCache.get(ui.fieldId + '|' + s.item.id);
              const on = s.item.id === ui.sel;
              const cloud = r ? r.cloudPct : Math.round(s.tileCloud);
              return `<button type="button" data-scene="${s.item.id}" class="flex h-12 w-14 shrink-0 flex-col items-center justify-center rounded-lg text-[12px] transition-colors ${on ? 'bg-brand-900 text-white' : 'bg-gray-50 text-gray-700 hover:bg-gray-100'}">
                <span>${fmtDay(s.day)}</span><span class="num font-mono text-[10px] ${on ? 'text-white/70' : cloud > 40 ? 'text-gray-400' : 'text-gray-500'}">${r ? '' : '~'}${cloud}%</span></button>`;
            }).join('')}
          </div>
        </div>
        <div id="ndMain">${cur ? mainHtml(cur) : status('Reading the field from the scene')}</div>
        <div>
          <div class="fp-h">Compare with an earlier date</div>
          <select id="ndCmp" class="fp-input"><option value="">No comparison</option>${others.filter((s) => s.day < (sceneById(ui.sel) || {}).day && s.tile === (sceneById(ui.sel) || {}).tile).map((s) => `<option value="${s.item.id}" ${s.item.id === ui.cmp ? 'selected' : ''}>${fmtDay(s.day)} · ~${Math.round(s.tileCloud)}% tile cloud</option>`).join('')}</select>
          <div id="ndCmpOut" class="mt-3"></div>
        </div>
        <div>
          <div class="mb-2 flex items-center justify-between"><span class="fp-h !mb-0">NDVI this season</span>${ui.series ? '' : '<button type="button" id="ndSeries" class="text-[12px] font-medium text-brand-700">Build chart</button>'}</div>
          <div id="ndSeriesOut">${ui.series ? seriesHtml(ui.series) : `<p class="text-[12px] text-gray-400">Reads up to ${CONFIG.chartMaxDates} of the clearest dates; dates with more than ${Math.round((1 - CONFIG.chartMinValid) * 100)}% cloud over the field are left out</p>`}</div>
        </div>
        <p class="text-[11px] leading-4 text-gray-400">Sentinel-2 L2A, 10 m · Element84 Earth Search · clouds masked with the scene classification layer</p>
      </div>`;
    el.querySelectorAll('[data-scene]').forEach((b) => b.addEventListener('click', () => selectScene(b.dataset.scene)));
    el.querySelectorAll('[data-layer]').forEach((b) => b.addEventListener('click', () => { ui.layer = b.dataset.layer; draw(); paintCurrent(); }));
    const ct = el.querySelector('#ndContrast'); if (ct) ct.addEventListener('change', () => { ui.contrast = ct.checked; paintCurrent(); draw(); });
    el.querySelector('#ndCmp').addEventListener('change', (e) => { ui.cmp = e.target.value; runCompare(); });
    const sb = el.querySelector('#ndSeries'); if (sb) sb.addEventListener('click', buildSeries);
    const selBtn = el.querySelector(`[data-scene="${ui.sel}"]`); if (selBtn) selBtn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (ui.cmp) runCompare(true);
  }

  function mainHtml(r) {
    const total = r.classes.reduce((a, b) => a + b, 0) || 1;
    return `
      <div class="flex items-end justify-between">
        <div>
          <div class="text-[12px] text-gray-500">Mean NDVI · ${fmtDay(r.scene.day)}</div>
          <div class="num font-mono text-[32px] leading-10 text-gray-900">${f2(r.mean)}</div>
          <div class="num font-mono text-[12px] text-gray-500">P10 ${f2(r.p10)} · P90 ${f2(r.p90)}</div>
        </div>
        <div class="text-right">
          <div class="num font-mono text-[13px] ${r.cloudPct > 40 ? 'text-amber-700' : 'text-gray-900'}">${r.cloudPct}% cloud</div>
          <div class="num font-mono text-[12px] text-gray-500">${formatHa(r.validHa)} clear</div>
        </div>
      </div>
      <div class="mt-4 flex items-center gap-1 rounded-lg bg-gray-100 p-0.5 text-[12px]">
        ${[['ndvi', 'NDVI'], ['rgb', 'True colour']].map(([v, l]) => `<button type="button" data-layer="${v}" class="h-7 flex-1 rounded-md transition-colors ${ui.layer === v ? 'bg-white font-medium text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'}">${l}</button>`).join('')}
      </div>
      ${ui.layer === 'ndvi' ? `<label class="mt-3 flex items-center gap-2 text-[12px] text-gray-600"><input id="ndContrast" type="checkbox" class="h-4 w-4 accent-brand-600" ${ui.contrast ? 'checked' : ''}/>Contrast within the field (P2–P98)</label>` : ''}
      <div class="mt-4 space-y-1.5">
        ${CLASS_LABELS.map(([range, label, col], i) => `
          <div class="flex items-center gap-2 text-[12px]">
            <span class="h-2.5 w-2.5 shrink-0 rounded-sm" style="background:${rgb(col)}"></span>
            <span class="num w-[72px] shrink-0 whitespace-nowrap font-mono text-gray-500">${range}</span>
            <span class="flex-1 truncate text-gray-700">${label}</span>
            <span class="h-1.5 w-16 overflow-hidden rounded-full bg-gray-100"><span class="block h-full rounded-full" style="width:${(100 * r.classes[i]) / total}%;background:${rgb(col)}"></span></span>
            <span class="num w-16 shrink-0 text-right font-mono text-gray-500">${formatHa(r.classes[i])}</span>
          </div>`).join('')}
      </div>`;
  }

  async function selectScene(id) {
    ui.sel = id; ui.cmp = '';
    const fieldId = ui.fieldId;
    draw();
    try {
      const r = await analyseScene(ui.field, sceneById(id));
      if (fieldId !== ui.fieldId || ui.sel !== id) return;
      draw();
      paintCurrent();
    } catch (err) {
      if (fieldId !== ui.fieldId || ui.sel !== id) return;
      const m = ui.el.querySelector('#ndMain');
      if (m) m.innerHTML = `<div class="rounded-lg bg-red-50 p-3 text-[13px] text-red-700 ring-1 ring-red-100">${escapeHtml(friendly(err))}</div>`;
    }
  }

  function friendly(err) {
    const m = (err && err.message) || '';
    if (/fetch|network|cors/i.test(m)) return 'Could not read the satellite image from this browser. The image host may be blocking cross-site requests; try another date or reload';
    return m || 'Could not read this scene';
  }

  async function paintCurrent() {
    const r = ui.sel && resultCache.get(ui.fieldId + '|' + ui.sel);
    if (!r || ui.cmp) return;
    if (ui.layer === 'rgb') {
      try { showOverlay(await trueColor(ui.field, r.scene, r), r.bounds); }
      catch (err) { showError(friendly(err)); }
      return;
    }
    const lo = ui.contrast ? r.p02 : 0, hi = ui.contrast ? r.p98 : 1;
    const span = Math.max(1e-6, hi - lo);
    showOverlay(paint(r, (i) => r.ndvi[i], (v) => ramp(RAMP, Math.max(0, Math.min(1, (v - lo) / span))), null), r.bounds);
  }

  async function runCompare(silent) {
    const out = ui.el && ui.el.querySelector('#ndCmpOut');
    if (!out) return;
    if (!ui.cmp) { out.innerHTML = ''; if (!silent) paintCurrent(); return; }
    const fieldId = ui.fieldId, a = ui.sel, b = ui.cmp;
    out.innerHTML = status('Reading the earlier date');
    try {
      const [cur, prev] = await Promise.all([analyseScene(ui.field, sceneById(a)), analyseScene(ui.field, sceneById(b))]);
      if (fieldId !== ui.fieldId || ui.sel !== a || ui.cmp !== b) return;
      const c = compare(cur, prev);
      showOverlay(paint(cur, (i) => c.d[i], (v) => ramp(DIVERGE, v), c.flag), cur.bounds);
      markers.forEach((m) => mapInstance.removeLayer(m)); markers = [];
      c.clusters.slice(0, 5).forEach((cl, i) => {
        markers.push(L.circleMarker([cl.lat, cl.lng], { radius: 7, color: '#ffffff', weight: 2, fillColor: '#111827', fillOpacity: 0.9 })
          .bindTooltip(`Drop ${i + 1}: ${formatHa(cl.ha)}, ${cl.meanDrop.toFixed(2)} NDVI`, { direction: 'top' }).addTo(mapInstance));
      });
      const trend = c.median >= 0 ? `+${c.median.toFixed(2)}` : c.median.toFixed(2);
      out.innerHTML = `
        <div class="rounded-lg ${c.clusters.length ? 'bg-amber-50 ring-1 ring-amber-100' : 'bg-gray-50'} p-3">
          <div class="text-[13px] font-medium ${c.clusters.length ? 'text-amber-900' : 'text-gray-900'}">${c.clusters.length ? `${formatHa(c.anomalyHa)} dropped more than ${CONFIG.anomalyDrop.toFixed(2)} against the field` : 'No area dropped against the rest of the field'}</div>
          <div class="num mt-1 font-mono text-[12px] text-gray-600">Field change ${trend} · ${fmtDay(prev.scene.day)} → ${fmtDay(cur.scene.day)} · ${formatHa(c.comparedHa)} compared</div>
          ${c.clusters.length ? `
            <div class="mt-2 space-y-1">${c.clusters.slice(0, 5).map((cl, i) => `
              <button type="button" data-cl="${i}" class="num flex w-full items-center justify-between rounded-md px-1.5 py-1 text-left font-mono text-[12px] text-gray-700 transition-colors hover:bg-amber-100/60">
                <span>Area ${i + 1} · ${formatHa(cl.ha)}</span><span>${cl.meanDrop.toFixed(2)}</span></button>`).join('')}</div>
            <button type="button" id="ndScout" class="mt-3 h-8 w-full rounded-lg bg-white text-[12px] font-medium text-gray-900 ring-1 ring-gray-200 transition-colors hover:bg-gray-50">Log a scouting visit for these areas</button>` : ''}
        </div>
        <div class="mt-2 flex items-center gap-2 text-[11px] text-gray-500">
          <span class="h-2 w-16 rounded-full" style="background:linear-gradient(90deg,${DIVERGE.map(([, col]) => rgb(col)).join(',')})"></span>
          <span class="num font-mono">−0.3 … +0.3</span><span class="flex items-center gap-1">· <span class="h-2 w-2 rounded-sm bg-red-600"></span>flagged drop</span>
        </div>`;
      out.querySelectorAll('[data-cl]').forEach((btn) => btn.addEventListener('click', () => {
        const cl = c.clusters[+btn.dataset.cl]; mapInstance.setView([cl.lat, cl.lng], Math.max(mapInstance.getZoom(), 16));
      }));
      const sc = out.querySelector('#ndScout');
      if (sc) sc.addEventListener('click', async () => {
        const note = `NDVI drop ${fmtDay(prev.scene.day)} → ${fmtDay(cur.scene.day)}: ` + c.clusters.slice(0, 5)
          .map((cl, i) => `area ${i + 1} ${cl.ha.toFixed(2)} ha (${cl.meanDrop.toFixed(2)}) at ${cl.lat.toFixed(5)}, ${cl.lng.toFixed(5)}`).join('; ');
        try {
          await apiPost('/activities', { fieldId: ui.field.id, type: 'scouting_visit', date: new Date().toISOString().slice(0, 10), notes: note.slice(0, 2000) });
          showToast('Scouting visit logged');
          document.dispatchEvent(new CustomEvent('activities:changed'));
        } catch (err) { showError(err.message || 'Could not log the visit'); }
      });
    } catch (err) {
      if (fieldId !== ui.fieldId) return;
      out.innerHTML = `<div class="rounded-lg bg-red-50 p-3 text-[13px] text-red-700 ring-1 ring-red-100">${escapeHtml(friendly(err))}</div>`;
    }
  }

  async function buildSeries() {
    const out = ui.el.querySelector('#ndSeriesOut');
    const fieldId = ui.fieldId;
    const picks = ui.scenes.filter((s) => s.covers).slice().sort((a, b) => a.tileCloud - b.tileCloud).slice(0, CONFIG.chartMaxDates)
      .sort((a, b) => (a.day < b.day ? -1 : 1));
    const pts = [];
    for (let i = 0; i < picks.length; i++) {
      if (fieldId !== ui.fieldId) return;
      out.innerHTML = status(`Reading date ${i + 1} of ${picks.length}`);
      try {
        const r = await analyseScene(ui.field, picks[i]);
        if (r.validHa / Math.max(r.fieldHa, 1e-9) >= CONFIG.chartMinValid) pts.push({ day: picks[i].day, mean: r.mean, p10: r.p10, p90: r.p90 });
      } catch { /* skip unreadable dates */ }
    }
    if (fieldId !== ui.fieldId) return;
    ui.series = pts;
    draw();
  }

  function seriesHtml(pts) {
    if (pts.length < 2) return '<p class="text-[12px] text-gray-400">Not enough clear dates to draw a curve yet</p>';
    const W = 340, H = 140, P = { l: 28, r: 8, t: 8, b: 20 };
    const t0 = +new Date(pts[0].day), t1 = +new Date(pts[pts.length - 1].day);
    const x = (d) => P.l + ((+new Date(d) - t0) / Math.max(1, t1 - t0)) * (W - P.l - P.r);
    const y = (v) => P.t + (1 - v) * (H - P.t - P.b);
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.day).toFixed(1)} ${y(p.mean).toFixed(1)}`).join(' ');
    const band = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.day).toFixed(1)} ${y(p.p90).toFixed(1)}`).join(' ') + ' ' +
      pts.slice().reverse().map((p) => `L${x(p.day).toFixed(1)} ${y(p.p10).toFixed(1)}`).join(' ') + ' Z';
    const planted = ui.crops.find((c) => c.plantingDate >= pts[0].day && c.plantingDate <= pts[pts.length - 1].day);
    return `
      <svg viewBox="0 0 ${W} ${H}" class="w-full" role="img" aria-label="Mean NDVI over the season">
        ${[0, 0.25, 0.5, 0.75, 1].map((v) => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}" stroke="#f3f4f6"/><text x="${P.l - 4}" y="${y(v) + 3}" text-anchor="end" font-size="9" fill="#9ca3af" font-family="ui-monospace,monospace">${v.toFixed(2)}</text>`).join('')}
        ${planted ? `<line x1="${x(planted.plantingDate)}" x2="${x(planted.plantingDate)}" y1="${P.t}" y2="${H - P.b}" stroke="#d1d5db" stroke-dasharray="3 3"/><text x="${x(planted.plantingDate) + 3}" y="${P.t + 8}" font-size="9" fill="#6b7280">planted</text>` : ''}
        <path d="${band}" fill="#16a34a" fill-opacity=".12"/>
        <path d="${line}" fill="none" stroke="#16a34a" stroke-width="2" stroke-linejoin="round"/>
        ${pts.map((p) => `<circle cx="${x(p.day)}" cy="${y(p.mean)}" r="2.5" fill="#fff" stroke="#16a34a" stroke-width="1.5"><title>${fmtDay(p.day)} · ${p.mean.toFixed(2)}</title></circle>`).join('')}
        <text x="${P.l}" y="${H - 5}" font-size="9" fill="#9ca3af">${fmtDay(pts[0].day)}</text>
        <text x="${W - P.r}" y="${H - 5}" font-size="9" fill="#9ca3af" text-anchor="end">${fmtDay(pts[pts.length - 1].day)}</text>
      </svg>
      <p class="num mt-1 font-mono text-[11px] text-gray-400">Mean with P10–P90 band · ${pts.length} clear dates</p>`;
  }

  window.NdviMonitor = { render, analyseScene, compare, searchScenes, config: CONFIG, _caches: { sceneCache, resultCache, tiffCache } };
})();
