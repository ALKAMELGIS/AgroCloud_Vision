/*
 * AgroCloud Vision — farm Activity log (workspace.html)
 *
 * Month calendar for the selected farm: one row per field, one column per
 * day, a coloured mark per activity (colour = activity type). Filter by type,
 * move between months, download the month as CSV, click a field name to open
 * its field panel. Data: GET /activities/by-farm/:farmId?from&to.
 */
(function () {
  'use strict';

  const TYPES = window.ActivityTypes || [];
  const COLOR = Object.fromEntries(TYPES.map(([v, , c]) => [v, c]));
  const LABEL = Object.fromEntries(TYPES.map(([v, l]) => [v, l]));

  const dlg = document.createElement('dialog');
  dlg.id = 'activityLogDialog';
  dlg.className = 'sheet';
  dlg.style.width = 'min(1120px, calc(100% - 32px))';
  dlg.innerHTML = `
    <div class="flex max-h-[calc(100vh-48px)] flex-col">
      <div class="flex flex-wrap items-center gap-3 border-b border-gray-100 px-6 py-4">
        <div class="mr-auto min-w-0">
          <h2 class="text-[17px] font-medium">Activity log</h2>
          <p id="alFarm" class="mt-0.5 truncate text-[12px] text-gray-500"></p>
        </div>
        <div class="flex items-center gap-1">
          <button type="button" id="alPrev" class="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900" aria-label="Previous month">${icon('chevronLeft')}</button>
          <span id="alMonth" class="num w-36 text-center text-[14px] font-medium text-gray-900"></span>
          <button type="button" id="alNext" class="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900" aria-label="Next month">${icon('chevronRight')}</button>
        </div>
        <select id="alType" class="h-9 rounded-lg border border-gray-200 bg-white px-2.5 text-[13px] outline-none focus:border-brand-600">
          <option value="">All activities</option>${TYPES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
        </select>
        <button type="button" id="alCsv" class="flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-gray-700 ring-1 ring-gray-200 transition-colors hover:bg-gray-50">${icon('download')}Download CSV</button>
        <button type="button" data-close class="rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700" aria-label="Close">${icon('x')}</button>
      </div>
      <div id="alBody" class="min-h-0 flex-1 overflow-auto"></div>
      <div id="alLegend" class="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-gray-100 px-6 py-3 text-[12px] text-gray-500"></div>
    </div>`;
  document.body.appendChild(dlg);
  dlg.querySelector('[data-close]').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

  const al = { month: new Date(new Date().getFullYear(), new Date().getMonth(), 1), rows: [], type: '' };
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  document.getElementById('alLegend').innerHTML = TYPES.map(([, l, c]) =>
    `<span class="flex items-center gap-1.5"><span class="h-2 w-2 rounded-full" style="background:${c}"></span>${l}</span>`).join('');

  async function load() {
    const farm = state.farms.find((f) => f.id === state.selectedFarmId);
    document.getElementById('alFarm').textContent = farm ? farm.name : '';
    const start = al.month;
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
    document.getElementById('alMonth').textContent = start.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    const body = document.getElementById('alBody');
    body.innerHTML = '<p class="px-6 py-10 text-center text-[13px] text-gray-400">Loading</p>';
    try {
      al.rows = (await apiGet(`/activities/by-farm/${state.selectedFarmId}?from=${iso(start)}&to=${iso(end)}`)) || [];
    } catch (err) {
      body.innerHTML = `<p class="px-6 py-10 text-center text-[13px] text-red-600">${escapeHtml(err.message || 'Could not load the activity log')}</p>`;
      return;
    }
    render();
  }

  function render() {
    const start = al.month;
    const days = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
    const todayIso = iso(new Date());
    const rows = al.rows.filter((r) => !al.type || r.type === al.type);
    const fields = [...state.fieldsById.values()];
    const byField = new Map(fields.map((f) => [f.id, []]));
    rows.forEach((r) => { if (!byField.has(r.fieldId)) byField.set(r.fieldId, []); byField.get(r.fieldId).push(r); });
    const names = new Map(fields.map((f) => [f.id, f]));
    rows.forEach((r) => { if (!names.has(r.fieldId)) names.set(r.fieldId, { id: r.fieldId, name: r.fieldName }); });

    const body = document.getElementById('alBody');
    if (!names.size) {
      body.innerHTML = '<p class="px-6 py-10 text-center text-[13px] text-gray-400">This farm has no fields yet</p>';
      return;
    }
    const dayCols = Array.from({ length: days }, (_, i) => i + 1);
    const colIso = (d) => `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(d)}`;
    const weekend = (d) => [5, 6].includes(new Date(colIso(d) + 'T00:00:00').getDay()); // Fri/Sat weekend (UAE)

    body.innerHTML = `
      <table class="num w-full border-separate border-spacing-0 text-[12px]">
        <thead class="sticky top-0 z-10 bg-white">
          <tr>
            <th class="sticky left-0 z-20 h-9 min-w-[200px] border-b border-gray-100 bg-white px-6 text-left font-medium text-gray-500">Field</th>
            ${dayCols.map((d) => `<th class="h-9 min-w-[28px] border-b border-gray-100 text-center font-mono font-normal ${colIso(d) === todayIso ? 'text-brand-700' : weekend(d) ? 'text-gray-300' : 'text-gray-400'}">${d}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${[...names.values()].map((f) => {
            const acts = byField.get(f.id) || [];
            const byDay = new Map();
            acts.forEach((a) => { const d = +a.date.slice(8, 10); if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(a); });
            return `<tr class="group">
              <td class="sticky left-0 z-10 h-10 border-b border-gray-50 bg-white px-6 group-hover:bg-gray-50">
                <button type="button" data-field="${f.id}" class="flex w-full items-center justify-between gap-2 text-left">
                  <span class="truncate text-[13px] text-gray-900">${escapeHtml(f.name)}</span>
                  <span class="font-mono text-[11px] text-gray-400">${f.areaHectares != null ? formatHa(f.areaHectares) : ''}</span>
                </button>
              </td>
              ${dayCols.map((d) => {
                const list = byDay.get(d) || [];
                const tip = list.map((a) => `${LABEL[a.type] || a.type}${a.product ? ' · ' + a.product : ''}${a.rate != null ? ' · ' + a.rate + ' ' + (a.unit || '') : ''}`).join('\n');
                return `<td class="h-10 border-b border-gray-50 text-center ${colIso(d) === todayIso ? 'bg-brand-50/60' : ''} group-hover:bg-gray-50" title="${escapeHtml(tip)}">
                  <span class="inline-flex flex-wrap justify-center gap-0.5">${list.slice(0, 3).map((a) => `<span class="h-2 w-2 rounded-full" style="background:${COLOR[a.type] || '#9ca3af'}"></span>`).join('')}</span>
                </td>`;
              }).join('')}
            </tr>`;
          }).join('')}
        </tbody>
      </table>
      <p class="px-6 py-3 text-[12px] text-gray-500">${rows.length === 1 ? '1 activity' : rows.length + ' activities'} this month</p>`;
    body.querySelectorAll('[data-field]').forEach((b) => b.addEventListener('click', () => {
      dlg.close();
      if (state.fieldsById.has(b.dataset.field)) openFieldPanel(b.dataset.field, 'activities');
    }));
  }

  function csv() {
    const rows = al.rows.filter((r) => !al.type || r.type === al.type);
    const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const lines = [['date', 'field', 'activity', 'product', 'rate', 'unit', 'notes'].join(',')]
      .concat(rows.slice().reverse().map((r) => [r.date, r.fieldName, LABEL[r.type] || r.type, r.product, r.rate, r.unit, r.notes].map(esc).join(',')));
    const farm = state.farms.find((f) => f.id === state.selectedFarmId);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }));
    a.download = `activity-log_${(farm ? farm.name : 'farm').replace(/[^\w-]+/g, '_')}_${iso(al.month).slice(0, 7)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  document.getElementById('alPrev').addEventListener('click', () => { al.month = new Date(al.month.getFullYear(), al.month.getMonth() - 1, 1); load(); });
  document.getElementById('alNext').addEventListener('click', () => { al.month = new Date(al.month.getFullYear(), al.month.getMonth() + 1, 1); load(); });
  document.getElementById('alType').addEventListener('change', (e) => { al.type = e.target.value; render(); });
  document.getElementById('alCsv').addEventListener('click', csv);
  document.addEventListener('activities:changed', () => { if (dlg.open) load(); });

  const btn = document.getElementById('activityLogBtn');
  if (btn) btn.addEventListener('click', () => {
    if (!state.selectedFarmId) { showError('Add a farm first'); return; }
    dlg.showModal();
    load();
  });
  window.openActivityLog = () => btn && btn.click();
})();
