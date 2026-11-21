/*
 * AgroSyntra One — Scout tasks
 *
 * Map pins with issue, priority, status, due date, assignee and notes.
 * API: /scout-tasks (POST, PATCH, DELETE) and /scout-tasks/by-farm/:farmId.
 * New task: click "New task", then a point on the map (inside a field), or
 * from an NDVI anomaly in the field Analytics tab.
 */
(function () {
  'use strict';
  const ISSUES = [['pests', 'Pests'], ['disease', 'Disease'], ['weeds', 'Weeds'], ['water_stress', 'Water stress'], ['nutrient', 'Nutrient deficiency'], ['other', 'Other']];
  const PRIOS = [['high', 'High', '#ef4444'], ['medium', 'Medium', '#f59e0b'], ['low', 'Low', '#60a5fa']];
  const PRIO = Object.fromEntries(PRIOS.map(([k, l, c]) => [k, { label: l, color: c }]));
  const ISSUE = Object.fromEntries(ISSUES);
  const STATUS = { open: 'Open', in_progress: 'In progress', done: 'Done' };
  const sc = { tasks: [], filter: 'active', layer: null, picking: false, farmId: null };
  const fmtDay = (d) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');
  const today = () => new Date().toISOString().slice(0, 10);

  async function load() {
    if (!state.selectedFarmId) return;
    sc.farmId = state.selectedFarmId;
    try { sc.tasks = (await apiGet(`/scout-tasks/by-farm/${state.selectedFarmId}`)) || []; } catch { sc.tasks = []; }
    drawPins();
    Shell.setBadge('scout', sc.tasks.filter((t) => t.status !== 'done' && t.dueDate && t.dueDate < today()).length);
    Shell.rerender('scout');
  }
  document.addEventListener('workspace:fields', () => { if (sc.farmId !== state.selectedFarmId) load(); });

  function drawPins() {
    if (!mapInstance) return;
    if (sc.layer) mapInstance.removeLayer(sc.layer);
    sc.layer = L.layerGroup(sc.tasks.filter((t) => t.status !== 'done').map((t) => L.marker([t.lat, t.lng], {
      icon: L.divIcon({ className: '', iconSize: [22, 22], iconAnchor: [11, 22], html: `<svg width="22" height="22" viewBox="0 0 24 24" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" fill="${PRIO[t.priority]?.color || '#9ca3af'}" stroke="#fff" stroke-width="1.5"/><circle cx="12" cy="10" r="3" fill="#fff"/></svg>` }),
    }).bindTooltip(`${escapeHtml(t.title)} · ${escapeHtml(t.fieldName || '')}`, { direction: 'top', offset: [0, -20] })
      .on('click', () => { Shell.show('scout'); focusTask(t.id); }))).addTo(mapInstance);
  }

  function fieldAt(latlng) {
    for (const [id, layer] of state.fieldLayerById) {
      const gj = layer.feature && layer.feature.geometry; if (!gj) continue;
      const polys = gj.type === 'Polygon' ? [gj.coordinates] : gj.type === 'MultiPolygon' ? gj.coordinates : [];
      const inside = polys.some((p) => { let ins = false; const ring = p[0]; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > latlng.lat) !== (yj > latlng.lat) && latlng.lng < ((xj - xi) * (latlng.lat - yi)) / (yj - yi) + xi) ins = !ins; } return ins; });
      if (inside) return id;
    }
    return null;
  }

  function render(el) {
    const list = sc.tasks.filter((t) => sc.filter === 'all' || (sc.filter === 'active' ? t.status !== 'done' : t.status === 'done'));
    el.innerHTML = `
      <div class="flex gap-2">
        <button type="button" id="scNew" class="fp-btn flex-1">${sc.picking ? 'Click a point in a field' : 'New task'}</button>
        <button type="button" id="scCsv" class="fp-ghost" title="Download spreadsheet">${icon('download')}</button>
      </div>
      <div class="mt-3 flex rounded-md bg-gray-100 p-0.5 text-[12px]">${[['active', 'Open'], ['done', 'Done'], ['all', 'All']].map(([k, l]) => `<button type="button" data-f="${k}" class="h-7 flex-1 rounded ${sc.filter === k ? 'bg-white text-gray-900' : 'text-gray-500'}">${l}</button>`).join('')}</div>
      <div id="scForm"></div>
      <div class="mt-3 divide-y divide-gray-100">
        ${list.map((t) => {
          const overdue = t.status !== 'done' && t.dueDate && t.dueDate < today();
          return `<div class="py-2.5" data-task="${t.id}">
            <button type="button" data-go="${t.id}" class="flex w-full items-start gap-2.5 text-left">
              <span class="mt-1.5 h-2 w-2 shrink-0 rounded-full" style="background:${PRIO[t.priority]?.color}"></span>
              <span class="min-w-0 flex-1">
                <span class="block truncate text-[13px] ${t.status === 'done' ? 'text-gray-500 line-through' : 'text-gray-900'}">${escapeHtml(t.title)}</span>
                <span class="block truncate text-[12px] text-gray-500">${escapeHtml(t.fieldName || '')} · ${ISSUE[t.issue] || t.issue}${t.assignee ? ' · ' + escapeHtml(t.assignee) : ''}</span>
                ${t.notes ? `<span class="mt-0.5 block line-clamp-2 text-[12px] text-gray-500">${escapeHtml(t.notes)}</span>` : ''}
              </span>
              <span class="num shrink-0 font-mono text-[11px] ${overdue ? 'text-red-600' : 'text-gray-500'}">${t.dueDate ? fmtDay(t.dueDate) : ''}</span>
            </button>
            <div class="mt-1.5 flex items-center gap-2 pl-4">
              <select data-status="${t.id}" class="fp-input !h-7 !w-auto !text-[11px]">${Object.entries(STATUS).map(([k, l]) => `<option value="${k}" ${k === t.status ? 'selected' : ''}>${l}</option>`).join('')}</select>
              <button type="button" data-del="${t.id}" class="ml-auto rounded p-1 text-gray-400 hover:text-red-600" title="Delete task">${icon('trash')}</button>
            </div>
          </div>`;
        }).join('') || `<p class="py-3 text-[13px] text-gray-500">${sc.filter === 'done' ? 'No finished tasks' : 'No open tasks'}</p>`}
      </div>`;
    el.querySelector('#scNew').addEventListener('click', () => startPick(el));
    el.querySelector('#scCsv').addEventListener('click', () => window.downloadCsv(`scout_tasks_${today()}.csv`,
      [['title', 'field', 'issue', 'priority', 'status', 'due', 'assignee', 'lat', 'lng', 'notes']].concat(sc.tasks.map((t) => [t.title, t.fieldName, ISSUE[t.issue] || t.issue, t.priority, STATUS[t.status], t.dueDate || '', t.assignee || '', t.lat, t.lng, t.notes || '']))));
    el.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { sc.filter = b.dataset.f; render(el); }));
    el.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => { const t = sc.tasks.find((x) => x.id === b.dataset.go); mapInstance.setView([t.lat, t.lng], Math.max(16, mapInstance.getZoom())); }));
    el.querySelectorAll('[data-status]').forEach((s) => s.addEventListener('change', async () => {
      try { await apiPatch(`/scout-tasks/${s.dataset.status}`, { status: s.value }); await load(); } catch (err) { showError(err.message || 'Could not update the task'); }
    }));
    el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Delete this task?')) return;
      try { await apiDelete(`/scout-tasks/${b.dataset.del}`); await load(); } catch (err) { showError(err.message || 'Could not delete the task'); }
    }));
    if (sc.draft) form(el, sc.draft);
  }

  function focusTask(id) {
    const el = document.querySelector(`[data-task="${id}"]`);
    if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('bg-gray-50'); setTimeout(() => el.classList.remove('bg-gray-50'), 1200); }
  }

  function startPick(el) {
    if (!mapInstance) return;
    sc.picking = true; render(el);
    mapInstance.getContainer().style.cursor = 'crosshair';
    const onClick = (e) => {
      const fieldId = fieldAt(e.latlng);
      if (!fieldId) { showError('Click inside one of the farm’s fields'); return; }
      mapInstance.off('click', onClick); mapInstance.getContainer().style.cursor = '';
      sc.picking = false;
      sc.draft = { fieldId, lat: +e.latlng.lat.toFixed(6), lng: +e.latlng.lng.toFixed(6) };
      render(el);
    };
    mapInstance.on('click', onClick);
  }

  function form(el, d) {
    const box = el.querySelector('#scForm');
    const fieldName = (state.fieldList || []).find((f) => f.id === d.fieldId)?.name || '';
    box.innerHTML = `
      <form id="scDraft" class="mt-3 space-y-3 rounded-lg bg-gray-50 p-3">
        <div class="num font-mono text-[11px] text-gray-500">${escapeHtml(fieldName)} · ${d.lat.toFixed(5)}, ${d.lng.toFixed(5)}</div>
        <div><label class="fp-label" for="scTitle">Title</label><input id="scTitle" class="fp-input" maxlength="160" required value="${escapeHtml(d.title || '')}" placeholder="e.g. Check SE corner"/></div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="fp-label" for="scIssue">Issue</label><select id="scIssue" class="fp-input">${ISSUES.map(([k, l]) => `<option value="${k}" ${k === (d.issue || 'other') ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <div><label class="fp-label" for="scPrio">Priority</label><select id="scPrio" class="fp-input">${PRIOS.map(([k, l]) => `<option value="${k}" ${k === (d.priority || 'medium') ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <div><label class="fp-label" for="scDue">Due</label><input id="scDue" type="date" class="fp-input" value="${d.dueDate || new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)}"/></div>
          <div><label class="fp-label" for="scWho">Assignee</label><input id="scWho" class="fp-input" maxlength="120" placeholder="Name or email"/></div>
        </div>
        <div><label class="fp-label" for="scNotes">Notes</label><textarea id="scNotes" rows="3" class="fp-input" maxlength="4000">${escapeHtml(d.notes || '')}</textarea></div>
        <div class="flex justify-end gap-2"><button type="button" id="scCancel" class="fp-ghost">Cancel</button><button type="submit" class="fp-btn">Create task</button></div>
      </form>`;
    box.querySelector('#scCancel').addEventListener('click', () => { sc.draft = null; render(el); });
    box.querySelector('#scDraft').addEventListener('submit', async (e) => {
      e.preventDefault();
      const q = (id) => box.querySelector('#' + id).value.trim();
      try {
        await apiPost('/scout-tasks', { fieldId: d.fieldId, lat: d.lat, lng: d.lng, title: q('scTitle'), issue: q('scIssue'), priority: q('scPrio'),
          ...(q('scDue') ? { dueDate: q('scDue') } : {}), ...(q('scWho') ? { assignee: q('scWho') } : {}), ...(q('scNotes') ? { notes: q('scNotes') } : {}) });
        sc.draft = null; showToast('Scout task created'); await load();
      } catch (err) { showError(err.message || 'Could not create the task'); }
    });
  }

  Shell.register('scout', { title: 'Scout tasks', render });
  window.ScoutTasks = {
    load,
    createFromAnomaly(field, cluster, note) {
      sc.draft = { fieldId: field.id, lat: +cluster.lat.toFixed(6), lng: +cluster.lng.toFixed(6), title: `NDVI drop ${cluster.ha.toFixed(2)} ha`, issue: 'other', priority: cluster.meanDrop <= -0.2 ? 'high' : 'medium', notes: note };
      Shell.show('scout');
    },
  };
})();
