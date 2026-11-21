/*
 * AgroCloud Vision — time series views: calendar heatmap and 3D skyline.
 *
 * Both show one layer (the first ticked one, or the chip picked in the legend) day by
 * day over the period: week columns, weekday rows (Mon first). Sentinel-2 sees a field
 * every few days, so days between two clear dates are filled by linear interpolation
 * and drawn muted; the tooltip says which dates they were estimated from. Days before
 * the first or after the last clear date stay empty.
 *
 * Five levels from the period's lowest to highest value, mixed from the dark surface
 * toward the layer's own colour (same colours as the chart).
 *
 * Motion (once per load or view switch, skipped with reduced motion):
 *  heatmap — cells settle in as a wave along time;
 *  skyline — the grid starts flat (top view), tilts to 34°, and columns rise along time.
 * Skyline: drag to turn, double-click to reset; hover reads a day, click opens a clear date.
 */
(function () {
  'use strict';

  // empty day and chart ground come from the theme (dark graphite or light limestone)
  let BASE = [30, 36, 43], INK = '255 255 255', MUTED = '#6f7782';
  const themeColors = () => {
    const css = (n) => (window.Theme ? Theme.css(n) : '');
    const h = css('--cell-empty'); if (/^#[0-9a-f]{6}$/i.test(h)) BASE = hex(h);
    INK = css('--ink') || INK; MUTED = css('--t-3') || MUTED;
  };
  const reduce = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b, f) => a.map((v, i) => Math.round(v + (b[i] - v) * f));
  const rgb = (c, a) => (a == null ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`);
  const shade = (c, f) => c.map((v) => Math.round(v * f));
  const easeOut = (x) => 1 - (1 - x) ** 3;
  const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  const esc = (s) => (window.escapeHtml ? escapeHtml(s) : String(s));
  const f2 = (v) => v.toFixed(2);

  let heatKey = null, lastMapKey = null;
  const mapView = () => window.Imagery && Imagery.views && Imagery.views[0];

  /** Day cells for one layer, with interpolation between clear dates and summary stats. */
  function build(ctx) {
    themeColors();
    const { ts, keys, colors, t0, DAY } = ctx;
    // follow the map's layer: when the index on the map changes and it is plotted here, show it
    const mk = mapView() && mapView().indexKey;
    if (mk !== lastMapKey) { lastMapKey = mk; if (keys.includes(mk)) heatKey = mk; }
    if (!keys.includes(heatKey)) heatKey = keys[0];
    const k = heatKey;
    const meas = ts.points.filter((p) => p.v[k]).map((p) => ({ t: p.t, v: p.v[k].mean, p }));
    const from = t0(ts.from), to = t0(ts.to);
    // rows start on the week day chosen in Settings (Saturday, Sunday or Monday)
    const ws = window.Prefs ? Prefs.weekStart : 1;
    const dow = (t) => (new Date(t).getUTCDay() - ws + 7) % 7;
    const start = from - dow(from) * DAY;
    const cells = []; let j = 0;
    for (let t = from; t <= to; t += DAY) {
      while (j < meas.length && meas[j].t < t) j++;
      const col = Math.floor((t - start) / (7 * DAY)), row = dow(t);
      const at = meas[j] && meas[j].t === t ? meas[j] : null;
      const prev = at ? null : meas[j - 1], next = at ? null : meas[j];
      let v = null, est = false;
      if (at) v = at.v;
      else if (prev && next) { v = prev.v + ((next.v - prev.v) * (t - prev.t)) / (next.t - prev.t); est = true; }
      cells.push({ t, col, row, v, est, m: at, prev, next });
    }
    const vals = cells.filter((c) => c.v != null).map((c) => c.v);
    const lo = vals.length ? Math.min(...vals) : 0, hi = vals.length ? Math.max(...vals) : 1;
    // colours: the index's own ramp, exactly as on the map. With the map's contrast on, the ramp
    // spans this period's lowest to highest value; otherwise the index's fixed range.
    const I = window.Imagery, idx = I.indices[k];
    const contrast = !!(mapView() && mapView().contrast);
    const [r0, r1] = contrast && hi > lo ? [lo, hi] : idx.range || [0, 1];
    const colorOf = (v) => I.rampAt(idx.ramp, Math.max(0, Math.min(1, (v - r0) / (r1 - r0 || 1))));
    const curScene = I.state && I.state.sceneId;
    // the map's class filter: days whose field mean is outside the chosen classes fade
    const flt = I.filter && I.filter.indexKey === k ? I.filter.classes : null;
    const edges = flt ? I.edgesFor(k) : null;
    cells.forEach((c) => {
      if (c.v == null) { c.rgb = BASE; c.n = 0; return; }
      c.n = hi > lo ? (c.v - lo) / (hi - lo) : 0.5;     // column height in 3D: relative to the period
      const col = colorOf(c.v);
      c.rgb = c.est ? mix(col, BASE, 0.45) : col;
      c.cur = !!(c.m && c.m.p.sceneId === curScene);
      c.dim = !!(flt && !flt.has(I.classOf(edges, c.v)));
      if (c.dim) c.rgb = mix(c.rgb, BASE, 0.78);
    });
    const ms = meas.slice();
    const stats = ms.length ? {
      avg: ms.reduce((s, m) => s + m.v, 0) / ms.length,
      peak: ms.reduce((a, b) => (b.v > a.v ? b : a)),
      low: ms.reduce((a, b) => (b.v < a.v ? b : a)),
      last: ms[ms.length - 1], prev: ms[ms.length - 2] || null, n: ms.length,
    } : null;
    const weeks = cells.length ? cells[cells.length - 1].col + 1 : 0;
    return { k, label: idx.label, color: colors[k], cells, lo, hi, r0, r1, contrast, ramp: idx.ramp, stats, weeks, start };
  }

  function legend(ctx, d) {
    const { keys, colors, legendEl } = ctx;
    const chips = keys.length > 1
      ? `<span class="tsc-chips" role="group" aria-label="Layer">${keys.map((k) => `<button type="button" data-hk="${k}" aria-pressed="${k === d.k}"><i style="background:${colors[k]}"></i>${window.Imagery.indices[k].label}</button>`).join('')}</span>`
      : `<span class="ts-key"><i style="background:${d.color}"></i>${d.label}</span>`;
    legendEl.innerHTML = `${chips}
      <span class="tsc-scale">${d.contrast ? '<span>contrast</span>' : ''}<span class="num">${f2(d.r0)}</span><i class="tsc-ramp" style="background:${window.Imagery.gradient(d.ramp)}"></i><span class="num">${f2(d.r1)}</span></span>
      <span class="tsc-scale"><i style="background:${rgb(mix(window.Imagery.rampAt(d.ramp, 0.75), BASE, 0.45))}"></i>Estimated</span>
      <span class="tsc-scale"><i class="tsc-cur"></i>Date on the map</span>`;
    // picking a layer here also switches the map to it
    legendEl.querySelectorAll('[data-hk]').forEach((b) => b.addEventListener('click', () => {
      heatKey = b.dataset.hk; lastMapKey = heatKey; ctx.ts.sweepAt = performance.now();
      const sel = document.getElementById('imgIndex');
      if (sel && sel.value !== heatKey) { sel.value = heatKey; sel.dispatchEvent(new Event('change')); }
      window.TimeSeries.redraw();
    }));
  }

  function tipHtml(c, d, ctx) {
    const { fmtShort } = ctx;
    const head = `<div class="ts-tip-date">${fmtShort(c.t)}</div>`;
    if (c.v == null) return head + '<div class="ts-tip-row"><span>No clear image around this day</span></div>';
    return head + `<div class="ts-tip-row"><span class="ts-tip-k"><i style="background:${d.color}"></i>${d.label}</span><b>${f2(c.v)}</b></div>`
      + (c.est
        ? `<div class="ts-tip-row"><span>Estimated</span><span>${fmtShort(c.prev.t).replace(/ \d{4}$/, '')} – ${fmtShort(c.next.t).replace(/ \d{4}$/, '')}</span></div>`
        : `<div class="ts-tip-row"><span>Cloud</span><span>${c.m.p.cloud}%</span></div><div class="ts-tip-hint">Click to open this date</div>`);
  }
  function placeTip(tip, x, y, box) {
    tip.hidden = false;
    const left = x + 14 + tip.offsetWidth > box.width ? x - 14 - tip.offsetWidth : x + 14;
    tip.style.left = Math.max(4, left) + 'px';
    tip.style.top = Math.max(4, Math.min(box.height - tip.offsetHeight - 4, y - tip.offsetHeight / 2)) + 'px';
  }
  const openDate = (c) => { if (c && c.m && window.Imagery) Imagery.showScene(c.m.p.scene); };

  function statsHtml(d, a = 0, b = 4) {
    const s = d.stats; if (!s) return '';
    const day = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    const ch = s.prev ? s.last.v - s.prev.v : null;
    const block = (label, v, sub) => `<div class="tsc-stat"><span class="tsc-stat-l">${label}</span><span class="tsc-stat-v num" style="color:${d.color}">${f2(v)}</span><span class="tsc-stat-s num">${sub}</span></div>`;
    return [
      block('Average', s.avg, `${s.n} clear dates`),
      block('Peak', s.peak.v, day(s.peak.t)),
      block('Lowest', s.low.v, day(s.low.t)),
      block('Latest', s.last.v, `${day(s.last.t)}${ch == null ? '' : ` · ${ch >= 0 ? '+' : '−'}${Math.abs(ch).toFixed(2)}`}`),
    ].slice(a, b).join('');
  }

  // ------------------------------------------------------------ heatmap

  const heat = {
    draw(ctx) {
      sky.hide(); ring.hide();
      const d = build(ctx); legend(ctx, d);
      const el = ctx.el; el.className = 'ts-alt tsc-heatmode';
      const box = el.getBoundingClientRect();
      const labW = 30, top = 16, statsH = 56;
      let cs = Math.min(18, Math.floor((box.width - labW - 8) / Math.max(1, d.weeks)));
      cs = Math.max(5, Math.min(cs, Math.floor((box.height - top - statsH - 8) / 7)));
      const gap = cs >= 12 ? 3 : cs >= 8 ? 2 : 1, sz = cs - gap, r = Math.min(3, sz / 4);
      const gw = d.weeks * cs, gx = labW + Math.max(0, (box.width - labW - gw) / 2);
      const animate = ctx.sinceSweep < 900 && !ctx.loading && !reduce(), off = Math.round(ctx.sinceSweep);
      const months = []; let lastM = -1;
      d.cells.forEach((c) => { const m = new Date(c.t).getUTCMonth(); if (m !== lastM && (c.row === 0 || c === d.cells[0])) { lastM = m; if (!months.length || c.col - months[months.length - 1][0] >= 3) months.push([c.col, c.t]); } });
      const rects = d.cells.map((c, i) => `<rect x="${(gx + c.col * cs).toFixed(1)}" y="${top + c.row * cs}" width="${sz}" height="${sz}" rx="${r}" fill="${rgb(c.rgb)}" data-i="${i}" class="tsc-cell${c.m ? ' is-clear' : ''}${c.cur ? ' is-cur' : ''}${c.dim ? ' is-dim' : ''}${animate ? ' is-enter' : ''}"${animate ? ` style="animation-delay:${c.col * 9 + c.row * 14 - off}ms"` : ''}/>`).join('');
      el.innerHTML = `
        <svg class="tsc-heat" width="${box.width}" height="${top + 7 * cs}" style="width:${box.width}px;height:${top + 7 * cs}px" aria-label="${d.label} by day">
          ${months.map(([col, t]) => `<text x="${(gx + col * cs).toFixed(1)}" y="10" class="ts-axis">${new Date(t).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })}</text>`).join('')}
          ${[0, 2, 4].map((rw) => [rw, ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][((window.Prefs ? Prefs.weekStart : 1) + rw) % 7]]).map(([rw, l]) => `<text x="${gx - 8}" y="${top + rw * cs + sz / 2 + 3}" text-anchor="end" class="ts-axis">${l}</text>`).join('')}
          ${rects}
        </svg>
        <div class="tsc-stats">${statsHtml(d)}</div>`;
      const svg = el.querySelector('svg');
      const cellAt = (e) => { const i = e.target.dataset && e.target.dataset.i; return i == null ? null : d.cells[+i]; };
      svg.addEventListener('mousemove', (e) => {
        const c = cellAt(e); if (!c) { ctx.tipEl.hidden = true; return; }
        const cb = ctx.tipEl.parentElement.getBoundingClientRect();
        ctx.tipEl.innerHTML = tipHtml(c, d, ctx);
        placeTip(ctx.tipEl, e.clientX - cb.left, e.clientY - cb.top, cb);
      });
      svg.addEventListener('mouseleave', () => { ctx.tipEl.hidden = true; });
      svg.addEventListener('click', (e) => openDate(cellAt(e)));
    },
  };

  // ------------------------------------------------------------ 3D skyline

  const YAW0 = 0.52, PITCH = 34 * Math.PI / 180, FLAT = 88 * Math.PI / 180;
  const sky = {
    canvas: null, d: null, ctx: null, yaw: YAW0, yawFrom: YAW0, yawAt: 0, growAt: -1e9, raf: 0, hover: null, polys: [], drag: null,
    hide() { cancelAnimationFrame(this.raf); this.raf = 0; },
    draw(ctx) {
      const d = build(ctx); legend(ctx, d);
      this.d = d; this.ctx = ctx;
      const el = ctx.el; ring.hide();
      if (!el.classList.contains('tsc-skymode') || !this.canvas || !el.contains(this.canvas)) {
        el.className = 'ts-alt tsc-skymode';
        el.innerHTML = `<canvas class="tsc-canvas" aria-label="3D skyline"></canvas>
          <div class="tsc-corner tsc-tr"></div><div class="tsc-corner tsc-bl"></div>
          <div class="tsc-hint">Drag to turn · double-click to reset</div>`;
        this.canvas = el.querySelector('canvas');
        this.bind();
      }
      el.querySelector('.tsc-tr').innerHTML = statsHtml(d, 0, 2);
      el.querySelector('.tsc-bl').innerHTML = statsHtml(d, 2, 4);
      if (ctx.sinceSweep < 900 && !ctx.loading) this.growAt = performance.now() - ctx.sinceSweep;
      this.loop();
    },
    loop() {
      if (this.raf) return;
      const tick = () => {
        this.raf = 0;
        const busy = this.render();
        if (busy) this.raf = requestAnimationFrame(tick);
      };
      this.raf = requestAnimationFrame(tick);
    },
    /** One frame. Returns true while something is still moving. */
    render() {
      const cv = this.canvas, d = this.d; if (!cv || !d || !cv.isConnected) return false;
      const box = cv.parentElement.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      if (cv.width !== Math.round(box.width * dpr) || cv.height !== Math.round(box.height * dpr)) {
        cv.width = Math.round(box.width * dpr); cv.height = Math.round(box.height * dpr);
        cv.style.width = box.width + 'px'; cv.style.height = box.height + 'px';
      }
      const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, box.width, box.height);
      const now = performance.now(), still = reduce();
      const since = now - this.growAt;
      const tilt = still ? 1 : easeInOut(clamp01(since / 750));
      const pitch = FLAT + (PITCH - FLAT) * tilt;
      const yk = still ? 1 : easeInOut(clamp01((now - this.yawAt) / 600));
      const yaw = this.drag ? this.yaw : this.yawFrom + (this.yaw - this.yawFrom) * yk;
      const W = d.weeks, Hmax = Math.max(3, Math.min(6, W / 9));
      const cy = Math.cos(yaw), sy = Math.sin(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch);
      const P = (x, y, z) => { const gx = x - W / 2, gy = y - 3.5; const xr = gx * cy - gy * sy, yr = gx * sy + gy * cy; return [xr, yr * sp - z * cp, yr]; };
      // fit: grid corners at floor and at full height
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      [[0, 0], [W, 0], [0, 7], [W, 7]].forEach(([x, y]) => [0, Hmax].forEach((z) => { const [a, b] = P(x, y, z); x0 = Math.min(x0, a); x1 = Math.max(x1, a); y0 = Math.min(y0, b); y1 = Math.max(y1, b); }));
      const pad = 18, sc = Math.min((box.width - 2 * pad) / (x1 - x0 || 1), (box.height - 2 * pad) / (y1 - y0 || 1));
      const ox = box.width / 2 - ((x0 + x1) / 2) * sc, oy = box.height / 2 - ((y0 + y1) / 2) * sc;
      const S = (x, y, z) => { const [a, b] = P(x, y, z); return [ox + a * sc, oy + b * sc]; };
      const a = 0.41;
      let moving = !still && (since < 750 + W * 12 + 560 || yk < 1);
      const order = d.cells.map((c) => ({ c, depth: P(c.col + 0.5, c.row + 0.5, 0)[2] })).sort((p, q) => p.depth - q.depth);
      // side faces whose outward normal points at the viewer
      const sides = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([nx, ny]) => ({ nx, ny, vis: nx * sy + ny * cy > 0.001, lit: nx * cy - ny * sy }));
      this.polys = [];
      g.lineJoin = 'round';
      for (const { c } of order) {
        const grow = still ? 1 : easeOut(clamp01((since - c.col * 12 - c.row * 6) / 560));
        const z = c.v == null ? 0 : (0.12 + 0.88 * c.n) * Hmax * grow;
        const x = c.col + 0.5, y = c.row + 0.5;
        const corner = (dx, dy, zz) => S(x + dx * a, y + dy * a, zz);
        const top = [corner(-1, -1, z), corner(1, -1, z), corner(1, 1, z), corner(-1, 1, z)];
        const hot = this.hover === c;
        const col = hot ? (window.Theme && Theme.current === 'light' ? shade(c.rgb, 0.82) : c.rgb.map((v) => Math.min(255, v + 34))) : c.rgb;
        const shapes = [];
        if (z > 0.01) {
          sides.forEach((f) => {
            if (!f.vis) return;
            const q = f.nx ? [[f.nx, -1], [f.nx, 1]] : [[-1, f.ny], [1, f.ny]];
            const poly = [corner(q[0][0], q[0][1], 0), corner(q[1][0], q[1][1], 0), corner(q[1][0], q[1][1], z), corner(q[0][0], q[0][1], z)];
            g.fillStyle = rgb(shade(col, f.lit > 0 ? 0.52 : 0.72)); g.beginPath(); poly.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py))); g.closePath(); g.fill();
            shapes.push(poly);
          });
        }
        g.fillStyle = rgb(c.v == null ? BASE : col);
        g.beginPath(); top.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py))); g.closePath(); g.fill();
        if (c.cur) { g.strokeStyle = `rgb(${INK} / .95)`; g.lineWidth = 1.6; g.stroke(); }
        else if (z > 0.01) { g.strokeStyle = `rgb(${INK} / .08)`; g.lineWidth = 0.6; g.stroke(); }
        shapes.push(top);
        this.polys.push({ c, shapes });
      }
      // month labels along the near edge
      g.font = '10px "IBM Plex Sans", system-ui, sans-serif'; g.fillStyle = MUTED; g.textAlign = 'center';
      let lastM = -1, lastX = -1e9;
      d.cells.forEach((c) => {
        if (c.row !== 0) return; const m = new Date(c.t).getUTCMonth(); if (m === lastM) return; lastM = m;
        const [px, py] = S(c.col + 0.5, 8.2, 0);
        if (Math.abs(px - lastX) < 30) return; lastX = px;
        g.fillText(new Date(c.t).toLocaleDateString(window.I18n && I18n.lang === 'ar' ? 'ar' : 'en-GB', { month: 'short', timeZone: 'UTC' }), px, py + 3);
      });
      if (yk < 1) moving = true;
      return moving;
    },
    hit(x, y) {
      const inside = (poly) => { let o = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) o = !o; } return o; };
      for (let i = this.polys.length - 1; i >= 0; i--) if (this.polys[i].shapes.some(inside)) return this.polys[i].c;
      return null;
    },
    bind() {
      const cv = this.canvas;
      cv.addEventListener('pointerdown', (e) => { this.drag = { x: e.clientX, yaw: this.yaw, moved: false }; cv.setPointerCapture(e.pointerId); });
      cv.addEventListener('pointermove', (e) => {
        const r = cv.getBoundingClientRect();
        if (this.drag) {
          const dx = e.clientX - this.drag.x; if (Math.abs(dx) > 3) this.drag.moved = true;
          this.yaw = this.drag.yaw + dx * 0.008; this.yawFrom = this.yaw; this.ctx.tipEl.hidden = true; this.loop();
          return;
        }
        const c = this.hit(e.clientX - r.left, e.clientY - r.top);
        if (c !== this.hover) { this.hover = c; this.loop(); }
        const tip = this.ctx.tipEl;
        if (!c) { tip.hidden = true; return; }
        const cb = tip.parentElement.getBoundingClientRect();
        tip.innerHTML = tipHtml(c, this.d, this.ctx);
        placeTip(tip, e.clientX - cb.left, e.clientY - cb.top, cb);
      });
      const up = (e) => {
        if (!this.drag) return;
        const moved = this.drag.moved; this.drag = null;
        try { cv.releasePointerCapture(e.pointerId); } catch { /* released */ }
        if (!moved) { const r = cv.getBoundingClientRect(); openDate(this.hit(e.clientX - r.left, e.clientY - r.top)); }
      };
      cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
      cv.addEventListener('pointerleave', () => { if (!this.drag) { this.hover = null; this.ctx.tipEl.hidden = true; this.loop(); } });
      cv.addEventListener('dblclick', () => { this.yawFrom = this.yaw; this.yaw = this.yaw0 != null ? this.yaw0 : YAW0; this.yawAt = performance.now(); this.loop(); });
    },
  };

  // ------------------------------------------------------------ 3D ring (pivot)
  // The period wraps once around a circle, like a centre pivot: each week is a sector
  // (clockwise from the top), each weekday a concentric ring, column height = value.
  // Same colours, estimates, hover, click and map link as the skyline; drag turns 360°.
  const ring = Object.assign(Object.create(sky), {
    canvas: null, d: null, ctx: null, yaw0: 0, yaw: 0, yawFrom: 0, yawAt: 0, growAt: -1e9, raf: 0, hover: null, polys: [], drag: null,
    draw(ctx) {
      const d = build(ctx); legend(ctx, d);
      this.d = d; this.ctx = ctx;
      const el = ctx.el; sky.hide();
      if (!el.classList.contains('tsc-ringmode') || !this.canvas || !el.contains(this.canvas)) {
        el.className = 'ts-alt tsc-skymode tsc-ringmode';
        el.innerHTML = `<canvas class="tsc-canvas" aria-label="3D ring"></canvas>
          <div class="tsc-corner tsc-tr"></div><div class="tsc-corner tsc-bl"></div>
          <div class="tsc-hint">Drag to turn 360° · double-click to reset</div>`;
        this.canvas = el.querySelector('canvas');
        this.bind();
      }
      el.querySelector('.tsc-tr').innerHTML = statsHtml(d, 0, 2);
      el.querySelector('.tsc-bl').innerHTML = statsHtml(d, 2, 4);
      if (ctx.sinceSweep < 900 && !ctx.loading) this.growAt = performance.now() - ctx.sinceSweep;
      this.loop();
    },
    render() {
      const cv = this.canvas, d = this.d; if (!cv || !d || !cv.isConnected) return false;
      const box = cv.parentElement.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      if (cv.width !== Math.round(box.width * dpr) || cv.height !== Math.round(box.height * dpr)) {
        cv.width = Math.round(box.width * dpr); cv.height = Math.round(box.height * dpr);
        cv.style.width = box.width + 'px'; cv.style.height = box.height + 'px';
      }
      const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, box.width, box.height);
      const now = performance.now(), still = reduce();
      const since = now - this.growAt;
      const tilt = still ? 1 : easeInOut(clamp01(since / 750));
      const pitch = FLAT + (PITCH + 0.1 - FLAT) * tilt;
      const yk = still ? 1 : easeInOut(clamp01((now - this.yawAt) / 600));
      const yaw = this.drag ? this.yaw : this.yawFrom + (this.yaw - this.yawFrom) * yk;
      const W = Math.max(1, d.weeks);
      // geometry: a small gap at the top marks where the period starts and ends
      const gap = 0.12, dTh = (2 * Math.PI - gap) / W, th0 = -Math.PI / 2 + gap / 2;
      const rIn = Math.max(2.4, 1 / dTh - 3.5), rOut = rIn + 7, Hmax = Math.max(1.6, rOut * 0.26);
      const cy = Math.cos(yaw), sy = Math.sin(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch);
      const P = (x, y, z) => { const xr = x * cy - y * sy, yr = x * sy + y * cy; return [xr, yr * sp - z * cp, yr]; };
      const G = (th, r) => [r * Math.cos(th), r * Math.sin(th)];
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let i = 0; i < 48; i++) { const [gx, gy] = G((i / 48) * 2 * Math.PI, rOut + 1.8); [0, Hmax].forEach((z) => { const [a, b] = P(gx, gy, z); x0 = Math.min(x0, a); x1 = Math.max(x1, a); y0 = Math.min(y0, b); y1 = Math.max(y1, b); }); }
      const pad = 14, sc = Math.min((box.width - 2 * pad) / (x1 - x0 || 1), (box.height - 2 * pad) / (y1 - y0 || 1));
      const ox = box.width / 2 - ((x0 + x1) / 2) * sc, oy = box.height / 2 - ((y0 + y1) / 2) * sc;
      const S = (gx, gy, z) => { const [a, b] = P(gx, gy, z); return [ox + a * sc, oy + b * sc]; };
      const SP = (th, r, z) => { const [gx, gy] = G(th, r); return S(gx, gy, z); };
      const path = (pts) => { g.beginPath(); pts.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py))); g.closePath(); };
      let moving = !still && (since < 750 + W * 12 + 560 || yk < 1);
      // floor: a soft annulus like the wet circle of a pivot
      g.beginPath();
      for (let i = 0; i <= 96; i++) { const [px, py] = SP((i / 96) * 2 * Math.PI, rOut + 0.55, 0); if (i) g.lineTo(px, py); else g.moveTo(px, py); }
      for (let i = 96; i >= 0; i--) { const [px, py] = SP((i / 96) * 2 * Math.PI, rIn - 0.55, 0); g.lineTo(px, py); }
      g.closePath(); g.fillStyle = `rgb(${INK} / .045)`; g.fill('evenodd'); g.strokeStyle = `rgb(${INK} / .1)`; g.lineWidth = 0.8; g.stroke();
      const order = d.cells.map((c) => { const th = th0 + (c.col + 0.5) * dTh, r = rIn + c.row + 0.5; const [gx, gy] = G(th, r); return { c, depth: P(gx, gy, 0)[2] }; }).sort((p, q) => p.depth - q.depth);
      const vis = (nx, ny) => nx * sy + ny * cy > 0.001, lit = (nx, ny) => nx * cy - ny * sy;
      this.polys = []; g.lineJoin = 'round';
      const N = 4;   // arc samples per sector edge
      for (const { c } of order) {
        const grow = still ? 1 : easeOut(clamp01((since - c.col * 12 - c.row * 6) / 560));
        const z = c.v == null ? 0 : (0.12 + 0.88 * c.n) * Hmax * grow;
        const a0 = th0 + (c.col + 0.07) * dTh, a1 = th0 + (c.col + 0.93) * dTh, r0 = rIn + c.row + 0.08, r1 = rIn + c.row + 0.92;
        const arc = (r, zz, from, to) => Array.from({ length: N + 1 }, (_, i) => SP(from + ((to - from) * i) / N, r, zz));
        const hot = this.hover === c;
        const col = hot ? (window.Theme && Theme.current === 'light' ? shade(c.rgb, 0.82) : c.rgb.map((v) => Math.min(255, v + 34))) : c.rgb;
        const shapes = [];
        if (z > 0.01) {
          const am = (a0 + a1) / 2;
          const faces = [
            { n: [Math.cos(am), Math.sin(am)], pts: () => [...arc(r1, 0, a0, a1), ...arc(r1, z, a1, a0)] },
            { n: [-Math.cos(am), -Math.sin(am)], pts: () => [...arc(r0, 0, a0, a1), ...arc(r0, z, a1, a0)] },
            { n: [Math.sin(a0), -Math.cos(a0)], pts: () => [SP(a0, r0, 0), SP(a0, r1, 0), SP(a0, r1, z), SP(a0, r0, z)] },
            { n: [-Math.sin(a1), Math.cos(a1)], pts: () => [SP(a1, r0, 0), SP(a1, r1, 0), SP(a1, r1, z), SP(a1, r0, z)] },
          ];
          faces.forEach((f) => {
            if (!vis(f.n[0], f.n[1])) return;
            const pts = f.pts(); path(pts);
            g.fillStyle = rgb(shade(col, lit(f.n[0], f.n[1]) > 0 ? 0.56 : 0.74)); g.fill();
            shapes.push(pts);
          });
        }
        const top = [...arc(r1, z, a0, a1), ...arc(r0, z, a1, a0)];
        path(top); g.fillStyle = rgb(c.v == null ? BASE : col); g.fill();
        if (c.cur) { g.strokeStyle = `rgb(${INK} / .95)`; g.lineWidth = 1.6; g.stroke(); }
        else if (z > 0.01) { g.strokeStyle = `rgb(${INK} / .08)`; g.lineWidth = 0.6; g.stroke(); }
        shapes.push(top);
        this.polys.push({ c, shapes });
      }
      // month names around the rim
      g.font = '10px "IBM Plex Sans", system-ui, sans-serif'; g.fillStyle = MUTED; g.textAlign = 'center';
      let lastM = -1;
      d.cells.forEach((c) => {
        const m = new Date(c.t).getUTCMonth(); if (m === lastM) return; lastM = m;
        const [px, py] = SP(th0 + (c.col + 0.5) * dTh, rOut + 1.4, 0);
        g.fillText(new Date(c.t).toLocaleDateString(window.I18n && I18n.lang === 'ar' ? 'ar' : 'en-GB', { month: 'short', timeZone: 'UTC' }), px, py + 3);
      });
      if (yk < 1) moving = true;
      return moving;
    },
  });
  // pointer drag turns the ring a full turn and more
  window.TimeSeriesViews = { heat, sky, ring };
})();
