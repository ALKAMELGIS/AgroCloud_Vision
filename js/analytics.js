/*
 * AgroCloud Vision — analytics views
 *
 * FieldAnalytics (Analytics tab of the field panel): index statistics for the
 *   timeline date, value classes in ha or %, compare with an earlier date
 *   (anomaly areas), season curve.
 * Shell views: Leaderboard, Reports, Weather analytics, Weather forecast,
 *   Notifications.
 */
(function () {
  'use strict';
  const I = () => window.Imagery;
  const fmtDay = (d) => (d ? new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');
  const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : '—');
  const sgn = (v) => (Number.isFinite(v) ? (v > 0 ? '+' : '') + v.toFixed(2) : '—');
  const status = (t) => `<div class="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2.5 text-[13px] text-gray-600">${icon('loader', 'spin text-gray-400')}<span>${escapeHtml(t)}</span></div>`;
  const errBox = (t) => `<div class="rounded-lg bg-red-50 p-3 text-[13px] text-red-700 ring-1 ring-red-100">${escapeHtml(t)}</div>`;
  const fields = () => state.fieldList || [];
  const geomOf = (id) => state.fieldsById && state.fieldsById.get(id);
  function centroid(id) {
    const l = state.fieldLayerById.get(id); if (!l) return null;
    const c = l.getBounds().getCenter(); return { lat: +c.lat.toFixed(4), lng: +c.lng.toFixed(4) };
  }

  // ------------------------------------------------------------ small SVG charts

  function lineChart(series, opts = {}) {
    const W = 288, H = opts.h || 140, P = { l: 30, r: 6, t: 8, b: 18 };
    const all = series.flatMap((s) => s.points);
    if (all.length < 2) return '<p class="text-[12px] text-gray-400">Not enough data yet</p>';
    const xs = all.map((p) => p.x), ys = all.map((p) => p.y).concat(opts.yZero ? [0] : []);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    let y0 = opts.yMin ?? Math.min(...ys), y1 = opts.yMax ?? Math.max(...ys);
    if (y1 === y0) y1 = y0 + 1;
    const X = (v) => P.l + ((v - x0) / (x1 - x0 || 1)) * (W - P.l - P.r);
    const Y = (v) => P.t + (1 - (v - y0) / (y1 - y0)) * (H - P.t - P.b);
    const ticks = [0, 0.5, 1].map((t) => y0 + (y1 - y0) * t);
    return `<svg viewBox="0 0 ${W} ${H}" class="w-full" role="img">
      ${ticks.map((v) => `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="rgba(255,255,255,.07)"/><text x="${P.l - 4}" y="${Y(v) + 3}" text-anchor="end" font-size="9" fill="#6f7782" font-family="ui-monospace,monospace">${opts.fmt ? opts.fmt(v) : v.toFixed(1)}</text>`).join('')}
      ${series.map((s) => s.bars
        ? s.points.map((p) => `<rect x="${X(p.x) - 1.5}" y="${Y(Math.max(p.y, 0))}" width="3" height="${Math.max(0, Y(0) - Y(Math.max(p.y, 0)))}" fill="${s.color}" opacity=".7"/>`).join('')
        : `<path d="${s.points.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)} ${Y(p.y).toFixed(1)}`).join(' ')}" fill="none" stroke="${s.color}" stroke-width="${s.width || 1.75}" ${s.dash ? 'stroke-dasharray="4 3"' : ''} stroke-linejoin="round"/>
           ${s.dots ? s.points.map((p) => `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="2.5" fill="#181b20" stroke="${s.color}" stroke-width="1.5"><title>${p.label || ''}</title></circle>`).join('') : ''}`).join('')}
      <text x="${P.l}" y="${H - 4}" font-size="9" fill="#6f7782">${opts.xLabel0 || ''}</text>
      <text x="${W - P.r}" y="${H - 4}" font-size="9" fill="#6f7782" text-anchor="end">${opts.xLabel1 || ''}</text>
    </svg>`;
  }
  const legend = (items) => `<div class="mt-1 flex flex-wrap gap-3 text-[11px] text-gray-500">${items.map(([c, l]) => `<span class="flex items-center gap-1.5"><span class="h-0.5 w-3 rounded" style="background:${c}"></span>${l}</span>`).join('')}</div>`;

  // ------------------------------------------------------------ field analytics

  const fa = { unit: 'ha', cmp: '', series: new Map() };
  function renderField(el, field) {
    const img = I();
    if (!img) { el.innerHTML = status('Loading satellite tools'); return; }
    const scene = img.current();
    const idxKey = img.state.indexKey, idx = img.indices[idxKey];
    if (!scene) { el.innerHTML = `<p class="text-[13px] text-gray-500">Pick a date on the timeline below the map</p>`; return; }
    el.innerHTML = status(`Reading ${idx.label} for ${fmtDay(scene.day)}`);
    img.analyse(field, scene, idxKey === 'rgb' ? 'ndvi' : idxKey).then((r) => {
      if (window.FieldPanel.fieldId !== field.id) return;
      draw(el, field, r);
    }).catch((err) => { el.innerHTML = errBox(img.friendly(err)); });
  }

  function draw(el, field, r) {
    const img = I(); const idx = img.indices[r.indexKey];
    const total = r.classes.reduce((a, b) => a + b, 0) || 1;
    const lo = idx.range[0], hi = idx.range[1];
    const sameTile = img.state.scenes.filter((s) => s.day < r.scene.day && s.tile === r.scene.tile && s.tileCloud < 80);
    const series = fa.series.get(field.id + '|' + r.indexKey);
    el.innerHTML = `
      <div class="space-y-5">
        <div class="flex items-end justify-between">
          <div>
            <div class="text-[12px] text-gray-500">${idx.label} · ${fmtDay(r.scene.day)}</div>
            <div class="num font-mono text-[32px] leading-10 text-gray-900">${f2(r.mean)}</div>
            <div class="num font-mono text-[12px] text-gray-500">P10 ${f2(r.p10)} · P90 ${f2(r.p90)}</div>
          </div>
          <div class="text-right">
            <div class="num font-mono text-[13px] ${r.cloudPct > 40 ? 'text-amber-700' : 'text-gray-900'}">${r.cloudPct}% cloud</div>
            <div class="num font-mono text-[12px] text-gray-500">${formatHa(r.validHa)} clear</div>
          </div>
        </div>
        <div>
          <div class="mb-2 flex items-center justify-between"><span class="fp-h !mb-0">Index values distribution</span>
            <span class="flex rounded-md bg-gray-100 p-0.5 text-[11px]">${['ha', '%'].map((u) => `<button type="button" data-unit="${u}" class="h-6 rounded px-2 ${fa.unit === u ? 'bg-white text-gray-900' : 'text-gray-500'}">${u}</button>`).join('')}</span></div>
          <div class="space-y-1">
            ${r.classes.map((v, k) => {
              const a = r.edges[k], b = Math.min(r.edges[k + 1], hi);
              const col = img.css(img.rampAt(idx.ramp, ((a + b) / 2 - lo) / (hi - lo)));
              const pct = (100 * v) / total;
              return `<div class="flex items-center gap-2 text-[12px]">
                <span class="h-2.5 w-2.5 shrink-0 rounded-sm" style="background:${col}"></span>
                <span class="num w-[84px] shrink-0 whitespace-nowrap font-mono text-gray-500">${a.toFixed(idx.range[1] > 2 ? 1 : 2)}–${b.toFixed(idx.range[1] > 2 ? 1 : 2)}</span>
                <span class="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100"><span class="block h-full rounded-full" style="width:${pct}%;background:${col}"></span></span>
                <span class="num w-16 shrink-0 text-right font-mono text-gray-500">${fa.unit === 'ha' ? formatHa(v) : pct.toFixed(1) + ' %'}</span>
              </div>`;
            }).join('')}
          </div>
        </div>
        <div>
          <div class="fp-h">Compare with an earlier date</div>
          <select id="faCmp" class="fp-input"><option value="">No comparison</option>${sameTile.map((s) => `<option value="${s.id}" ${s.id === fa.cmp ? 'selected' : ''}>${fmtDay(s.day)} · ~${Math.round(s.tileCloud)}% tile cloud</option>`).join('')}</select>
          <div id="faCmpOut" class="mt-3"></div>
        </div>
        <div>
          <div class="mb-2 flex items-center justify-between"><span class="fp-h !mb-0">${idx.label} over the season</span>${series ? '' : '<button type="button" id="faSeries" class="text-[12px] font-medium text-brand-700">Build chart</button>'}</div>
          <div id="faSeriesOut">${series ? seriesHtml(series, idx) : '<p class="text-[12px] text-gray-400">Reads the clearest dates of this period; dates with more than 40% cloud over the field are left out</p>'}</div>
        </div>
        <p class="text-[11px] leading-4 text-gray-400">Sentinel-2 L2A, 10 m · Element84 Earth Search · clouds masked with the scene classification layer</p>
      </div>`;
    el.querySelectorAll('[data-unit]').forEach((b) => b.addEventListener('click', () => { fa.unit = b.dataset.unit; draw(el, field, r); }));
    el.querySelector('#faCmp').addEventListener('change', (e) => { fa.cmp = e.target.value; runCompare(el, field, r); });
    const sb = el.querySelector('#faSeries'); if (sb) sb.addEventListener('click', () => buildSeries(el, field, r));
    if (fa.cmp && sameTile.some((s) => s.id === fa.cmp)) runCompare(el, field, r); else { fa.cmp = ''; img.clearDelta(); }
  }

  async function runCompare(el, field, cur) {
    const img = I(); const out = el.querySelector('#faCmpOut');
    if (!fa.cmp) { out.innerHTML = ''; img.clearDelta(); return; }
    out.innerHTML = status('Reading the earlier date');
    try {
      const prev = await img.analyse(field, img.sceneById(fa.cmp), cur.indexKey);
      const c = img.compare(cur, prev);
      img.showDelta(cur, c);
      out.innerHTML = `
        <div class="rounded-lg ${c.clusters.length ? 'bg-amber-50 ring-1 ring-amber-100' : 'bg-gray-50'} p-3">
          <div class="text-[13px] font-medium ${c.clusters.length ? 'text-amber-900' : 'text-gray-900'}">${c.clusters.length ? `${formatHa(c.anomalyHa)} dropped more than ${img.config.anomalyDrop.toFixed(2)} against the field` : 'No area dropped against the rest of the field'}</div>
          <div class="num mt-1 font-mono text-[12px] text-gray-600">Field change ${sgn(c.median)} · ${fmtDay(prev.scene.day)} → ${fmtDay(cur.scene.day)}</div>
          ${c.clusters.length ? `<div class="mt-2 space-y-1">${c.clusters.slice(0, 5).map((cl, i) => `<button type="button" data-cl="${i}" class="num flex w-full items-center justify-between rounded-md px-1.5 py-1 text-left font-mono text-[12px] text-gray-700 transition-colors hover:bg-amber-100/60"><span>Area ${i + 1} · ${formatHa(cl.ha)}</span><span>${cl.meanDrop.toFixed(2)}</span></button>`).join('')}</div>
          <div class="mt-3 grid grid-cols-2 gap-2">
            <button type="button" id="faTask" class="h-8 rounded-lg bg-white text-[12px] font-medium text-gray-900 ring-1 ring-gray-200 transition-colors hover:bg-gray-50">Create scout task</button>
            <button type="button" id="faScout" class="h-8 rounded-lg bg-white text-[12px] font-medium text-gray-900 ring-1 ring-gray-200 transition-colors hover:bg-gray-50">Log scouting visit</button>
          </div>` : ''}
        </div>
        <div class="mt-2 flex items-center gap-2 text-[11px] text-gray-500"><span class="h-2 w-16 rounded-full" style="background:linear-gradient(90deg,#b2182b,#f4a582,#f7f7f7,#a6dba0,#1b7837)"></span><span class="num font-mono">−0.3 … +0.3</span><span class="flex items-center gap-1">· <span class="h-2 w-2 rounded-sm bg-red-600"></span>flagged drop</span></div>`;
      out.querySelectorAll('[data-cl]').forEach((b) => b.addEventListener('click', () => { const cl = c.clusters[+b.dataset.cl]; mapInstance.setView([cl.lat, cl.lng], Math.max(mapInstance.getZoom(), 16)); }));
      const note = `NDVI drop ${fmtDay(prev.scene.day)} → ${fmtDay(cur.scene.day)}: ` + c.clusters.slice(0, 5).map((cl, i) => `area ${i + 1} ${cl.ha.toFixed(2)} ha (${cl.meanDrop.toFixed(2)}) at ${cl.lat.toFixed(5)}, ${cl.lng.toFixed(5)}`).join('; ');
      const sc = out.querySelector('#faScout');
      if (sc) sc.addEventListener('click', async () => {
        try {
          await apiPost('/activities', { fieldId: field.id, type: 'scouting_visit', date: new Date().toISOString().slice(0, 10), notes: note.slice(0, 2000) });
          showToast('Scouting visit logged'); document.dispatchEvent(new CustomEvent('activities:changed'));
        } catch (err) { showError(err.message || 'Could not log the visit'); }
      });
      const tk = out.querySelector('#faTask');
      if (tk) tk.addEventListener('click', () => window.ScoutTasks && ScoutTasks.createFromAnomaly(field, c.clusters[0], note));
    } catch (err) { out.innerHTML = errBox(img.friendly(err)); }
  }

  async function buildSeries(el, field, cur) {
    const img = I(); const out = el.querySelector('#faSeriesOut');
    const picks = img.state.scenes.filter((s) => s.covers && s.tile === cur.scene.tile).slice().sort((a, b) => a.tileCloud - b.tileCloud).slice(0, 16).sort((a, b) => (a.day < b.day ? -1 : 1));
    const pts = [];
    for (let i = 0; i < picks.length; i++) {
      if (window.FieldPanel.fieldId !== field.id) return;
      out.innerHTML = status(`Reading date ${i + 1} of ${picks.length}`);
      try { const r = await img.analyse(field, picks[i], cur.indexKey); if (r.cloudPct <= 40 && Number.isFinite(r.mean)) pts.push({ day: picks[i].day, mean: r.mean, p10: r.p10, p90: r.p90 }); } catch { /* skip */ }
    }
    fa.series.set(field.id + '|' + cur.indexKey, pts);
    draw(el, field, cur);
  }
  function seriesHtml(pts, idx) {
    if (pts.length < 2) return '<p class="text-[12px] text-gray-400">Not enough clear dates to draw a curve yet</p>';
    const t = (d) => +new Date(d);
    return lineChart([
      { points: pts.map((p) => ({ x: t(p.day), y: p.p90 })), color: '#22c55e', width: 1, dash: true },
      { points: pts.map((p) => ({ x: t(p.day), y: p.p10 })), color: '#22c55e', width: 1, dash: true },
      { points: pts.map((p) => ({ x: t(p.day), y: p.mean, label: `${fmtDay(p.day)} · ${p.mean.toFixed(2)}` })), color: '#4ade80', width: 2, dots: true },
    ], { yMin: idx.range[0], yMax: idx.range[1], fmt: (v) => v.toFixed(2), xLabel0: fmtDay(pts[0].day), xLabel1: fmtDay(pts[pts.length - 1].day) })
      + legend([['#4ade80', 'Mean'], ['#22c55e', 'P10 – P90']]) + `<p class="num mt-1 font-mono text-[11px] text-gray-400">${pts.length} clear dates</p>`;
  }
  window.FieldAnalytics = { render: renderField };

  // ------------------------------------------------------------ Leaderboard

  const lb = { mode: 'drop' };
  function renderLeaderboard(el) {
    const img = I();
    const scene = img && img.current();
    if (!scene) { el.innerHTML = '<p class="text-[13px] text-gray-500">Pick a satellite date on the timeline to rank fields</p>'; return; }
    const rows = fields().map((f) => ({ f, r: img.riskFor(f.id), cur: img.resultFor(f.id) }));
    const pending = rows.some((x) => !x.r);
    let list = rows.filter((x) => x.r && Number.isFinite(x.r.change));
    list.sort((a, b) => (lb.mode === 'drop' ? a.r.change - b.r.change : b.r.change - a.r.change));
    const nodata = rows.filter((x) => x.r && !Number.isFinite(x.r.change));
    el.innerHTML = `
      <p class="text-[12px] leading-5 text-gray-500">NDVI change between ${fmtDay(scene.day)} and each field's previous clear image on the same tile</p>
      <div class="mt-3 flex rounded-lg bg-gray-100 p-0.5 text-[12px]">${[['drop', 'Biggest drops'], ['rise', 'Biggest gains']].map(([k, l]) => `<button type="button" data-lb="${k}" class="h-7 flex-1 rounded-md ${lb.mode === k ? 'bg-white text-gray-900' : 'text-gray-500'}">${l}</button>`).join('')}</div>
      ${pending ? `<div class="mt-3">${status('Comparing fields with their previous clear image')}</div>` : ''}
      <div class="mt-3 divide-y divide-gray-100">
        ${list.map((x, i) => {
          const c = x.r.change;
          const col = c <= img.config.highDrop ? 'text-red-600' : c <= img.config.lowDrop ? 'text-amber-700' : c > 0.03 ? 'text-brand-700' : 'text-gray-500';
          return `<button type="button" data-open="${x.f.id}" class="flex w-full items-center gap-3 py-2.5 text-left">
            <span class="num w-5 font-mono text-[12px] text-gray-400">${i + 1}</span>
            <span class="min-w-0 flex-1"><span class="block truncate text-[13px] text-gray-900">${escapeHtml(x.f.name)}</span>
              <span class="num block font-mono text-[11px] text-gray-500">${f2(x.r.prev.mean)} → ${f2(x.r.cur.mean)} · ${fmtDay(x.r.prev.scene.day)}</span></span>
            <span class="num font-mono text-[13px] ${col}">${sgn(c)}</span>
          </button>`;
        }).join('')}
      </div>
      ${nodata.length ? `<p class="mt-3 text-[12px] text-gray-500">No clear comparison for ${nodata.map((x) => escapeHtml(x.f.name)).join(', ')}</p>` : ''}
      ${list.length ? `<button type="button" id="lbCsv" class="mt-4 flex h-9 w-full items-center justify-center gap-1.5 rounded-lg text-[13px] text-gray-700 ring-1 ring-gray-200 transition-colors hover:bg-gray-50">${icon('download')}Download CSV</button>` : ''}`;
    el.querySelectorAll('[data-lb]').forEach((b) => b.addEventListener('click', () => { lb.mode = b.dataset.lb; renderLeaderboard(el); }));
    el.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openFieldPanel(b.dataset.open, 'monitoring')));
    const csvBtn = el.querySelector('#lbCsv');
    if (csvBtn) csvBtn.addEventListener('click', () => downloadCsv(`leaderboard_${scene.day}.csv`,
      [['rank', 'field', 'area_ha', 'previous_date', 'previous_ndvi', 'date', 'ndvi', 'change']].concat(list.map((x, i) => [i + 1, x.f.name, (x.f.areaHectares || 0).toFixed(2), x.r.prev.scene.day, x.r.prev.mean.toFixed(3), x.r.cur.scene.day, x.r.cur.mean.toFixed(3), x.r.change.toFixed(3)]))));
  }

  function downloadCsv(name, rows) {
    const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + rows.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  window.downloadCsv = downloadCsv;

  // ------------------------------------------------------------ Reports (season analytics)

  async function renderReports(el) {
    const farm = state.farms.find((f) => f.id === state.selectedFarmId);
    const list = fields();
    const year = new Date().getFullYear();
    el.innerHTML = status('Collecting this season');
    let acts = [];
    try { acts = (await apiGet(`/activities/by-farm/${state.selectedFarmId}?from=${year}-01-01&to=${year}-12-31`)) || []; } catch { /* no activities */ }
    const img = I(); const scene = img && img.current();
    const area = list.reduce((s, f) => s + (f.areaHectares || 0), 0);
    const byCrop = new Map();
    list.forEach((f) => { const c = currentCropOf(f) || 'No crop'; byCrop.set(c, (byCrop.get(c) || 0) + (f.areaHectares || 0)); });
    const byType = new Map();
    acts.forEach((a) => byType.set(a.type, (byType.get(a.type) || 0) + 1));
    const label = Object.fromEntries((window.ActivityTypes || []).map(([v, l, c]) => [v, [l, c]]));
    const ranked = list.map((f) => ({ f, r: img && img.resultFor(f.id) })).filter((x) => x.r && Number.isFinite(x.r.mean) && x.r.indexKey === 'ndvi').sort((a, b) => b.r.mean - a.r.mean);
    const bar = (v, max, col) => `<span class="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100"><span class="block h-full rounded-full" style="width:${max ? (100 * v) / max : 0}%;background:${col}"></span></span>`;
    const maxCrop = Math.max(0, ...byCrop.values()), maxType = Math.max(0, ...byType.values());
    el.innerHTML = `
      <div class="space-y-6">
        <div class="grid grid-cols-2 gap-2">
          <div class="rounded-lg bg-gray-50 p-3"><div class="text-[12px] text-gray-500">Fields</div><div class="num mt-1 font-mono text-[20px] text-gray-900">${list.length}</div></div>
          <div class="rounded-lg bg-gray-50 p-3"><div class="text-[12px] text-gray-500">Area</div><div class="num mt-1 font-mono text-[20px] text-gray-900">${formatHa(area)}</div></div>
          <div class="rounded-lg bg-gray-50 p-3"><div class="text-[12px] text-gray-500">Activities ${year}</div><div class="num mt-1 font-mono text-[20px] text-gray-900">${acts.length}</div></div>
          <div class="rounded-lg bg-gray-50 p-3"><div class="text-[12px] text-gray-500">Mean NDVI${scene ? ' · ' + fmtDay(scene.day).replace(/ \d{4}$/, '') : ''}</div><div class="num mt-1 font-mono text-[20px] text-gray-900">${ranked.length ? f2(ranked.reduce((s, x) => s + x.r.mean * (x.f.areaHectares || 0), 0) / ranked.reduce((s, x) => s + (x.f.areaHectares || 0), 0)) : '—'}</div></div>
        </div>
        <div><div class="fp-h">Crop area</div><div class="space-y-1.5">${[...byCrop.entries()].sort((a, b) => b[1] - a[1]).map(([c, v]) => `<div class="flex items-center gap-2 text-[12px]"><span class="w-24 truncate text-gray-700">${escapeHtml(c)}</span>${bar(v, maxCrop, '#22c55e')}<span class="num w-16 text-right font-mono text-gray-500">${formatHa(v)}</span></div>`).join('')}</div></div>
        <div><div class="fp-h">Activities by type</div>${byType.size ? `<div class="space-y-1.5">${[...byType.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => `<div class="flex items-center gap-2 text-[12px]"><span class="w-24 truncate text-gray-700">${(label[t] || [t])[0]}</span>${bar(n, maxType, (label[t] || [0, '#9ca3af'])[1])}<span class="num w-8 text-right font-mono text-gray-500">${n}</span></div>`).join('')}</div>` : '<p class="text-[12px] text-gray-400">No activities logged this year</p>'}</div>
        <div><div class="fp-h">Best and worst fields by NDVI</div>${ranked.length ? `<div class="divide-y divide-gray-100">${ranked.slice(0, 3).concat(ranked.length > 3 ? ranked.slice(-3) : []).filter((x, i, a) => a.indexOf(x) === i).map((x) => `<button type="button" data-open="${x.f.id}" class="flex w-full items-center justify-between py-2 text-left text-[13px]"><span class="truncate text-gray-900">${escapeHtml(x.f.name)}</span><span class="num font-mono text-gray-500">${f2(x.r.mean)}</span></button>`).join('')}</div>` : '<p class="text-[12px] text-gray-400">Pick an NDVI date on the timeline</p>'}</div>
        <div class="grid grid-cols-2 gap-2">
          <button type="button" id="rpCsv" class="flex h-9 items-center justify-center gap-1.5 rounded-lg text-[13px] text-gray-700 ring-1 ring-gray-200 transition-colors hover:bg-gray-50">${icon('download')}CSV</button>
          <button type="button" id="rpPrint" class="flex h-9 items-center justify-center gap-1.5 rounded-lg text-[13px] text-gray-700 ring-1 ring-gray-200 transition-colors hover:bg-gray-50">${icon('fileText')}Print or PDF</button>
        </div>
      </div>`;
    el.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openFieldPanel(b.dataset.open, 'monitoring')));
    el.querySelector('#rpCsv').addEventListener('click', () => downloadCsv(`season_report_${(farm ? farm.name : 'farm').replace(/\W+/g, '_')}_${year}.csv`,
      [['field', 'area_ha', 'crop', 'irrigation', 'ndvi', 'ndvi_date', 'activities']].concat(list.map((f) => {
        const r = img && img.resultFor(f.id);
        return [f.name, (f.areaHectares || 0).toFixed(2), currentCropOf(f), f.irrigation || '', r && r.indexKey === 'ndvi' && Number.isFinite(r.mean) ? r.mean.toFixed(3) : '', r ? r.scene.day : '', acts.filter((a) => a.fieldId === f.id).length];
      }))));
    el.querySelector('#rpPrint').addEventListener('click', () => printReport(farm, list, acts, ranked, byCrop, year));
  }

  function printReport(farm, list, acts, ranked, byCrop, year) {
    let host = document.getElementById('reportPrint');
    if (!host) { host = document.createElement('div'); host.id = 'reportPrint'; host.style.display = 'none'; document.body.appendChild(host); }
    const rows = list.map((f) => { const r = ranked.find((x) => x.f.id === f.id); return `<tr><td>${escapeHtml(f.name)}</td><td>${(f.areaHectares || 0).toFixed(2)}</td><td>${escapeHtml(currentCropOf(f) || '')}</td><td>${r ? r.r.mean.toFixed(2) : ''}</td><td>${acts.filter((a) => a.fieldId === f.id).length}</td></tr>`; }).join('');
    host.innerHTML = `<style>#reportPrint{font:12px system-ui;color:#111;padding:24px}#reportPrint table{border-collapse:collapse;width:100%;margin-top:12px}#reportPrint td,#reportPrint th{border-bottom:1px solid #ddd;padding:6px;text-align:left}#reportPrint h1{font-size:18px;margin:0}</style>
      <h1>${escapeHtml(farm ? farm.name : 'Farm')} · season ${year}</h1>
      <p>${list.length} fields · ${list.reduce((s, f) => s + (f.areaHectares || 0), 0).toFixed(2)} ha · ${acts.length} activities · printed ${new Date().toLocaleDateString('en-GB')}</p>
      <p>Crops: ${[...byCrop.entries()].map(([c, v]) => `${escapeHtml(c)} ${v.toFixed(1)} ha`).join(' · ')}</p>
      <table><thead><tr><th>Field</th><th>Area (ha)</th><th>Crop</th><th>NDVI</th><th>Activities</th></tr></thead><tbody>${rows}</tbody></table>`;
    document.body.classList.add('printing');
    window.print();
    setTimeout(() => document.body.classList.remove('printing'), 500);
  }

  // ------------------------------------------------------------ Weather analytics

  const wa = { fieldId: null, base: 10, data: null, key: null };
  function seasonStart(f) {
    const crops = (f && f.crops) || [];
    const c = crops.filter((x) => x.plantingDate).sort((a, b) => (a.plantingDate < b.plantingDate ? 1 : -1))[0];
    const yearStart = `${new Date().getFullYear()}-01-01`;
    return c && c.plantingDate > `${new Date().getFullYear() - 1}-06-01` ? c.plantingDate : yearStart;
  }
  async function renderWeatherAnalytics(el) {
    const list = fields();
    if (!list.length) { el.innerHTML = '<p class="text-[13px] text-gray-500">Add a field to see its weather</p>'; return; }
    if (!wa.fieldId || !list.some((f) => f.id === wa.fieldId)) wa.fieldId = (window.FieldPanel && FieldPanel.fieldId) || list[0].id;
    const f = list.find((x) => x.id === wa.fieldId);
    const c = centroid(f.id);
    const start = seasonStart(f);
    const end = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
    el.innerHTML = `
      <div class="space-y-4">
        <div class="grid grid-cols-2 gap-2">
          <select id="waField" class="fp-input">${list.map((x) => `<option value="${x.id}" ${x.id === f.id ? 'selected' : ''}>${escapeHtml(x.name)}</option>`).join('')}</select>
          <select id="waBase" class="fp-input">${[0, 5, 10].map((b) => `<option value="${b}" ${b === wa.base ? 'selected' : ''}>GDD base ${b} °C</option>`).join('')}</select>
        </div>
        <p class="num font-mono text-[11px] text-gray-500">${fmtDay(start)} → ${fmtDay(end)} · ${c ? `${c.lat}, ${c.lng}` : ''}</p>
        <div id="waBody">${status('Loading the weather history')}</div>
      </div>`;
    el.querySelector('#waField').addEventListener('change', (e) => { wa.fieldId = e.target.value; renderWeatherAnalytics(el); });
    el.querySelector('#waBase').addEventListener('change', (e) => { wa.base = +e.target.value; renderWeatherAnalytics(el); });
    if (!c || start > end) { el.querySelector('#waBody').innerHTML = '<p class="text-[12px] text-gray-500">The season has just started; history appears after a few days</p>'; return; }
    const key = `${f.id}|${start}|${end}`;
    try {
      if (wa.key !== key) { wa.data = (await apiGet(`/weather/field/${f.id}/history?lat=${c.lat}&lng=${c.lng}&start=${start}&end=${end}`)).days || []; wa.key = key; }
    } catch (err) { el.querySelector('#waBody').innerHTML = errBox('Weather history is not available right now'); return; }
    const days = wa.data.filter((d) => d.temperatureMaxC != null);
    if (!days.length) { el.querySelector('#waBody').innerHTML = '<p class="text-[12px] text-gray-500">No weather data for this period</p>'; return; }
    let rain = 0, gdd = 0, heat = 0, cold = 0;
    const t = (d) => +new Date(d.date);
    const rainPts = [], cumRain = [], gddPts = [], tmax = [], tmin = [];
    days.forEach((d) => {
      const p = +d.precipitationMm || 0; rain += p;
      gdd += Math.max(0, (d.temperatureMaxC + d.temperatureMinC) / 2 - wa.base);
      if (d.temperatureMaxC >= 30) heat++; if (d.temperatureMinC <= -6) cold++;
      rainPts.push({ x: t(d), y: p }); cumRain.push({ x: t(d), y: rain }); gddPts.push({ x: t(d), y: gdd });
      tmax.push({ x: t(d), y: d.temperatureMaxC }); tmin.push({ x: t(d), y: d.temperatureMinC });
    });
    const x0 = fmtDay(days[0].date), x1 = fmtDay(days[days.length - 1].date);
    el.querySelector('#waBody').innerHTML = `
      <div class="grid grid-cols-3 gap-2">
        <div class="rounded-lg bg-gray-50 p-2.5"><div class="text-[11px] text-gray-500">Rain</div><div class="num font-mono text-[15px] text-gray-900">${rain.toFixed(0)} mm</div></div>
        <div class="rounded-lg bg-gray-50 p-2.5"><div class="text-[11px] text-gray-500">GDD</div><div class="num font-mono text-[15px] text-gray-900">${Math.round(gdd)}</div></div>
        <div class="rounded-lg bg-gray-50 p-2.5"><div class="text-[11px] text-gray-500">Days ≥ 30 °C</div><div class="num font-mono text-[15px] ${heat ? 'text-amber-700' : 'text-gray-900'}">${heat}</div></div>
      </div>
      <div><div class="fp-h">Precipitation</div>${lineChart([{ points: rainPts, color: '#38bdf8', bars: true }, { points: cumRain.map((p) => ({ x: p.x, y: p.y * Math.max(...rainPts.map((q) => q.y), 1) / Math.max(rain, 1) })), color: '#7dd3fc', width: 1.5 }], { yZero: true, fmt: (v) => v.toFixed(0), xLabel0: x0, xLabel1: x1 })}${legend([['#38bdf8', 'Daily mm'], ['#7dd3fc', `Accumulated, ${rain.toFixed(0)} mm total`]])}</div>
      <div><div class="fp-h">Temperature</div>${lineChart([{ points: tmax, color: '#f87171' }, { points: tmin, color: '#60a5fa' }], { fmt: (v) => v.toFixed(0) + '°', xLabel0: x0, xLabel1: x1 })}${legend([['#f87171', 'Max'], ['#60a5fa', 'Min'], ['#f59e0b', `Heat stress ≥ 30 °C: ${heat} days`]])}</div>
      <div><div class="fp-h">Growing degree days, base ${wa.base} °C</div>${lineChart([{ points: gddPts, color: '#fbbf24', width: 2 }], { yZero: true, fmt: (v) => v.toFixed(0), xLabel0: x0, xLabel1: x1 })}</div>
      <p class="text-[11px] text-gray-400">Open-Meteo historical weather · the last 5 days are not in the archive yet${cold ? ` · ${cold} days at or below −6 °C` : ''}</p>`;
  }

  // ------------------------------------------------------------ Forecast

  async function renderForecast(el) {
    const list = fields();
    if (!list.length) { el.innerHTML = '<p class="text-[13px] text-gray-500">Add a field to see the forecast</p>'; return; }
    const f = list.find((x) => x.id === (window.FieldPanel && FieldPanel.fieldId)) || list[0];
    const c = centroid(f.id);
    el.innerHTML = status('Loading the forecast');
    const fmt = (d) => d.toISOString().slice(0, 10);
    let days = [];
    try { days = (await apiGet(`/weather/field/${f.id}/forecast?lat=${c.lat}&lng=${c.lng}&start=${fmt(new Date())}&end=${fmt(new Date(Date.now() + 13 * 86400000))}`)).days || []; }
    catch { el.innerHTML = errBox('The forecast is not available right now'); return; }
    const spray = (d) => { const w = +d.windSpeedMaxKmh || 0, p = +d.precipitationMm || 0, t = d.temperatureMaxC;
      return w < 15 && p < 1 && t < 30 ? ['#22c55e', 'Good'] : w < 25 && p < 3 && t < 34 ? ['#f59e0b', 'Marginal'] : ['#ef4444', 'Avoid']; };
    el.innerHTML = `
      <p class="text-[12px] text-gray-500">14 days at ${escapeHtml(f.name)} · spraying window from wind, rain and heat</p>
      <div class="mt-3 divide-y divide-gray-100">${days.map((d) => { const [col, l] = spray(d); return `
        <div class="num flex h-10 items-center gap-2 font-mono text-[12px]">
          <span class="w-20 text-gray-500">${new Date(d.date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
          <span class="w-16 text-gray-900">${Math.round(d.temperatureMaxC)}°/${Math.round(d.temperatureMinC)}°</span>
          <span class="w-14 text-right text-sky-400">${(+d.precipitationMm || 0).toFixed(1)} mm</span>
          <span class="w-14 text-right text-gray-500">${Math.round(+d.windSpeedMaxKmh || 0)} km/h</span>
          <span class="ml-auto flex items-center gap-1 font-sans text-[11px] text-gray-500" title="Spraying"><span class="h-2 w-2 rounded-full" style="background:${col}"></span>${l}</span>
        </div>`; }).join('')}</div>
      <p class="mt-2 text-[11px] text-gray-400">Good: wind under 15 km/h, under 1 mm rain and below 30 °C · Open-Meteo</p>`;
  }

  // ------------------------------------------------------------ Notifications

  function renderNotifications(el) {
    const img = I(); const scene = img && img.current();
    const list = fields().map((f) => ({ f, r: img && img.riskFor(f.id) })).filter((x) => x.r && (x.r.kind === 'high' || x.r.kind === 'low'))
      .sort((a, b) => a.r.change - b.r.change);
    const latest = img && img.state.scenes.find((s) => s.tileCloud < img.config.cloudThreshold);
    el.innerHTML = `
      <div class="space-y-2">
        ${latest ? `<div class="flex gap-3 rounded-lg bg-gray-50 p-3"><span class="text-gray-400">${icon('satellite')}</span><div><div class="text-[13px] text-gray-900">New Sentinel-2 image</div><div class="num font-mono text-[12px] text-gray-500">${fmtDay(latest.day)} · ${Math.round(latest.tileCloud)}% tile cloud</div></div></div>` : ''}
        ${list.map((x) => `<button type="button" data-open="${x.f.id}" class="flex w-full gap-3 rounded-lg bg-gray-50 p-3 text-left transition-colors hover:bg-gray-100">
          <span class="mt-1 h-2 w-2 shrink-0 rounded-full" style="background:${x.r.kind === 'high' ? '#ef4444' : '#f59e0b'}"></span>
          <div class="min-w-0"><div class="text-[13px] text-gray-900">${x.r.kind === 'high' ? 'High NDVI drop' : 'NDVI drop'} · ${escapeHtml(x.f.name)}</div>
          <div class="num font-mono text-[12px] text-gray-500">${f2(x.r.prev.mean)} → ${f2(x.r.cur.mean)} (${sgn(x.r.change)}) · ${fmtDay(x.r.prev.scene.day)} → ${fmtDay(x.r.cur.scene.day)}</div></div>
        </button>`).join('')}
        ${!list.length ? `<p class="text-[13px] text-gray-500">${scene ? 'No NDVI drops on the selected date' : 'Pick a date on the timeline'}</p>` : ''}
      </div>`;
    el.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openFieldPanel(b.dataset.open, 'monitoring')));
  }

  // ------------------------------------------------------------ register

  Shell.register('leaderboard', { title: 'Leaderboard', render: renderLeaderboard });
  Shell.register('reports', { title: 'Reports', render: renderReports });
  Shell.register('weather-analytics', { title: 'Weather analytics', render: renderWeatherAnalytics });
  Shell.register('weather-forecast', { title: 'Forecast', render: renderForecast });
  Shell.register('notifications', { title: 'Notifications', render: renderNotifications });
  ['imagery:risks', 'imagery:change'].forEach((e) => document.addEventListener(e, () => { Shell.rerender('leaderboard'); Shell.rerender('notifications'); }));
})();
