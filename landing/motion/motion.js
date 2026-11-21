/*
 * AgroSyntra One — motion engine for the landing scenes (canvas 2D, no libraries).
 *
 * The analysis is the system's own (js/imagery.js, js/ts-calendar.js), line for line:
 *  - pixels carry Sentinel-2 L2A reflectances (B02 B03 B04 B05 B08 B11) and an SCL class;
 *  - NDVI, NDMI, NDWI and BSI use the same formulas, value ranges and colour ramps;
 *  - SCL 3, 8, 9, 10 (shadow, cloud, cirrus) are masked and drawn grey, cloud % is per field;
 *  - contrast stretches each field between its own P2 and P98; classes are the ten equal
 *    steps of the index range, in hectares; P10 / P90 as in the Analytics tab;
 *  - the season: one value per clear date (≥ 30 % of the field clear), days between two
 *    clear dates interpolated and drawn muted, colours from the period's low to high.
 * The canvas cannot reach the satellite, so the reflectances come from a field model
 * (vegetation cover, moisture, a reservoir, a drifting cloud). The live site runs the
 * same steps on real images (workspace.html?demo).
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------- ramps (copied from js/imagery.js)
  const RDYLGN = [[0, [165, 0, 38]], [0.1, [215, 48, 39]], [0.2, [244, 109, 67]], [0.3, [253, 174, 97]], [0.4, [254, 224, 139]],
    [0.5, [255, 255, 191]], [0.6, [217, 239, 139]], [0.7, [166, 217, 106]], [0.8, [102, 189, 99]], [0.9, [26, 152, 80]], [1, [0, 104, 55]]];
  const MOIST = [[0, [140, 81, 10]], [0.25, [216, 179, 101]], [0.45, [246, 232, 195]], [0.6, [199, 234, 229]], [0.8, [90, 180, 172]], [1, [1, 102, 94]]];
  const WATER = [[0, [140, 106, 67]], [0.35, [217, 201, 163]], [0.5, [242, 239, 232]], [0.7, [127, 178, 214]], [1, [31, 95, 158]]];
  const SOIL = [[0, [47, 93, 52]], [0.3, [143, 163, 91]], [0.5, [232, 220, 192]], [0.75, [196, 154, 108]], [1, [122, 75, 42]]];
  function rampAt(ramp, t) {
    t = Math.max(0, Math.min(1, t));
    for (let i = 1; i < ramp.length; i++) {
      const [a, ca] = ramp[i - 1], [b, cb] = ramp[i];
      if (t <= b) { const f = (t - a) / (b - a || 1); return [0, 1, 2].map((k) => Math.round(ca[k] + (cb[k] - ca[k]) * f)); }
    }
    return ramp[ramp.length - 1][1].slice();
  }
  const nd = (a, b) => (a + b > 0 ? (a - b) / (a + b) : NaN);
  const INDICES = {
    ndvi: { label: 'NDVI', name: 'Vegetation', f: (b) => nd(b.nir, b.red), range: [0, 1], ramp: RDYLGN },
    ndmi: { label: 'NDMI', name: 'Water content', f: (b) => nd(b.nir08, b.swir16), range: [-0.4, 0.6], ramp: MOIST },
    ndwi: { label: 'NDWI', name: 'Surface water', f: (b) => nd(b.green, b.nir), range: [-0.6, 0.4], ramp: WATER },
    bsi: { label: 'BSI', name: 'Bare soil', f: (b) => nd(b.swir16 + b.red, b.nir + b.blue), range: [-0.4, 0.4], ramp: SOIL },
  };
  const KEEP_SCL = new Set([4, 5, 6, 7]);
  const edgesFor = (k) => { const [lo, hi] = INDICES[k].range; return Array.from({ length: 11 }, (_, i) => lo + ((hi - lo) * i) / 10); };
  const classOf = (edges, v) => { if (!Number.isFinite(v)) return -1; for (let k = 0; k < 10; k++) if (v < edges[k + 1]) return k; return 9; };

  // ---------------------------------------------------------------- noise and helpers
  function hash(x, y, s) { const n = Math.sin(x * 12.9898 + y * 78.233 + s * 37.719) * 43758.5453; return n - Math.floor(n); }
  function vnoise(x, y, s) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const css = (c, k = 1, a) => (a == null ? `rgb(${Math.round(c[0] * k)},${Math.round(c[1] * k)},${Math.round(c[2] * k)})` : `rgba(${Math.round(c[0] * k)},${Math.round(c[1] * k)},${Math.round(c[2] * k)},${a})`);
  const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))];

  // ---------------------------------------------------------------- reflectance model (L2A surface reflectance)
  // endmembers: dry soil, green canopy, open water; canopy short-wave infrared rises as it dries
  const SOILR = { blue: 0.11, green: 0.15, red: 0.21, rededge1: 0.24, nir: 0.29, nir08: 0.30, swir16: 0.37 };
  const VEGR = { blue: 0.03, green: 0.07, red: 0.03, rededge1: 0.12, nir: 0.5, nir08: 0.51, swir16: 0.16 };
  const WATR = { blue: 0.07, green: 0.08, red: 0.05, rededge1: 0.04, nir: 0.03, nir08: 0.03, swir16: 0.015 };
  function bands(fv, moist, water) {
    const o = {};
    for (const k in SOILR) {
      let v = SOILR[k] * (1 - fv) + VEGR[k] * fv;
      if (k === 'swir16') v += (1 - moist) * 0.1 * fv;
      o[k] = water ? WATR[k] : v;
    }
    return o;
  }

  // ---------------------------------------------------------------- camera (yaw about the vertical, then pitch)
  function camera(W, H, yaw, pitch, scale, cy) {
    const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), f = 4.2;
    return {
      p(x, y, z) { const x1 = x * cyw - z * syw, z1 = x * syw + z * cyw; const y2 = y * cp + z1 * sp, d = z1 * cp - y * sp; const s = f / (f + d); return [W / 2 + x1 * s * scale, cy - y2 * s * scale, d]; },
      depth(x, y, z) { return (x * syw + z * cyw) * cp - y * sp; },
      faces(nx, nz) { return nx * syw + nz * cyw < 0; },
    };
  }
  function quad(ctx, a, b, c, d) { ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(d[0], d[1]); ctx.closePath(); }
  function box(ctx, cam, x, z, s, h, rgb, alpha, y0 = 0) {
    const hs = s / 2; h += y0;
    if (h - y0 > 0.003) {
      for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (!cam.faces(nx, nz)) continue;
        const a = nx ? [x + nx * hs, z - hs] : [x - hs, z + nz * hs], b = nx ? [x + nx * hs, z + hs] : [x + hs, z + nz * hs];
        ctx.beginPath(); quad(ctx, cam.p(a[0], y0, a[1]), cam.p(b[0], y0, b[1]), cam.p(b[0], h, b[1]), cam.p(a[0], h, a[1]));
        ctx.fillStyle = css(rgb, nx ? 0.74 : 0.86, alpha); ctx.fill();
      }
    }
    ctx.beginPath(); quad(ctx, cam.p(x - hs, h, z - hs), cam.p(x + hs, h, z - hs), cam.p(x + hs, h, z + hs), cam.p(x - hs, h, z + hs));
    ctx.fillStyle = css(rgb, 1, alpha); ctx.fill();
  }

  // ---------------------------------------------------------------- the farm: pixels of 10 m (0.05 units)
  const PX = 0.05, HA_PX = 0.01; // one pixel = 10 m × 10 m = 0.01 ha
  const healthy = (b) => (dx, dz) => b - 0.07 * Math.hypot(dx, dz);
  const wedge = (b, from, to, low) => (dx, dz) => {
    const a = (Math.atan2(dz, dx) * 180 / Math.PI + 360) % 360, d = Math.hypot(dx, dz);
    const inside = from < to ? a >= from && a <= to : a >= from || a <= to;
    return inside && d > 0.3 ? low + 0.1 * (1 - d) : b - 0.05 * d;
  };
  function pivot(name, cx, cz, r, seed, cover, moistBias = 0) {
    const px = [];
    for (let z = cz - r; z <= cz + r + 1e-9; z += PX) for (let x = cx - r; x <= cx + r + 1e-9; x += PX) {
      const dx = (x - cx) / r, dz = (z - cz) / r; if (dx * dx + dz * dz > 1) continue;
      const fv = clamp(cover(dx, dz) + (vnoise(x * 9, z * 9, seed) - 0.5) * 0.16 + (hash(x, z, seed) - 0.5) * 0.04, 0.02, 0.97);
      const moist = clamp(0.35 + 0.6 * fv + moistBias + (vnoise(x * 5, z * 5, seed + 3) - 0.5) * 0.2, 0, 1);
      px.push({ x, z, fv, moist, water: false });
    }
    return { name, cx, cz, r, px, ha: +(px.length * HA_PX * 25).toFixed(2) };   // drawn at 1:5, areas at true scale
  }
  function farm() {
    const f = [
      pivot('Pivot 1', -1.05, 0.48, 0.44, 3, healthy(0.82)),
      pivot('Pivot 2', 0, 0.48, 0.44, 7, wedge(0.8, 300, 25, 0.3), -0.05),
      pivot('Pivot 3', 1.05, 0.48, 0.44, 11, healthy(0.62)),
      pivot('Pivot 4', -1.05, -0.5, 0.44, 5, healthy(0.74)),
      pivot('Pivot 5', 0, -0.5, 0.44, 13, (dx) => 0.5 + 0.24 * dx),
    ];
    const pond = { name: 'Reservoir', px: [] };
    for (let z = 0.06; z <= 0.24; z += PX) for (let x = 0.6; x <= 0.95; x += PX) pond.px.push({ x, z, fv: 0, moist: 1, water: true });
    const block = { name: 'Fodder block', px: [] };
    for (let z = -0.88; z <= -0.12; z += PX) for (let x = 0.68; x <= 1.5; x += PX) {
      const fv = clamp(0.66 + (vnoise(x * 7, z * 7, 17) - 0.5) * 0.26, 0, 1); block.px.push({ x, z, fv, moist: clamp(0.4 + 0.5 * fv, 0, 1), water: false });
    }
    return { pivots: f, others: [pond, block] };
  }

  /** The Analytics tab for one field: as js/imagery.js analyse() + paint(), over the model's pixels. */
  function analyse(field, key, sclOf) {
    const idx = INDICES[key];
    const vals = field.px.map((p) => { const scl = sclOf ? sclOf(p) : 4; if (!KEEP_SCL.has(scl)) return NaN; return idx.f(bands(p.fv, p.moist, p.water)); });
    const ok = vals.filter(Number.isFinite).sort((a, b) => a - b);
    const edges = edgesFor(key), haPx = field.ha / field.px.length;
    const classes = new Array(10).fill(0);
    vals.forEach((v) => { const c = classOf(edges, v); if (c >= 0) classes[c] += haPx; });
    return {
      key, vals, edges, classes, n: ok.length,
      mean: ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : NaN,
      p02: pct(ok, 0.02), p98: pct(ok, 0.98), p10: pct(ok, 0.1), p90: pct(ok, 0.9),
      cloudPct: Math.round((1 - ok.length / field.px.length) * 100), clearHa: ok.length * haPx,
    };
  }
  function colourer(res, contrast, filter) {
    const idx = INDICES[res.key];
    const [lo, hi] = contrast && !filter && Number.isFinite(res.p02) ? [res.p02, res.p98] : idx.range;
    return (v) => {
      if (!Number.isFinite(v)) return { rgb: [120, 126, 135], a: 0.59 };                      // cloud, as paint()
      if (filter && !filter.has(classOf(res.edges, v))) return { rgb: [150, 150, 146], a: 0.27 };
      return { rgb: rampAt(idx.ramp, (v - lo) / (hi - lo || 1)), a: 0.94 };
    };
  }

  // ---------------------------------------------------------------- canvas plumbing: drag, visibility, reduced motion
  function mount(canvas, draw, opts = {}) {
    const ctx = canvas.getContext('2d');
    const reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const st = { yaw: opts.yaw ?? -0.42, pitch: opts.pitch ?? 0.92, drag: null, vis: true, W: 1, H: 1, dpr: 1, t: 0, last: 0, drift: opts.drift ?? 0.025 };
    const size = () => { st.dpr = Math.min(2, window.devicePixelRatio || 1); st.W = Math.max(1, Math.round(canvas.clientWidth * st.dpr)); st.H = Math.max(1, Math.round(canvas.clientHeight * st.dpr)); canvas.width = st.W; canvas.height = st.H; };
    size();
    const ro = window.ResizeObserver ? new ResizeObserver(size) : null; if (ro) ro.observe(canvas);
    const io = window.IntersectionObserver ? new IntersectionObserver((es) => { st.vis = es.some((e) => e.isIntersecting); }) : null; if (io) io.observe(canvas);
    canvas.addEventListener('pointerdown', (e) => { st.drag = { x: e.clientX, y: e.clientY, yaw: st.yaw, pitch: st.pitch }; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => { if (!st.drag) return; st.yaw = st.drag.yaw + (e.clientX - st.drag.x) * 0.006; st.pitch = clamp(st.drag.pitch + (e.clientY - st.drag.y) * 0.004, 0.4, 1.4); });
    const up = () => { st.drag = null; }; canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('dblclick', () => { st.yaw = opts.yaw ?? -0.42; st.pitch = opts.pitch ?? 0.92; });
    let raf = 0;
    const loop = (now) => {
      raf = requestAnimationFrame(loop);
      const dt = st.last ? Math.min(0.05, (now - st.last) / 1000) : 0.016; st.last = now;
      if (!st.vis) return;
      if (!reduced) st.t += dt;
      if (!st.drag && !reduced) st.yaw += dt * st.drift;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, st.W, st.H);
      draw(ctx, st, dt, reduced);
    };
    raf = requestAnimationFrame(loop);
    return { st, reduced, stop() { cancelAnimationFrame(raf); if (ro) ro.disconnect(); if (io) io.disconnect(); } };
  }

  // ---------------------------------------------------------------- scene 1: the satellite pass
  const DATES = [['21 Oct\'26', 4], ['26 Oct\'26', 61], ['31 Oct\'26', 0], ['5 Nov\'26', 2], ['10 Nov\'26', 18], ['15 Nov\'26', 0]];
  const STEPS = [
    { idx: 'natural', date: 4, label: 'Natural colour', cloud: true },
    { idx: 'ndvi', date: 4, label: 'NDVI · vegetation', cloud: true },
    { idx: 'ndvi', date: 5, label: 'NDVI · vegetation', cloud: false },
    { idx: 'ndmi', date: 5, label: 'NDMI · water content', cloud: false },
    { idx: 'ndwi', date: 5, label: 'NDWI · surface water', cloud: false },
    { idx: 'bsi', date: 5, label: 'BSI · bare soil', cloud: false },
  ];
  const STEP_T = 4.4, SWEEP_T = 2.4;
  function hero(canvas, onState, opts = {}) {
    const F = farm();
    const sel = F.pivots[1];
    const cloudC = { x: 0.1, z: 0.6, r: 0.21 }, shadowOff = { x: -0.12, z: -0.1 };
    const sclOf = (cloudy) => (p) => {
      if (!cloudy) return 4;
      if (Math.hypot(p.x - cloudC.x, (p.z - cloudC.z) * 1.25) < cloudC.r) return 9;                               // cloud
      if (Math.hypot(p.x - cloudC.x - shadowOff.x, (p.z - cloudC.z - shadowOff.z) * 1.25) < cloudC.r * 0.8) return 3; // its shadow
      return 4;
    };
    const fields = [...F.pivots, ...F.others];
    const all = []; fields.forEach((f) => f.px.forEach((p) => { p.f = f; all.push(p); }));
    const state = { forced: null, key: null, filter: null, contrast: true, lastStep: -1 };
    const cache = new Map();
    const res = (f, key, cloudy) => { const k = f.name + key + cloudy; if (!cache.has(k)) cache.set(k, analyse(f, key, sclOf(cloudy))); return cache.get(k); };
    const report = (i) => {
      const s = STEPS[i]; const key = state.key || (s.idx === 'natural' ? 'ndvi' : s.idx);
      const r = res(sel, key, s.cloud); const idx = INDICES[key];
      const [lo, hi] = state.contrast && !state.filter ? [r.p02, r.p98] : idx.range;
      onState && onState({
        step: i, label: state.key ? idx.label + ' · ' + idx.name.toLowerCase() : s.label, natural: s.idx === 'natural' && !state.key,
        key, indexLabel: idx.label, dateIx: s.date, dates: DATES, field: sel.name, ha: sel.ha,
        mean: r.mean, p10: r.p10, p90: r.p90, cloudPct: r.cloudPct, clearHa: r.clearHa,
        rows: r.classes.map((ha, c) => ({ c, from: r.edges[c], to: r.edges[c + 1], ha, color: rampAt(idx.ramp, (c + 0.5) / 10) })),
        lo, hi, contrast: state.contrast && !state.filter, filter: state.filter ? [...state.filter] : [],
        legend: Array.from({ length: 10 }, (_, c) => rampAt(idx.ramp, (c + 0.5) / 10)),
      });
    };
    const m = mount(canvas, (ctx, st) => {
      const W = st.W, H = st.H, total = STEPS.length * STEP_T;
      const tt = state.forced !== null ? state.forced * STEP_T + SWEEP_T + 0.6 : st.t % total;
      const i = Math.floor(tt / STEP_T) % STEPS.length, local = tt - i * STEP_T;
      if (i !== state.lastStep) { state.lastStep = i; report(i); }
      const cur = STEPS[i], prev = STEPS[(i + STEPS.length - 1) % STEPS.length];
      const sweep = state.forced !== null ? 1 : clamp(local / SWEEP_T, 0, 1), sx = -1.75 + ease(sweep) * 3.5;
      const cam = camera(W, H, st.yaw, st.pitch, Math.min(W, H * 1.7) * 0.36 * (opts.zoom || 1), H * (opts.cy || 0.54));
      ctx.beginPath(); quad(ctx, cam.p(-1.75, 0, -1.05), cam.p(1.75, 0, -1.05), cam.p(1.75, 0, 1.05), cam.p(-1.75, 0, 1.05)); ctx.fillStyle = '#d9cca9'; ctx.fill();
      ctx.strokeStyle = 'rgba(236,227,204,.9)'; ctx.lineWidth = 3 * st.dpr;
      [[-0.52, -1.05, -0.52, 1.05], [0.52, -1.05, 0.52, 1.05], [-1.75, -0.02, 1.75, -0.02]].forEach(([a, b, c, d]) => { const p = cam.p(a, 0, b), q = cam.p(c, 0, d); ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke(); });
      // colour every pixel the way the map does for its step (left of the swath: this step; right: the previous one)
      const painter = (s) => {
        const key = state.key || (s.idx === 'natural' ? null : s.idx);
        if (!key) return (p) => { const b = bands(p.fv, p.moist, p.water); const scl = sclOf(s.cloud)(p); let c = [b.red * 2.5 * 255, b.green * 2.5 * 255, b.blue * 2.5 * 255].map((v) => Math.min(255, v)); if (scl === 9) c = mixc(c, [250, 250, 248], 0.75); if (scl === 3) c = mixc(c, [70, 68, 62], 0.35); return { rgb: c, a: 1 }; };
        const byField = new Map();
        return (p) => {
          if (!byField.has(p.f)) { const r = res(p.f, key, s.cloud); byField.set(p.f, { r, col: colourer(r, state.contrast, p.f === sel ? state.filter : null), ix: new Map(p.f.px.map((q, j) => [q, j])) }); }
          const o = byField.get(p.f); return o.col(o.r.vals[o.ix.get(p)]);
        };
      };
      const paintCur = painter(cur), paintPrev = painter(prev);
      const order = all.map((p) => [cam.depth(p.x, 0, p.z), p]).sort((a, b) => b[0] - a[0]);
      for (const [, p] of order) {
        const c = (p.x > sx ? paintPrev : paintCur)(p);
        let rgb = mixc([217, 204, 169], c.rgb, c.a);
        const near = Math.abs(p.x - sx); if (sweep < 1 && near < 0.08) rgb = mixc(rgb, [255, 255, 255], 0.35 * (1 - near / 0.08));
        box(ctx, cam, p.x, p.z, PX, 0, rgb);
      }
      F.pivots.forEach((f) => {
        ctx.beginPath();
        for (let k = 0; k <= 64; k++) { const a = k / 64 * Math.PI * 2; const q = cam.p(f.cx + Math.cos(a) * (f.r + 0.01), 0.002, f.cz + Math.sin(a) * (f.r + 0.01)); k ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }
        ctx.strokeStyle = f === sel ? '#ffffff' : 'rgba(34,197,94,.9)'; ctx.lineWidth = (f === sel ? 2.6 : 1.4) * st.dpr; ctx.stroke();
      });
      if (sweep < 1) {
        const a = cam.p(sx, 0.004, -1.05), b = cam.p(sx, 0.004, 1.05), a2 = cam.p(sx - 0.25, 0.004, -1.05), b2 = cam.p(sx - 0.25, 0.004, 1.05);
        const g = ctx.createLinearGradient(a2[0], 0, a[0], 0); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,255,255,.26)');
        ctx.beginPath(); quad(ctx, a2, a, b, b2); ctx.fillStyle = g; ctx.fill();
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 * st.dpr; ctx.stroke();
      }
      // the cloud above: soft puffs; on the next clear date it lifts and thins out
      const fade = cur.cloud ? 1 : prev.cloud && state.forced === null ? 1 - clamp(local / 1.6, 0, 1) : 0;
      if (fade > 0.01) {
        const rise = (1 - fade) * 0.5, base = Math.min(W, H * 1.7) * 0.36;
        [[0, 0, 0.2], [0.14, 0.05, 0.16], [-0.15, 0.02, 0.15], [0.05, -0.12, 0.15], [-0.06, 0.13, 0.13], [0.2, -0.08, 0.11]].forEach(([ox, oz, r], k) => {
          const q = cam.p(cloudC.x + ox + rise * 0.3 * (k % 2 ? 1 : -1), 0.32 + rise, cloudC.z + oz), rr = r * base * (1 + rise * 0.6);
          const gr = ctx.createRadialGradient(q[0], q[1], 0, q[0], q[1], rr);
          gr.addColorStop(0, `rgba(255,255,255,${0.9 * fade})`); gr.addColorStop(0.6, `rgba(250,250,248,${0.5 * fade})`); gr.addColorStop(1, 'rgba(250,250,248,0)');
          ctx.fillStyle = gr; ctx.beginPath(); ctx.ellipse(q[0], q[1], rr, rr * 0.62, 0, 0, Math.PI * 2); ctx.fill();
        });
      }
    }, opts);
    return {
      stop: m.stop, steps: STEPS,
      show(i) { state.forced = i === null ? null : clamp(i, 0, STEPS.length - 1); state.lastStep = -1; },
      setIndex(k) { state.key = INDICES[k] ? k : null; state.filter = null; if (state.key && state.forced === null) state.forced = 2; state.lastStep = -1; },
      toggleClass(c) { const f = new Set(state.filter || []); f.has(c) ? f.delete(c) : f.add(c); state.filter = f.size ? f : null; if (state.forced === null) state.forced = Math.max(2, state.lastStep); state.lastStep = -1; },
      setContrast(on) { state.contrast = on; state.lastStep = -1; },
    };
  }

  // ---------------------------------------------------------------- scene 2: the season, as js/ts-calendar.js builds it
  const DAY = 86400000;
  function season(field) {
    // one year of Sentinel-2 passes, every 5 days; a summer crop (planted late April, peak July, cut September)
    const end = Date.UTC(2026, 10, 18), start = end - 365 * DAY;
    const cover = (t) => { const d = (t - Date.UTC(2026, 3, 20)) / DAY; const crop = d < 0 ? 0 : d < 75 ? d / 75 : d < 130 ? 1 : d < 160 ? 1 - (d - 130) / 30 : 0; return 0.12 + 0.76 * crop + 0.08 * Math.sin((t - start) / DAY / 58); };
    const pts = [];
    for (let t = start + 2 * DAY, i = 0; t <= end; t += 5 * DAY, i++) {
      const cloud = hash(i, 3, 11); if (cloud > 0.72) continue;                       // ≥ 30 % of the field clear
      const fvMean = cover(t);
      const vals = field.px.map((p) => INDICES.ndvi.f(bands(clamp(fvMean + (p.fv - 0.65) * 0.5 * Math.min(1, fvMean / 0.4), 0.02, 0.97), p.moist, p.water)));
      const ok = vals.filter(Number.isFinite);
      pts.push({ t, v: ok.reduce((a, b) => a + b, 0) / ok.length, cloud: Math.round(cloud * 40) });
    }
    // days: week columns, weekday rows (Mon first); between clear dates linear, marked estimated
    const dow = (t) => (new Date(t).getUTCDay() + 6) % 7, s0 = start - dow(start) * DAY;
    const cells = []; let j = 0;
    for (let t = start; t <= end; t += DAY) {
      while (j < pts.length && pts[j].t < t) j++;
      const at = pts[j] && Math.abs(pts[j].t - t) < DAY / 2 ? pts[j] : null, prev = at ? null : pts[j - 1], next = at ? null : pts[j];
      let v = null, est = false;
      if (at) v = at.v; else if (prev && next) { v = prev.v + ((next.v - prev.v) * (t - prev.t)) / (next.t - prev.t); est = true; }
      cells.push({ t, col: Math.floor((t - s0) / (7 * DAY)), row: dow(t), v, est, m: at });
    }
    const vs = cells.filter((c) => c.v != null).map((c) => c.v), lo = Math.min(...vs), hi = Math.max(...vs);
    const BASE = [238, 236, 231];   // the light theme's empty day (--cell-empty)
    cells.forEach((c) => { if (c.v == null) { c.rgb = BASE; c.n = 0; return; } c.n = (c.v - lo) / (hi - lo); const col = rampAt(RDYLGN, c.n); c.rgb = c.est ? mixc(col, BASE, 0.45) : col; });
    const peak = pts.reduce((a, b) => (b.v > a.v ? b : a)), low = pts.reduce((a, b) => (b.v < a.v ? b : a)), last = pts[pts.length - 1], prevPt = pts[pts.length - 2];
    return { pts, cells, lo, hi, weeks: cells[cells.length - 1].col + 1, stats: { avg: pts.reduce((a, b) => a + b.v, 0) / pts.length, peak, low, last, change: last.v - prevPt.v, n: pts.length } };
  }
  const ACT_T = 5;
  function stats(canvas, onState) {
    const field = pivot('Pivot 2', 0, 0, 0.62, 7, wedge(0.8, 300, 25, 0.3), -0.05);
    field.ha = pivot('Pivot 2', 0, 0.48, 0.44, 7, wedge(0.8, 300, 25, 0.3), -0.05).ha;   // the same pivot as scene 1, drawn larger
    const a = analyse(field, 'ndvi');
    const S = season(field);
    const col = colourer(a, true, null);
    field.px.forEach((p, i) => { p.v = a.vals[i]; p.c = classOf(a.edges, p.v); p.rgb = col(p.v).rgb; });
    // classes: ten stacks, one per tenth of the NDVI range
    const byC = Array.from({ length: 10 }, () => []);
    field.px.forEach((p) => byC[p.c].push(p));
    // four by four cubes a layer, layers rising, so each stack's height is its hectares
    byC.forEach((list, k) => list.forEach((p, j) => { p.hx = -1.08 + k * 0.24 + ((j % 4) - 1.5) * 0.054; p.hz = 0.08 - (Math.floor(j / 4) % 4) * 0.054; p.hy = Math.floor(j / 16) * 0.046; }));
    // skyline and ring: one column per day
    const cs = 2.2 / S.weeks;
    S.cells.forEach((c) => {
      c.sx = -1.1 + (c.col + 0.5) * cs; c.sz = -0.24 + c.row * 0.08;
      const ang = (c.col / S.weeks) * Math.PI * 2 - Math.PI / 2, rad = 0.44 + c.row * 0.085;
      c.rx = Math.cos(ang) * rad; c.rz = Math.sin(ang) * rad;
    });
    const ACTS = ['Pixels', 'Classes', 'Skyline', 'Ring'];
    const st0 = { forced: null, lastAct: -1 };
    const m = mount(canvas, (ctx, st, dt, reduced) => {
      const W = st.W, H = st.H;
      const T = st0.forced !== null ? st0.forced * ACT_T + ACT_T * 0.95 : reduced ? ACT_T * 0.95 : st.t % (ACT_T * 4);
      const act = Math.floor(T / ACT_T) % 4, local = (T - act * ACT_T) / ACT_T;
      if (act !== st0.lastAct) { st0.lastAct = act; onState && onState({ act, name: ACTS[act], field: field.name, ha: field.ha, pixels: field.px.length, a, season: S }); }
      const k = ease(clamp(local / 0.55, 0, 1));
      const cam = camera(W, H, st.yaw, st.pitch, Math.min(W, H * 1.5) * 0.48, H * 0.58);
      ctx.beginPath(); for (let i = 0; i <= 72; i++) { const an = i / 72 * Math.PI * 2; const q = cam.p(Math.cos(an) * 1.3, 0, Math.sin(an) * 1.3); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); } ctx.fillStyle = 'rgba(22,32,26,.045)'; ctx.fill();
      const items = [];
      // pixels: on the ground (act 0), into class stacks (act 1), falling away (act 2 → 3)
      if (act <= 1 || (act === 2 && k < 1)) {
        const gone = act === 2 ? k : 0;
        field.px.forEach((p) => {
          let x, z, y, s = PX, y0 = 0;
          if (act === 0) { x = p.x; z = p.z; y = 0; }
          else if (act === 1) { const kk = ease(clamp((local * 1.8 - p.c * 0.06) / 0.6, 0, 1)); x = p.x + (p.hx - p.x) * kk; z = p.z + (p.hz - p.z) * kk; y0 = p.hy * kk; y = 0.04 * kk; s = PX + (0.052 - PX) * kk; }
          else { x = p.hx; z = p.hz; y0 = p.hy * (1 - gone); y = 0.04 * (1 - gone); s = 0.052 * (1 - gone); }
          if (s > 0.004) items.push([cam.depth(x, 0, z), x, z, s * 0.92, y, act === 0 ? p.rgb : rampAt(RDYLGN, (p.c + 0.5) / 10), y0]);
        });
      }
      // days: rise as a skyline along time (act 2), wrap into the pivot ring (act 3), sink back (end of act 3)
      if (act >= 2) {
        S.cells.forEach((c) => {
          let x = c.sx, z = c.sz, h = 0.02 + c.n * 0.34;
          if (act === 2) { const kk = ease(clamp((local * 1.6 - c.col / S.weeks * 0.6) / 0.5, 0, 1)); h *= kk; if (kk <= 0) return; }
          else { x = c.sx + (c.rx - c.sx) * k; z = c.sz + (c.rz - c.sz) * k; const sink = clamp((local - 0.9) / 0.1, 0, 1); h *= 1 - sink; }
          items.push([cam.depth(x, 0, z), x, z, cs * 0.86, h, c.rgb]);
        });
      }
      items.sort((p, q) => q[0] - p[0] || (p[6] || 0) - (q[6] || 0)).forEach(([, x, z, s, h, rgb, y0]) => box(ctx, cam, x, z, s, h, rgb, undefined, y0 || 0));
      ctx.font = `${11 * st.dpr}px "IBM Plex Sans", sans-serif`; ctx.textAlign = 'center';
      if (act === 1 && local > 0.45) {
        ctx.globalAlpha = clamp((local - 0.45) / 0.2, 0, 1);
        for (let c = 0; c < 10; c++) { const x = -1.08 + c * 0.24, q = cam.p(x, 0, -0.2); ctx.fillStyle = '#7a7f78'; ctx.fillText(a.edges[c].toFixed(1), q[0], q[1] + 14 * st.dpr); if (a.classes[c] > 0.005) { const top = cam.p(x, (Math.ceil(byC[c].length / 16)) * 0.046 + 0.05, -0.001); ctx.fillStyle = '#16201a'; ctx.fillText(a.classes[c].toFixed(2) + ' ha', top[0], top[1] - 6 * st.dpr); } }
        ctx.globalAlpha = 1;
      }
      if (act >= 2 && local > 0.35) {
        ctx.fillStyle = '#7a7f78'; ctx.globalAlpha = clamp((local - 0.35) / 0.2, 0, 1);
        const months = []; let last = -1; S.cells.forEach((c) => { const mo = new Date(c.t).getUTCMonth(); if (mo !== last && c.row === 0) { last = mo; months.push(c); } });
        months.forEach((c, i) => { if (i % 2) return; const q = act === 2 ? cam.p(c.sx, 0, 0.42) : cam.p(c.rx * 1.42, 0, c.rz * 1.42); ctx.fillText(new Date(c.t).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }), q[0], q[1] + 12 * st.dpr); });
        ctx.globalAlpha = 1;
      }
    }, { pitch: 0.86, drift: 0.03 });
    return { stop: m.stop, acts: ACTS, show(i) { st0.forced = i === null ? null : clamp(i, 0, 3); st0.lastAct = -1; } };
  }

  window.AgroMotion = { hero, stats, rampAt, INDICES };
})();
