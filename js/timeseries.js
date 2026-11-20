/*
 * AgroCloud Vision — field time series
 *
 * A panel under the map (opened from the chart button in the map tools) that plots an
 * index for one field over a period: every Sentinel-2 date whose field is at most 40 %
 * cloudy, the mean as a smooth line with the P10–P90 spread as a band, crop seasons as
 * bands along the top, and optionally temperature, rain or top-soil moisture from
 * Open-Meteo on a second axis. Hover reads a date; clicking a point opens that date on
 * the map; the strip below zooms into part of the period. CSV export.
 *
 * Several layers can be plotted together; each index keeps one colour that stands for
 * what it measures (leaf green, red-edge copper, soil ochre, water blue, chlorophyll
 * teal). Weather stays neutral grey. ReCI has its own scale, so next to other layers
 * it moves to the right axis (weather is off then). Chart types: area, line, bars,
 * points with the P10–P90 range, and change since the previous clear date.
 *
 * Points arrive as they are read (Imagery.analyse), so the line grows while it loads.
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const DAY = 86400000;
  const iso = (t) => new Date(t).toISOString().slice(0, 10);
  const t0 = (d) => Date.parse(d + 'T00:00:00Z');
  const fmtShort = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const INDEX_KEYS = ['ndvi', 'ndre', 'msavi', 'ndmi', 'reci'];
  const COLORS = { ndvi: '#7cc46a', ndre: '#e08a5b', msavi: '#d4b26a', ndmi: '#5ea7e0', reci: '#4fb8a5' };
  const WEATHER_INK = '#9aa3ad';
  const WEATHER = {
    none: null,
    temp: { label: 'Temperature', unit: '°C', color: WEATHER_INK, get: (d) => (d.temperatureMaxC != null && d.temperatureMinC != null ? (d.temperatureMaxC + d.temperatureMinC) / 2 : null), kind: 'line' },
    rain: { label: 'Rain', unit: 'mm', color: WEATHER_INK, get: (d) => d.precipitationMm, kind: 'bars' },
    soil: { label: 'Soil moisture', unit: 'm³/m³', color: WEATHER_INK, get: (d) => d.soilMoisture, kind: 'line' },
  };
  const CHARTS = { area: 'Area', line: 'Line', bar: 'Bars', scatter: 'Points', change: 'Change' };
  const stored = (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
  const store = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

  const ts = {
    open: false, fieldId: null, weather: 'none',
    indices: stored('tsIndices', 'ndvi').split(',').filter((k) => INDEX_KEYS.includes(k)),
    chart: CHARTS[stored('tsChart', 'area')] ? stored('tsChart', 'area') : 'area',
    mode: ['chart', 'heat', 'sky'].includes(stored('tsMode', 'chart')) ? stored('tsMode', 'chart') : 'chart',
    from: iso(Date.now() - 365 * DAY), to: iso(Date.now()),
    points: [], crops: [], weatherDays: null, weatherKey: '', view: null,
    token: 0, done: 0, total: 0, hover: null,
    seen: new Set(), sweepAt: -1e9,   // entry animation: new marks once, full sweep when a load finishes
  };
  if (!ts.indices.length) ts.indices = ['ndvi'];
  const keysOrdered = () => INDEX_KEYS.filter((k) => ts.indices.includes(k));
  const reciMixed = () => ts.indices.includes('reci') && ts.indices.length > 1;

  // ------------------------------------------------------------ markup

  const tool = document.createElement('button');
  tool.type = 'button'; tool.id = 'tsBtn'; tool.className = 'map-btn';
  tool.setAttribute('aria-pressed', 'false'); tool.title = 'Time series';
  tool.innerHTML = icon('chartSpline');
  document.getElementById('measureBtn').insertAdjacentElement('afterend', tool);

  const panel = document.createElement('section');
  panel.id = 'tsPanel'; panel.className = 'ts-panel'; panel.hidden = true;
  panel.setAttribute('aria-label', 'Time series');
  panel.innerHTML = `
    <aside class="ts-side">
      <div class="ts-title">${icon('chartSpline')}<span>Time series</span></div>
      <label class="ts-label" for="tsField">Field</label>
      <select id="tsField" class="ts-input"></select>
      <span class="ts-label" id="tsIndexLabel">Layers</span>
      <button type="button" id="tsIndex" class="ts-input ts-multi" aria-haspopup="true" aria-expanded="false" aria-labelledby="tsIndexLabel"></button>
      <span class="ts-label">Weather</span>
      <div class="ts-seg" id="tsWeather" role="group" aria-label="Weather">
        <button type="button" data-w="none" aria-pressed="true">Off</button>
        <button type="button" data-w="temp" aria-pressed="false">Temp</button>
        <button type="button" data-w="rain" aria-pressed="false">Rain</button>
        <button type="button" data-w="soil" aria-pressed="false">Soil</button>
      </div>
      <span class="ts-label">Period</span>
      <div class="ts-dates">
        <input type="date" id="tsFrom" class="ts-input" aria-label="From" />
        <input type="date" id="tsTo" class="ts-input" aria-label="To" />
      </div>
    </aside>
    <div class="ts-main">
      <div class="ts-top">
        <div class="ts-legend" id="tsLegend"></div>
        <span class="ts-status" id="tsStatus"></span>
        <div class="ts-modes" id="tsModes" role="tablist" aria-label="View">
          <button type="button" role="tab" data-mode="chart" title="Chart">${icon('chartSpline')}</button>
          <button type="button" role="tab" data-mode="heat" title="Heatmap">${icon('heatmap')}</button>
          <button type="button" role="tab" data-mode="sky" title="3D skyline">${icon('cube')}</button>
        </div>
        <select id="tsChartType" class="ts-input ts-chart-type" title="Chart" aria-label="Chart">${Object.entries(CHARTS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
        <div class="ts-quick" id="tsQuick" role="group" aria-label="Period">
          <button type="button" data-m="3">3M</button><button type="button" data-m="6">6M</button>
          <button type="button" data-m="12">1Y</button><button type="button" data-m="24">2Y</button>
        </div>
        <button type="button" id="tsCsv" class="ts-icon" title="Download CSV">${icon('download')}</button>
        <button type="button" id="tsClose" class="ts-icon" title="Close">${icon('x')}</button>
      </div>
      <div class="ts-chart" id="tsChart"><div class="ts-progress" id="tsProgress" hidden><i></i></div><div class="ts-alt" id="tsAlt" hidden></div><svg id="tsSvg" role="img" aria-label="Index over time"></svg><div class="ts-tip" id="tsTip" hidden></div></div>
      <div class="ts-brush" id="tsBrush">
        <svg id="tsMini" aria-hidden="true"></svg>
        <div class="ts-window" id="tsWindow"><span class="ts-handle" data-h="a"></span><span class="ts-handle" data-h="b"></span></div>
        <button type="button" id="tsReset" class="ts-icon ts-reset" title="Show the whole period">${icon('refresh')}</button>
      </div>
    </div>`;
  document.getElementById('mapMain').appendChild(panel);
  hydrateIcons(panel);
  // layer menu lives on <body> so the side column's scroll does not clip it
  const menu = document.createElement('div');
  menu.id = 'tsIndexMenu'; menu.className = 'ts-menu dark-ui'; menu.hidden = true; menu.setAttribute('role', 'group'); menu.setAttribute('aria-label', 'Layers');
  document.body.appendChild(menu);

  // ------------------------------------------------------------ open / close

  function setOpen(on) {
    ts.open = on;
    panel.hidden = !on;
    tool.setAttribute('aria-pressed', String(on));
    document.getElementById('mapMain').classList.toggle('ts-open', on);
    setTimeout(() => { if (mapInstance) mapInstance.invalidateSize(); if (window.Imagery && Imagery.invalidate) Imagery.invalidate(); draw(); }, 30);
    if (on) {
      fillFields();
      if (!ts.points.length && ts.fieldId) load();
    }
  }
  tool.addEventListener('click', () => setOpen(!ts.open));
  $('tsClose').addEventListener('click', () => setOpen(false));

  // ------------------------------------------------------------ controls

  function fillFields() {
    const list = state.fieldList || [];
    const sel = $('tsField');
    if (!list.length) { sel.innerHTML = '<option value="">No fields</option>'; ts.fieldId = null; return; }
    if (!ts.fieldId || !list.some((f) => f.id === ts.fieldId)) ts.fieldId = (window.FieldPanel && FieldPanel.fieldId) || list[0].id;
    sel.innerHTML = list.map((f) => `<option value="${f.id}" translate="no">${escapeHtml(f.name)}</option>`).join('');
    sel.value = ts.fieldId;
  }
  function fillIndices() {
    const I = window.Imagery; if (!I) return;
    const keys = keysOrdered();
    $('tsIndex').innerHTML = `<span class="ts-multi-dots">${keys.map((k) => `<i style="background:${COLORS[k]}"></i>`).join('')}</span><span class="ts-multi-text">${keys.map((k) => I.indices[k].label).join(', ')}</span>${icon('chevronDown')}`;
    hydrateIcons($('tsIndex'));
    menu.innerHTML = INDEX_KEYS.filter((k) => I.indices[k]).map((k) => `
      <label class="ts-opt"><input type="checkbox" value="${k}"${ts.indices.includes(k) ? ' checked' : ''}${ts.indices.length === 1 && ts.indices[0] === k ? ' disabled' : ''}>
        <i style="background:${COLORS[k]}"></i><span class="ts-opt-name">${I.indices[k].label}</span><span class="ts-opt-sub">${I.indices[k].name}</span></label>`).join('');
    $('tsChartType').value = ts.chart;
    syncWeather();
  }
  function placeMenu() {
    const r = $('tsIndex').getBoundingClientRect();
    menu.style.minWidth = Math.max(240, r.width) + 'px';
    menu.style.left = r.left + 'px';
    const h = menu.offsetHeight || 220;
    menu.style.top = (r.bottom + 4 + h > window.innerHeight ? Math.max(8, r.top - 4 - h) : r.bottom + 4) + 'px';
  }
  function setMenu(open) {
    menu.hidden = !open; $('tsIndex').setAttribute('aria-expanded', String(open));
    if (open) { fillIndices(); placeMenu(); }
  }
  $('tsIndex').addEventListener('click', (e) => { e.stopPropagation(); setMenu(menu.hidden); });
  menu.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', () => setMenu(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) setMenu(false); });
  menu.addEventListener('change', (e) => {
    const k = e.target.value; if (!k) return;
    ts.indices = e.target.checked ? [...new Set([...ts.indices, k])] : ts.indices.filter((x) => x !== k);
    if (!ts.indices.length) ts.indices = [k];
    store('tsIndices', keysOrdered().join(','));
    fillIndices(); placeMenu(); load();
  });
  function setMode(m) {
    ts.mode = m; store('tsMode', m); ts.hover = null; ts.sweepAt = performance.now();
    $('tsModes').querySelectorAll('[data-mode]').forEach((b) => { b.setAttribute('aria-selected', String(b.dataset.mode === m)); });
    draw();
  }
  $('tsModes').querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  $('tsModes').querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === ts.mode)));
  $('tsChartType').addEventListener('change', (e) => { ts.chart = e.target.value; store('tsChart', ts.chart); ts.sweepAt = performance.now(); draw(); });
  /** ReCI next to other layers takes the right axis, so weather has nowhere to go. */
  function syncWeather() {
    const off = reciMixed();
    $('tsWeather').querySelectorAll('[data-w]').forEach((b) => {
      const dis = off && b.dataset.w !== 'none';
      b.disabled = dis; b.title = dis ? 'ReCI uses the right axis' : '';
    });
  }
  $('tsField').addEventListener('change', (e) => { ts.fieldId = e.target.value; load(); });
  $('tsWeather').querySelectorAll('[data-w]').forEach((b) => b.addEventListener('click', () => {
    ts.weather = b.dataset.w;
    $('tsWeather').querySelectorAll('[data-w]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    loadWeather().then(draw);
    draw();
  }));
  function setPeriod(from, to) {
    const max = iso(Date.now());
    to = to > max ? max : to;
    if (from >= to) from = iso(t0(to) - 30 * DAY);
    if (t0(to) - t0(from) > 1100 * DAY) from = iso(t0(to) - 1100 * DAY);   // three years at most
    ts.from = from; ts.to = to;
    $('tsFrom').value = from; $('tsTo').value = to; $('tsTo').max = max; $('tsFrom').max = to;
    markQuick();
  }
  function markQuick() {
    const months = Math.round((t0(ts.to) - t0(ts.from)) / (30.44 * DAY));
    $('tsQuick').querySelectorAll('[data-m]').forEach((b) => b.setAttribute('aria-pressed', String(ts.to === iso(Date.now()) && Math.abs(months - +b.dataset.m) < 1)));
  }
  $('tsFrom').addEventListener('change', () => { setPeriod($('tsFrom').value, ts.to); load(); });
  $('tsTo').addEventListener('change', () => { setPeriod(ts.from, $('tsTo').value); load(); });
  $('tsQuick').querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => {
    const now = new Date();
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - +b.dataset.m, now.getUTCDate()));
    setPeriod(iso(from), iso(now)); load();
  }));
  $('tsCsv').addEventListener('click', () => {
    const w = weatherByDay(); const keys = keysOrdered();
    const lab = (k) => window.Imagery.indices[k].label;
    const rows = [['date', ...keys.flatMap((k) => [`${lab(k)} mean`, `${lab(k)} p10`, `${lab(k)} p90`]), 'field cloud %', 'temperature °C', 'rain mm', 'soil moisture m3/m3']];
    ts.points.forEach((p) => {
      const d = w.get(p.day) || {};
      rows.push([p.day, ...keys.flatMap((k) => { const v = p.v[k]; return v ? [v.mean.toFixed(3), v.p10.toFixed(3), v.p90.toFixed(3)] : ['', '', '']; }), p.cloud, fix(WEATHER.temp.get(d), 1), fix(d.precipitationMm, 1), fix(d.soilMoisture, 3)]);
    });
    const name = ((state.fieldList || []).find((f) => f.id === ts.fieldId) || {}).name || 'field';
    window.downloadCsv(`${name.replace(/[^\w-]+/g, '_')}_${keys.join('-')}_${ts.from}_${ts.to}.csv`, rows);
  });
  const fix = (v, n) => (v == null || !Number.isFinite(v) ? '' : v.toFixed(n));

  // ------------------------------------------------------------ data

  const fieldOf = (id) => state.fieldsById && state.fieldsById.get(id);

  async function load() {
    const I = window.Imagery;
    const field = fieldOf(ts.fieldId);
    const token = ++ts.token;
    ts.points = []; ts.crops = []; ts.view = null; ts.done = 0; ts.total = 0; ts.hover = null; ts.seen.clear();
    if (!I || !field || !field.geometry) { status(I ? 'Pick a field' : 'Satellite tools are loading'); draw(); return; }
    fillIndices();
    status('Finding images');
    draw();
    apiGet(`/crops/by-field/${field.id}`).then((c) => { if (token === ts.token) { ts.crops = c || []; draw(); } }).catch(() => {});
    loadWeather().then(() => token === ts.token && draw());
    let scenes;
    try {
      const lookback = Math.ceil((Date.now() - t0(ts.from)) / DAY) + 1;
      scenes = await I.searchScenes([field.geometry], 'ts:' + field.id, lookback);
    } catch (err) { if (token === ts.token) status(I.friendly(err), true); return; }
    if (token !== ts.token) return;
    const list = scenes.filter((s) => s.day >= ts.from && s.day <= ts.to && s.tileCloud < 70 && s.covers !== false)
      .sort((a, b) => (a.day < b.day ? -1 : 1));
    ts.total = list.length;
    if (!list.length) { status('No images in this period'); draw(); return; }
    let next = 0;
    const work = async () => {
      while (next < list.length) {
        const s = list[next++];
        try {
          // all layers of a date at once: they share the same band reads
          const keys = keysOrdered();
          const res = await Promise.all(keys.map((k) => I.analyse(field, s, k).catch(() => null)));
          if (token !== ts.token) return;
          const v = {}; let cloud = null;
          res.forEach((r, i) => {
            if (!r) return;
            if (cloud === null) cloud = r.cloudPct;
            if (Number.isFinite(r.mean)) v[keys[i]] = { mean: r.mean, p10: r.p10, p90: r.p90 };
          });
          if (cloud <= 40 && Object.keys(v).length) {
            ts.points.push({ day: s.day, t: t0(s.day), sceneId: s.id, scene: s, v, cloud });
            ts.points.sort((a, b) => a.t - b.t);
          }
        } catch { /* a date that cannot be read is left out */ }
        if (token !== ts.token) return;
        ts.done++;
        status(ts.done < ts.total ? `${ts.done} / ${ts.total}` : `${ts.points.length} clear dates`);
        schedule();
      }
    };
    await Promise.all(Array.from({ length: 6 }, work));
    if (token !== ts.token) return;
    ts.sweepAt = performance.now(); cancelAnimationFrame(raf); draw();
  }

  async function loadWeather() {
    if (ts.weather === 'none' || !ts.fieldId) return;
    const layer = state.fieldLayerById && state.fieldLayerById.get(ts.fieldId);
    if (!layer) return;
    // the archive runs a few days behind
    const end = iso(Math.min(t0(ts.to), Date.now() - 6 * DAY));
    const key = `${ts.fieldId}|${ts.from}|${end}`;
    if (ts.weatherKey === key && ts.weatherDays) return;
    const c = layer.getBounds().getCenter();
    try {
      const res = await apiGet(`/weather/field/${ts.fieldId}/history?lat=${c.lat.toFixed(4)}&lng=${c.lng.toFixed(4)}&start=${ts.from}&end=${end}`);
      ts.weatherDays = (res && res.days) || []; ts.weatherKey = key;
    } catch { ts.weatherDays = []; ts.weatherKey = key; }
  }
  function weatherByDay() { return new Map((ts.weatherDays || []).map((d) => [d.date, d])); }

  function status(text, isError) {
    const el = $('tsStatus');
    el.textContent = text || '';
    el.classList.toggle('is-error', !!isError);
  }

  // ------------------------------------------------------------ drawing

  let raf = 0;
  function schedule() { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); }

  /** Monotone cubic (Fritsch–Carlson): smooth without overshooting between dates. */
  function smoothPath(pts) {
    if (pts.length < 2) return '';
    const n = pts.length, dx = [], dy = [], m = [];
    for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1][0] - pts[i][0]; dy[i] = (pts[i + 1][1] - pts[i][1]) / (dx[i] || 1); }
    m[0] = dy[0]; m[n - 1] = dy[n - 2];
    for (let i = 1; i < n - 1; i++) m[i] = dy[i - 1] * dy[i] <= 0 ? 0 : (dy[i - 1] + dy[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (dy[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
      const a = m[i] / dy[i], b = m[i + 1] / dy[i], h = a * a + b * b;
      if (h > 9) { const k = 3 / Math.sqrt(h); m[i] = k * a * dy[i]; m[i + 1] = k * b * dy[i]; }
    }
    let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < n - 1; i++) {
      const h = dx[i] / 3;
      d += ` C${(pts[i][0] + h).toFixed(1)} ${(pts[i][1] + m[i] * h).toFixed(1)} ${(pts[i + 1][0] - h).toFixed(1)} ${(pts[i + 1][1] - m[i + 1] * h).toFixed(1)} ${pts[i + 1][0].toFixed(1)} ${pts[i + 1][1].toFixed(1)}`;
    }
    return d;
  }

  function monthTicks(a, b) {
    const out = []; const d = new Date(a); d.setUTCDate(1); d.setUTCHours(0, 0, 0, 0);
    if (+d < a) d.setUTCMonth(d.getUTCMonth() + 1);
    const span = (b - a) / (30.44 * DAY);
    const step = span > 18 ? 3 : span > 9 ? 2 : 1;
    while (+d <= b) {
      if (d.getUTCMonth() % step === 0) out.push(+d);
      d.setUTCMonth(d.getUTCMonth() + 1);
    }
    return out;
  }
  const monthLabel = (t) => {
    const d = new Date(t);
    const m = d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
    return d.getUTCMonth() === 0 ? `${m} ${String(d.getUTCFullYear()).slice(2)}` : m;
  };

  function geometry() {
    const box = $('tsChart').getBoundingClientRect();
    const W = Math.max(320, box.width), H = Math.max(140, box.height);
    const right = reciMixed() || (WEATHER[ts.weather] && !reciMixed());
    return { W, H, P: { l: 40, r: right ? 48 : 16, t: ts.crops.length ? 26 : 12, b: 24 } };
  }
  function viewRange() { return ts.view || [t0(ts.from), t0(ts.to)]; }

  /** Value plotted for a point: the mean, or the change since the previous date with that layer. */
  function seriesOf(k, pts) {
    const out = []; let prev = null;
    ts.points.forEach((p) => {
      const v = p.v[k]; if (!v) return;
      const val = ts.chart === 'change' ? (prev ? v.mean - prev.mean : null) : v.mean;
      prev = v;
      if (val !== null && pts.includes(p)) out.push({ p, val, lo: v.p10, hi: v.p90 });
    });
    return out;
  }
  const niceStep = (span) => { const e = 10 ** Math.floor(Math.log10(span / 4)); return [1, 2, 2.5, 5, 10].map((m) => m * e).find((s) => span / s <= 5) || e * 10; };

  /** Axis ranges: one left axis for the normalised indices, ReCI on the right when mixed. */
  function axes(pts) {
    const I = window.Imagery; const keys = keysOrdered().filter((k) => I.indices[k]);
    const right = reciMixed() ? ['reci'] : [];
    const left = keys.filter((k) => !right.includes(k));
    const range = (ks) => {
      if (ts.chart === 'change') {
        let m = 0; ks.forEach((k) => seriesOf(k, pts).forEach((d) => { m = Math.max(m, Math.abs(d.val)); }));
        m = m || 0.1; const st = niceStep(2 * m); m = Math.ceil(m / st) * st; return [-m, m];
      }
      return [Math.min(...ks.map((k) => I.indices[k].range[0])), Math.max(...ks.map((k) => I.indices[k].range[1]))];
    };
    return { keys, left, right, L: range(left), R: right.length ? range(right) : null };
  }

  function draw() {
    if (!ts.open) return;
    const I = window.Imagery;
    const svg = $('tsSvg');
    if (!I) { svg.innerHTML = ''; return; }
    // heatmap and 3D skyline (js/ts-calendar.js) take the chart area
    const alt = ts.mode !== 'chart' && window.TimeSeriesViews && TimeSeriesViews[ts.mode];
    svg.style.display = alt ? 'none' : ''; $('tsAlt').hidden = !alt; $('tsBrush').hidden = !!alt; $('tsChartType').hidden = !!alt;
    if (alt) {
      const loading = ts.total > 0 && ts.done < ts.total;
      const pr = $('tsProgress'); pr.hidden = !loading; if (loading) pr.firstChild.style.width = Math.round((100 * ts.done) / ts.total) + '%';
      $('tsTip').hidden = true;
      alt.draw({ ts, keys: keysOrdered(), colors: COLORS, el: $('tsAlt'), legendEl: $('tsLegend'), tipEl: $('tsTip'), loading, sinceSweep: performance.now() - ts.sweepAt, fmtShort, iso, t0, DAY });
      return;
    }
    if (window.TimeSeriesViews) Object.values(TimeSeriesViews).forEach((v) => v.hide && v.hide());
    const { W, H, P } = geometry();
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const [a, b] = viewRange();
    const X = (t) => P.l + ((t - a) / (b - a || 1)) * (W - P.l - P.r);
    const pts = ts.points.filter((p) => p.t >= a - 20 * DAY && p.t <= b + 20 * DAY);
    const inView = pts.filter((p) => p.t >= a && p.t <= b);
    const ax = axes(pts);
    const mkY = ([lo, hi]) => (v) => P.t + (1 - (v - lo) / (hi - lo || 1)) * (H - P.t - P.b);
    const YL = mkY(ax.L), YR = ax.R ? mkY(ax.R) : null;
    const Yk = (k) => (ax.right.includes(k) ? YR : YL);
    const fmtTick = (v, [lo, hi]) => ((hi - lo) > 2 ? v.toFixed(0) : (ts.chart === 'change' && v > 0 ? '+' : '') + v.toFixed(2));
    const ticks = ([lo, hi]) => [0, 0.25, 0.5, 0.75, 1].map((k) => lo + (hi - lo) * k);
    const months = monthTicks(a, b);
    const single = ax.keys.length === 1;
    const w = reciMixed() ? null : WEATHER[ts.weather];
    let weatherSvg = '', rightAxis = '';
    if (ax.R) {
      rightAxis = ticks(ax.R).map((v) => `<text x="${W - P.r + 6}" y="${(YR(v) + 3).toFixed(1)}" class="ts-axis" fill="${COLORS.reci}">${fmtTick(v, ax.R)}</text>`).join('');
    } else if (w && ts.weatherDays && ts.weatherDays.length) {
      const days = ts.weatherDays.map((d) => ({ t: t0(d.date), v: w.get(d) })).filter((d) => d.v != null && Number.isFinite(d.v) && d.t >= a && d.t <= b);
      if (days.length) {
        let lo = Math.min(...days.map((d) => d.v)), hi = Math.max(...days.map((d) => d.v));
        if (w.kind === 'bars') lo = 0;
        if (hi === lo) hi = lo + 1;
        const pad = (hi - lo) * 0.08; if (w.kind !== 'bars') { lo -= pad; hi += pad; }
        const top = w.kind === 'bars' ? P.t + (H - P.t - P.b) * 0.45 : P.t;
        const YW = (v) => top + (1 - (v - lo) / (hi - lo)) * (H - P.b - top);
        if (w.kind === 'bars') {
          const bw = Math.max(1, Math.min(6, ((W - P.l - P.r) / ((b - a) / DAY)) * 0.7));
          weatherSvg = days.filter((d) => d.v > 0).map((d) => `<rect x="${(X(d.t) - bw / 2).toFixed(1)}" y="${YW(d.v).toFixed(1)}" width="${bw.toFixed(1)}" height="${(H - P.b - YW(d.v)).toFixed(1)}" fill="${w.color}" opacity=".3" class="ts-weather"/>`).join('');
        } else {
          // 7-day running mean keeps the weather quiet behind the index line
          const sm = days.map((d, i) => { const win = days.slice(Math.max(0, i - 3), i + 4); return [X(d.t), YW(win.reduce((s, x) => s + x.v, 0) / win.length)]; });
          weatherSvg = `<path d="${smoothPath(sm)}" fill="none" stroke="${w.color}" stroke-width="1.25" stroke-dasharray="4 3" opacity=".7" class="ts-weather"/>`;
        }
        rightAxis = [lo, (lo + hi) / 2, hi].map((v) => `<text x="${W - P.r + 6}" y="${(YW(v) + 3).toFixed(1)}" class="ts-axis">${w.kind === 'bars' || Math.abs(hi) >= 10 ? Math.round(v) : v.toFixed(2)}</text>`).join('');
      }
    }
    const crops = ts.crops.map((c) => {
      const s = Math.max(a, t0(c.plantingDate)), e = Math.min(b, c.expectedHarvestDate ? t0(c.expectedHarvestDate) : b);
      if (!(e > s)) return '';
      return `<g class="ts-crop"><rect x="${X(s).toFixed(1)}" y="4" width="${(X(e) - X(s)).toFixed(1)}" height="14" rx="4"/><text x="${(X(s) + 6).toFixed(1)}" y="14">${escapeHtml(c.cropType)}</text></g>`;
    }).join('');

    const hov = ts.hover && inView.find((p) => p.t === ts.hover);
    const isCur = (p) => Imagery.state.sceneId === p.sceneId;
    const loading = ts.total > 0 && ts.done < ts.total;
    // a redraw during the sweep (hover, resize) continues it: negative delays pick up where it was
    const el = performance.now() - ts.sweepAt, sweep = !loading && el < 900;
    const off = sweep ? Math.round(el) : 0;
    // a mark animates in once: the first time it is drawn, or on a full sweep
    const enter = (k, t) => { const id = ts.chart + k + t; if (sweep || !ts.seen.has(id)) { ts.seen.add(id); return ' is-enter'; } return ''; };
    const dly = (i, n) => ` style="animation-delay:${sweep ? Math.round((i / Math.max(1, n)) * 260) - off : 0}ms`;
    // bar width from the tightest spacing between dates
    let gap = Infinity; for (let i = 1; i < inView.length; i++) gap = Math.min(gap, X(inView[i].t) - X(inView[i - 1].t));
    const groupW = Math.max(3, Math.min(22, (Number.isFinite(gap) ? gap : 40) * 0.72));
    let defs = '', back = '', front = '';
    ax.keys.forEach((k, ki) => {
      const c = COLORS[k], Y = Yk(k), data = seriesOf(k, pts), vis = data.filter((d) => d.p.t >= a && d.p.t <= b);
      const [lo, hi] = ax.right.includes(k) ? ax.R : ax.L;
      const base = Y(Math.max(lo, Math.min(hi, 0)));
      if (ts.chart === 'area' || ts.chart === 'line') {
        const line = smoothPath(data.map((d) => [X(d.p.t), Y(d.val)]));
        if (single && data.length > 1 && !loading) {
          const band = `${smoothPath(data.map((d) => [X(d.p.t), Y(d.hi)]))} L${data.slice().reverse().map((d) => `${X(d.p.t).toFixed(1)} ${Y(d.lo).toFixed(1)}`).join(' L')} Z`;
          back += `<path d="${band}" fill="${c}" opacity=".1" class="ts-band${sweep ? ' is-enter' : ''}" style="animation-delay:${-off}ms"/>`;
        }
        if (ts.chart === 'area' && data.length > 1 && !loading) {
          defs += `<linearGradient id="tsFill-${k}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${c}" stop-opacity="${single ? 0.22 : 0.12}"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></linearGradient>`;
          back += `<path d="${line} L${X(data[data.length - 1].p.t).toFixed(1)} ${base.toFixed(1)} L${X(data[0].p.t).toFixed(1)} ${base.toFixed(1)} Z" fill="url(#tsFill-${k})" class="ts-area${sweep ? ' is-enter' : ''}" style="animation-delay:${-off}ms"/>`;
        }
        // while dates stream in only the points show; the line sweeps in once the load is done
        if (line && !loading) front += `<path d="${line}" pathLength="1" fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" class="ts-line${sweep ? ' is-enter' : ''}" style="animation-delay:${ki * 60 - off}ms" data-k="${k}"/>`;
        front += vis.map((d, i) => `<circle cx="${X(d.p.t).toFixed(1)}" cy="${Y(d.val).toFixed(1)}" r="${d.p === hov ? 4.5 : 2.75}" class="ts-dot${enter(k, d.p.t)}${d.p === hov ? ' is-hover' : ''}${isCur(d.p) ? ' is-current' : ''}"${dly(i, vis.length)};--c:${c}" data-k="${k}" data-t="${d.p.t}"/>`).join('');
      } else if (ts.chart === 'scatter') {
        front += vis.map((d) => `<line x1="${X(d.p.t).toFixed(1)}" x2="${X(d.p.t).toFixed(1)}" y1="${Y(d.lo).toFixed(1)}" y2="${Y(d.hi).toFixed(1)}" stroke="${c}" stroke-width="1.5" opacity=".35" class="ts-whisker"/>`).join('');
        front += vis.map((d, i) => `<circle cx="${X(d.p.t).toFixed(1)}" cy="${Y(d.val).toFixed(1)}" r="${d.p === hov ? 5 : 3.5}" class="ts-dot is-solid${enter(k, d.p.t)}${d.p === hov ? ' is-hover' : ''}${isCur(d.p) ? ' is-current' : ''}"${dly(i, vis.length)};--c:${c}" data-k="${k}" data-t="${d.p.t}"/>`).join('');
      } else {
        // bar and change: grouped bars from zero
        const n = ax.keys.length, bw = Math.max(1.5, groupW / n - (n > 1 ? 1 : 0));
        front += vis.map((d, i) => {
          const x = X(d.p.t) - groupW / 2 + ki * (groupW / n), y = Y(d.val);
          const top = Math.min(y, base), h = Math.max(1, Math.abs(base - y));
          return `<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(2, bw / 3).toFixed(1)}" fill="${c}" opacity="${d.p === hov || !hov ? (ts.chart === 'change' && d.val < 0 ? 0.6 : 0.9) : 0.35}" class="ts-bar${enter(k, d.p.t)}${y > base ? ' is-neg' : ''}${isCur(d.p) ? ' is-current' : ''}"${dly(i, vis.length)}" data-k="${k}" data-t="${d.p.t}"/>`;
        }).join('');
      }
    });
    const zero = ts.chart === 'change' || (ax.L[0] < 0 && ax.L[1] > 0) ? `<line x1="${P.l}" x2="${W - P.r}" y1="${YL(0).toFixed(1)}" y2="${YL(0).toFixed(1)}" class="ts-zero"/>` : '';
    svg.innerHTML = `
      <defs>${defs}<clipPath id="tsClip"><rect x="${P.l}" y="0" width="${W - P.l - P.r}" height="${H}"/></clipPath></defs>
      ${ticks(ax.L).map((v) => `<line x1="${P.l}" x2="${W - P.r}" y1="${YL(v).toFixed(1)}" y2="${YL(v).toFixed(1)}" class="ts-grid"/><text x="${P.l - 8}" y="${(YL(v) + 3).toFixed(1)}" text-anchor="end" class="ts-axis">${fmtTick(v, ax.L)}</text>`).join('')}
      ${months.map((t) => `<line x1="${X(t).toFixed(1)}" x2="${X(t).toFixed(1)}" y1="${P.t}" y2="${H - P.b}" class="ts-grid ts-vgrid"/><text x="${X(t).toFixed(1)}" y="${H - 6}" text-anchor="middle" class="ts-axis">${monthLabel(t)}</text>`).join('')}
      ${zero}
      <g clip-path="url(#tsClip)">
        ${crops}
        ${weatherSvg}
        ${back}
        ${hov ? `<line x1="${X(hov.t).toFixed(1)}" x2="${X(hov.t).toFixed(1)}" y1="${P.t}" y2="${H - P.b}" class="ts-cross"/>` : ''}
        ${front}
      </g>
      ${rightAxis}
      ${!pts.length && ts.done >= ts.total && ts.total ? `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" class="ts-empty">No clear dates in this period</text>` : ''}`;
    const pr = $('tsProgress'); pr.hidden = !loading; if (loading) pr.firstChild.style.width = Math.round((100 * ts.done) / ts.total) + '%';
    legend(ax, w);
    tip(hov, X, (p) => { const k = ax.keys.find((x) => p.v[x]); const d = k && seriesOf(k, [p])[0]; return d ? Yk(k)(d.val) : (H - P.b) / 2; });
    drawMini();
  }

  function legend(ax, w) {
    const I = window.Imagery;
    const years = ts.from.slice(0, 4) === ts.to.slice(0, 4) ? ts.to.slice(0, 4) : `${ts.from.slice(0, 4)}–${ts.to.slice(2, 4)}`;
    const single = ax.keys.length === 1;
    $('tsLegend').innerHTML = `
      ${ax.keys.map((k, i) => `<span class="ts-key" data-k="${k}"><i style="background:${COLORS[k]}"></i>${I.indices[k].label}${ax.right.includes(k) ? ' <span class="ts-key-sub">right axis</span>' : ''}${i === 0 && !ax.right.includes(k) ? ` <span class="ts-key-sub">${years}</span>` : ''}</span>`).join('')}
      ${ts.chart === 'change' ? '<span class="ts-key-sub">Change since previous date</span>' : ''}
      ${single && (ts.chart === 'area' || ts.chart === 'line') ? `<span class="ts-key"><i class="is-band" style="background:${COLORS[ax.keys[0]]}2e"></i>P10–P90</span>` : ''}
      ${ts.chart === 'scatter' ? '<span class="ts-key"><i class="is-whisker"></i>P10–P90</span>' : ''}
      ${w ? `<span class="ts-key"><i class="is-dash"></i>${w.label} <span class="ts-key-sub">${w.unit}</span></span>` : ''}`;
  }

  function tip(p, X, yOf) {
    const el = $('tsTip');
    if (!p) { el.hidden = true; return; }
    const I = window.Imagery; const keys = keysOrdered();
    const w = reciMixed() ? null : WEATHER[ts.weather];
    const d = weatherByDay().get(p.day);
    const wv = w && d ? w.get(d) : null;
    const prevOf = (k) => { const i = ts.points.indexOf(p); for (let j = i - 1; j >= 0; j--) if (ts.points[j].v[k]) return ts.points[j].v[k]; return null; };
    const rows = keys.map((k) => {
      const v = p.v[k]; if (!v) return '';
      let val = v.mean.toFixed(2);
      if (ts.chart === 'change') { const pr = prevOf(k); if (!pr) return ''; const dd = v.mean - pr.mean; val = (dd > 0 ? '+' : dd < 0 ? '−' : '') + Math.abs(dd).toFixed(2); }
      return `<div class="ts-tip-row"><span class="ts-tip-k"><i style="background:${COLORS[k]}"></i>${I.indices[k].label}</span><b>${val}</b></div>`;
    }).join('');
    const one = keys.length === 1 && p.v[keys[0]];
    el.innerHTML = `
      <div class="ts-tip-date">${fmtShort(p.t)}</div>
      ${rows}
      ${one && ts.chart !== 'change' ? `<div class="ts-tip-row"><span>P10–P90</span><span>${one.p10.toFixed(2)}–${one.p90.toFixed(2)}</span></div>` : ''}
      <div class="ts-tip-row"><span>Cloud</span><span>${p.cloud}%</span></div>
      ${w && wv != null ? `<div class="ts-tip-row"><span>${w.label}</span><span>${w.kind === 'bars' ? wv.toFixed(1) : Math.abs(wv) >= 10 ? wv.toFixed(1) : wv.toFixed(2)} ${w.unit}</span></div>` : ''}
      <div class="ts-tip-hint">Click to open this date</div>`;
    el.hidden = false;
    const box = $('tsChart').getBoundingClientRect();
    const x = X(p.t) * box.width / Math.max(320, box.width), y = yOf(p);
    const left = x + 14 + 180 > box.width ? x - 14 - el.offsetWidth : x + 14;
    el.style.left = Math.max(4, left) + 'px';
    el.style.top = Math.max(4, Math.min(box.height - el.offsetHeight - 4, y - el.offsetHeight / 2)) + 'px';
  }

  // hover and click on the chart
  function nearest(ev) {
    const svg = $('tsSvg');
    const r = svg.getBoundingClientRect();
    const { W, P } = geometry();
    const [a, b] = viewRange();
    const x = ((ev.clientX - r.left) / r.width) * W;
    const t = a + ((x - P.l) / (W - P.l - P.r)) * (b - a);
    let best = null, bd = Infinity;
    ts.points.forEach((p) => { if (p.t < a || p.t > b) return; const dd = Math.abs(p.t - t); if (dd < bd) { bd = dd; best = p; } });
    const pxPerDay = (W - P.l - P.r) / ((b - a) / DAY);
    return best && bd / DAY * pxPerDay < 40 ? best : null;
  }
  $('tsSvg').addEventListener('mousemove', (e) => { const p = nearest(e); const t = p ? p.t : null; if (t !== ts.hover) { ts.hover = t; schedule(); } });
  $('tsSvg').addEventListener('mouseleave', () => { ts.hover = null; schedule(); });
  $('tsSvg').addEventListener('click', (e) => {
    const p = nearest(e);
    if (!p || !window.Imagery) return;
    Imagery.showScene(p.scene);
    schedule();
  });

  // ------------------------------------------------------------ zoom strip

  function drawMini() {
    const svg = $('tsMini');
    const box = $('tsBrush').getBoundingClientRect();
    const W = Math.max(200, box.width - 40), H = 28;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.style.width = W + 'px';
    const a = t0(ts.from), b = t0(ts.to);
    const k = keysOrdered()[0];
    const idx = window.Imagery && Imagery.indices[k];
    const [y0, y1] = idx ? idx.range : [0, 1];
    const X = (t) => ((t - a) / (b - a || 1)) * W;
    const Y = (v) => 3 + (1 - (v - y0) / (y1 - y0)) * (H - 6);
    const data = ts.points.filter((p) => p.v[k]);
    svg.innerHTML = data.length > 1 ? `<path d="${smoothPath(data.map((p) => [X(p.t), Y(p.v[k].mean)]))}" fill="none" stroke="${COLORS[k]}" stroke-width="1.25" opacity=".7"/>` : '';
    const [va, vb] = viewRange();
    const win = $('tsWindow');
    win.style.left = (X(va) / W) * 100 * (W / box.width) + '%';
    win.style.width = ((X(vb) - X(va)) / W) * 100 * (W / box.width) + '%';
    $('tsReset').disabled = !ts.view;
  }

  (function brush() {
    const win = $('tsWindow');
    let drag = null;
    const toT = (clientX) => {
      const svg = $('tsMini').getBoundingClientRect();
      const k = Math.max(0, Math.min(1, (clientX - svg.left) / svg.width));
      return t0(ts.from) + k * (t0(ts.to) - t0(ts.from));
    };
    win.addEventListener('pointerdown', (e) => {
      const [va, vb] = viewRange();
      drag = { mode: e.target.dataset.h || 'move', start: toT(e.clientX), va, vb };
      win.setPointerCapture(e.pointerId); e.preventDefault();
    });
    win.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const A = t0(ts.from), B = t0(ts.to), min = 14 * DAY;
      const t = toT(e.clientX), d = t - drag.start;
      let va = drag.va, vb = drag.vb;
      if (drag.mode === 'a') va = Math.min(Math.max(A, drag.va + d), vb - min);
      else if (drag.mode === 'b') vb = Math.max(Math.min(B, drag.vb + d), va + min);
      else { const len = drag.vb - drag.va; va = Math.min(Math.max(A, drag.va + d), B - len); vb = va + len; }
      ts.view = va <= A + DAY && vb >= B - DAY ? null : [va, vb];
      schedule();
    });
    const end = (e) => { if (drag) { drag = null; try { win.releasePointerCapture(e.pointerId); } catch { /* released */ } } };
    win.addEventListener('pointerup', end); win.addEventListener('pointercancel', end);
    $('tsBrush').addEventListener('dblclick', () => { ts.view = null; schedule(); });
    $('tsReset').addEventListener('click', () => { ts.view = null; schedule(); });
  })();

  // ------------------------------------------------------------ wiring

  window.addEventListener('resize', schedule);
  document.addEventListener('workspace:fields', () => { if (ts.open) { const before = ts.fieldId; fillFields(); if (ts.fieldId !== before) load(); } });
  document.addEventListener('imagery:change', schedule);
  // opening a field in the panel shows that field here too
  const prevOpen = window.openFieldPanel;
  window.openFieldPanel = function (id, tab) {
    const r = prevOpen(id, tab);
    if (ts.open && id && id !== ts.fieldId) { ts.fieldId = id; fillFields(); load(); }
    else if (id) ts.fieldId = ts.fieldId || id;
    return r;
  };
  setPeriod(ts.from, ts.to);

  window.TimeSeries = { open: () => setOpen(true), close: () => setOpen(false), state: ts, load, colors: COLORS, redraw: () => draw(), setMode };
})();
