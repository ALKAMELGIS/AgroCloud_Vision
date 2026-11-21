/*
 * AgroSyntra One — the satellite pass on real imagery (landing hero and sign-in page).
 *
 * The same scene, steps and panel as AgroMotion.hero, but nothing is modelled:
 *  - the ground is Esri World Imagery (the workspace's basemap), tiles stitched for the area;
 *  - the fields are the centre pivots of the Texas High Plains area the live demo uses
 *    (detected in Sentinel-2 NDVI, cached by js/demo.js as agroDemoPivots:v1, found again here if missing);
 *  - the index layers come from Sentinel-2 L2A bands through Sentinel Hub (the workspace's instance),
 *    10 m pixels, with the system's formulas, ranges, ramps, SCL masking, per-field P2–P98 contrast and
 *    the ten value classes in hectares; drawn smoothly inside each pivot, as the map does.
 * Both layers are laid on the 3D ground with a triangle mesh, so the camera tilt, drift and the sweep stay.
 *
 * AgroReal.load() resolves with the data (or rejects; then the page keeps the field model).
 * AgroReal.hero(canvas, onState, opts, data) returns the same controls as AgroMotion.hero.
 */
(function () {
  'use strict';
  const M = window.AgroMotion; if (!M || !M.kit) return;
  const { camera, mount, quad, edgesFor, classOf, KEEP_SCL, ease, clamp, pct, STEP_T, SWEEP_T } = M.kit;
  const { INDICES, rampAt } = M;

  // ------------------------------------------------------------ the area (same as js/demo.js)
  const AOI = { lng: -102.322, lat: 34.116, w: 3400, h: 2300 };
  const R = 6378137, DEG = Math.PI / 180;
  const toMerc = (lng, lat) => [lng * DEG * R, Math.log(Math.tan(Math.PI / 4 + lat * DEG / 2)) * R];
  const k = 1 / Math.cos(AOI.lat * DEG);
  const [mx, my] = toMerc(AOI.lng, AOI.lat);
  const BOX = [mx - AOI.w / 2 * k, my - AOI.h / 2 * k, mx + AOI.w / 2 * k, my + AOI.h / 2 * k];
  const GW = Math.round(AOI.w / 10), GH = Math.round(AOI.h / 10);       // 10 m Sentinel-2 grid
  const HX = AOI.w / 2000, HZ = AOI.h / 2000;                          // half size in scene units (1 unit = 1 km)
  const HA_PX = 0.01;                                                 // one 10 m pixel = 0.01 ha

  const SH = { base: 'https://services.sentinel-hub.com/ogc', instance: '60de79ca-16a7-4afd-bcbd-0261bf0156fa' };
  const shUrl = (svc, p) => `${SH.base}/${svc}/${SH.instance}?` + new URLSearchParams(p).toString();
  const SCRIPT = `//VERSION=3
function setup() {
  return { input: [{ bands: ["B02", "B03", "B04", "B08", "B8A", "B11", "SCL"] }], output: { bands: 7, sampleType: "FLOAT32" } };
}
function evaluatePixel(s) { return [s.B02, s.B03, s.B04, s.B08, s.B8A, s.B11, s.SCL]; }`;
  const GEOTIFF = 'https://cdn.jsdelivr.net/npm/geotiff@2.1.3/dist-browser/geotiff.js';
  const ESRI = (z, y, x) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;

  const loadScript = (src) => new Promise((ok, no) => { if (window.GeoTIFF) return ok(); const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = no; document.head.appendChild(s); });
  const timeout = (p, ms, what) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(what + ' timed out')), ms))]);
  // the same request again within three days comes from the browser's cache (Sentinel Hub requests cost processing units)
  async function cachedFetch(url, kind) {
    let cache = null;
    try { cache = await caches.open('agro-landing-v1'); const hit = await cache.match(url); if (hit && Date.now() - Number(hit.headers.get('x-at') || 0) < 3 * 86400000) return hit; } catch { cache = null; }
    const res = await fetch(url); if (!res.ok) throw new Error(kind + ' ' + res.status);
    if (cache) { try { const body = await res.clone().arrayBuffer(); await cache.put(url, new Response(body, { headers: { 'content-type': res.headers.get('content-type') || '', 'x-at': String(Date.now()) } })); } catch { /* quota */ } }
    return res;
  }

  // ------------------------------------------------------------ loading
  async function scenes() {
    const end = new Date(), start = new Date(Date.now() - 90 * 86400000), d = (x) => x.toISOString().slice(0, 10);
    const res = await cachedFetch(shUrl('wfs', { SERVICE: 'WFS', REQUEST: 'GetFeature', VERSION: '2.0.0', TYPENAMES: 'DSS2', OUTPUTFORMAT: 'application/json', SRSNAME: 'EPSG:3857',
      BBOX: BOX.join(','), TIME: d(start) + '/' + d(end), MAXFEATURES: '100' }), 'dates');
    const byDay = new Map();
    ((await res.json()).features || []).map((f) => f.properties || {}).filter((p) => p.date).forEach((p) => {
      const c = Math.round(p.cloudCoverPercentage ?? 100); if (!byDay.has(p.date) || c < byDay.get(p.date)) byDay.set(p.date, c);
    });
    const days = [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
    const clear = days.find(([, c]) => c < 5) || days.slice().sort((a, b) => a[1] - b[1])[0];
    if (!clear) throw new Error('no Sentinel-2 dates');
    const cloudy = days.find(([day, c]) => c >= 15 && c <= 75 && day !== clear[0]) || null;
    return { days, clear, cloudy };
  }
  // the instance's L2A layer to hang the evalscript on (its names look like "3_NDVI"; "-L1C" ones are top of atmosphere)
  let layerP = null;
  function layer() {
    if (!layerP) layerP = cachedFetch(shUrl('wms', { SERVICE: 'WMS', REQUEST: 'GetCapabilities', VERSION: '1.3.0' }), 'layers').then((r) => r.text()).then((xml) => {
      const names = [...new DOMParser().parseFromString(xml, 'text/xml').getElementsByTagName('Layer')]
        .map((l) => [...l.children].find((c) => c.localName === 'Name')).filter(Boolean).map((n) => n.textContent.trim());
      return names.find((n) => /NDVI/i.test(n) && !/L1C/i.test(n)) || names.find((n) => !/L1C|SAR|ORTHO|DECIBEL|LINEAR/i.test(n)) || names[0] || 'NDVI';
    }).catch(() => '3_NDVI');
    return layerP;
  }
  async function bandsFor(day) {
    const res = await cachedFetch(shUrl('wms', { SERVICE: 'WMS', REQUEST: 'GetMap', VERSION: '1.3.0', LAYERS: await layer(), CRS: 'EPSG:3857', BBOX: BOX.join(','),
      WIDTH: String(GW), HEIGHT: String(GH), FORMAT: 'image/tiff', TIME: day + '/' + day, MAXCC: '100', SHOWLOGO: 'false', EVALSCRIPT: btoa(SCRIPT) }), 'bands');
    await loadScript(GEOTIFF);
    const img = await (await GeoTIFF.fromArrayBuffer(await res.arrayBuffer())).getImage();
    const r = await img.readRasters();
    return { blue: r[0], green: r[1], red: r[2], nir: r[3], nir08: r[4], swir16: r[5], scl: r[6] };
  }
  function basemap(z = 16) {
    const n = 2 ** z, size = 2 * Math.PI * R, px = (256 * n) / size;
    const X = (m) => (m + size / 2) * px, Y = (m) => (size / 2 - m) * px;
    const x0 = X(BOX[0]), x1 = X(BOX[2]), y0 = Y(BOX[3]), y1 = Y(BOX[1]);
    const tx0 = Math.floor(x0 / 256), tx1 = Math.floor(x1 / 256), ty0 = Math.floor(y0 / 256), ty1 = Math.floor(y1 / 256);
    const cv = document.createElement('canvas'); cv.width = Math.round(x1 - x0); cv.height = Math.round(y1 - y0);
    const ctx = cv.getContext('2d');
    const jobs = [];
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      jobs.push(new Promise((ok, no) => {
        const im = new Image(); im.decoding = 'async';
        im.onload = () => { ctx.drawImage(im, tx * 256 - x0, ty * 256 - y0); ok(); };
        im.onerror = () => no(new Error('basemap tile'));
        im.src = ESRI(z, ty, tx);
      }));
    }
    return Promise.all(jobs).then(() => cv);
  }
  // pivots: the live demo's cache, else found here in the clear NDVI (centres along gradients, as js/demo.js)
  function pivotsFrom(ndvi) {
    let cached = [];
    try {
      const c = JSON.parse(localStorage.getItem('agroDemoPivots:v1') || 'null');
      if (c && c.circles) cached = c.circles.map((p) => ({ x: (p.cx - mx) / k / 1000, z: (p.cy - my) / k / 1000, r: p.r / 1000 }));
    } catch { /* none */ }
    let found = [];
    try { found = detect(ndvi); } catch { found = []; }
    if (found.length >= Math.max(2, cached.length)) return found;
    if (cached.length >= 2) return cached;
    throw new Error('no pivots found');
  }
  function detect(ndvi) {
    const W = GW, H = GH, g = new Float32Array(W * H), mag = new Float32Array(W * H), gx = new Float32Array(W * H), gy = new Float32Array(W * H);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { let s = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) s += ndvi[(y + j) * W + x + i] || 0; g[y * W + x] = s / 9; }
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const a = (i, j) => g[(y + j) * W + x + i];
      const sx = a(1, -1) + 2 * a(1, 0) + a(1, 1) - a(-1, -1) - 2 * a(-1, 0) - a(-1, 1), sy = a(-1, 1) + 2 * a(0, 1) + a(1, 1) - a(-1, -1) - 2 * a(0, -1) - a(1, -1);
      const i = y * W + x; gx[i] = sx; gy[i] = sy; mag[i] = Math.hypot(sx, sy);
    }
    const thr = Math.max(0.12, Array.from(mag).sort((a, b) => b - a)[Math.floor(W * H * 0.12)] || 0);
    const RAD = []; for (let r = 24; r <= 58; r += 2) RAD.push(r);
    const acc = RAD.map(() => new Float32Array(W * H));
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x, m = mag[i]; if (m < thr) continue;
      RAD.forEach((r, ri) => { for (const sg of [1, -1]) { const cx = Math.round(x + sg * gx[i] / m * r), cy = Math.round(y + sg * gy[i] / m * r); if (cx >= 0 && cy >= 0 && cx < W && cy < H) acc[ri][cy * W + cx]++; } });
    }
    const cands = [];
    RAD.forEach((r, ri) => { const A = acc[ri]; for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) { let s = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) s += A[(y + j) * W + x + i]; const sc = s / (2 * Math.PI * r); if (sc > 0.28 && x - r >= 0 && y - r >= 0 && x + r < W && y + r < H) cands.push({ x, y, r, sc }); } });
    cands.sort((a, b) => b.sc - a.sc);
    const out = [];
    for (const c of cands) {
      if (out.length >= 8) break;
      if (out.some((o) => Math.hypot(o.x - c.x, o.y - c.y) < (o.r + c.r) * 0.92)) continue;
      let si = 0, ni = 0, so = 0, no = 0;   // one crop inside, something else just outside
      for (let y = Math.max(0, c.y - c.r - 6); y < Math.min(H, c.y + c.r + 6); y++) for (let x = Math.max(0, c.x - c.r - 6); x < Math.min(W, c.x + c.r + 6); x++) {
        const dd = Math.hypot(x - c.x, y - c.y), v = ndvi[y * W + x] || 0;
        if (dd < c.r * 0.85) { si += v; ni++; } else if (dd > c.r * 1.05 && dd < c.r * 1.2) { so += v; no++; }
      }
      if (!ni || !no || Math.abs(si / ni - so / no) < 0.05) continue;
      out.push(c);
    }
    return out.map((c) => ({ x: -HX + (c.x + 0.5) * 0.01, z: HZ - (c.y + 0.5) * 0.01, r: c.r * 0.01 }));
  }

  let loading = null;
  function load() {
    if (loading) return loading;
    loading = timeout((async () => {
      const sc = await scenes();
      const [img, clear, cloudy] = await Promise.all([basemap(16), bandsFor(sc.clear[0]), sc.cloudy ? bandsFor(sc.cloudy[0]).catch(() => null) : Promise.resolve(null)]);
      const ndvi = new Float32Array(GW * GH); for (let i = 0; i < ndvi.length; i++) ndvi[i] = INDICES.ndvi.f({ nir: clear.nir[i], red: clear.red[i] }) || 0;
      const pivots = pivotsFrom(ndvi);
      return { img, clear, cloudy: cloudy && sc.cloudy ? cloudy : null, days: sc.days, clearDay: sc.clear, cloudyDay: cloudy ? sc.cloudy : null, pivots };
    })(), 25000, 'satellite data');
    loading.catch(() => { loading = null; });
    return loading;
  }

  // ------------------------------------------------------------ fields and the Analytics numbers
  const fmtDay = (day) => { const t = new Date(day + 'T00:00:00Z'); return `${t.getUTCDate()} ${t.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })}'${String(t.getUTCFullYear()).slice(2)}`; };
  function prepare(data) {
    const fields = data.pivots.map((p, i) => {
      const px = [];
      for (let j = 0; j < GH; j++) for (let i2 = 0; i2 < GW; i2++) {
        const x = -HX + (i2 + 0.5) * 0.01, z = HZ - (j + 0.5) * 0.01;
        if ((x - p.x) ** 2 + (z - p.z) ** 2 <= p.r * p.r) px.push(j * GW + i2);
      }
      return { name: 'Pivot ' + (i + 1), ...p, px, ha: +(px.length * HA_PX).toFixed(2) };
    }).filter((f) => f.px.length > 50);
    fields.sort((a, b) => (Math.abs(a.z - b.z) > 0.3 ? b.z - a.z : a.x - b.x)).forEach((f, i) => { f.name = 'Pivot ' + (i + 1); });
    // the field to open: the one whose NDVI varies most (the most to read in its classes)
    const spread = (f) => { const v = f.px.map((i) => INDICES.ndvi.f({ nir: data.clear.nir[i], red: data.clear.red[i] })).filter(Number.isFinite).sort((a, b) => a - b); return pct(v, 0.9) - pct(v, 0.1); };
    const big = Math.max(...fields.map((f) => f.ha));
    const sel = fields.filter((f) => f.ha >= 0.6 * big).sort((a, b) => spread(b) - spread(a))[0];
    return { fields, sel };
  }
  function bandAt(B, i) { return { blue: B.blue[i], green: B.green[i], red: B.red[i], nir: B.nir[i], nir08: B.nir08[i], swir16: B.swir16[i] }; }
  function analyse(field, key, B) {
    const idx = INDICES[key];
    const vals = field.px.map((i) => (KEEP_SCL.has(Math.round(B.scl[i])) ? idx.f(bandAt(B, i)) : NaN));
    const ok = vals.filter(Number.isFinite).sort((a, b) => a - b);
    const edges = edgesFor(key), classes = new Array(10).fill(0);
    vals.forEach((v) => { const c = classOf(edges, v); if (c >= 0) classes[c] += HA_PX; });
    return { key, vals, edges, classes, mean: ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : NaN,
      p02: pct(ok, 0.02), p98: pct(ok, 0.98), p10: pct(ok, 0.1), p90: pct(ok, 0.9),
      cloudPct: Math.round((1 - ok.length / field.px.length) * 100), clearHa: ok.length * HA_PX };
  }

  // ------------------------------------------------------------ the index layer as a texture (smooth inside each pivot)
  const UP = 4;   // texture pixels per 10 m pixel
  function layerTexture(fields, B, key, contrast, filterField, filter, analyseOf) {
    const idx = INDICES[key];
    const small = document.createElement('canvas'); small.width = GW; small.height = GH;
    const sctx = small.getContext('2d'), im = sctx.createImageData(GW, GH), d = im.data;
    fields.forEach((f) => {
      const r = analyseOf(f, key);
      const filt = f === filterField ? filter : null;
      const [lo, hi] = contrast && !filt && Number.isFinite(r.p02) && r.p98 - r.p02 > 0.02 ? [r.p02, r.p98] : idx.range;
      f.px.forEach((i, n) => {
        // opaque inside the field (the mesh triangles overlap a hair; a see-through layer would show the seams)
        const v = r.vals[n]; let c;
        if (!Number.isFinite(v)) c = [138, 143, 150];                                   // cloud or shadow, as paint() greys it
        else if (filt && !filt.has(classOf(r.edges, v))) c = [178, 174, 164];           // outside the chosen classes
        else c = rampAt(idx.ramp, (v - lo) / (hi - lo || 1));
        d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = 255;
      });
    });
    // pixels just outside a pivot take their neighbour's colour (transparent), so smoothing does not bleed grey at the rim
    sctx.putImageData(im, 0, 0);
    const big = document.createElement('canvas'); big.width = GW * UP; big.height = GH * UP;
    const bctx = big.getContext('2d');
    bctx.save(); bctx.beginPath();
    fields.forEach((f) => { const cx = (f.x + HX) * 100 * UP, cy = (HZ - f.z) * 100 * UP; bctx.moveTo(cx + f.r * 100 * UP, cy); bctx.arc(cx, cy, f.r * 100 * UP, 0, Math.PI * 2); });
    bctx.clip(); bctx.imageSmoothingEnabled = true; bctx.imageSmoothingQuality = 'high';
    bctx.drawImage(small, 0, 0, big.width, big.height); bctx.restore();
    return big;
  }

  // ------------------------------------------------------------ an image laid on the ground in 3D (affine triangles)
  function drawGround(ctx, cam, img, N = 18, M2 = 13) {
    const W = img.width, H = img.height;
    const P = (u, v) => cam.p(-HX + u * 2 * HX, 0, HZ - v * 2 * HZ);
    const tri = (a, b, c, ua, ub, uc) => {
      // screen a,b,c ← image ua,ub,uc (pixels); grow the triangle a little so neighbours meet without seams
      const cx = (a[0] + b[0] + c[0]) / 3, cy = (a[1] + b[1] + c[1]) / 3, g = (p) => [p[0] + (p[0] - cx) * 0.02 + Math.sign(p[0] - cx) * 0.6, p[1] + (p[1] - cy) * 0.02 + Math.sign(p[1] - cy) * 0.6];
      const A = g(a), Bp = g(b), C = g(c);
      const den = (ub[0] - ua[0]) * (uc[1] - ua[1]) - (uc[0] - ua[0]) * (ub[1] - ua[1]); if (!den) return;
      const m11 = ((b[0] - a[0]) * (uc[1] - ua[1]) - (c[0] - a[0]) * (ub[1] - ua[1])) / den;
      const m12 = ((b[1] - a[1]) * (uc[1] - ua[1]) - (c[1] - a[1]) * (ub[1] - ua[1])) / den;
      const m21 = ((c[0] - a[0]) * (ub[0] - ua[0]) - (b[0] - a[0]) * (uc[0] - ua[0])) / den;
      const m22 = ((c[1] - a[1]) * (ub[0] - ua[0]) - (b[1] - a[1]) * (uc[0] - ua[0])) / den;
      const dx = a[0] - m11 * ua[0] - m21 * ua[1], dy = a[1] - m12 * ua[0] - m22 * ua[1];
      ctx.save(); ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(Bp[0], Bp[1]); ctx.lineTo(C[0], C[1]); ctx.closePath(); ctx.clip();
      ctx.setTransform(m11, m12, m21, m22, dx, dy); ctx.drawImage(img, 0, 0); ctx.restore();
    };
    for (let j = 0; j < M2; j++) for (let i = 0; i < N; i++) {
      const u0 = i / N, u1 = (i + 1) / N, v0 = j / M2, v1 = (j + 1) / M2;
      const p00 = P(u0, v0), p10 = P(u1, v0), p01 = P(u0, v1), p11 = P(u1, v1);
      tri(p00, p10, p11, [u0 * W, v0 * H], [u1 * W, v0 * H], [u1 * W, v1 * H]);
      tri(p00, p11, p01, [u0 * W, v0 * H], [u1 * W, v1 * H], [u0 * W, v1 * H]);
    }
  }

  // ------------------------------------------------------------ the scene
  function hero(canvas, onState, opts = {}, data) {
    const { fields, sel } = prepare(data);
    // six dates, newest last, always including the two the scene shows (the clear one and the cloudy one)
    const must = [data.clearDay, data.cloudyDay].filter(Boolean).map(([dd]) => dd);
    const strip = [...new Map([...data.days.filter(([dd]) => must.includes(dd)), ...data.days].map((x) => [x[0], x])).values()]
      .slice(0, 6).sort((a, b) => (a[0] < b[0] ? -1 : 1));
    const dateIxOf = (day) => Math.max(0, strip.findIndex(([dd]) => dd === day));
    const cloudy = !!data.cloudy;
    const STEPS = [
      { idx: 'natural', B: cloudy ? 'cloudy' : 'clear', label: 'Natural colour' },
      { idx: 'ndvi', B: cloudy ? 'cloudy' : 'clear', label: 'NDVI · vegetation' },
      { idx: 'ndvi', B: 'clear', label: 'NDVI · vegetation' },
      { idx: 'ndmi', B: 'clear', label: 'NDMI · water content' },
      { idx: 'ndwi', B: 'clear', label: 'NDWI · surface water' },
      { idx: 'bsi', B: 'clear', label: 'BSI · bare soil' },
    ];
    const dayOf = (s) => (s.B === 'cloudy' ? data.cloudyDay : data.clearDay)[0];
    const state = { forced: null, key: null, filter: null, contrast: true, lastStep: -1 };
    const ares = new Map(), tex = new Map();
    const res = (f, key, which) => { const kk = f.name + key + which; if (!ares.has(kk)) ares.set(kk, analyse(f, key, data[which])); return ares.get(kk); };
    const texture = (s) => {
      const key = state.key || (s.idx === 'natural' ? null : s.idx); if (!key) return null;
      const kk = [key, s.B, state.contrast, state.filter ? [...state.filter].join('.') : ''].join('|');
      if (!tex.has(kk)) { if (tex.size > 12) tex.clear(); tex.set(kk, layerTexture(fields, data[s.B], key, state.contrast, sel, state.filter, (f, kx) => res(f, kx, s.B))); }
      return tex.get(kk);
    };
    // where the cloud is on the cloudy date (centre of SCL 8/9/10 pixels), for the puffs above it
    let cloudC = null;
    if (cloudy) {
      let sx = 0, sz = 0, n = 0;
      for (let i = 0; i < GW * GH; i++) { const c = Math.round(data.cloudy.scl[i]); if (c >= 8 && c <= 10) { sx += -HX + ((i % GW) + 0.5) * 0.01; sz += HZ - (Math.floor(i / GW) + 0.5) * 0.01; n++; } }
      if (n > 30) cloudC = { x: sx / n, z: sz / n, share: n / (GW * GH) };
    }
    const report = (i) => {
      const s = STEPS[i]; const key = state.key || (s.idx === 'natural' ? 'ndvi' : s.idx);
      const r = res(sel, key, s.B); const idx = INDICES[key];
      const [lo, hi] = state.contrast && !state.filter && r.p98 - r.p02 > 0.02 ? [r.p02, r.p98] : idx.range;
      onState && onState({
        step: i, label: state.key ? idx.label + ' · ' + idx.name.toLowerCase() : s.label, natural: s.idx === 'natural' && !state.key,
        key, indexLabel: idx.label, dateIx: dateIxOf(dayOf(s)), dates: strip.map(([dd, c]) => [fmtDay(dd), c]), field: sel.name, ha: sel.ha,
        mean: r.mean, p10: r.p10, p90: r.p90, cloudPct: r.cloudPct, clearHa: r.clearHa,
        rows: r.classes.map((ha, c) => ({ c, from: r.edges[c], to: r.edges[c + 1], ha, color: rampAt(idx.ramp, (c + 0.5) / 10) })),
        lo, hi, contrast: state.contrast && !state.filter, filter: state.filter ? [...state.filter] : [],
        legend: Array.from({ length: 10 }, (_, c) => rampAt(idx.ramp, (c + 0.5) / 10)), real: true, day: dayOf(s),
      });
    };
    const m = mount(canvas, (ctx, st) => {
      const W = st.W, H = st.H, total = STEPS.length * STEP_T;
      const tt = state.forced !== null ? state.forced * STEP_T + SWEEP_T + 0.6 : st.t % total;
      const i = Math.floor(tt / STEP_T) % STEPS.length, local = tt - i * STEP_T;
      if (i !== state.lastStep) { state.lastStep = i; report(i); }
      const cur = STEPS[i], prev = STEPS[(i + STEPS.length - 1) % STEPS.length];
      const sweep = state.forced !== null ? 1 : clamp(local / SWEEP_T, 0, 1), sx = -HX + ease(sweep) * 2 * HX;
      const cam = camera(W, H, st.yaw, st.pitch, Math.min(W, H * 1.7) * 0.36 * (opts.zoom || 1), H * (opts.cy || 0.54));
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      drawGround(ctx, cam, data.img);
      // the index layer: this step left of the swath, the previous step right of it
      const half = (from, to) => { ctx.beginPath(); quad(ctx, cam.p(from, 0, -HZ), cam.p(to, 0, -HZ), cam.p(to, 0, HZ), cam.p(from, 0, HZ)); };
      const tCur = texture(cur), tPrev = sweep < 1 ? texture(prev) : null;
      if (tCur) { ctx.save(); half(-HX, sx); ctx.clip(); drawGround(ctx, cam, tCur, 14, 10); ctx.restore(); }
      if (tPrev) { ctx.save(); half(sx, HX); ctx.clip(); drawGround(ctx, cam, tPrev, 14, 10); ctx.restore(); }
      // field outlines (the open field in white)
      fields.forEach((f) => {
        ctx.beginPath();
        for (let q = 0; q <= 72; q++) { const a = q / 72 * Math.PI * 2; const p = cam.p(f.x + Math.cos(a) * f.r, 0.002, f.z + Math.sin(a) * f.r); q ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); }
        ctx.strokeStyle = f === sel ? '#ffffff' : 'rgba(34,197,94,.95)'; ctx.lineWidth = (f === sel ? 2.6 : 1.6) * st.dpr; ctx.stroke();
      });
      if (sweep < 1) {
        const a = cam.p(sx, 0.004, -HZ), b = cam.p(sx, 0.004, HZ), a2 = cam.p(sx - 0.25, 0.004, -HZ), b2 = cam.p(sx - 0.25, 0.004, HZ);
        const g = ctx.createLinearGradient(a2[0], 0, a[0], 0); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,255,255,.22)');
        ctx.beginPath(); quad(ctx, a2, a, b, b2); ctx.fillStyle = g; ctx.fill();
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 * st.dpr; ctx.stroke();
      }
      // the real cloud of the cloudy date, above where Sentinel-2 saw it; it lifts on the next (clear) date
      const fade = cur.B === 'cloudy' ? 1 : prev.B === 'cloudy' && state.forced === null ? 1 - clamp(local / 1.6, 0, 1) : 0;
      if (cloudC && fade > 0.01) {
        const rise = (1 - fade) * 0.5, base = Math.min(W, H * 1.7) * 0.36 * (opts.zoom || 1) * clamp(Math.sqrt(cloudC.share) * 1.6, 0.25, 0.9);
        [[0, 0, 0.2], [0.14, 0.05, 0.16], [-0.15, 0.02, 0.15], [0.05, -0.12, 0.15], [-0.06, 0.13, 0.13], [0.2, -0.08, 0.11]].forEach(([ox, oz, r], q) => {
          const p = cam.p(cloudC.x + ox + rise * 0.3 * (q % 2 ? 1 : -1), 0.32 + rise, cloudC.z + oz), rr = r * base * (1 + rise * 0.6);
          const gr = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], rr);
          gr.addColorStop(0, `rgba(255,255,255,${0.85 * fade})`); gr.addColorStop(0.6, `rgba(250,250,248,${0.45 * fade})`); gr.addColorStop(1, 'rgba(250,250,248,0)');
          ctx.fillStyle = gr; ctx.beginPath(); ctx.ellipse(p[0], p[1], rr, rr * 0.62, 0, 0, Math.PI * 2); ctx.fill();
        });
      }
    }, opts);
    return {
      stop: m.stop, steps: STEPS, real: true,
      show(i) { state.forced = i === null ? null : clamp(i, 0, STEPS.length - 1); state.lastStep = -1; },
      setIndex(kx) { state.key = INDICES[kx] ? kx : null; state.filter = null; if (state.key && state.forced === null) state.forced = 2; state.lastStep = -1; },
      toggleClass(c) { const f = new Set(state.filter || []); f.has(c) ? f.delete(c) : f.add(c); state.filter = f.size ? f : null; if (state.forced === null) state.forced = Math.max(2, state.lastStep); state.lastStep = -1; },
      setContrast(on) { state.contrast = on; state.lastStep = -1; },
    };
  }

  window.AgroReal = { load, hero, AOI };
})();
