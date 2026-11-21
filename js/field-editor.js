/*
 * AgroOne — field registration and field history
 *
 * New field (OneSoil-style): after drawing, the shape stays on the map with draggable
 * corners and a "New field" card opens beside the map (not a modal), so the boundary
 * can still be adjusted. Area, self-crossing and overlaps with saved fields are checked
 * on the server while you edit (POST /fields/check). Save offers the choices the server
 * gives: cut the overlap away or keep it; duplicates are never saved.
 *
 * Also here: the overlap choices for boundary edits and imports, the field history list
 * with restore, and Recently deleted with restore.
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const AMBER = '#f59e0b';
  const fmtArea = (ha) => (ha == null ? '—' : ha < 1 ? `${Math.round(ha * 10000).toLocaleString('en')} m²` : formatHa(ha));

  // ------------------------------------------------------------ shape checks (shared)

  let marks = null;
  function clearMarks() { if (marks && mapInstance) mapInstance.removeLayer(marks); marks = null; }
  /** Outlines the saved fields a shape overlaps and marks where a boundary crosses itself. */
  function showMarks(result) {
    clearMarks();
    if (!mapInstance || !result) return;
    marks = L.layerGroup().addTo(mapInstance);
    (result.conflicts || []).forEach((c) => {
      const layer = state.fieldLayerById && state.fieldLayerById.get(c.id);
      const gj = layer && layer.toGeoJSON ? layer.toGeoJSON() : null;
      if (gj) L.geoJSON(gj, { interactive: false, style: { color: AMBER, weight: 3, dashArray: '6 4', fillColor: AMBER, fillOpacity: 0.12 } }).addTo(marks);
    });
    if (result.where) {
      L.circleMarker([result.where.lat, result.where.lng], { radius: 9, color: '#fff', weight: 2, fillColor: '#ef4444', fillOpacity: 1, interactive: false }).addTo(marks);
    }
  }

  let checkSeq = 0;
  /** Debounced server check; calls back with the newest answer only. */
  function makeChecker(onResult, delay = 350) {
    let timer = 0;
    return (geometry, excludeId) => {
      clearTimeout(timer);
      const seq = ++checkSeq;
      onResult({ pending: true });
      timer = setTimeout(async () => {
        try {
          const r = await apiPost('/fields/check', { boundary: geometry, ...(excludeId ? { excludeId } : {}) });
          if (seq === checkSeq) onResult(r || { ok: true });
        } catch (err) {
          if (seq === checkSeq) onResult({ ok: true, offline: true });   // the save itself still validates
        }
      }, delay);
    };
  }

  /** One-line status + list for a check result. */
  function statusHtml(r) {
    if (!r || r.pending) return `<div class="fe-status">${icon('loader', 'spin')}<span>Checking the boundary</span></div>`;
    if (r.offline) return '';
    if (!r.ok) return `<div class="fe-status is-error">${icon('alert')}<span>${escapeHtml(r.message)}</span></div>`;
    if (r.duplicate) {
      const d = r.conflicts.find((c) => c.duplicate);
      return `<div class="fe-status is-error">${icon('alert')}<span>This field is already saved as <b>${escapeHtml(d.name)}</b></span></div>`;
    }
    if (r.conflicts && r.conflicts.length) {
      return `<div class="fe-status is-warn">${icon('alert')}<span>Overlaps ${r.conflicts.length === 1 ? 'a saved field' : r.conflicts.length + ' saved fields'}</span></div>
        <ul class="fe-list">${r.conflicts.slice(0, 5).map((c) => `<li><span class="truncate">${escapeHtml(c.name)}</span><span class="num">${fmtArea(c.overlapHa)}</span></li>`).join('')}</ul>`;
    }
    return `<div class="fe-status is-ok">${icon('check')}<span>No overlap with saved fields${r.repaired ? ' · the outline will be cleaned up on save' : ''}</span></div>`;
  }

  /** Choices for a 409 overlap answer: resolves to 'clip' | 'allow' | null. */
  function askOverlap(host, err) {
    return new Promise((resolve) => {
      const data = err.data || {};
      if (data.code === 'FIELD_DUPLICATE') { resolve(null); return; }
      host.innerHTML = `
        <div class="fe-choice">
          <p>${escapeHtml(err.message)}</p>
          <div class="flex flex-wrap gap-2">
            <button type="button" data-ov="clip" class="fp-btn">Cut the overlap and save</button>
            <button type="button" data-ov="allow" class="fp-ghost h-9 rounded-lg px-3 text-[13px]">Save with the overlap</button>
            <button type="button" data-ov="" class="h-9 rounded-lg px-3 text-[13px] text-gray-500 hover:text-gray-900">Keep editing</button>
          </div>
        </div>`;
      host.classList.remove('hidden');
      host.querySelectorAll('[data-ov]').forEach((b) => b.addEventListener('click', () => { host.classList.add('hidden'); host.innerHTML = ''; resolve(b.dataset.ov || null); }));
    });
  }

  function savedNote(row) {
    const bits = [];
    if (row && row.clippedHa) bits.push(`overlap of ${fmtArea(row.clippedHa)} cut away`);
    if (row && row.overlapsKept) bits.push('overlap kept');
    if (row && row.repaired) bits.push('outline cleaned up');
    return bits.length ? ` · ${bits.join(', ')}` : '';
  }

  // ------------------------------------------------------------ new field (draft)

  const draft = { layer: null, geometry: null, result: null, saving: false };
  const panel = document.createElement('aside');
  panel.id = 'draftPanel';
  panel.className = 'hidden absolute inset-0 z-30 flex-col overflow-hidden bg-white';
  panel.innerHTML = `
    <div class="border-b border-gray-100 px-4 pb-4 pt-4">
      <div class="flex items-center justify-between">
        <h2 class="text-[16px] font-medium text-gray-900">New field</h2>
        <button type="button" id="dfClose" class="rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700" aria-label="Discard new field">${icon('x')}</button>
      </div>
      <div class="mt-3 flex items-baseline gap-2">
        <span id="dfArea" class="num font-mono text-[24px] font-medium text-gray-900">—</span>
        <span id="dfCorners" class="num font-mono text-[12px] text-gray-500"></span>
      </div>
      <p class="mt-1 text-[12px] text-gray-500">Drag the corners to adjust</p>
    </div>
    <form id="dfForm" class="thin-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4" autocomplete="off">
      <div id="dfStatus"></div>
      <div><label class="fp-label" for="dfName">Field name</label><input id="dfName" class="fp-input" maxlength="200" /></div>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="fp-label" for="dfFarm">Farm</label><select id="dfFarm" class="fp-input"></select></div>
        <div><label class="fp-label" for="dfIrr">Irrigation</label><select id="dfIrr" class="fp-input"></select></div>
      </div>
      <div id="dfChoice" class="hidden"></div>
      <p id="dfError" class="hidden text-[13px] text-red-600"></p>
      <div class="mt-auto flex justify-end gap-2 pt-2">
        <button type="button" id="dfCancel" class="fp-ghost h-9 rounded-lg px-4 text-[13px]">Cancel</button>
        <button type="submit" id="dfSave" class="fp-btn">Save field</button>
      </div>
    </form>`;
  $('sidePanel').appendChild(panel);
  hydrateIcons(panel);

  function suggestName() {
    const word = window.I18n && I18n.lang === 'ar' ? 'حقل' : 'Field';
    const used = new Set((state.fieldList || []).map((f) => f.name));
    let n = (state.fieldList || []).reduce((m, f) => { const x = /^(?:Field|حقل) (\d+)$/.exec(f.name); return Math.max(m, x ? +x[1] : 0); }, 0) + 1;
    while (used.has(`${word} ${n}`)) n++;
    return `${word} ${n}`;
  }

  function draftGeometry() {
    const gj = draft.layer.toGeoJSON().geometry;
    return gj.type === 'Polygon' ? gj : { type: 'Polygon', coordinates: gj.coordinates[0] };
  }
  const checkDraft = makeChecker((r) => {
    draft.result = r;
    $('dfStatus').innerHTML = statusHtml(r);
    hydrateIcons($('dfStatus'));
    if (!r.pending) showMarks(r);
    $('dfSave').disabled = draft.saving || (!r.pending && !r.offline && (!r.ok || r.duplicate));
  });
  function onDraftChange() {
    if (!draft.layer) return;
    draft.geometry = draftGeometry();
    const ring = draft.geometry.coordinates[0];
    $('dfArea').textContent = fmtArea(GisImport.polygonAreaHa(draft.geometry.coordinates));
    $('dfCorners').textContent = `${ring.length - 1} corners`;
    $('dfChoice').classList.add('hidden'); $('dfError').classList.add('hidden');
    checkDraft(draft.geometry, null);
  }

  /** Called when a polygon or circle has been drawn. */
  function openDraft(layer, layerType) {
    discardDraft(true);
    if (window.setSidePanel) setSidePanel(true);
    const geometry = layerToPolygonGeoJson(layer, layerType);
    const rings = geometry.coordinates.map((ring) => ring.slice(0, -1).map(([lng, lat]) => [lat, lng]));
    draft.layer = L.polygon(rings, { color: COLORS.draft, weight: 2, fillColor: COLORS.draft, fillOpacity: 0.12 }).addTo(mapInstance);
    if (draft.layer.editing) draft.layer.editing.enable();
    draft.layer.on('edit', onDraftChange);
    mapInstance.on('draw:editvertex draw:editmove', onDraftChange);

    fillFarmSelects();
    $('dfFarm').innerHTML = state.farms.map((f) => `<option value="${f.id}">${escapeHtml(f.name)}</option>`).join('');
    if (state.selectedFarmId) $('dfFarm').value = state.selectedFarmId;
    $('dfIrr').innerHTML = IRRIGATION.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
    $('dfName').value = suggestName();
    panel.classList.remove('hidden'); panel.classList.add('flex');
    onDraftChange();
    setTimeout(() => { $('dfName').focus(); $('dfName').select(); }, 30);
  }

  function discardDraft(silent) {
    mapInstance && mapInstance.off('draw:editvertex draw:editmove', onDraftChange);
    if (draft.layer) { if (draft.layer.editing) draft.layer.editing.disable(); mapInstance.removeLayer(draft.layer); }
    draft.layer = null; draft.geometry = null; draft.result = null;
    clearMarks();
    panel.classList.add('hidden'); panel.classList.remove('flex');
    $('dfChoice').classList.add('hidden'); $('dfChoice').innerHTML = '';
  }
  $('dfClose').addEventListener('click', () => discardDraft());
  $('dfCancel').addEventListener('click', () => discardDraft());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && draft.layer && !document.querySelector('dialog[open]') && !$('dfChoice').innerHTML) discardDraft();
  });

  async function saveDraft(overlap) {
    if (!draft.layer || draft.saving) return;
    const farmId = $('dfFarm').value;
    if (!farmId) { showError('Add a farm first'); return; }
    draft.saving = true; $('dfSave').disabled = true; $('dfError').classList.add('hidden');
    const name = $('dfName').value.trim();
    try {
      const row = await apiPost('/fields', {
        farmId, boundary: draftGeometry(), ...(name ? { name } : {}),
        ...($('dfIrr').value ? { irrigation: $('dfIrr').value } : {}), ...(overlap ? { overlap } : {}),
      });
      draft.saving = false;
      discardDraft(true);
      await goToFarm(farmId);
      showToast(`${row.name} saved · ${fmtArea(row.areaHectares)}${savedNote(row)}`);
    } catch (err) {
      draft.saving = false; $('dfSave').disabled = false;
      if (err.status === 409 && err.data && err.data.code === 'FIELD_OVERLAP') {
        showMarks(err.data);
        const choice = await askOverlap($('dfChoice'), err);
        if (choice) saveDraft(choice);
        return;
      }
      if (err.data && err.data.where) showMarks(err.data);
      $('dfError').textContent = err.message || 'Could not save this field';
      $('dfError').classList.remove('hidden');
    }
  }
  $('dfForm').addEventListener('submit', (e) => { e.preventDefault(); saveDraft(null); });

  // ------------------------------------------------------------ history (field panel)

  const EVENT_LABEL = {
    created: 'Field added', boundary_edited: 'Boundary edited', boundary_restored: 'Earlier boundary restored',
    renamed: 'Renamed', moved: 'Moved to another farm', irrigation: 'Irrigation changed', archived: 'Deleted', restored: 'Restored',
  };
  const fmtWhen = (d) => new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  let preview = null;
  function clearPreview() { if (preview && mapInstance) mapInstance.removeLayer(preview); preview = null; }

  function historyDetail(h) {
    const d = h.detail || {};
    if (h.event === 'renamed') return `${escapeHtml(d.from || '')} → ${escapeHtml(d.to || '')}`;
    if (h.event === 'irrigation') return `${escapeHtml(d.from || 'not set')} → ${escapeHtml(d.to || 'not set')}`;
    if (h.event === 'moved') {
      const farm = (id) => (state.farms.find((f) => f.id === id) || {}).name || 'another farm';
      return `${escapeHtml(farm(d.fromFarmId))} → ${escapeHtml(farm(d.toFarmId))}`;
    }
    const bits = [];
    if (h.areaHectares != null) bits.push(fmtArea(h.areaHectares));
    if (d.imported) bits.push('imported');
    if (d.clippedHa) bits.push(`overlap ${fmtArea(d.clippedHa)} cut`);
    if (d.overlapsKept) bits.push('overlap kept');
    if (d.repaired) bits.push('outline cleaned up');
    if (d.baseline) bits.push('first recorded boundary');
    return bits.join(' · ');
  }

  async function renderHistory(host, fieldId) {
    host.innerHTML = '<p class="text-[12px] text-gray-400">Loading history</p>';
    let rows = [];
    try { rows = (await apiGet(`/fields/${fieldId}/history`)) || []; } catch { host.innerHTML = '<p class="text-[12px] text-gray-400">History is not available</p>'; return; }
    const shapes = rows.filter((h) => h.boundary);
    const currentId = shapes[0] && shapes[0].id;
    host.innerHTML = `<ol class="fe-history">${rows.map((h) => `
      <li data-h="${h.id}" class="${h.boundary ? 'has-shape' : ''}">
        <div class="flex items-baseline justify-between gap-2">
          <span class="text-[13px] text-gray-900">${EVENT_LABEL[h.event] || escapeHtml(h.event)}</span>
          <span class="num shrink-0 font-mono text-[11px] text-gray-400">${fmtWhen(h.createdAt)}</span>
        </div>
        <div class="num mt-0.5 font-mono text-[12px] text-gray-500">${historyDetail(h)}${h.userEmail ? ` · ${escapeHtml(h.userEmail)}` : ''}</div>
        ${h.boundary && h.id !== currentId ? `<div class="mt-1.5 flex gap-3 text-[12px]"><button type="button" data-show="${h.id}" class="text-gray-500 hover:text-gray-900">Show on map</button><button type="button" data-restore="${h.id}" class="font-medium text-brand-700">Restore this boundary</button></div>` : ''}
        ${h.id === currentId ? '<div class="mt-1 text-[11px] text-gray-400">Current boundary</div>' : ''}
      </li>`).join('')}</ol>`;
    host.querySelectorAll('[data-show]').forEach((b) => b.addEventListener('click', () => {
      const h = rows.find((x) => x.id === b.dataset.show);
      clearPreview();
      preview = L.geoJSON(h.boundary, { interactive: false, style: { color: '#93c5fd', weight: 2, dashArray: '5 4', fillOpacity: 0.08 } }).addTo(mapInstance);
      mapInstance.fitBounds(preview.getBounds(), { padding: [60, 60], maxZoom: 17 });
    }));
    host.querySelectorAll('[data-restore]').forEach((b) => b.addEventListener('click', async () => {
      const restore = async (overlap) => {
        try {
          await apiPost(`/fields/${fieldId}/history/${b.dataset.restore}/restore`, overlap ? { overlap } : {});
          clearPreview();
          await goToFarm(state.selectedFarmId);
          showToast('Earlier boundary restored');
          openFieldPanel(fieldId);
        } catch (err) {
          if (err.status === 409 && err.data && err.data.code === 'FIELD_OVERLAP') {
            const slot = document.createElement('div'); b.closest('li').appendChild(slot);
            const choice = await askOverlap(slot, err); slot.remove();
            if (choice) restore(choice);
          } else showError(err.message || 'Could not restore this boundary');
        }
      };
      restore(null);
    }));
  }
  document.addEventListener('fieldpanel:close', clearPreview);

  // ------------------------------------------------------------ delete with undo, recently deleted

  async function deleteField(field) {
    await apiDelete(`/fields/${field.id}`);
    document.dispatchEvent(new CustomEvent('fieldpanel:close'));
    await goToFarm(state.selectedFarmId);
    showToast(`${field.name} deleted`, { label: 'Undo', run: () => restoreField(field.id, field.name) });
  }

  async function restoreField(id, name, overlap) {
    try {
      await apiPost(`/fields/${id}/restore`, overlap ? { overlap } : {});
      await goToFarm(state.selectedFarmId);
      showToast(`${name} restored`);
    } catch (err) {
      if (err.status === 409 && err.data && err.data.code === 'FIELD_OVERLAP') {
        const host = $('deletedChoice');
        if (host) {
          $('deletedSection').open = true;
          const choice = await askOverlap(host, err);
          if (choice) restoreField(id, name, choice);
          return;
        }
      }
      showError(err.message || 'Could not restore the field');
    }
  }

  async function renderDeleted() {
    const host = $('deletedSection');
    if (!host || !state.selectedFarmId) return;
    let rows = [];
    try { rows = (await apiGet(`/fields/archived?farmId=${state.selectedFarmId}`)) || []; } catch { rows = []; }
    host.classList.toggle('hidden', !rows.length);
    $('deletedCount').textContent = rows.length;
    $('deletedList').innerHTML = rows.map((r) => `
      <li class="flex items-center justify-between gap-2 py-1.5">
        <span class="min-w-0"><span class="block truncate text-[13px] text-gray-700">${escapeHtml(r.name)}</span><span class="num font-mono text-[11px] text-gray-400">${fmtArea(r.areaHectares)} · ${fmtWhen(r.archivedAt)}</span></span>
        <span class="flex shrink-0 gap-2 text-[12px]">
          <button type="button" data-undel="${r.id}" class="font-medium text-brand-700">Restore</button>
          ${typeof user !== 'undefined' && user && user.role === 'owner' ? `<button type="button" data-purge="${r.id}" class="text-gray-400 hover:text-red-600">Delete forever</button>` : ''}
        </span>
      </li>`).join('');
    $('deletedList').querySelectorAll('[data-undel]').forEach((b) => b.addEventListener('click', () => restoreField(b.dataset.undel, rows.find((r) => r.id === b.dataset.undel).name)));
    $('deletedList').querySelectorAll('[data-purge]').forEach((b) => b.addEventListener('click', async () => {
      const r = rows.find((x) => x.id === b.dataset.purge);
      if (!confirm(`Delete ${r.name} forever? Its crops, activities and history are removed and cannot be restored.`)) return;
      try { await apiDelete(`/fields/${r.id}?permanent=true`); renderDeleted(); showToast(`${r.name} deleted forever`); }
      catch (err) { showError(err.message || 'Could not delete the field'); }
    }));
  }
  document.addEventListener('workspace:fields', renderDeleted);

  window.FieldEditor = { openDraft, discardDraft, makeChecker, statusHtml, showMarks, clearMarks, askOverlap, savedNote, renderHistory, deleteField, restoreField, renderDeleted, fmtArea };
})();
