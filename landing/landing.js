/*
 * AgroSyntra One — public pages: product art, tool tabs, language button.
 * The art is drawn here (SVG) from the same vegetation ramp the app uses, so the fields on
 * the landing page look like the fields in the workspace. Nothing here is real customer data.
 */
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';

  // ------------------------------------------------------------ colour ramps (same stops as js/imagery.js)
  const RDYLGN = [[0, [165, 0, 38]], [0.1, [215, 48, 39]], [0.2, [244, 109, 67]], [0.3, [253, 174, 97]], [0.4, [254, 224, 139]],
    [0.5, [255, 255, 191]], [0.6, [217, 239, 139]], [0.7, [166, 217, 106]], [0.8, [102, 189, 99]], [0.9, [26, 152, 80]], [1, [0, 104, 55]]];
  const MOIST = [[0, [140, 81, 10]], [0.25, [216, 179, 101]], [0.45, [246, 232, 195]], [0.6, [199, 234, 229]], [0.8, [90, 180, 172]], [1, [1, 102, 94]]];
  const SOIL = [[0, [26, 152, 80]], [0.35, [217, 239, 139]], [0.6, [236, 214, 160]], [0.8, [191, 129, 45]], [1, [120, 72, 28]]];
  function at(ramp, v) {
    v = Math.max(0, Math.min(1, v));
    for (let i = 1; i < ramp.length; i++) {
      const [a, ca] = ramp[i - 1], [b, cb] = ramp[i];
      if (v <= b) { const t = (v - a) / (b - a || 1); return `rgb(${ca.map((c, k) => Math.round(c + (cb[k] - c) * t)).join(',')})`; }
    }
    return `rgb(${ramp[ramp.length - 1][1].join(',')})`;
  }

  // deterministic noise so the picture is the same on every load
  function noise(x, y, s) { const n = Math.sin(x * 12.9898 + y * 78.233 + s * 37.719) * 43758.5453; return n - Math.floor(n); }
  function smooth(x, y, s) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = noise(xi, yi, s), b = noise(xi + 1, yi, s), c = noise(xi, yi + 1, s), d = noise(xi + 1, yi + 1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  const el = (tag, attrs = {}, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };

  /**
   * One centre pivot as 10 m pixels.
   * value(dx, dy) in field units (-1..1) returns the index value 0..1 before noise.
   */
  function pivot(svg, { cx, cy, r, px = 9, seed = 1, value, ramp = RDYLGN, outline = 'rgba(255,255,255,.85)', width = 1.5, id }) {
    const clipId = 'clip-' + (id || seed + '-' + cx);
    const cp = el('clipPath', { id: clipId }, el('defs', {}, svg));
    el('circle', { cx, cy, r }, cp);
    const g = el('g', { 'clip-path': `url(#${clipId})` }, svg);
    for (let y = cy - r; y < cy + r; y += px) {
      for (let x = cx - r; x < cx + r; x += px) {
        const dx = (x + px / 2 - cx) / r, dy = (y + px / 2 - cy) / r;
        if (dx * dx + dy * dy > 1.08) continue;
        let v = value(dx, dy) + (smooth(x / 38, y / 38, seed) - 0.5) * 0.16 + (noise(x, y, seed) - 0.5) * 0.05;
        el('rect', { x, y, width: px + 0.4, height: px + 0.4, fill: at(ramp, v) }, g);
      }
    }
    el('circle', { cx, cy, r, fill: 'none', stroke: outline, 'stroke-width': width }, svg);
    return g;
  }

  // field value models
  const healthy = (base) => (dx, dy) => base - 0.06 * Math.hypot(dx, dy);
  const wedge = (base, from, to, low) => (dx, dy) => {
    const a = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360, d = Math.hypot(dx, dy);
    const inside = from < to ? a >= from && a <= to : a >= from || a <= to;
    return inside && d > 0.28 ? low + 0.12 * (1 - d) : base - 0.05 * d;
  };

  function landscape(svg, w, h) {
    el('rect', { width: w, height: h, fill: '#d9cca9' }, svg);
    // dune texture
    const g = el('g', { opacity: '.5' }, svg);
    for (let i = 0; i < 9; i++) el('path', { d: `M${-40} ${40 + i * 70} C ${w * 0.3} ${10 + i * 70}, ${w * 0.6} ${90 + i * 70}, ${w + 40} ${30 + i * 70}`, stroke: '#cfc09a', 'stroke-width': 18, fill: 'none' }, g);
    const t = el('g', { stroke: '#ece3cc', 'stroke-width': 4, fill: 'none', 'stroke-linecap': 'round' }, svg);
    return t;
  }

  // ------------------------------------------------------------ hero: the workspace map
  function heroMap(svg) {
    const W = 960, H = 520; svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    const tracks = landscape(svg, W, H);
    el('path', { d: 'M-20 268 L980 236' }, tracks); el('path', { d: 'M318 -20 L300 540' }, tracks); el('path', { d: 'M646 -20 L628 540' }, tracks);
    pivot(svg, { cx: 160, cy: 130, r: 124, seed: 3, value: healthy(0.8) });
    pivot(svg, { cx: 470, cy: 120, r: 128, seed: 7, value: wedge(0.78, 300, 20, 0.32), outline: '#ffffff', width: 3, id: 'sel' });
    pivot(svg, { cx: 790, cy: 128, r: 120, seed: 11, value: healthy(0.62) });
    pivot(svg, { cx: 160, cy: 404, r: 124, seed: 5, value: healthy(0.74) });
    pivot(svg, { cx: 470, cy: 400, r: 124, seed: 13, value: (dx, dy) => 0.48 + 0.22 * dx });
    // fodder block (rectangle)
    const cp = el('clipPath', { id: 'blk' }, el('defs', {}, svg)); el('rect', { x: 680, y: 300, width: 250, height: 200 }, cp);
    const g = el('g', { 'clip-path': 'url(#blk)' }, svg);
    for (let y = 300; y < 500; y += 9) for (let x = 680; x < 930; x += 9) el('rect', { x, y, width: 9.4, height: 9.4, fill: at(RDYLGN, 0.66 + (smooth(x / 40, y / 40, 17) - 0.5) * 0.22) }, g);
    el('rect', { x: 680, y: 300, width: 250, height: 200, fill: 'none', stroke: 'rgba(255,255,255,.85)', 'stroke-width': 1.5 }, svg);
  }

  // ------------------------------------------------------------ sign in art
  function authMap(svg) {
    const W = 600, H = 900; svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    const tracks = landscape(svg, W, H);
    el('path', { d: 'M-20 300 L620 270' }, tracks); el('path', { d: 'M300 -20 L290 920' }, tracks); el('path', { d: 'M-20 600 L620 575' }, tracks);
    pivot(svg, { cx: 150, cy: 150, r: 132, seed: 2, value: healthy(0.8) });
    pivot(svg, { cx: 440, cy: 140, r: 128, seed: 4, value: wedge(0.76, 200, 260, 0.36) });
    pivot(svg, { cx: 150, cy: 440, r: 130, seed: 6, value: healthy(0.7) });
    pivot(svg, { cx: 440, cy: 430, r: 132, seed: 8, value: healthy(0.84), outline: '#fff', width: 3 });
    pivot(svg, { cx: 150, cy: 730, r: 128, seed: 9, value: (dx) => 0.5 + 0.2 * dx });
    pivot(svg, { cx: 440, cy: 725, r: 130, seed: 10, value: healthy(0.66) });
  }

  // ------------------------------------------------------------ tool art
  function svgBox(w, h) { const s = el('svg', { viewBox: `0 0 ${w} ${h}`, role: 'img' }); return s; }
  const txt = (svg, x, y, s, o = {}) => { const t = el('text', { x, y, 'font-size': o.size || 12, fill: o.fill || '#7a7f78', 'text-anchor': o.anchor || 'start', 'font-family': 'inherit', ...(o.attrs || {}) }, svg); t.textContent = s; return t; };

  const ART = {
    indices() {
      const s = svgBox(560, 250); el('rect', { width: 560, height: 250, fill: '#f6f5f1' }, s);
      const m = wedge(0.76, 290, 10, 0.34);
      [['NDVI', RDYLGN, m], ['NDMI', MOIST, (dx, dy) => 0.2 + 0.7 * m(dx, dy)], ['BSI', SOIL, (dx, dy) => 1.05 - m(dx, dy)]].forEach(([n, ramp, f], i) => {
        pivot(s, { cx: 100 + i * 180, cy: 112, r: 80, px: 7, seed: 21, value: f, ramp, outline: '#fff', id: 'ix' + i });
        txt(s, 100 + i * 180, 222, n, { anchor: 'middle', size: 13, fill: '#16201a' });
      });
      return s;
    },
    series() {
      const s = svgBox(560, 250); el('rect', { width: 560, height: 250, fill: '#f6f5f1' }, s);
      const cols = 26, rows = 7, cw = 18, gap = 2, x0 = 40, y0 = 40;
      for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
        const day = c * 7 + r; const t = day / (cols * 7);
        let v = 0.25 + 0.6 * Math.sin(Math.PI * Math.min(1, t * 1.25)) + (noise(c, r, 4) - 0.5) * 0.08;
        const est = noise(c, r, 9) > 0.62;
        el('rect', { x: x0 + c * (cw + gap), y: y0 + r * (cw + gap), width: cw, height: cw, rx: 3, fill: at(RDYLGN, v), opacity: est ? 0.45 : 1 }, s);
      }
      ['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov'].forEach((mn, i) => txt(s, x0 + i * 4.4 * (cw + gap), y0 - 12, mn));
      txt(s, x0, 222, 'Faded squares are days estimated between clear images', { size: 12 });
      return s;
    },
    risks() {
      const s = svgBox(560, 250); el('rect', { width: 560, height: 250, fill: '#f6f5f1' }, s);
      const rows = [['Pivot 2', '-0.11', 0.58, '#b4432d'], ['Pivot 5', '-0.07', 0.49, '#c8642e'], ['Fodder block', '-0.02', 0.66, '#7a7f78'], ['Pivot 1', '+0.03', 0.79, '#17552d']];
      rows.forEach(([n, d, v, c], i) => {
        const y = 30 + i * 52;
        el('rect', { x: 24, y, width: 512, height: 44, rx: 10, fill: '#fff', stroke: 'rgba(22,32,26,.09)' }, s);
        el('rect', { x: 40, y: y + 15, width: 14, height: 14, rx: 4, fill: at(RDYLGN, v) }, s);
        txt(s, 66, y + 27, n, { size: 14, fill: '#16201a' });
        txt(s, 330, y + 27, 'NDVI ' + v.toFixed(2), { size: 13 });
        txt(s, 516, y + 27, d, { size: 13, fill: c, anchor: 'end' });
      });
      return s;
    },
    vra() {
      const s = svgBox(560, 250); el('rect', { width: 560, height: 250, fill: '#f6f5f1' }, s);
      const zc = ['#1a9850', '#91cf60', '#fee08b', '#fc8d59'];
      pivot(s, { cx: 130, cy: 125, r: 100, px: 10, seed: 31, value: wedge(0.8, 280, 30, 0.35), ramp: [[0, [252, 141, 89]], [0.45, [254, 224, 139]], [0.62, [145, 207, 96]], [1, [26, 152, 80]]], outline: '#fff', id: 'vra' });
      [['Zone 1', '18.4 ha', '180 kg/ha'], ['Zone 2', '29.7 ha', '210 kg/ha'], ['Zone 3', '21.0 ha', '240 kg/ha'], ['Zone 4', '10.1 ha', '270 kg/ha']].forEach(([z, a, r], i) => {
        const y = 46 + i * 42;
        el('rect', { x: 268, y: y - 12, width: 12, height: 12, rx: 3, fill: zc[i] }, s);
        txt(s, 290, y - 1, z, { size: 13, fill: '#16201a' }); txt(s, 400, y - 1, a, { size: 13 }); txt(s, 536, y - 1, r, { size: 13, anchor: 'end', fill: '#16201a' });
      });
      txt(s, 268, 222, 'ISO-XML · Shapefile · GeoJSON · KML', { size: 12 });
      return s;
    },
    soil() {
      const s = svgBox(560, 250); el('rect', { width: 560, height: 250, fill: '#f6f5f1' }, s);
      pivot(s, { cx: 280, cy: 125, r: 108, px: 9, seed: 41, value: healthy(0.7), outline: '#fff', id: 'soil' });
      let n = 1;
      for (let y = -0.75; y <= 0.76; y += 0.375) for (let x = -0.75; x <= 0.76; x += 0.375) {
        if (x * x + y * y > 0.7) continue;
        const cx = 280 + x * 108, cy = 125 + y * 108;
        el('circle', { cx, cy, r: 9, fill: '#fff', stroke: '#16201a', 'stroke-width': 1.2 }, s);
        txt(s, cx, cy + 4, String(n++), { size: 10, anchor: 'middle', fill: '#16201a' });
      }
      return s;
    },
    log() {
      const s = svgBox(560, 250); el('rect', { width: 560, height: 250, fill: '#f6f5f1' }, s);
      const ops = { 3: '#2f6fb3', 6: '#1f6b3a', 10: '#c2511f', 13: '#2f6fb3', 17: '#8c5a2b', 20: '#2f6fb3', 24: '#1f6b3a', 27: '#2f6fb3' };
      for (let d = 0; d < 30; d++) {
        const c = d % 7, r = Math.floor(d / 7), x = 24 + c * 74, y = 20 + r * 44;
        el('rect', { x, y, width: 70, height: 40, rx: 8, fill: '#fff', stroke: 'rgba(22,32,26,.08)' }, s);
        txt(s, x + 8, y + 16, String(d + 1), { size: 11 });
        if (ops[d]) el('rect', { x: x + 8, y: y + 24, width: 54, height: 8, rx: 4, fill: ops[d] }, s);
      }
      return s;
    },
    scout() {
      const s = svgBox(560, 250); el('rect', { width: 560, height: 250, fill: '#f6f5f1' }, s);
      pivot(s, { cx: 140, cy: 125, r: 104, px: 9, seed: 51, value: wedge(0.78, 120, 170, 0.34), outline: '#fff', id: 'sc' });
      [[96, 168, '1'], [70, 120, '2'], [180, 82, '3']].forEach(([x, y, n]) => {
        el('path', { d: `M${x} ${y} c-9 -12 -12 -16 -12 -21 a12 12 0 1 1 24 0 c0 5 -3 9 -12 21z`, fill: '#16201a' }, s);
        txt(s, x, y - 18, n, { size: 10, anchor: 'middle', fill: '#fff' });
      });
      [['1', 'Check for leaf rust', 'High'], ['2', 'Low stand near the arm end', 'Medium'], ['3', 'Confirm nozzle repair', 'Low']].forEach(([n, t, p], i) => {
        const y = 50 + i * 56;
        el('rect', { x: 276, y: y - 22, width: 262, height: 46, rx: 10, fill: '#fff', stroke: 'rgba(22,32,26,.09)' }, s);
        txt(s, 292, y + 5, n, { size: 13, fill: '#7a7f78' });
        txt(s, 310, y + 5, t, { size: 13, fill: '#16201a' });
        txt(s, 524, y + 5, p, { size: 12, anchor: 'end' });
      });
      return s;
    },
    weather() {
      const s = svgBox(560, 250); el('rect', { width: 560, height: 250, fill: '#f6f5f1' }, s);
      const x0 = 40, x1 = 530, y0 = 30, y1 = 200;
      for (let i = 0; i < 5; i++) el('line', { x1: x0, x2: x1, y1: y0 + i * 42.5, y2: y0 + i * 42.5, stroke: 'rgba(22,32,26,.07)' }, s);
      const line = (f, c) => { let d = ''; for (let i = 0; i <= 60; i++) { const x = x0 + (x1 - x0) * i / 60, y = f(i / 60); d += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1); } el('path', { d, fill: 'none', stroke: c, 'stroke-width': 2, 'stroke-linecap': 'round' }, s); };
      line((t) => 160 - 70 * Math.sin(Math.PI * t * 0.9) - 6 * Math.sin(t * 30), '#c2511f');
      line((t) => 182 - 28 * Math.exp(-((t - 0.3) ** 2) / 0.004) - 40 * Math.exp(-((t - 0.72) ** 2) / 0.003), '#2f6fb3');
      line((t) => 120 + 30 * Math.cos(Math.PI * t * 1.3), '#167a73');
      [['Temperature', '#c2511f'], ['Rain', '#2f6fb3'], ['Soil moisture', '#167a73']].forEach(([n, c], i) => {
        el('rect', { x: 40 + i * 140, y: 226, width: 14, height: 3, rx: 1.5, fill: c }, s); txt(s, 60 + i * 140, 231, n);
      });
      return s;
    },
    report() {
      const s = svgBox(560, 250); el('rect', { width: 560, height: 250, fill: '#ebe7dd' }, s);
      [0, 1].forEach((p) => {
        const x = 104 + p * 186, y = 18;
        el('rect', { x, y, width: 166, height: 222, rx: 4, fill: '#fff', stroke: 'rgba(22,32,26,.12)' }, s);
        el('rect', { x: x + 12, y: y + 12, width: 80, height: 7, rx: 3, fill: '#16201a' }, s);
        for (let i = 0; i < 3; i++) el('rect', { x: x + 12, y: y + 26 + i * 8, width: 140 - i * 30, height: 4, rx: 2, fill: '#d9d6cd' }, s);
        if (p === 0) {
          pivot(s, { cx: x + 48, cy: y + 98, r: 34, px: 4, seed: 61, value: wedge(0.78, 300, 20, 0.34), outline: '#fff', width: 1, id: 'rp1' });
          pivot(s, { cx: x + 118, cy: y + 98, r: 34, px: 4, seed: 61, value: wedge(0.78, 300, 20, 0.34), ramp: [[0, [252, 141, 89]], [0.45, [254, 224, 139]], [0.62, [145, 207, 96]], [1, [26, 152, 80]]], outline: '#fff', width: 1, id: 'rp2' });
          for (let i = 0; i < 6; i++) el('rect', { x: x + 12, y: y + 150 + i * 11, width: 142, height: 6, rx: 2, fill: i % 2 ? '#efede6' : '#e4e1d8' }, s);
        } else {
          let d = ''; for (let i = 0; i <= 30; i++) { const t = i / 30; d += (i ? 'L' : 'M') + (x + 12 + 142 * t).toFixed(1) + ' ' + (y + 110 - 50 * Math.sin(Math.PI * Math.min(1, t * 1.2))).toFixed(1); }
          el('path', { d, fill: 'none', stroke: '#1f6b3a', 'stroke-width': 1.6 }, s);
          for (let i = 0; i < 7; i++) el('rect', { x: x + 12, y: y + 130 + i * 11, width: 142 - (i % 3) * 20, height: 5, rx: 2, fill: '#e4e1d8' }, s);
        }
      });
      return s;
    },
    team() {
      const s = svgBox(560, 250); el('rect', { width: 560, height: 250, fill: '#f6f5f1' }, s);
      const roles = [['Owner', 'Everything, including the team'], ['Manager', 'Farms, fields and operations'], ['GIS analyst', 'Boundaries, imports and zones'], ['Agronomist', 'Crops, scouting and reports'], ['Field supervisor', 'Activities and scout tasks'], ['Viewer', 'Reads, does not change']];
      roles.forEach(([r, d], i) => {
        const y = 22 + i * 36;
        el('rect', { x: 24, y, width: 512, height: 32, rx: 8, fill: i % 2 ? 'transparent' : '#fff' }, s);
        txt(s, 40, y + 21, r, { size: 13, fill: '#16201a' }); txt(s, 220, y + 21, d, { size: 13 });
      });
      return s;
    },
  };

  // ------------------------------------------------------------ wire up
  function trSvgText(root) { if (window.I18n && I18n.lang === 'ar') root.querySelectorAll('text').forEach((t) => { t.textContent = I18n.t(t.textContent); }); }

  function init() {
    const hero = document.getElementById('heroMap'); if (hero) heroMap(hero);
    const auth = document.getElementById('authMap'); if (auth) authMap(auth);
    document.querySelectorAll('[data-art]').forEach((box) => {
      const f = ART[box.dataset.art]; if (!f) return;
      const svg = f(); svg.setAttribute('aria-hidden', 'true'); box.appendChild(svg); trSvgText(box);
    });

    // tools: a tab list; arrow keys move between tools
    const tabs = [...document.querySelectorAll('.tool')];
    const show = (t) => {
      tabs.forEach((b) => { const on = b === t; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; document.getElementById(b.getAttribute('aria-controls')).hidden = !on; });
    };
    tabs.forEach((b, i) => {
      b.addEventListener('click', () => show(b));
      b.addEventListener('keydown', (e) => {
        const k = e.key; let j = null;
        if (k === 'ArrowDown' || k === 'ArrowRight') j = (i + 1) % tabs.length;
        if (k === 'ArrowUp' || k === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
        if (j !== null) { e.preventDefault(); show(tabs[j]); tabs[j].focus(); }
      });
    });

    const lb = document.getElementById('langBtn');
    if (lb) {
      const ar = window.I18n && I18n.lang === 'ar';
      lb.textContent = ar ? 'English' : 'العربية'; lb.lang = ar ? 'en' : 'ar'; lb.setAttribute('translate', 'no');
      lb.addEventListener('click', () => I18n.setLang(ar ? 'en' : 'ar'));
    }
    const y = document.getElementById('year'); if (y) y.textContent = String(new Date().getFullYear());
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
