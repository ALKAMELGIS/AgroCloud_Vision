/*
 * AgroCloud Vision — workspace shell
 *
 * Navigation rail (Monitoring: Fields, Leaderboard, Reports · Weather:
 * Analytics, Forecast · Field activity log · VRA maps: Sowing, Vegetation,
 * P&K, Map builder, Soil sampling · Scout tasks · Notifications), view
 * switching in the side panel, map tools (location search, zoom, measure,
 * swipe) and the "Check fields with risks" chips.
 *
 * Modules register views with Shell.register(id, { title, render(el) }).
 */
(function () {
  'use strict';

  const NAV = [
    { group: 'monitoring', label: 'Monitoring', icon: 'layers', items: [['fields', 'Fields'], ['leaderboard', 'Leaderboard'], ['reports', 'Reports']] },
    { group: 'weather', label: 'Weather', icon: 'cloud', items: [['weather-analytics', 'Analytics'], ['weather-forecast', 'Forecast']] },
    { id: 'activity-log', label: 'Field activity log', icon: 'calendar' },
    { group: 'vra', label: 'VRA maps', icon: 'grid', items: [['vra-sowing', 'Sowing'], ['vra-vegetation', 'Vegetation'], ['vra-pk', 'P&K'], ['vra-builder', 'Map builder'], ['soil-sampling', 'Soil sampling']] },
    { id: 'scout', label: 'Scout tasks', icon: 'mapPin' },
    { id: 'notifications', label: 'Notifications', icon: 'bell' },
  ];

  const views = new Map();
  const shell = { current: 'fields' };
  window.Shell = shell;

  const navEl = document.getElementById('navItems');
  const year = new Date().getFullYear();
  navEl.innerHTML = `
    <div class="mb-2 flex h-9 items-center gap-2.5 rounded-lg px-3 text-[13px] text-gray-500">${icon('sprout')}<span>Season ${year}</span></div>
    ${NAV.map((n) => n.group ? `
      <div class="nav-group" data-open="true">
        <button type="button" class="nav-item" data-group="${n.group}">${icon(n.icon)}<span>${n.label}</span>${icon('chevron', 'chev')}</button>
        <div class="nav-subs mt-0.5 flex flex-col gap-0.5">${n.items.map(([id, l]) => `<button type="button" class="nav-sub" data-view="${id}">${l}</button>`).join('')}</div>
      </div>` : `
      <button type="button" class="nav-item mt-0.5" data-view="${n.id}">${icon(n.icon)}<span>${n.label}</span><span class="nav-badge ml-auto hidden rounded-full bg-red-600 px-1.5 text-[10px] font-medium text-white"></span></button>`).join('')}`;

  navEl.querySelectorAll('[data-group]').forEach((b) => b.addEventListener('click', () => {
    const g = b.parentElement; g.dataset.open = g.dataset.open === 'false' ? 'true' : 'false';
  }));
  navEl.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => show(b.dataset.view)));

  const moduleEl = document.getElementById('viewModule');
  const fieldsEl = document.getElementById('viewFields');

  function markNav(id) {
    navEl.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-current', String(b.dataset.view === id)));
  }

  function show(id) {
    if (id === 'activity-log') { if (window.openActivityLog) window.openActivityLog(); return; }
    shell.current = id;
    markNav(id);
    const fp = document.getElementById('fieldPanel');
    if (id === 'fields') {
      moduleEl.classList.add('hidden'); moduleEl.classList.remove('flex');
      fieldsEl.classList.remove('hidden'); fieldsEl.classList.add('flex');
      document.dispatchEvent(new CustomEvent('shell:view', { detail: id }));
      return;
    }
    if (fp && !fp.classList.contains('hidden')) document.getElementById('fpClose').click();
    fieldsEl.classList.add('hidden'); fieldsEl.classList.remove('flex');
    moduleEl.classList.remove('hidden'); moduleEl.classList.add('flex');
    const v = views.get(id);
    moduleEl.innerHTML = `
      <div class="flex items-center justify-between px-4 pb-3 pt-4">
        <h1 class="text-[20px] font-medium">${v ? v.title : id}</h1>
        <button type="button" id="moduleClose" class="rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-900" aria-label="Back to fields">${icon('x')}</button>
      </div>
      <div id="moduleBody" class="thin-scroll min-h-0 flex-1 overflow-y-auto px-4 pb-4"></div>`;
    document.getElementById('moduleClose').addEventListener('click', () => show('fields'));
    const body = document.getElementById('moduleBody');
    if (v) {
      try { v.render(body); } catch (err) { body.innerHTML = `<p class="text-[13px] text-red-600">${escapeHtml(err.message)}</p>`; }
    } else body.innerHTML = '<p class="text-[13px] text-gray-500">Loading</p>';
    document.dispatchEvent(new CustomEvent('shell:view', { detail: id }));
  }

  shell.register = (id, def) => { views.set(id, def); if (shell.current === id) show(id); };
  shell.show = show;
  shell.rerender = (id) => { if (shell.current === id) show(id); };
  shell.setBadge = (id, n) => {
    const b = navEl.querySelector(`[data-view="${id}"] .nav-badge`);
    if (!b) return;
    b.textContent = n > 99 ? '99+' : String(n);
    b.classList.toggle('hidden', !n);
  };
  // Opening a field shows the Fields view underneath.
  const origOpen = window.openFieldPanel;
  window.openFieldPanel = function (id, tab) {
    if (shell.current !== 'fields') show('fields');
    return origOpen(id, tab);
  };
  markNav('fields');

  // ------------------------------------------------------------ risk chips

  const RISKS = [['all', 'All'], ['high', 'High NDVI drop'], ['low', 'NDVI drop'], ['nodata', 'No data'], ['none', 'No risks']];
  const RISK_DOT = { high: '#ef4444', low: '#f59e0b', nodata: '#6f7782', none: '#22c55e' };
  function renderRiskChips() {
    const box = document.getElementById('riskChips');
    const fields = state.fieldList || [];
    const img = window.Imagery;
    const count = (k) => (k === 'all' ? fields.length : fields.filter((f) => ((img && img.riskFor(f.id)) || { kind: 'nodata' }).kind === k).length);
    const sel = fieldListState.risk;
    box.innerHTML = RISKS.map(([k, l]) => `
      <button type="button" data-risk="${k}" class="flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] transition-colors ${sel === k ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'}">
        ${k !== 'all' ? `<span class="h-1.5 w-1.5 rounded-full" style="background:${RISK_DOT[k]}"></span>` : ''}${l}<span class="num font-mono text-[11px] text-gray-400">${count(k)}</span>
      </button>`).join('');
    box.querySelectorAll('[data-risk]').forEach((b) => b.addEventListener('click', () => {
      fieldListState.risk = b.dataset.risk; renderRiskChips(); renderFieldsList();
    }));
    const alerts = fields.filter((f) => { const r = img && img.riskFor(f.id); return r && (r.kind === 'high' || r.kind === 'low'); }).length;
    shell.setBadge('notifications', alerts);
  }
  ['imagery:risks', 'imagery:change', 'workspace:fields'].forEach((e) => document.addEventListener(e, renderRiskChips));

  // ------------------------------------------------------------ location search

  const form = document.getElementById('geoSearchForm');
  const input = document.getElementById('geoSearch');
  const results = document.getElementById('geoResults');
  let searchMarker = null;
  function closeResults() { results.classList.add('hidden'); results.classList.remove('flex'); }
  function goTo(lat, lng, bbox, label) {
    if (!mapInstance) return;
    if (bbox) mapInstance.fitBounds([[bbox[0], bbox[2]], [bbox[1], bbox[3]]], { maxZoom: 15 });
    else mapInstance.setView([lat, lng], 15);
    if (searchMarker) mapInstance.removeLayer(searchMarker);
    searchMarker = L.circleMarker([lat, lng], { radius: 6, color: '#fff', weight: 2, fillColor: '#22c55e', fillOpacity: 1 })
      .bindTooltip(escapeHtml(label), { direction: 'top' }).addTo(mapInstance);
    closeResults();
  }
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    const m = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (m && Math.abs(+m[1]) <= 90 && Math.abs(+m[2]) <= 180) { goTo(+m[1], +m[2], null, `${(+m[1]).toFixed(5)}, ${(+m[2]).toFixed(5)}`); return; }
    results.classList.remove('hidden'); results.classList.add('flex');
    results.innerHTML = `<div class="flex items-center gap-2 px-3 py-2 text-[13px] text-gray-500">${icon('loader', 'spin')}Searching</div>`;
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=${encodeURIComponent(q)}`, { headers: { 'Accept-Language': 'en' } });
      const list = await res.json();
      if (!list.length) { results.innerHTML = '<div class="px-3 py-2 text-[13px] text-gray-500">No places found</div>'; return; }
      results.innerHTML = list.map((r, i) => `<button type="button" data-i="${i}" class="menu-item !items-start"><span class="text-gray-400">${icon('mapPin')}</span><span class="min-w-0"><span class="block truncate">${escapeHtml(r.name || r.display_name.split(',')[0])}</span><span class="block truncate text-[11px] text-gray-500">${escapeHtml(r.display_name)}</span></span></button>`).join('');
      results.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => {
        const r = list[+b.dataset.i];
        goTo(+r.lat, +r.lon, r.boundingbox && r.boundingbox.map(Number), r.display_name);
      }));
    } catch {
      results.innerHTML = '<div class="px-3 py-2 text-[13px] text-red-600">Search is not available right now</div>';
    }
  });
  document.addEventListener('click', (e) => { if (!form.parentElement.contains(e.target)) closeResults(); });

  // ------------------------------------------------------------ zoom / swipe / measure

  document.getElementById('zoomInBtn').addEventListener('click', () => mapInstance && mapInstance.zoomIn());
  document.getElementById('zoomOutBtn').addEventListener('click', () => mapInstance && mapInstance.zoomOut());
  document.getElementById('swipeBtn').addEventListener('click', () => {
    if (!window.Imagery || !Imagery.current()) { showError('Pick a satellite date first'); return; }
    Imagery.setSwipe(!Imagery.state.swipe);
  });

  const measureBtn = document.getElementById('measureBtn');
  const measureMenu = document.getElementById('measureMenu');
  const measured = [];
  let measureHandler = null;
  measureBtn.addEventListener('click', (e) => { e.stopPropagation(); measureMenu.classList.toggle('hidden'); measureMenu.classList.toggle('flex'); });
  document.addEventListener('click', (e) => { if (!measureMenu.contains(e.target)) { measureMenu.classList.add('hidden'); measureMenu.classList.remove('flex'); } });
  function fmtLen(m) { return m >= 1000 ? (m / 1000).toFixed(2) + ' km' : Math.round(m) + ' m'; }
  measureMenu.querySelectorAll('[data-measure]').forEach((b) => b.addEventListener('click', () => {
    measureMenu.classList.add('hidden'); measureMenu.classList.remove('flex');
    if (measureHandler) { measureHandler.disable(); measureHandler = null; }
    if (b.dataset.measure === 'clear') { measured.forEach((l) => mapInstance.removeLayer(l)); measured.length = 0; measureBtn.setAttribute('aria-pressed', 'false'); return; }
    const style = { color: '#ffffff', weight: 2, dashArray: '6 4', fillOpacity: 0.08 };
    measureHandler = b.dataset.measure === 'line'
      ? new L.Draw.Polyline(mapInstance, { shapeOptions: style, metric: true, showLength: true })
      : new L.Draw.Polygon(mapInstance, { shapeOptions: style, metric: true, showArea: true, allowIntersection: false });
    measureHandler._measuring = true;
    measureHandler.enable();
    measureBtn.setAttribute('aria-pressed', 'true');
  }));
  // Measurements must not open the New field dialog: intercept the draw event before workspace's handler.
  const origFire = L.Map.prototype.fire;
  L.Map.prototype.fire = function (type, data, propagate) {
    if (type === L.Draw.Event.CREATED && measureHandler && data && data.layer) {
      const layer = data.layer;
      let label;
      if (data.layerType === 'polyline') {
        const pts = layer.getLatLngs(); let m = 0;
        for (let i = 1; i < pts.length; i++) m += pts[i - 1].distanceTo(pts[i]);
        label = fmtLen(m);
      } else {
        const gj = layer.toGeoJSON().geometry;
        const ha = GisImport.polygonAreaHa(gj.coordinates);
        const per = layer.getLatLngs()[0].reduce((s, p, i, a) => s + p.distanceTo(a[(i + 1) % a.length]), 0);
        label = `${formatHa(ha)} · ${fmtLen(per)} perimeter`;
      }
      layer.addTo(this); layer.bindTooltip(label, { permanent: true, direction: 'center', className: 'num' }).openTooltip();
      measured.push(layer);
      measureHandler = null;
      return this;
    }
    return origFire.call(this, type, data, propagate);
  };
})();
