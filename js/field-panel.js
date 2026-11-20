/*
 * AgroCloud Vision — field panel (workspace.html)
 *
 * Opens on the right when a field is clicked on the map or in the list.
 * Tabs: Overview (name, irrigation, farm, season, weather), Crops (seasons
 * and growth stage), Activities (operations log with product and rate),
 * Monitoring (satellite NDVI, filled by js/ndvi.js when it is loaded).
 * Also: edit boundary by dragging vertices, delete field.
 *
 * Uses the workspace globals: state, mapInstance, apiGet, apiPost, apiPatch,
 * apiDelete, icon, hydrateIcons, escapeHtml, formatHa, showError, showToast,
 * goToFarm, setSelectedField, flyToField, IRRIGATION, COLORS.
 */
(function () {
  'use strict';

  const ACTIVITY_TYPES = [
    ['fertilization', 'Fertilizer', '#2563eb'],
    ['irrigation', 'Irrigation', '#0891b2'],
    ['spraying', 'Spraying', '#7c3aed'],
    ['planting', 'Sowing / planting', '#16a34a'],
    ['tillage', 'Tillage', '#a16207'],
    ['harvest', 'Harvest', '#d97706'],
    ['scouting_visit', 'Scouting', '#db2777'],
    ['pruning', 'Pruning', '#4b5563'],
    ['other', 'Other', '#9ca3af'],
  ];
  const ACTIVITY = Object.fromEntries(ACTIVITY_TYPES.map(([v, l, c]) => [v, { label: l, color: c }]));
  const UNITS = ['kg/ha', 'L/ha', 'g/ha', 't/ha', 'seeds/ha', 'mm', 'm³/ha'];
  const DEFAULT_UNIT = { fertilization: 'kg/ha', spraying: 'L/ha', irrigation: 'mm', planting: 'kg/ha', harvest: 't/ha' };
  const STAGES = [
    ['planted', 'Planted'], ['germination', 'Germination'], ['vegetative', 'Vegetative'], ['flowering', 'Flowering'],
    ['fruiting', 'Fruiting'], ['maturity', 'Maturity'], ['harvested', 'Harvested'],
  ];
  const CROPS = ['Alfalfa', 'Rhodes grass', 'Wheat', 'Barley', 'Maize', 'Sorghum', 'Date palm', 'Potato', 'Tomato', 'Onion', 'Cotton', 'Soybean', 'Sunflower', 'Citrus', 'Olive'];

  window.ActivityTypes = ACTIVITY_TYPES;

  const today = () => new Date().toISOString().slice(0, 10);
  const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
  const fmtDate = (d) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

  // ------------------------------------------------------------ markup

  const panel = document.createElement('aside');
  panel.id = 'fieldPanel';
  panel.className = 'hidden absolute inset-0 z-20 flex-col overflow-hidden bg-white';
  panel.innerHTML = `
    <div class="border-b border-gray-100 px-4 pb-3 pt-4">
      <button type="button" id="fpBack" class="mb-2 flex items-center gap-1.5 text-[12px] text-gray-500 transition-colors hover:text-gray-900">${icon('arrowLeft')}<span>Fields</span></button>
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <h2 id="fpName" class="truncate text-[16px] font-medium text-gray-900"></h2>
          <p id="fpMeta" class="num mt-0.5 truncate font-mono text-[12px] text-gray-500"></p>
        </div>
        <button type="button" id="fpClose" class="rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700" aria-label="Close">${icon('x')}</button>
      </div>
      <div class="mt-3 flex gap-1.5">
        <button type="button" id="fpZoom" class="fp-act">${icon('focus')}<span>Zoom</span></button>
        <button type="button" id="fpEdit" class="fp-act">${icon('pencil')}<span>Edit boundary</span></button>
        <button type="button" id="fpDelete" class="fp-act ml-auto hover:!text-red-600">${icon('trash')}<span>Delete</span></button>
      </div>
    </div>
    <div class="flex h-10 shrink-0 gap-4 border-b border-gray-100 px-4 text-[13px]" role="tablist">
      <button class="fp-tab" data-tab="monitoring" role="tab">Analytics</button>
      <button class="fp-tab" data-tab="overview" role="tab">Overview</button>
      <button class="fp-tab" data-tab="crops" role="tab">Crops</button>
      <button class="fp-tab" data-tab="activities" role="tab">Activities</button>
    </div>
    <div class="thin-scroll min-h-0 flex-1 overflow-y-auto">
      <section data-pane="overview" class="fp-pane hidden space-y-6 p-4"></section>
      <section data-pane="crops" class="fp-pane hidden space-y-4 p-4"></section>
      <section data-pane="activities" class="fp-pane hidden space-y-4 p-4"></section>
      <section data-pane="monitoring" class="fp-pane p-4"></section>
    </div>`;
  document.getElementById('sidePanel').appendChild(panel);

  const style = document.createElement('style');
  style.textContent = `
    .fp-act { display:inline-flex; align-items:center; gap:6px; height:28px; padding:0 8px; border-radius:7px; font-size:12px; color:#4b5563; box-shadow: inset 0 0 0 1px #e5e7eb; transition: background-color .12s, color .12s; }
    .fp-act:hover { background:#f9fafb; color:#111827; }
    .fp-act .ico { width:14px; height:14px; }
    .fp-tab { position:relative; color:#6b7280; transition:color .12s; }
    .fp-tab:hover { color:#111827; }
    .fp-tab[aria-selected="true"] { color:#111827; font-weight:500; }
    .fp-tab[aria-selected="true"]::after { content:''; position:absolute; left:0; right:0; bottom:-1px; height:2px; border-radius:2px; background:#16a34a; }
    .fp-label { display:block; margin-bottom:6px; font-size:12px; font-weight:500; color:#6b7280; }
    .fp-input { height:36px; width:100%; border-radius:8px; border:1px solid #e5e7eb; background:#fff; padding:0 10px; font-size:13px; outline:none; transition: border-color .12s, box-shadow .12s; }
    .fp-input:focus { border-color:#16a34a; box-shadow:0 0 0 3px rgb(22 163 74 / .15); }
    textarea.fp-input { height:auto; padding:8px 10px; resize:vertical; }
    .fp-btn { height:36px; padding:0 14px; border-radius:8px; font-size:13px; font-weight:500; color:#fff; background:#16a34a; transition: background-color .12s, opacity .12s; }
    .fp-btn:hover { background:#15803d; } .fp-btn:disabled { opacity:.4; }
    .fp-ghost { height:36px; padding:0 12px; border-radius:8px; font-size:13px; font-weight:500; color:#374151; box-shadow: inset 0 0 0 1px #e5e7eb; transition: background-color .12s; }
    .fp-ghost:hover { background:#f9fafb; }
    .fp-h { font-size:12px; font-weight:500; color:#6b7280; margin-bottom:8px; }
    .fp-dot { width:8px; height:8px; border-radius:50%; flex:none; }
    .fp-row-del { opacity:0; transition:opacity .12s; } .fp-row:hover .fp-row-del, .fp-row-del:focus { opacity:1; }
  `;
  document.head.appendChild(style);

  const $ = (sel) => panel.querySelector(sel);
  const pane = (name) => panel.querySelector(`[data-pane="${name}"]`);

  // ------------------------------------------------------------ state

  const fp = { fieldId: null, field: null, crops: [], activities: [], tab: 'monitoring', editLayer: null, weatherKey: null };
  window.FieldPanel = fp;

  function currentField() {
    return state.fieldsById && state.fieldsById.get(fp.fieldId);
  }
  function fieldCenter(field) {
    const layer = state.fieldLayerById.get(field.id);
    if (!layer) return null;
    const c = layer.getBounds().getCenter();
    return { lat: +c.lat.toFixed(5), lng: +c.lng.toFixed(5) };
  }
  function irrigationLabel(v) {
    const hit = IRRIGATION.find(([k]) => k === (v || ''));
    return hit && v ? hit[1] : 'Irrigation not set';
  }

  // ------------------------------------------------------------ open / close

  document.addEventListener('imagery:change', () => { if (fp.fieldId && fp.tab === 'monitoring') renderMonitoring(); });

  window.openFieldPanel = async function (fieldId, tab) {
    if (fp.editLayer) cancelEdit();
    fp.fieldId = fieldId;
    const field = currentField();
    if (!field) return;
    fp.field = field;
    setSelectedField(fieldId);
    flyToField(fieldId);
    panel.classList.remove('hidden'); panel.classList.add('flex');
    renderHeader();
    selectTab(tab || fp.tab || 'overview');
    await loadFieldData();
  };

  function closePanel() {
    if (fp.editLayer) cancelEdit();
    panel.classList.add('hidden'); panel.classList.remove('flex');
    fp.fieldId = null;
    setSelectedField(null);
    document.dispatchEvent(new CustomEvent('fieldpanel:close'));
  }
  $('#fpClose').addEventListener('click', closePanel);
  $('#fpBack').addEventListener('click', closePanel);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && fp.fieldId && !document.querySelector('dialog[open]')) closePanel();
  });
  // Selecting another farm closes the panel (its field is no longer on the map).
  const origSelectFarm = window.selectFarm;
  if (typeof origSelectFarm === 'function') {
    window.selectFarm = function (id) { closePanel(); return origSelectFarm(id); };
  }

  function renderHeader() {
    const f = fp.field;
    $('#fpName').textContent = f.name;
    $('#fpMeta').textContent = `${formatHa(f.areaHectares)} · ${irrigationLabel(f.irrigation)}`;
  }

  panel.querySelectorAll('.fp-tab').forEach((t) => t.addEventListener('click', () => selectTab(t.dataset.tab)));
  function selectTab(name) {
    fp.tab = name;
    panel.querySelectorAll('.fp-tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
    panel.querySelectorAll('.fp-pane').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== name));
    if (name === 'monitoring') renderMonitoring();
  }

  async function loadFieldData() {
    const id = fp.fieldId;
    renderOverview(); renderCrops(); renderActivities();
    try {
      const [crops, activities] = await Promise.all([apiGet(`/crops/by-field/${id}`), apiGet(`/activities/by-field/${id}`)]);
      if (id !== fp.fieldId) return;
      fp.crops = crops || [];
      fp.activities = activities || [];
    } catch (err) {
      if (id !== fp.fieldId) return;
      fp.crops = []; fp.activities = [];
      showError('Could not load this field’s crops and activities');
    }
    renderOverview(); renderCrops(); renderActivities();
    loadWeather();
    if (fp.tab === 'monitoring') renderMonitoring();
  }

  // ------------------------------------------------------------ overview

  function currentCrop() {
    return fp.crops.find((c) => c.growthStage !== 'harvested') || null;
  }

  function renderOverview() {
    const f = fp.field;
    const crop = currentCrop();
    const recent = fp.activities.slice(0, 3);
    pane('overview').innerHTML = `
      <form id="fpDetails" class="space-y-3">
        <div><label class="fp-label" for="fpNameInput">Name</label><input id="fpNameInput" class="fp-input" maxlength="200" value="${escapeHtml(f.name)}" /></div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="fp-label" for="fpIrr">Irrigation</label><select id="fpIrr" class="fp-input">${IRRIGATION.map(([v, l]) => `<option value="${v}" ${v === (f.irrigation || '') ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <div><label class="fp-label" for="fpFarm">Farm</label><select id="fpFarm" class="fp-input">${state.farms.map((fm) => `<option value="${fm.id}" ${fm.id === state.selectedFarmId ? 'selected' : ''}>${escapeHtml(fm.name)}</option>`).join('')}</select></div>
        </div>
        <div class="flex justify-end"><button id="fpSave" type="submit" class="fp-btn" disabled>Save changes</button></div>
      </form>

      <div>
        <div class="fp-h">This season</div>
        ${crop ? `
          <div class="rounded-lg bg-gray-50 p-3">
            <div class="flex items-center justify-between">
              <span class="text-[14px] font-medium text-gray-900">${escapeHtml(crop.cropType)}${crop.variety ? ` <span class="font-normal text-gray-500">· ${escapeHtml(crop.variety)}</span>` : ''}</span>
              <span class="text-[12px] text-gray-500">${(STAGES.find(([v]) => v === crop.growthStage) || ['', crop.growthStage])[1]}</span>
            </div>
            <div class="num mt-1 font-mono text-[12px] text-gray-500">Planted ${fmtDate(crop.plantingDate)} · day ${Math.max(0, daysBetween(crop.plantingDate, today()))}</div>
          </div>` : `
          <div class="flex items-center justify-between rounded-lg bg-gray-50 p-3 text-[13px] text-gray-500">
            <span>No crop recorded for this season</span>
            <button type="button" data-goto="crops" class="font-medium text-brand-700">Add crop</button>
          </div>`}
      </div>

      <div>
        <div class="mb-2 flex items-center justify-between"><span class="fp-h !mb-0">Latest activities</span><button type="button" data-goto="activities" class="text-[12px] font-medium text-brand-700">Add activity</button></div>
        ${recent.length ? `<div class="space-y-1">${recent.map(activityRow).join('')}</div>` : '<p class="text-[13px] text-gray-400">Nothing logged yet</p>'}
      </div>

      <div>
        <div class="fp-h">Weather at this field</div>
        <div id="fpWeather" class="text-[12px] text-gray-400">Loading forecast</div>
      </div>

      <div>
        <div class="fp-h">History</div>
        <div id="fpHistory"></div>
      </div>`;
    if (window.FieldEditor) FieldEditor.renderHistory($('#fpHistory'), f.id);
    hydrateIcons(pane('overview'));
    pane('overview').querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => selectTab(b.dataset.goto)));
    pane('overview').querySelectorAll('[data-del-activity]').forEach(bindActivityDelete);

    const form = $('#fpDetails');
    const save = $('#fpSave');
    const dirty = () => {
      save.disabled = $('#fpNameInput').value.trim() === f.name && $('#fpIrr').value === (f.irrigation || '') && $('#fpFarm').value === state.selectedFarmId;
    };
    form.addEventListener('input', dirty); form.addEventListener('change', dirty);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = $('#fpNameInput').value.trim();
      if (!name) { showError('The field needs a name'); return; }
      const body = {};
      if (name !== f.name) body.name = name;
      if ($('#fpIrr').value !== (f.irrigation || '')) body.irrigation = $('#fpIrr').value;
      const movedTo = $('#fpFarm').value !== state.selectedFarmId ? $('#fpFarm').value : null;
      if (movedTo) body.farmId = movedTo;
      save.disabled = true;
      try {
        await apiPatch(`/fields/${f.id}`, body);
        const id = f.id;
        await goToFarm(movedTo || state.selectedFarmId);
        showToast(movedTo ? `${name} moved` : `${name} saved`);
        if (state.fieldsById.get(id)) openFieldPanel(id, 'overview'); else closePanel();
      } catch (err) {
        showError(err.message || 'Could not save the field');
        dirty();
      }
    });
    if (fp.weather) renderWeatherInto();
  }

  async function loadWeather() {
    const f = fp.field;
    const c = fieldCenter(f);
    if (!c) return;
    const key = f.id + c.lat + c.lng;
    if (fp.weatherKey === key && fp.weather) { renderWeatherInto(); return; }
    fp.weatherKey = key; fp.weather = null;
    const fmt = (d) => d.toISOString().slice(0, 10);
    try {
      const w = await apiGet(`/weather/field/${f.id}/forecast?lat=${c.lat}&lng=${c.lng}&start=${fmt(new Date())}&end=${fmt(new Date(Date.now() + 6 * 86400000))}`);
      if (fp.weatherKey !== key) return;
      fp.weather = w && w.days ? w.days : [];
    } catch {
      if (fp.weatherKey !== key) return;
      fp.weather = [];
    }
    renderWeatherInto();
  }

  function renderWeatherInto() {
    const el = document.getElementById('fpWeather');
    if (!el) return;
    const days = fp.weather || [];
    if (!days.length) { el.textContent = 'Forecast not available right now'; return; }
    const rain = days.reduce((s, d) => s + (+d.precipitationMm || 0), 0);
    el.className = '';
    el.innerHTML = `
      <div class="num divide-y divide-gray-100 font-mono text-[12px]">
        ${days.slice(0, 7).map((d) => `
          <div class="flex h-7 items-center justify-between">
            <span class="w-20 text-gray-500">${new Date(d.date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })}</span>
            <span class="text-gray-900">${Math.round(d.temperatureMaxC)}° / ${Math.round(d.temperatureMinC)}°</span>
            <span class="w-14 text-right text-gray-500">${(+d.precipitationMm || 0).toFixed(1)} mm</span>
          </div>`).join('')}
      </div>
      <p class="num mt-2 font-mono text-[11px] text-gray-400">Rain next 7 days ${rain.toFixed(1)} mm · Open-Meteo</p>`;
  }

  // ------------------------------------------------------------ crops

  function renderCrops() {
    pane('crops').innerHTML = `
      <form id="fpCropForm" class="space-y-3 rounded-lg bg-gray-50 p-3">
        <div class="grid grid-cols-2 gap-3">
          <div><label class="fp-label" for="fpCropType">Crop</label><input id="fpCropType" class="fp-input" list="fpCropList" required maxlength="80" placeholder="e.g. Alfalfa" /></div>
          <div><label class="fp-label" for="fpVariety">Variety</label><input id="fpVariety" class="fp-input" maxlength="80" /></div>
          <div><label class="fp-label" for="fpPlanted">Planting date</label><input id="fpPlanted" type="date" class="fp-input" required value="${today()}" /></div>
          <div><label class="fp-label" for="fpHarvest">Expected harvest</label><input id="fpHarvest" type="date" class="fp-input" /></div>
        </div>
        <datalist id="fpCropList">${CROPS.map((c) => `<option value="${c}">`).join('')}</datalist>
        <div class="flex justify-end"><button class="fp-btn" type="submit">Add crop</button></div>
      </form>
      <div>
        <div class="fp-h">Crop history</div>
        ${fp.crops.length ? `<div class="divide-y divide-gray-100">${fp.crops.map((c) => `
          <div class="fp-row flex items-center gap-3 py-2.5">
            <div class="min-w-0 flex-1">
              <div class="truncate text-[13px] font-medium text-gray-900">${escapeHtml(c.cropType)}${c.variety ? ` <span class="font-normal text-gray-500">· ${escapeHtml(c.variety)}</span>` : ''}</div>
              <div class="num font-mono text-[11px] text-gray-500">${fmtDate(c.plantingDate)}${c.expectedHarvestDate ? ' → ' + fmtDate(c.expectedHarvestDate) : ''}</div>
            </div>
            <select data-stage="${c.id}" class="fp-input !h-8 !w-[118px] !text-[12px]">${STAGES.map(([v, l]) => `<option value="${v}" ${v === c.growthStage ? 'selected' : ''}>${l}</option>`).join('')}</select>
            <button type="button" data-del-crop="${c.id}" class="fp-row-del rounded p-1 text-gray-400 hover:text-red-600" title="Delete crop">${icon('trash')}</button>
          </div>`).join('')}</div>` : '<p class="text-[13px] text-gray-400">No crops recorded for this field</p>'}
      </div>`;

    $('#fpCropForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {
        fieldId: fp.fieldId,
        cropType: $('#fpCropType').value.trim(),
        plantingDate: $('#fpPlanted').value,
        ...($('#fpVariety').value.trim() ? { variety: $('#fpVariety').value.trim() } : {}),
        ...($('#fpHarvest').value ? { expectedHarvestDate: $('#fpHarvest').value } : {}),
      };
      if (!body.cropType) return;
      try {
        await apiPost('/crops', body);
        await refreshLists();
        showToast(`${body.cropType} added`);
      } catch (err) { showError(err.message || 'Could not add the crop'); }
    });
    pane('crops').querySelectorAll('[data-stage]').forEach((sel) => sel.addEventListener('change', async () => {
      try { await apiPatch(`/crops/${sel.dataset.stage}`, { growthStage: sel.value }); await refreshLists(); }
      catch (err) { showError(err.message || 'Could not update the growth stage'); }
    }));
    pane('crops').querySelectorAll('[data-del-crop]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Delete this crop record?')) return;
      try { await apiDelete(`/crops/${b.dataset.delCrop}`); await refreshLists(); }
      catch (err) { showError(err.message || 'Could not delete the crop'); }
    }));
  }

  // ------------------------------------------------------------ activities

  function activityRow(a) {
    const t = ACTIVITY[a.type] || ACTIVITY.other;
    const amount = a.rate != null ? `${+a.rate} ${escapeHtml(a.unit || '')}` : '';
    const detail = [a.product ? escapeHtml(a.product) : '', amount].filter(Boolean).join(' · ');
    return `
      <div class="fp-row flex items-start gap-3 py-2">
        <span class="fp-dot mt-1.5" style="background:${t.color}"></span>
        <div class="min-w-0 flex-1">
          <div class="flex items-baseline justify-between gap-2">
            <span class="text-[13px] font-medium text-gray-900">${t.label}</span>
            <span class="num shrink-0 font-mono text-[11px] text-gray-500">${fmtDate(a.date)}</span>
          </div>
          ${detail ? `<div class="num truncate text-[12px] text-gray-600">${detail}</div>` : ''}
          ${a.notes ? `<div class="mt-0.5 text-[12px] text-gray-500">${escapeHtml(a.notes)}</div>` : ''}
        </div>
        <button type="button" data-del-activity="${a.id}" class="fp-row-del rounded p-1 text-gray-400 hover:text-red-600" title="Delete activity">${icon('trash')}</button>
      </div>`;
  }

  function bindActivityDelete(b) {
    b.addEventListener('click', async () => {
      if (!confirm('Delete this activity?')) return;
      try { await apiDelete(`/activities/${b.dataset.delActivity}`); await refreshLists(); document.dispatchEvent(new CustomEvent('activities:changed')); }
      catch (err) { showError(err.message || 'Could not delete the activity'); }
    });
  }

  function renderActivities() {
    pane('activities').innerHTML = `
      <form id="fpActForm" class="space-y-3 rounded-lg bg-gray-50 p-3">
        <div class="grid grid-cols-2 gap-3">
          <div><label class="fp-label" for="fpActType">Activity</label><select id="fpActType" class="fp-input">${ACTIVITY_TYPES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>
          <div><label class="fp-label" for="fpActDate">Date</label><input id="fpActDate" type="date" class="fp-input" required value="${today()}" /></div>
        </div>
        <div><label class="fp-label" for="fpProduct">Product</label><input id="fpProduct" class="fp-input" maxlength="120" placeholder="e.g. Urea 46%" /></div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="fp-label" for="fpRate">Rate</label><input id="fpRate" type="number" min="0" step="any" class="fp-input num" /></div>
          <div><label class="fp-label" for="fpUnit">Unit</label><select id="fpUnit" class="fp-input">${UNITS.map((u) => `<option>${u}</option>`).join('')}</select></div>
        </div>
        <div><label class="fp-label" for="fpNotes">Notes</label><textarea id="fpNotes" rows="2" class="fp-input" maxlength="2000"></textarea></div>
        <div class="flex justify-end"><button class="fp-btn" type="submit">Log activity</button></div>
      </form>
      <div>
        <div class="fp-h">Log</div>
        ${fp.activities.length ? `<div class="divide-y divide-gray-100">${fp.activities.map(activityRow).join('')}</div>` : '<p class="text-[13px] text-gray-400">No activities logged for this field</p>'}
      </div>`;
    const typeSel = $('#fpActType');
    const syncUnit = () => { $('#fpUnit').value = DEFAULT_UNIT[typeSel.value] || 'kg/ha'; };
    typeSel.addEventListener('change', syncUnit); syncUnit();
    $('#fpActForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const rate = $('#fpRate').value;
      const body = {
        fieldId: fp.fieldId,
        type: typeSel.value,
        date: $('#fpActDate').value,
        ...($('#fpProduct').value.trim() ? { product: $('#fpProduct').value.trim() } : {}),
        ...(rate !== '' ? { rate: +rate, unit: $('#fpUnit').value } : {}),
        ...($('#fpNotes').value.trim() ? { notes: $('#fpNotes').value.trim() } : {}),
      };
      try {
        await apiPost('/activities', body);
        await refreshLists();
        showToast(`${ACTIVITY[body.type].label} logged`);
        document.dispatchEvent(new CustomEvent('activities:changed'));
      } catch (err) { showError(err.message || 'Could not log the activity'); }
    });
    pane('activities').querySelectorAll('[data-del-activity]').forEach(bindActivityDelete);
  }

  async function refreshLists() {
    const id = fp.fieldId;
    const [crops, activities] = await Promise.all([apiGet(`/crops/by-field/${id}`), apiGet(`/activities/by-field/${id}`)]);
    if (id !== fp.fieldId) return;
    fp.crops = crops || []; fp.activities = activities || [];
    renderOverview(); renderCrops(); renderActivities();
  }

  // ------------------------------------------------------------ monitoring (js/ndvi.js)

  function renderMonitoring() {
    const el = pane('monitoring');
    if (window.FieldAnalytics && fp.field) window.FieldAnalytics.render(el, fp.field, { crops: fp.crops });
    else el.innerHTML = '<p class="text-[13px] text-gray-400">Satellite analytics is loading</p>';
  }

  // ------------------------------------------------------------ zoom / edit / delete

  $('#fpZoom').addEventListener('click', () => fp.fieldId && flyToField(fp.fieldId));

  const editBar = document.createElement('div');
  editBar.className = 'hidden absolute bottom-[136px] left-1/2 z-[580] -translate-x-1/2 items-center gap-3 rounded-xl bg-white p-2 pl-4 shadow-lg ring-1 ring-black/5';
  editBar.innerHTML = `
    <span class="text-[13px] text-gray-600">Drag the white points to reshape <span id="fpEditArea" class="num ml-1 font-mono text-gray-900"></span></span>
    <span id="fpEditStatus" class="max-w-[280px] text-[12px]"></span>
    <button type="button" id="fpEditCancel" class="h-8 rounded-lg px-3 text-[13px] text-gray-600 transition-colors hover:bg-gray-100">Cancel</button>
    <button type="button" id="fpEditSave" class="h-8 rounded-lg bg-brand-600 px-3 text-[13px] font-medium text-white transition-colors hover:bg-brand-700">Save boundary</button>`;
  document.getElementById('mapMain').appendChild(editBar);

  function editableGeometryArea(layer) {
    const gj = layer.toGeoJSON().geometry;
    return GisImport.polygonAreaHa(gj.type === 'Polygon' ? gj.coordinates : gj.coordinates[0]);
  }

  $('#fpEdit').addEventListener('click', () => {
    const f = fp.field;
    if (!f || !f.geometry || !L.Edit || !L.Edit.Poly) { showError('Boundary editing is not available'); return; }
    if (f.geometry.type !== 'Polygon') { showError('Only single polygons can be edited'); return; }
    if (fp.editLayer) return;
    const rings = f.geometry.coordinates.map((ring) => ring.slice(0, -1).map(([lng, lat]) => [lat, lng]));
    const layer = L.polygon(rings, { color: COLORS.draft, weight: 2, fillOpacity: 0.15 }).addTo(mapInstance);
    layer.editing.enable();
    fp.editLayer = layer;
    const baseLayer = state.fieldLayerById.get(f.id);
    if (baseLayer) baseLayer.setStyle({ opacity: 0, fillOpacity: 0 });
    const check = window.FieldEditor && FieldEditor.makeChecker((r) => {
      const el = document.getElementById('fpEditStatus');
      el.innerHTML = FieldEditor.statusHtml(r).replace(/<ul[\s\S]*<\/ul>/, '');
      hydrateIcons(el);
      if (!r.pending) FieldEditor.showMarks(r);
      document.getElementById('fpEditSave').disabled = !r.pending && !r.offline && (!r.ok || r.duplicate);
    });
    const updateArea = () => {
      document.getElementById('fpEditArea').textContent = formatHa(editableGeometryArea(layer));
      const gj = layer.toGeoJSON().geometry;
      if (check) check(gj.type === 'Polygon' ? gj : { type: 'Polygon', coordinates: gj.coordinates[0] }, f.id);
    };
    layer.on('edit', updateArea); mapInstance.on('draw:editvertex', updateArea);
    updateArea();
    editBar.classList.remove('hidden'); editBar.classList.add('flex');
  });

  function cancelEdit() {
    if (!fp.editLayer) return;
    mapInstance.off('draw:editvertex');
    if (window.FieldEditor) FieldEditor.clearMarks();
    document.getElementById('fpEditStatus').innerHTML = '';
    fp.editLayer.editing.disable();
    mapInstance.removeLayer(fp.editLayer);
    fp.editLayer = null;
    editBar.classList.add('hidden'); editBar.classList.remove('flex');
    if (state.fieldsLayer) state.fieldsLayer.setStyle((f) => fieldStyle((f.properties || {}).id || f.id));
  }
  document.getElementById('fpEditCancel').addEventListener('click', cancelEdit);
  async function saveEdit(overlap) {
    const layer = fp.editLayer; const id = fp.fieldId;
    if (!layer) return;
    const geometry = layer.toGeoJSON().geometry;
    try {
      const updated = await apiPatch(`/fields/${id}`, { boundary: geometry, ...(overlap ? { overlap } : {}) });
      cancelEdit();
      await goToFarm(state.selectedFarmId);
      showToast(`Boundary saved · ${formatHa(updated && updated.areaHectares)}${window.FieldEditor ? FieldEditor.savedNote(updated) : ''}`);
      openFieldPanel(id);
    } catch (err) {
      if (err.status === 409 && err.data && err.data.code === 'FIELD_OVERLAP' && window.FieldEditor) {
        const slot = document.getElementById('fpEditStatus');
        const choice = await FieldEditor.askOverlap(slot, err);
        slot.classList.remove('hidden');
        if (choice) saveEdit(choice);
        return;
      }
      showError(err.message || 'Could not save the boundary');
    }
  }
  document.getElementById('fpEditSave').addEventListener('click', () => saveEdit(null));

  $('#fpDelete').addEventListener('click', async () => {
    const f = fp.field;
    if (!f) return;
    // deleting is recoverable: Undo in the toast, or Restore under Recently deleted
    try {
      closePanel();
      await FieldEditor.deleteField(f);
    } catch (err) { showError(err.message || 'Could not delete the field'); }
  });
})();
