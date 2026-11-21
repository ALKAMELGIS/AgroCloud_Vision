/*
 * AgroOne — workspace shell
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

  // Structure follows the shared SidebarNav component: optional heading per group,
  // items with icon, badge, shortcut and animated children.
  const GROUPS = [
    { items: [
      { id: 'search', title: 'Search', icon: 'search', shortcut: '⌘K' },
      { id: 'fields', title: 'Fields', icon: 'layers' },
      { id: 'notifications', title: 'Notifications', icon: 'bell', badge: true },
    ] },
    { heading: 'Monitoring', items: [
      { id: 'leaderboard', title: 'Leaderboard', icon: 'trophy' },
      { id: 'reports', title: 'Reports', icon: 'fileText' },
      { id: 'weather', title: 'Weather', icon: 'cloud', children: [
        { id: 'weather-analytics', title: 'Analytics' }, { id: 'weather-forecast', title: 'Forecast' } ] },
    ] },
    { heading: 'Operations', items: [
      { id: 'activity-log', title: 'Field activity log', icon: 'calendar' },
      { id: 'scout', title: 'Scout tasks', icon: 'mapPin', badge: true },
    ] },
    { heading: 'Precision ag', items: [
      { id: 'vra', title: 'VRA maps', icon: 'grid', children: [
        { id: 'vra-sowing', title: 'Sowing' }, { id: 'vra-vegetation', title: 'Vegetation' },
        { id: 'vra-pk', title: 'P&K' }, { id: 'vra-builder', title: 'Map builder' } ] },
      { id: 'soil-sampling', title: 'Soil sampling', icon: 'flask' },
    ] },
  ];

  const views = new Map();
  const shell = { current: 'fields' };
  window.Shell = shell;
  const rail = document.getElementById('navRail');
  const navEl = document.getElementById('navItems');

  function itemHtml(it, child) {
    if (it.children) return `
      <div class="nav-item-wrap" data-parent="${it.id}" data-open="false">
        <button type="button" class="nav-row" data-toggle="${it.id}" title="${it.title}">
          <span class="nav-label">${icon(it.icon)}<span>${it.title}</span></span>
          <span class="nav-meta">${icon('chevronRight', 'nav-chev')}</span>
        </button>
        <div class="nav-children"><div>${it.children.map((c) => itemHtml(c, true)).join('')}</div></div>
      </div>`;
    return `
      <button type="button" class="nav-row" data-view="${it.id}" title="${it.title}" aria-current="false">
        <span class="nav-label">${child ? '' : icon(it.icon)}<span>${it.title}</span></span>
        <span class="nav-meta">${it.shortcut ? `<kbd class="kbd">${it.shortcut}</kbd>` : ''}${it.badge ? `<span class="nav-badge hidden" data-badge="${it.id}"></span>` : ''}</span>
        ${it.badge ? `<span class="nav-dot" data-dot="${it.id}"></span>` : ''}
      </button>`;
  }
  navEl.innerHTML = GROUPS.map((g) => `
    <div class="flex flex-col gap-0.5">
      ${g.heading ? `<span class="nav-heading">${g.heading}</span>` : ''}
      ${g.items.map((it) => itemHtml(it)).join('')}
    </div>`).join('');
  // account row, menu (settings, language, appearance, log out) and the Settings window: js/settings.js
  if (window.mountAccount) window.mountAccount();

  navEl.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', () => {
    const wrap = b.parentElement;
    if (rail.classList.contains('collapsed')) { const first = wrap.querySelector('[data-view]'); if (first) show(first.dataset.view); return; }
    wrap.dataset.open = wrap.dataset.open === 'true' ? 'false' : 'true';
  }));
  navEl.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.view === 'search') { openPalette(); return; }
    show(b.dataset.view);
  }));

  // collapse to an icon rail (remembered per browser)
  const collapseBtn = document.getElementById('navCollapse');
  function setCollapsed(on) {
    rail.classList.toggle('collapsed', on);
    collapseBtn.innerHTML = icon(on ? 'panelOpen' : 'panelClose');
    collapseBtn.title = on ? 'Expand sidebar' : 'Collapse sidebar';
    try { localStorage.setItem('navCollapsed', on ? '1' : '0'); } catch { /* private mode */ }
    setTimeout(() => { if (mapInstance) mapInstance.invalidateSize(); if (window.Imagery && Imagery.invalidate) Imagery.invalidate(); }, 280);
  }
  collapseBtn.addEventListener('click', () => setCollapsed(!rail.classList.contains('collapsed')));
  try { if (localStorage.getItem('navCollapsed') === '1') setCollapsed(true); } catch { /* ignore */ }

  // farm switcher (the component's "workspace switcher")
  const sw = document.getElementById('farmSwitcher');
  function renderSwitcher(open) {
    const farm = state.farms.find((f) => f.id === state.selectedFarmId);
    const list = state.fieldList || [];
    const ha = list.reduce((a, f) => a + (f.areaHectares || 0), 0);
    sw.innerHTML = `
      <button type="button" class="ws-btn" id="wsBtn" title="${farm ? escapeHtml(farm.name) : 'Farms'}">
        <span class="flex min-w-0 items-center gap-3">
          <span class="ws-avatar">${escapeHtml((farm ? farm.name : 'A').charAt(0).toUpperCase())}</span>
          <span class="ws-text flex min-w-0 flex-col">
            <span class="truncate text-[13px] font-medium leading-tight text-gray-900">${farm ? escapeHtml(farm.name) : 'No farm yet'}</span>
            <span class="num truncate text-[11px] leading-tight text-gray-500">${list.length} field${list.length === 1 ? '' : 's'} · ${formatHa(ha)}</span>
          </span>
        </span>
        <span class="ws-chev text-gray-500">${icon('chevronDown')}</span>
      </button>
      ${open ? `<div class="ws-menu">
        ${state.farms.map((f) => `<button type="button" class="ws-opt" data-farm="${f.id}" aria-current="${f.id === state.selectedFarmId}"><span class="truncate">${escapeHtml(f.name)}</span><span class="num font-mono text-[11px] text-gray-500">${f.fields?.length || 0}</span></button>`).join('')}
        <div class="mx-2 my-1 h-px bg-white/10"></div>
        <button type="button" class="ws-opt" data-new-farm><span class="flex items-center gap-2 text-gray-500">${icon('plus')}Create farm</span></button>
      </div>` : ''}`;
    sw.querySelector('#wsBtn').addEventListener('click', (e) => { e.stopPropagation(); renderSwitcher(!open); });
    sw.querySelectorAll('[data-farm]').forEach((b) => b.addEventListener('click', () => { renderSwitcher(false); if (b.dataset.farm !== state.selectedFarmId) selectFarm(b.dataset.farm); }));
    const nf = sw.querySelector('[data-new-farm]');
    if (nf) nf.addEventListener('click', () => { renderSwitcher(false); openGroupDialog(); });
  }
  document.addEventListener('click', (e) => { if (!sw.contains(e.target) && sw.querySelector('.ws-menu')) renderSwitcher(false); });
  const origFarms = window.renderFarmsList;
  window.renderFarmsList = function () { const r = origFarms.apply(this, arguments); renderSwitcher(false); return r; };
  document.addEventListener('workspace:fields', () => renderSwitcher(false));
  shell.renderSwitcher = renderSwitcher;

  const moduleEl = document.getElementById('viewModule');
  const fieldsEl = document.getElementById('viewFields');

  function markNav(id) {
    navEl.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-current', String(b.dataset.view === id)));
    navEl.querySelectorAll('.nav-item-wrap').forEach((w) => { if (w.querySelector(`[data-view="${id}"]`)) w.dataset.open = 'true'; });
  }

  function show(id) {
    if (id === 'activity-log') { if (window.openActivityLog) window.openActivityLog(); return; }
    setSidePanel(true);
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
  shell.setBadge = (id, n, alert) => {
    const b = navEl.querySelector(`[data-badge="${id}"]`), d = navEl.querySelector(`[data-dot="${id}"]`);
    if (!b) return;
    b.textContent = n > 99 ? '99+' : String(n);
    b.classList.toggle('hidden', !n); b.classList.toggle('alert', !!alert);
    if (d) d.classList.toggle('on', !!n);
  };
  // Opening a field shows the Fields view underneath.
  const origOpen = window.openFieldPanel;
  window.openFieldPanel = function (id, tab) {
    setSidePanel(true);
    if (shell.current !== 'fields') show('fields');
    return origOpen(id, tab);
  };

  // ------------------------------------------------------------ fields panel: hide / show

  // A slim tab on the panel's edge folds the panel away so the map takes the room. It
  // stays on the map edge to bring it back; opening a view, a field or a new field reopens it.
  const appRoot = document.getElementById('appRoot');
  const panelTab = document.createElement('button');
  panelTab.type = 'button';
  panelTab.id = 'panelToggle';
  panelTab.className = 'panel-tab';
  panelTab.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5"/></svg>';
  document.getElementById('mapMain').appendChild(panelTab);
  function setSidePanel(open) {
    const was = !appRoot.classList.contains('side-collapsed');
    appRoot.classList.toggle('side-collapsed', !open);
    panelTab.setAttribute('aria-expanded', String(open));
    panelTab.title = open ? 'Hide fields panel' : 'Show fields panel';
    panelTab.setAttribute('aria-label', panelTab.title);
    try { localStorage.setItem('panelCollapsed', open ? '0' : '1'); } catch { /* private mode */ }
    if (was !== open) setTimeout(() => { if (mapInstance) mapInstance.invalidateSize(); if (window.Imagery && Imagery.invalidate) Imagery.invalidate(); }, 300);
  }
  window.setSidePanel = setSidePanel;
  panelTab.addEventListener('click', () => setSidePanel(appRoot.classList.contains('side-collapsed')));
  try { if (localStorage.getItem('panelCollapsed') === '1') setSidePanel(false); else setSidePanel(true); } catch { setSidePanel(true); }
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
    shell.setBadge('notifications', alerts, true);
  }
  ['imagery:risks', 'imagery:change', 'workspace:fields'].forEach((e) => document.addEventListener(e, renderRiskChips));

  // ------------------------------------------------------------ location search

  const form = document.getElementById('geoSearchForm');
  const input = document.getElementById('geoSearch');
  const results = document.getElementById('geoResults');
  let searchMarker = null;
  const wrap = document.getElementById('geoSearchWrap');
  const toggle = document.getElementById('geoSearchToggle');
  function closeResults() { results.classList.add('hidden'); results.classList.remove('flex'); }
  function openSearch() {
    wrap.classList.add('open'); toggle.setAttribute('aria-expanded', 'true'); input.tabIndex = 0;
    setTimeout(() => input.focus(), 60);
  }
  function closeSearch() {
    wrap.classList.remove('open'); toggle.setAttribute('aria-expanded', 'false'); input.tabIndex = -1;
    closeResults(); input.blur();
  }
  window.openLocationSearch = openSearch;
  toggle.addEventListener('click', () => {
    if (!wrap.classList.contains('open')) openSearch();
    else if (input.value.trim()) form.requestSubmit();
    else closeSearch();
  });
  document.getElementById('geoSearchClose').addEventListener('click', () => { input.value = ''; closeSearch(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); input.value = ''; closeSearch(); } });
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
  document.addEventListener('click', (e) => {
    if (wrap.contains(e.target)) return;
    closeResults();
    if (!input.value.trim()) closeSearch();
  });

  // ------------------------------------------------------------ zoom / swipe / measure

  document.getElementById('zoomInBtn').addEventListener('click', () => mapInstance && mapInstance.zoomIn());
  document.getElementById('zoomOutBtn').addEventListener('click', () => mapInstance && mapInstance.zoomOut());
  const compareMenu = document.getElementById('compareMenu');
  const closeCompareMenu = () => { compareMenu.classList.add('hidden'); compareMenu.classList.remove('flex'); };
  function compare(mode) {
    closeCompareMenu();
    if (mode !== 'off' && (!window.Imagery || !Imagery.current())) { showError('Pick a satellite date first'); return; }
    Imagery.setCompare(mode);
  }
  window.startCompare = compare;
  document.getElementById('swipeBtn').addEventListener('click', (e) => {
    e.stopPropagation(); compareMenu.classList.toggle('hidden'); compareMenu.classList.toggle('flex');
  });
  compareMenu.querySelectorAll('[data-compare]').forEach((b) => b.addEventListener('click', () => compare(b.dataset.compare)));
  document.addEventListener('click', (e) => { if (!compareMenu.contains(e.target)) closeCompareMenu(); });

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

  // ------------------------------------------------------------ command palette (⌘K)

  const cmdk = document.getElementById('cmdk');
  const cInput = document.getElementById('cmdkInput');
  const cList = document.getElementById('cmdkList');
  let cItems = [], cSel = 0;
  function paletteItems(q) {
    const out = [];
    const add = (group, label, ico, run, hint) => out.push({ group, label, ico, run, hint });
    (state.fieldList || []).forEach((f) => add('Fields', f.name, 'layers', () => openFieldPanel(f.id), formatHa(f.areaHectares)));
    GROUPS.flatMap((g) => g.items.flatMap((it) => (it.children ? it.children.map((c) => ({ ...c, parent: it.title })) : [it])))
      .filter((it) => it.id !== 'search')
      .forEach((it) => add('Go to', it.parent ? `${it.parent} › ${it.title}` : it.title, it.icon || 'chevronRight', () => show(it.id)));
    const act = (label, ico, action) => add('Actions', label, ico, () => { const b = document.querySelector(`#addMenu [data-action="${action}"]`); if (b) b.click(); });
    act('Draw a polygon field', 'pentagon', 'draw-polygon'); act('Draw a pivot circle', 'circle', 'draw-circle');
    act('Upload field boundaries', 'upload', 'upload'); act('Add GIS data layer', 'layers', 'gis'); act('Select fields on the map', 'pointer', 'select');
    add('Actions', 'Swipe: compare two layers with a divider', 'swipe', () => compare('swipe'));
    add('Actions', 'Side by side: compare two screens', 'split', () => compare('split'));
    add('Actions', 'Measure a distance', 'ruler', () => { const b = document.querySelector('[data-measure="line"]'); if (b) b.click(); });
    add('Actions', 'Create farm', 'plus', () => openGroupDialog());
    if (window.Settings) {
      add('Settings', 'Settings', 'settings', () => Settings.open('general'));
      add('Settings', 'Appearance: light, dark or match device', 'sun', () => Settings.open('appearance'));
      add('Settings', 'Area unit: hectares, acres or dunums', 'settings', () => Settings.open('general'));
      add('Settings', 'Default map layer and imagery source', 'layers', () => Settings.open('map'));
    }
    state.farms.filter((f) => f.id !== state.selectedFarmId).forEach((f) => add('Farms', 'Switch to ' + f.name, 'home', () => selectFarm(f.id)));
    const ql = q.trim().toLowerCase();
    const hits = ql ? out.filter((i) => i.label.toLowerCase().includes(ql)) : out.filter((i) => i.group !== 'Fields' || out.indexOf(i) < 6);
    if (ql) hits.push({ group: 'Places', label: `Search places for “${q.trim()}”`, ico: 'mapPin', run: () => { window.openLocationSearch(); document.getElementById('geoSearch').value = q.trim(); document.getElementById('geoSearchForm').requestSubmit(); } });
    return hits;
  }
  function drawPalette() {
    cItems = paletteItems(cInput.value);
    cSel = Math.min(cSel, Math.max(0, cItems.length - 1));
    let last = '';
    cList.innerHTML = cItems.length ? cItems.map((it, i) => {
      const head = it.group !== last ? `<div class="cmdk-group">${it.group}</div>` : ''; last = it.group;
      return `${head}<button type="button" class="cmdk-item" data-i="${i}" aria-selected="${i === cSel}">${icon(it.ico)}<span class="truncate">${escapeHtml(it.label)}</span>${it.hint ? `<span class="cmdk-hint">${escapeHtml(it.hint)}</span>` : ''}</button>`;
    }).join('') : `<div class="flex flex-col items-center py-8 text-[13px] text-gray-500">${icon('command', 'mb-2 opacity-40')}No results</div>`;
    cList.querySelectorAll('[data-i]').forEach((b) => {
      b.addEventListener('mousemove', () => { if (cSel !== +b.dataset.i) { cSel = +b.dataset.i; mark(); } });
      b.addEventListener('click', () => runItem(+b.dataset.i));
    });
  }
  function mark() { cList.querySelectorAll('[data-i]').forEach((b) => b.setAttribute('aria-selected', String(+b.dataset.i === cSel))); const el = cList.querySelector(`[data-i="${cSel}"]`); if (el) el.scrollIntoView({ block: 'nearest' }); }
  function runItem(i) { const it = cItems[i]; closePalette(); if (it) it.run(); }
  function openPalette() { cmdk.classList.remove('hidden'); cmdk.classList.add('flex'); cInput.value = ''; cSel = 0; drawPalette(); setTimeout(() => cInput.focus(), 0); }
  function closePalette() { cmdk.classList.add('hidden'); cmdk.classList.remove('flex'); }
  shell.openPalette = openPalette;
  cInput.addEventListener('input', () => { cSel = 0; drawPalette(); });
  cInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); cSel = Math.min(cItems.length - 1, cSel + 1); mark(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); cSel = Math.max(0, cSel - 1); mark(); }
    else if (e.key === 'Enter') { e.preventDefault(); runItem(cSel); }
    else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
  });
  cmdk.querySelectorAll('[data-cmdk-close]').forEach((el) => el.addEventListener('click', closePalette));
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); cmdk.classList.contains('hidden') ? openPalette() : closePalette(); }
  });
})();
