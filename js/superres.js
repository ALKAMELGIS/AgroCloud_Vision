/*
 * Sentinel-2 super-resolution in the browser.
 *
 * Models: models/sr/*.onnx (Apache 2.0, see models/sr/README.md). They take
 * B02 B03 B04 B08 at 10 m as reflectance x 10000 and return the same four
 * bands at 5 m (x2) or 2.5 m (x4). Each field is read with a margin of
 * ceil(margin / factor) input pixels, run in tiles, and the margin is cropped.
 *
 * Only NDVI, MSAVI and natural colour can be sharpened (the models have no
 * red-edge or SWIR bands). The cloud mask still comes from the 20 m SCL band.
 * Output is a model estimate: stats, zones and comparisons keep using 10 m.
 */
(function () {
  const ORT = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/';
  const MODELS = {
    x2: { file: 'models/sr/s2v2x2_spatrad.onnx', factor: 2, margin: 66, label: '5 m' },
    x4: { file: 'models/sr/wsx4_spatrad.onnx', factor: 4, margin: 130, label: '2.5 m' },
  };
  const SUPPORTED = new Set(['ndvi', 'msavi', 'rgb']);
  const TILE = 96;            // core input pixels per tile
  const CACHE = 'agro-sr-v1';

  function loadScript(url, globalName) {
    if (window[globalName]) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script'); s.src = url; s.async = true;
      s.onload = () => resolve(); s.onerror = () => reject(new Error('Could not load ' + url));
      document.head.appendChild(s);
    });
  }

  async function fetchModel(key, onProgress) {
    const url = new URL(MODELS[key].file, document.baseURI).href;
    let cache = null;
    try { cache = await caches.open(CACHE); const hit = await cache.match(url); if (hit) return new Uint8Array(await hit.arrayBuffer()); } catch { cache = null; }
    const res = await fetch(url);
    if (!res.ok) throw new Error('Could not download the sharpening model (' + res.status + ')');
    const total = +res.headers.get('content-length') || 0;
    const reader = res.body.getReader(); const parts = []; let got = 0;
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      parts.push(value); got += value.length;
      if (total && onProgress) onProgress(got / total);
    }
    const buf = new Uint8Array(got); let o = 0; parts.forEach((p) => { buf.set(p, o); o += p.length; });
    try { if (cache) await cache.put(url, new Response(buf, { headers: { 'content-type': 'application/octet-stream' } })); } catch { /* quota */ }
    return buf;
  }

  const sessions = new Map();
  function session(key, onProgress) {
    if (sessions.has(key)) return sessions.get(key);
    const p = (async () => {
      await loadScript(ORT + 'ort.min.js', 'ort');
      const ort = window.ort;
      ort.env.wasm.wasmPaths = ORT;
      ort.env.wasm.numThreads = window.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
      const bytes = await fetchModel(key, onProgress);
      if (navigator.gpu) {
        try { return await ort.InferenceSession.create(bytes, { executionProviders: ['webgpu'], graphOptimizationLevel: 'all' }); } catch { /* fall back to wasm */ }
      }
      return ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    })();
    sessions.set(key, p);
    p.catch(() => sessions.delete(key));
    return p;
  }

  // toRGB from the source repo: contrast with highlight compression, saturation, sRGB
  const maxR = 4.0, midR = 0.17, sat = 1.5, gamma = 1.9, gOff = 0.01;
  const gOffPow = gOff ** gamma, gOffRange = (1 + gOff) ** gamma - gOffPow;
  const clip = (s) => (s < 0 ? 0 : s > 1 ? 1 : s);
  const adj = (a, tx, ty, maxC) => { const ar = clip(a / maxC); return (ar * (ar * (tx / maxC + ty - 1) - ty)) / (ar * ((2 * tx) / maxC - 1) - tx / maxC); };
  const sAdj = (a) => (((adj(a, midR, 1, maxR) + gOff) ** gamma) - gOffPow) / gOffRange;
  const sRGB = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** 0.41666666666 - 0.055);
  function toRGB(r, g, b) {
    r = sAdj(r); g = sAdj(g); b = sAdj(b);
    const avg = ((r + g + b) / 3) * (1 - sat);
    return [clip(avg + r * sat), clip(avg + g * sat), clip(avg + b * sat)].map((c) => Math.floor(sRGB(c) * 255));
  }

  /** Rasterises the field on the output grid (1 = inside). */
  function fieldMask(polys, ox, oy, px, W, H) {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#000'; ctx.beginPath();
    polys.forEach((poly) => poly.forEach((ring) => ring.forEach(([x, y], k) => {
      const cx = (x - ox) / px, cy = (oy - y) / px; if (k) ctx.lineTo(cx, cy); else ctx.moveTo(cx, cy);
    })));
    ctx.fill('evenodd');
    const a = ctx.getImageData(0, 0, W, H).data; const m = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) m[i] = a[i * 4 + 3] > 127 ? 1 : 0;
    return m;
  }

  const results = new Map();
  /**
   * Sharpened result for one field and date, shaped like Imagery.analyse()
   * (values, inField, rgba, w, h, gx0, gy0, bounds) plus px (metres per pixel).
   */
  function enhance(field, scene, indexKey, modelKey, onProgress) {
    const key = [scene.id, field.id, indexKey, modelKey].join('|');
    if (results.has(key)) return results.get(key);
    const p = (async () => {
      const I = window.Imagery._sr; const M = MODELS[modelKey];
      if (!M) throw new Error('Unknown model');
      if (!SUPPORTED.has(indexKey)) throw new Error('Sharpening works with NDVI, MSAVI and natural colour');
      await I.libs();
      const sess = await session(modelKey, (f) => onProgress && onProgress({ phase: 'model', f }));
      const f = M.factor, m = Math.ceil(M.margin / f), crop = m * f, px = 10 / f;
      const code = I.epsgOf(scene.item);
      const toUtm = proj4('EPSG:4326', I.utmDef(code));
      const polys = I.ringsOf(field.geometry).map((poly) => poly.map((ring) => ring.map(([lng, lat]) => toUtm.forward([lng, lat]))));
      const xs = polys.flatMap((q) => q[0].map((v) => v[0])), ys = polys.flatMap((q) => q[0].map((v) => v[1]));
      const ubox = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      const scl = await I.readBand(scene, field.id, 'scl', ubox);
      // 10 m core grid aligned with the tile, plus the model margin on every side
      const cx0 = Math.floor((ubox[0] - scl.ox) / 10) * 10 + scl.ox, cy0 = scl.oy - Math.floor((scl.oy - ubox[3]) / 10) * 10;
      const cw = Math.ceil((ubox[2] - cx0) / 10), ch = Math.ceil((cy0 - ubox[1]) / 10);
      if (cw * ch > 400 * 400) throw new Error('The field is too large to sharpen in the browser');
      const gx0 = cx0 - m * 10, gy0 = cy0 + m * 10, gw = cw + 2 * m, gh = ch + 2 * m;
      const pbox = [gx0, gy0 - gh * 10, gx0 + gw * 10, gy0];
      const names = ['blue', 'green', 'red', 'nir'];
      const bands = await Promise.all(names.map((b) => I.readBand(scene, field.id + '|sr', b, pbox)));
      // input: reflectance x 10000, gaps filled with the band mean
      const n = gw * gh, input = new Float32Array(4 * n);
      bands.forEach((bb, k) => {
        let sum = 0, cnt = 0; const plane = input.subarray(k * n, (k + 1) * n);
        for (let r = 0; r < gh; r++) for (let c = 0; c < gw; c++) {
          const bi = bb.at(gx0 + (c + 0.5) * 10, gy0 - (r + 0.5) * 10);
          const dn = bi < 0 ? 0 : bb.data[bi];
          const v = dn ? (dn * bb.sc.scale + bb.sc.offset) * 10000 : NaN;
          plane[r * gw + c] = v; if (!Number.isNaN(v)) { sum += v; cnt++; }
        }
        if (!cnt) throw new Error('No data for this field on this date');
        const mean = sum / cnt; for (let i = 0; i < n; i++) if (Number.isNaN(plane[i])) plane[i] = mean;
      });
      // tiled inference over the core
      const W = cw * f, H = ch * f, out = [0, 1, 2, 3].map(() => new Float32Array(W * H));
      const tiles = []; for (let ty = 0; ty < ch; ty += TILE) for (let tx = 0; tx < cw; tx += TILE) tiles.push([tx, ty]);
      const inName = sess.inputNames[0];
      for (let t = 0; t < tiles.length; t++) {
        if (onProgress) onProgress({ phase: 'run', f: t / tiles.length });
        const [tx, ty] = tiles[t]; const tw = Math.min(TILE, cw - tx), th = Math.min(TILE, ch - ty);
        const iw = tw + 2 * m, ih = th + 2 * m, tin = new Float32Array(4 * iw * ih);
        for (let k = 0; k < 4; k++) for (let r = 0; r < ih; r++) {
          const src = k * n + (ty + r) * gw + tx;
          tin.set(input.subarray(src, src + iw), k * iw * ih + r * iw);
        }
        const res = await sess.run({ [inName]: new window.ort.Tensor('float32', tin, [1, 4, ih, iw]) });
        const o = res[sess.outputNames[0]]; const od = o.data; const ow = iw * f, oh = ih * f;
        for (let k = 0; k < 4; k++) for (let r = 0; r < th * f; r++) {
          const src = k * ow * oh + (r + crop) * ow + crop;
          out[k].set(od.subarray(src, src + tw * f), (ty * f + r) * W + tx * f);
        }
        if (o.dispose) o.dispose();
      }
      // index on the fine grid; clouds from SCL
      const inField = fieldMask(polys, cx0, cy0, px, W, H);
      const values = new Float32Array(W * H).fill(NaN);
      const rgba = indexKey === 'rgb' ? new Uint8ClampedArray(W * H * 4) : null;
      const idx = window.Imagery.indices[indexKey];
      const keep = window.Imagery.config.keepScl;
      let fieldPx = 0, validPx = 0; const sorted = [];
      for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
        const i = r * W + c; if (!inField[i]) continue; fieldPx++;
        const si = scl.at(cx0 + (c + 0.5) * px, cy0 - (r + 0.5) * px);
        if (si < 0 || !keep.has(scl.data[si])) continue;
        const B = out[0][i] / 1e4, G = out[1][i] / 1e4, R = out[2][i] / 1e4, N = out[3][i] / 1e4;
        if (rgba) { const [cr, cg, cb] = toRGB(R, G, B); rgba.set([cr, cg, cb, 255], i * 4); values[i] = 1; validPx++; continue; }
        const v = idx.f({ red: R, nir: N });
        if (!Number.isFinite(v)) continue;
        values[i] = v; validPx++; sorted.push(v);
      }
      sorted.sort((a, b) => a - b);
      const q = (pp) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(pp * sorted.length))] : NaN);
      const fromUtm = proj4(I.utmDef(code), 'EPSG:4326');
      const sw = fromUtm.forward([cx0, cy0 - ch * 10]), ne = fromUtm.forward([cx0 + cw * 10, cy0]);
      if (onProgress) onProgress({ phase: 'run', f: 1 });
      return {
        key, field, scene, indexKey, values, inField, rgba, w: W, h: H, px, pxHa: (px * px) / 1e4, gx0: cx0, gy0: cy0, code, model: modelKey,
        bounds: [[sw[1], sw[0]], [ne[1], ne[0]]],
        fieldHa: (fieldPx * px * px) / 1e4, validHa: (validPx * px * px) / 1e4,
        cloudPct: fieldPx ? Math.round(100 * (1 - validPx / fieldPx)) : 100,
        mean: sorted.length ? sorted.reduce((s, v) => s + v, 0) / sorted.length : NaN, p02: q(0.02), p98: q(0.98),
      };
    })();
    results.set(key, p);
    p.catch(() => results.delete(key));
    return p;
  }

  window.SuperRes = { MODELS, SUPPORTED, enhance, session, toRGB, _results: results };
})();
