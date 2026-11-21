/*
 * AgroSyntra One — the field options menu (⋮ on a field card, right-click on a field on the map,
 * ⋮ in the field panel header).
 *
 *   Open field · Zoom to field · Hide on map · Add to favourites
 *   Rename · Change color · Transparency & outline
 *   Field settings · Edit boundary on map · Duplicate · Move to farm ›
 *   Export field › · Archive
 *   Delete field
 *
 * Server actions (rename, duplicate, move, archive, delete) go through the API like the field panel.
 * Display choices (hidden, favourite, colour, fill, outline) are kept per field in this browser
 * (localStorage "fieldPrefs:v1") and drawn by fieldStyle() and the imagery layer.
 *
 * Uses the workspace globals: state, mapInstance, apiGet, apiPost, apiPatch, apiDelete, ICONS, icon,
 * escapeHtml, formatHa, showError, showToast, goToFarm, flyToField, openFieldPanel, renderFieldsList.
 */
(function () {
  'use strict';
  const T = (s) => (window.I18n ? I18n.t(s) : s);
  if (window.I18n && I18n.add) I18n.add({"Add to group": "إضافة إلى مجموعة", "Group": "المجموعة", "New group…": "مجموعة جديدة…", "Remove from group": "إزالة من المجموعة", "fields": "حقول", "field": "حقل", "Removed from the group": "أُزيل من المجموعة", "Could not change the group": "تعذّر تغيير المجموعة", "Edit group": "تعديل المجموعة", "New group": "مجموعة جديدة", "Group name": "اسم المجموعة", "e.g. North pivots": "مثال: محاور الشمال", "Fields in the group": "الحقول في المجموعة", "The group needs a name": "تحتاج المجموعة إلى اسم", "Choose at least one field": "اختر حقلاً واحداً على الأقل", "Rename group": "إعادة تسمية المجموعة", "Collapse group": "طي المجموعة", "Expand group": "توسيع المجموعة", "Show the group on the map": "إظهار المجموعة على الخريطة", "Hide the group on the map": "إخفاء المجموعة على الخريطة", "Group options": "خيارات المجموعة", "Zoom to group": "التكبير إلى المجموعة", "Choose fields…": "اختيار الحقول…", "Ungroup": "فك المجموعة"});
  if (window.I18n && I18n.add) I18n.add({"Field options": "خيارات الحقل", "Open field": "فتح الحقل", "Zoom to field": "التكبير إلى الحقل", "Hide on map": "إخفاء على الخريطة", "Show on map": "إظهار على الخريطة", "Add to favourites": "إضافة إلى المفضلة", "Remove from favourites": "إزالة من المفضلة", "Rename": "إعادة التسمية", "Change color": "تغيير اللون", "Transparency & outline": "الشفافية والحدود", "Field settings": "إعدادات الحقل", "Edit boundary on map": "تعديل الحدود على الخريطة", "Duplicate": "تكرار", "Move to farm": "نقل إلى مزرعة", "Export field": "تصدير الحقل", "Archive": "أرشفة", "Delete field": "حذف الحقل", "Favourite": "مفضّل", "Hidden on the map": "مخفي على الخريطة", "No other farm yet": "لا توجد مزرعة أخرى بعد", "Shapefile (zip)": "Shapefile (ملف مضغوط)", "CSV (WKT)": "CSV (WKT)", "Field": "حقل", "The demo is read-only: sign in to change fields": "العرض التجريبي للقراءة فقط: سجّل الدخول لتعديل الحقول", "Could not complete this action": "تعذّر تنفيذ هذا الإجراء", "is hidden on the map": "مخفي على الخريطة", "is shown on the map": "ظاهر على الخريطة", "Undo": "تراجع", "added to favourites": "أُضيف إلى المفضلة", "removed from favourites": "أُزيل من المفضلة", "moved to": "نُقل إلى", "Open farm": "فتح المزرعة", "Could not move the field": "تعذّر نقل الحقل", "This field has no boundary to copy": "لا توجد حدود لهذا الحقل لنسخها", "copy": "نسخة", "saved": "حُفظ", "Open": "فتح", "The server needs the latest update to duplicate fields: redeploy the backend on Render": "يحتاج الخادم إلى آخر تحديث لتكرار الحقول: أعد نشر الخادم على Render", "Could not duplicate the field": "تعذّر تكرار الحقل", "This field has no boundary to export": "لا توجد حدود لهذا الحقل لتصديرها", "Exported": "تم التصدير", "The Shapefile writer is not loaded": "كاتب Shapefile غير محمّل", "Could not write the Shapefile": "تعذّرت كتابة Shapefile", "Could not load the zip writer": "تعذّر تحميل أداة الضغط", "Close": "إغلاق", "Cancel": "إلغاء", "Rename field": "إعادة تسمية الحقل", "Name": "الاسم", "Save": "حفظ", "The field needs a name": "يحتاج الحقل إلى اسم", "Renamed to": "أُعيدت تسميته إلى", "Field colour": "لون الحقل", "The outline and fill of this field on the map": "حدود هذا الحقل وتعبئته على الخريطة", "Colour": "اللون", "Default": "الافتراضي", "Custom": "مخصص", "Custom colour": "لون مخصص", "Apply": "تطبيق", "colour saved": "حُفظ اللون", "Satellite layer opacity": "عتامة طبقة القمر الصناعي", "Fill opacity": "عتامة التعبئة", "Outline width": "عرض الحدود", "An outline of 0 px hides the boundary line": "حدود بعرض 0 بكسل تُخفي خط الحدود", "style saved": "حُفظ النمط", "and its crops, activities and history will be deleted forever. This cannot be undone.": "ومحاصيله وأنشطته وسجلّه ستُحذف نهائياً. لا يمكن التراجع عن ذلك.", "To keep it recoverable, use Archive instead.": "لإبقائه قابلاً للاستعادة، استخدم الأرشفة بدلاً من ذلك.", "Delete forever": "حذف نهائي", "deleted forever": "حُذف نهائياً", "Archived": "المؤرشفة", "archived": "أُرشف"});

  // ------------------------------------------------------------ icons this menu needs
  Object.assign(ICONS, {
    more: '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>',
    star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/>',
    type: '<path d="M4 7V5h16v2"/><path d="M12 5v14"/><path d="M9 19h6"/>',
    palette: '<circle cx="13.5" cy="6.5" r="1"/><circle cx="17.5" cy="10.5" r="1"/><circle cx="8.5" cy="7.5" r="1"/><circle cx="6.5" cy="12.5" r="1"/><path d="M12 2a10 10 0 0 0 0 20c1 0 1.7-.8 1.7-1.7 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.9.8-1.7 1.7-1.7H17a5 5 0 0 0 5-5C22 6 17.5 2 12 2z"/>',
    sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    shapes: '<path d="M8.3 10a.7.7 0 0 1-.6-1.1l3.7-6a.7.7 0 0 1 1.2 0l3.7 6a.7.7 0 0 1-.6 1.1z"/><rect x="3" y="14" width="7" height="7" rx="1"/><circle cx="17.5" cy="17.5" r="3.5"/>',
    copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    moveTo: '<path d="M2 9V5c0-1.1.9-2 2-2h3.9a2 2 0 0 1 1.7.9l.8 1.2a2 2 0 0 0 1.7.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-1"/><path d="M2 13h10"/><path d="m9 16 3-3-3-3"/>',
    archive: '<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
  });

  // ------------------------------------------------------------ per-field display choices
  const KEY = 'fieldPrefs:v1';
  let prefs = {};
  try { prefs = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { prefs = {}; }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* storage off */ } };
  const FieldPrefs = {
    get: (id) => prefs[id] || {},
    set(id, patch) {
      const next = { ...(prefs[id] || {}), ...patch };
      Object.keys(next).forEach((k) => { if (next[k] == null || next[k] === false) delete next[k]; });
      if (Object.keys(next).length) prefs[id] = next; else delete prefs[id];
      save();
    },
  };
  window.FieldPrefs = FieldPrefs;

  // The map style of a field: its colour, fill and outline, the selected field brighter.
  const DEFAULT_COLOR = (typeof COLORS !== 'undefined' && COLORS.field) || '#22c55e';
  const baseStyle = window.fieldStyle;
  window.fieldStyle = function (id) {
    const p = FieldPrefs.get(id), on = id === state.selectedFieldId;
    const st = baseStyle ? baseStyle(id) : { color: DEFAULT_COLOR, weight: 2, fillOpacity: 0.04 };
    const color = p.color || st.color;
    const weight = p.weight != null ? p.weight : st.weight;
    return {
      ...st,
      color: on ? '#ffffff' : color,
      fillColor: p.color || st.fillColor,
      weight: on ? Math.max(weight, 3) : weight,
      opacity: weight === 0 && !on ? 0 : 1,
      fillOpacity: p.fill != null ? p.fill : st.fillOpacity,
    };
  };
  function restyle() {
    if (state.fieldsLayer) state.fieldsLayer.setStyle((f) => fieldStyle((f.properties || {}).id || f.id));
  }
  // hidden fields leave the map (and the imagery), favourites lead the list
  function applyVisibility() {
    if (!state.fieldsLayer || !state.fieldLayerById) return;
    state.fieldLayerById.forEach((layer, id) => {
      const hidden = !!FieldPrefs.get(id).hidden, on = state.fieldsLayer.hasLayer(layer);
      if (hidden && on) state.fieldsLayer.removeLayer(layer);
      if (!hidden && !on) state.fieldsLayer.addLayer(layer);
    });
    restyle();
  }
  // the imagery of a field takes its transparency
  function applyImageryOpacity() {
    const v = window.Imagery && Imagery.views && Imagery.views[0];
    if (!v || !v.layerFor) return;
    v.layerFor.forEach((layer, id) => { const p = FieldPrefs.get(id); layer.setOpacity(p.imgOpacity != null ? p.imgOpacity : 1); });
  }
  document.addEventListener('workspace:fields', () => { applyVisibility(); bindMap(); });
  document.addEventListener('imagery:change', applyImageryOpacity);

  // ------------------------------------------------------------ the list: ⋮ on every card
  const list = document.getElementById('fieldsList');
  const decorate = () => {
    list.querySelectorAll('.field-card').forEach((card) => {
      const id = card.dataset.fieldId;
      if (card.parentElement.classList.contains('field-row')) return;
      const row = document.createElement('div'); row.className = 'field-row'; row.dataset.fieldId = id;
      card.replaceWith(row); row.appendChild(card);
      const p = FieldPrefs.get(id);
      if (p.fav || p.hidden) {
        const name = card.querySelector('.truncate');
        if (name) name.insertAdjacentHTML('beforeend', `${p.fav ? `<span class="fm-flag" title="${T('Favourite')}">${icon('star')}</span>` : ''}${p.hidden ? `<span class="fm-flag" title="${T('Hidden on the map')}">${icon('eyeOff')}</span>` : ''}`);
      }
      if (p.hidden) row.classList.add('is-hidden');
      const more = document.createElement('button');
      more.type = 'button'; more.className = 'field-more'; more.innerHTML = icon('more');
      more.setAttribute('aria-label', T('Field options')); more.setAttribute('aria-haspopup', 'menu'); more.title = T('Field options');
      more.addEventListener('click', (e) => { e.stopPropagation(); openMenu(id, more); });
      row.appendChild(more);
      card.addEventListener('contextmenu', (e) => { e.preventDefault(); openMenu(id, null, e.clientX, e.clientY); });
    });
    // favourites first, keeping the chosen order inside each group
    const rows = [...list.querySelectorAll(':scope > .field-row')];
    rows.filter((r) => FieldPrefs.get(r.dataset.fieldId).fav).reverse().forEach((r) => list.prepend(r));
    buildTree();
  };
  new MutationObserver(() => { if (list.querySelector(':scope > .field-card')) decorate(); }).observe(list, { childList: true });
  decorate();

  // ------------------------------------------------------------ the map: right-click a field
  let mapBound = null;
  function bindMap() {
    if (!state.fieldsLayer || mapBound === state.fieldsLayer) return;
    mapBound = state.fieldsLayer;
    state.fieldsLayer.on('contextmenu', (e) => {
      const layer = e.layer || e.propagatedFrom; if (!layer) return;
      let id = null; state.fieldLayerById.forEach((l, k) => { if (l === layer) id = k; });
      if (!id) return;
      L.DomEvent.preventDefault(e.originalEvent); L.DomEvent.stop(e);
      openMenu(id, null, e.originalEvent.clientX, e.originalEvent.clientY);
    });
  }

  // ------------------------------------------------------------ the panel header: ⋮ next to close
  function bindPanel() {
    const close = document.getElementById('fpClose');
    if (!close || document.getElementById('fpMore')) return;
    const b = document.createElement('button');
    b.type = 'button'; b.id = 'fpMore'; b.className = close.className; b.innerHTML = icon('more');
    b.setAttribute('aria-label', T('Field options')); b.setAttribute('aria-haspopup', 'menu'); b.title = T('Field options');
    b.addEventListener('click', (e) => { e.stopPropagation(); if (window.FieldPanel && FieldPanel.fieldId) openMenu(FieldPanel.fieldId, b); });
    const wrap = document.createElement('div'); wrap.className = 'flex shrink-0 items-center gap-0.5';
    close.replaceWith(wrap); wrap.append(b, close);
  }
  bindPanel();

  // ------------------------------------------------------------ the menu
  const menu = document.createElement('div');
  menu.className = 'fm-menu'; menu.setAttribute('role', 'menu'); menu.hidden = true;
  document.body.appendChild(menu);
  let menuFor = null, anchorEl = null, sub = null;

  const fieldOf = (id) => {
    const geo = state.fieldsById && state.fieldsById.get(id);
    const row = (state.fieldList || []).find((f) => f.id === id);
    return geo || row ? { ...(row || {}), ...(geo || {}), id } : null;
  };
  const item = (act, ico, label, extra = '') => `<button type="button" role="menuitem" class="fm-item ${extra}" data-act="${act}">${icon(ico)}<span>${T(label)}</span>${extra.includes('has-sub') ? `<span class="fm-chev">${icon('chevronRight')}</span>` : ''}</button>`;
  const sep = '<div class="fm-sep" role="separator"></div>';

  function openMenu(id, anchor, x, y) {
    const f = fieldOf(id); if (!f) return;
    closeMenu();
    menuFor = id; anchorEl = anchor;
    const p = FieldPrefs.get(id);
    const area = Number.isFinite(f.areaHectares) ? formatHa(f.areaHectares) : '';
    menu.innerHTML = `
      <div class="fm-head"><b>${escapeHtml(f.name || '')}</b><span class="num">${area}</span></div>
      ${item('open', 'mapPin', 'Open field')}
      ${item('zoom', 'focus', 'Zoom to field')}
      ${item('hide', p.hidden ? 'eye' : 'eyeOff', p.hidden ? 'Show on map' : 'Hide on map')}
      ${item('fav', 'star', p.fav ? 'Remove from favourites' : 'Add to favourites', p.fav ? 'is-fav' : '')}
      ${sep}
      ${item('rename', 'type', 'Rename')}
      ${item('color', 'palette', 'Change color')}
      ${item('style', 'sliders', 'Transparency & outline')}
      ${sep}
      ${item('settings', 'settings', 'Field settings')}
      ${item('edit', 'shapes', 'Edit boundary on map')}
      ${item('duplicate', 'copy', 'Duplicate')}
      ${item('group', 'layers', f.groupName ? 'Group' : 'Add to group', 'has-sub')}
      ${item('move', 'moveTo', 'Move to farm', 'has-sub')}
      ${sep}
      ${item('export', 'download', 'Export field', 'has-sub')}
      ${item('archive', 'archive', 'Archive')}
      ${sep}
      ${item('delete', 'trash', 'Delete field', 'is-danger')}`;
    menu.hidden = false;
    place(menu, anchor, x, y);
    if (anchor) anchor.setAttribute('aria-expanded', 'true');
    menu.querySelector('.fm-item').focus({ preventScroll: true });
  }
  function closeMenu() {
    if (sub) { sub.remove(); sub = null; }
    if (menu.hidden) return;
    menu.hidden = true;
    if (anchorEl) { anchorEl.setAttribute('aria-expanded', 'false'); }
    menuFor = null; anchorEl = null;
  }
  // below/above the anchor or at the pointer, always inside the window
  function place(el, anchor, x, y, beside) {
    el.style.left = '0px'; el.style.top = '0px';
    const r = el.getBoundingClientRect(), W = innerWidth, H = innerHeight, rtl = document.dir === 'rtl';
    let left, top;
    if (beside) {
      const b = beside.getBoundingClientRect();
      left = rtl ? b.left - r.width + 4 : b.right - 4;
      if (left + r.width > W - 8 || left < 8) left = rtl ? b.right - 4 : b.left - r.width + 4;
      top = b.top - 6;
    } else if (anchor) {
      const b = anchor.getBoundingClientRect();
      left = rtl ? b.left : b.right - r.width;
      top = b.bottom + 4;
      if (top + r.height > H - 8) top = b.top - r.height - 4;
    } else { left = rtl ? x - r.width : x; top = y; }
    left = Math.max(8, Math.min(left, W - r.width - 8));
    top = Math.max(8, Math.min(top, H - r.height - 8));
    el.style.left = Math.round(left) + 'px'; el.style.top = Math.round(top) + 'px';
  }

  function openSub(kind, btn) {
    if (sub) sub.remove();
    sub = document.createElement('div'); sub.className = 'fm-menu fm-sub'; sub.setAttribute('role', 'menu');
    if (kind === 'group') {
      const f = fieldOf(menuFor) || {}, groups = groupNames();
      sub.innerHTML = groups.map((g) => `<button type="button" role="menuitemradio" aria-checked="${g === f.groupName}" class="fm-item" data-group="${escapeHtml(g)}">${icon(g === f.groupName ? 'check' : 'layers')}<span>${escapeHtml(g)}</span></button>`).join('')
        + (groups.length ? sep : '')
        + `<button type="button" role="menuitem" class="fm-item" data-group-new="1">${icon('folderPlus')}<span>${T('New group…')}</span></button>`
        + (f.groupName ? `<button type="button" role="menuitem" class="fm-item" data-group-out="1">${icon('x')}<span>${T('Remove from group')}</span></button>` : '');
    } else if (kind === 'move') {
      const others = state.farms.filter((fm) => fm.id !== state.selectedFarmId);
      sub.innerHTML = others.length
        ? others.map((fm) => `<button type="button" role="menuitem" class="fm-item" data-farm="${fm.id}"><span>${escapeHtml(fm.name)}</span></button>`).join('')
        : `<p class="fm-empty">${T('No other farm yet')}</p>`;
    } else {
      sub.innerHTML = [['geojson', 'GeoJSON'], ['kml', 'KML'], ['shp', 'Shapefile (zip)'], ['gpx', 'GPX'], ['csv', 'CSV (WKT)']]
        .map(([k, l]) => `<button type="button" role="menuitem" class="fm-item" data-exp="${k}"><span>${T(l)}</span></button>`).join('');
    }
    document.body.appendChild(sub);
    place(sub, null, 0, 0, btn);
    const id = menuFor;
    sub.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      closeMenu();
      if (b.dataset.group != null) setGroup([id], b.dataset.group);
      else if (b.dataset.groupNew) groupDialog({ fieldIds: [id] });
      else if (b.dataset.groupOut) setGroup([id], '');
      else if (b.dataset.farm) moveTo(id, b.dataset.farm); else exportField(id, b.dataset.exp);
    });
    const first = sub.querySelector('button'); if (first) first.focus({ preventScroll: true });
  }

  menu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    e.stopPropagation();
    const act = b.dataset.act, id = menuFor;
    if (act === 'move' || act === 'export' || act === 'group') { openSub(act, b); return; }
    closeMenu();
    run(act, id);
  });
  menu.addEventListener('pointerover', (e) => {
    const b = e.target.closest('.has-sub');
    if (b && (!sub || sub.dataset.for !== b.dataset.act) && matchMedia('(hover: hover)').matches) { openSub(b.dataset.act, b); sub.dataset.for = b.dataset.act; }
    else if (!b && e.target.closest('[data-act]') && sub) { sub.remove(); sub = null; }
  });
  document.addEventListener('pointerdown', (e) => {
    if (menu.hidden) return;
    if (menu.contains(e.target) || (sub && sub.contains(e.target)) || (anchorEl && anchorEl.contains(e.target))) return;
    closeMenu();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (menu.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); const a = anchorEl; if (sub) { sub.remove(); sub = null; menu.querySelector('.has-sub').focus(); return; } closeMenu(); if (a) a.focus(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const host = sub && sub.contains(document.activeElement) ? sub : menu;
      const items = [...host.querySelectorAll('button')]; const i = items.indexOf(document.activeElement);
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
    }
    const fwd = document.dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
    if (e.key === fwd && document.activeElement.classList.contains('has-sub')) { e.preventDefault(); openSub(document.activeElement.dataset.act, document.activeElement); }
  }, true);
  addEventListener('resize', closeMenu);
  if (list) list.addEventListener('scroll', closeMenu, { passive: true });

  // ------------------------------------------------------------ actions
  const nameOf = (id) => (fieldOf(id) || {}).name || T('Field');
  const reloadFarm = async (fit) => { await goToFarm(state.selectedFarmId, fit); };
  const readOnly = () => { if (window.DEMO) { showToast(T('The demo is read-only: sign in to change fields')); return true; } return false; };

  async function run(act, id) {
    const f = fieldOf(id); if (!f) return;
    try {
      if (act === 'open') { openFieldPanel(id); return; }
      if (act === 'zoom') { if (FieldPrefs.get(id).hidden) { FieldPrefs.set(id, { hidden: false }); applyVisibility(); refreshImagery(); renderFieldsList(); } flyToField(id); return; }
      if (act === 'hide') {
        const hidden = !FieldPrefs.get(id).hidden;
        FieldPrefs.set(id, { hidden });
        if (hidden && window.FieldPanel && FieldPanel.fieldId === id) document.getElementById('fpClose').click();
        applyVisibility(); refreshImagery(); renderFieldsList();
        showToast(hidden ? `${f.name} ${T('is hidden on the map')}` : `${f.name} ${T('is shown on the map')}`, hidden ? { label: T('Undo'), run: () => run('hide', id) } : undefined);
        return;
      }
      if (act === 'fav') {
        const fav = !FieldPrefs.get(id).fav; FieldPrefs.set(id, { fav }); renderFieldsList();
        showToast(fav ? `${f.name} ${T('added to favourites')}` : `${f.name} ${T('removed from favourites')}`);
        return;
      }
      if (act === 'rename') return renameDialog(f);
      if (act === 'color') return colorDialog(f);
      if (act === 'style') return styleDialog(f);
      if (act === 'settings') { await openFieldPanel(id, 'overview'); setTimeout(() => { const n = document.getElementById('fpNameInput'); if (n) { n.focus(); n.select(); } }, 250); return; }
      if (act === 'edit') {
        if (readOnly()) return;
        if (FieldPrefs.get(id).hidden) { FieldPrefs.set(id, { hidden: false }); applyVisibility(); }
        await openFieldPanel(id); const b = document.getElementById('fpEdit'); if (b) b.click(); return;
      }
      if (act === 'duplicate') return duplicate(f);
      if (act === 'archive') {
        if (readOnly()) return;
        await FieldEditor.deleteField(f);   // recoverable: Undo in the toast, Restore under Archived
        return;
      }
      if (act === 'delete') return deleteDialog(f);
    } catch (err) { showError(err.message || T('Could not complete this action')); }
  }
  function refreshImagery() { if (window.Imagery && Imagery.refresh) Imagery.refresh(); }

  async function moveTo(id, farmId) {
    if (readOnly()) return;
    const f = fieldOf(id), farm = state.farms.find((x) => x.id === farmId);
    try {
      await apiPatch(`/fields/${id}`, { farmId });
      await reloadFarm();
      showToast(`${f.name} ${T('moved to')} ${farm ? farm.name : ''}`, { label: T('Open farm'), run: () => goToFarm(farmId, true) });
    } catch (err) { showError(err.message || T('Could not move the field')); }
  }

  async function duplicate(f) {
    if (readOnly()) return;
    let g = f.geometry;
    if (!g) { showError(T('This field has no boundary to copy')); return; }
    if (g.type === 'MultiPolygon') {   // the API saves one polygon: keep the largest part
      const ringArea = (r) => Math.abs(r.reduce((a, p, i) => { const q = r[(i + 1) % r.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0));
      g = { type: 'Polygon', coordinates: g.coordinates.slice().sort((a, b) => ringArea(b[0]) - ringArea(a[0]))[0] };
    }
    const taken = new Set((state.fieldList || []).map((x) => x.name));
    let name = `${f.name} ${T('copy')}`; for (let n = 2; taken.has(name); n++) name = `${f.name} ${T('copy')} ${n}`;
    try {
      const body = { farmId: state.selectedFarmId, name, boundary: g, copyOf: f.id };
      if (f.irrigation) body.irrigation = f.irrigation;
      const saved = await apiPost('/fields', body);
      await reloadFarm();
      showToast(`${name} ${T('saved')}`, saved && saved.id ? { label: T('Open'), run: () => openFieldPanel(saved.id) } : undefined);
    } catch (err) {
      showError(/already saved/i.test(err.message || '') ? T('The server needs the latest update to duplicate fields: redeploy the backend on Render') : err.message || T('Could not duplicate the field'));
    }
  }

  // ------------------------------------------------------------ groups (a layer tree, like ArcGIS Online group layers)
  // A field belongs to at most one named group (fields."groupName", shared through Supabase). The list shows each
  // group as a collapsible node with its own eye, count, area and menu; ungrouped fields follow.
  const UI_KEY = 'fieldGroupsUI:v1';
  let ui = {}; try { ui = JSON.parse(localStorage.getItem(UI_KEY) || '{}') || {}; } catch { ui = {}; }
  const uiKey = (name) => (state.selectedFarmId || '') + '|' + name;
  const saveUi = () => { try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch { /* storage off */ } };
  const groupOf = (id) => ((state.fieldList || []).find((f) => f.id === id) || {}).groupName || '';
  function groupNames() { return [...new Set((state.fieldList || []).map((f) => f.groupName).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })); }
  const membersOf = (name) => (state.fieldList || []).filter((f) => f.groupName === name).map((f) => f.id);

  async function setGroup(ids, name) {
    if (readOnly()) return;
    const target = String(name || '').trim();
    const todo = ids.filter((id) => groupOf(id) !== target);
    try {
      for (const id of todo) await apiPatch(`/fields/${id}`, { groupName: target });
      await reloadFarm();
      if (todo.length) showToast(target ? `${todo.length === 1 ? (fieldOf(todo[0]) || {}).name : todo.length + ' ' + T('fields')} → ${target}` : T('Removed from the group'));
    } catch (err) { showError(err.message || T('Could not change the group')); }
  }

  // New group / edit a group: a name and the fields in it, chosen from the farm's list
  function groupDialog({ fieldIds = [], editing = null }) {
    if (readOnly()) return;
    const all = (state.fieldList || []).slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const pre = new Set(editing ? membersOf(editing) : fieldIds);
    openDialog(T(editing ? 'Edit group' : 'New group'), `
      <label class="mb-1.5 block text-[12px] font-medium text-gray-500" for="fmGroupName">${T('Group name')}</label>
      <input id="fmGroupName" required maxlength="120" class="h-10 w-full rounded-lg border border-gray-200 px-3 text-[14px] outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20" value="${escapeHtml(editing || '')}" placeholder="${T('e.g. North pivots')}">
      <div class="mb-1.5 mt-4 flex items-center justify-between text-[12px] font-medium text-gray-500"><span>${T('Fields in the group')}</span><span class="num" id="fmGroupCount"></span></div>
      <div class="fm-checklist thin-scroll">${all.map((f) => `<label class="fm-check"><input type="checkbox" value="${f.id}" ${pre.has(f.id) ? 'checked' : ''}><span class="truncate">${escapeHtml(f.name)}</span><span class="num">${formatHa(f.areaHectares)}</span>${f.groupName && f.groupName !== editing ? `<em>${escapeHtml(f.groupName)}</em>` : ''}</label>`).join('')}</div>`,
    T('Save'), async (d) => {
      const name = d.querySelector('#fmGroupName').value.trim();
      if (!name) throw new Error(T('The group needs a name'));
      const chosen = [...d.querySelectorAll('.fm-check input:checked')].map((i) => i.value);
      if (!chosen.length) throw new Error(T('Choose at least one field'));
      const out = editing ? membersOf(editing).filter((id) => !chosen.includes(id)) : [];
      for (const id of chosen) if (groupOf(id) !== name) await apiPatch(`/fields/${id}`, { groupName: name });
      for (const id of out) await apiPatch(`/fields/${id}`, { groupName: '' });
      if (editing && editing !== name && ui[uiKey(editing)] != null) { ui[uiKey(name)] = ui[uiKey(editing)]; delete ui[uiKey(editing)]; saveUi(); }
      await reloadFarm();
      showToast(`${name}: ${chosen.length} ${T(chosen.length === 1 ? 'field' : 'fields')}`);
    });
    const count = () => { dlg.querySelector('#fmGroupCount').textContent = dlg.querySelectorAll('.fm-check input:checked').length + ' / ' + all.length; };
    dlg.querySelectorAll('.fm-check input').forEach((i) => i.addEventListener('change', count)); count();
  }

  function renameGroup(name) {
    if (readOnly()) return;
    openDialog(T('Rename group'), `<label class="mb-1.5 block text-[12px] font-medium text-gray-500" for="fmGroupName">${T('Group name')}</label>
      <input id="fmGroupName" required maxlength="120" class="h-10 w-full rounded-lg border border-gray-200 px-3 text-[14px] outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20" value="${escapeHtml(name)}">`,
    T('Save'), async (d) => {
      const next = d.querySelector('#fmGroupName').value.trim();
      if (!next) throw new Error(T('The group needs a name'));
      if (next === name) return true;
      for (const id of membersOf(name)) await apiPatch(`/fields/${id}`, { groupName: next });
      if (ui[uiKey(name)] != null) { ui[uiKey(next)] = ui[uiKey(name)]; delete ui[uiKey(name)]; saveUi(); }
      await reloadFarm();
      showToast(`${T('Renamed to')} ${next}`);
    });
    dlg.querySelector('#fmGroupName').select();
  }

  function zoomToGroup(name) {
    let b = null;
    membersOf(name).forEach((id) => { const l = state.fieldLayerById && state.fieldLayerById.get(id); if (l) b = b ? b.extend(l.getBounds()) : L.latLngBounds(l.getBounds().getSouthWest(), l.getBounds().getNorthEast()); });
    if (b && mapInstance) mapInstance.fitBounds(b, { padding: [60, 60], maxZoom: 16 });
  }
  function setGroupHidden(name, hidden) {
    membersOf(name).forEach((id) => FieldPrefs.set(id, { hidden }));
    applyVisibility(); refreshImagery(); renderFieldsList();
  }

  function buildTree() {
    if (list.querySelector(':scope > .fg')) return;
    const names = groupNames(); if (!names.length) return;
    const first = list.firstChild;
    names.forEach((name) => {
      const rows = [...list.querySelectorAll(':scope > .field-row')].filter((r) => groupOf(r.dataset.fieldId) === name);
      if (!rows.length) return;   // filtered out by the search or a risk chip
      const ids = membersOf(name), ha = (state.fieldList || []).filter((f) => ids.includes(f.id)).reduce((a, f) => a + (f.areaHectares || 0), 0);
      const allHidden = ids.every((id) => FieldPrefs.get(id).hidden), open = !ui[uiKey(name)];
      const sec = document.createElement('div'); sec.className = 'fg'; sec.dataset.group = name; sec.setAttribute('role', 'group');
      sec.innerHTML = `<div class="fg-head">
          <button type="button" class="fg-toggle" aria-expanded="${open}" aria-label="${T(open ? 'Collapse group' : 'Expand group')}">${icon('chevronDown')}</button>
          <button type="button" class="fg-eye" aria-pressed="${!allHidden}" title="${T(allHidden ? 'Show the group on the map' : 'Hide the group on the map')}" aria-label="${T(allHidden ? 'Show the group on the map' : 'Hide the group on the map')}">${icon(allHidden ? 'eyeOff' : 'eye')}</button>
          <span class="fg-name truncate" translate="no">${escapeHtml(name)}</span>
          <span class="fg-meta num">${ids.length} · ${formatHa(ha)}</span>
          <button type="button" class="field-more fg-more" aria-haspopup="menu" aria-label="${T('Group options')}" title="${T('Group options')}">${icon('more')}</button>
        </div><div class="fg-body"${open ? '' : ' hidden'}></div>`;
      const body = sec.querySelector('.fg-body');
      rows.forEach((r) => body.appendChild(r));
      list.insertBefore(sec, first && first.parentNode === list ? first : null);
      sec.querySelector('.fg-toggle').addEventListener('click', () => { ui[uiKey(name)] = open ? 1 : undefined; if (!ui[uiKey(name)]) delete ui[uiKey(name)]; saveUi(); renderFieldsList(); });
      sec.querySelector('.fg-name').addEventListener('click', () => sec.querySelector('.fg-toggle').click());
      sec.querySelector('.fg-eye').addEventListener('click', () => setGroupHidden(name, !allHidden));
      const more = sec.querySelector('.fg-more');
      more.addEventListener('click', (e) => { e.stopPropagation(); openGroupMenu(name, more); });
      sec.querySelector('.fg-head').addEventListener('contextmenu', (e) => { e.preventDefault(); openGroupMenu(name, null, e.clientX, e.clientY); });
    });
    // keep the groups in name order at the top, then the fields without a group
    [...list.querySelectorAll(':scope > .fg')].reverse().forEach((g) => list.prepend(g));
  }

  let groupFor = null;
  function openGroupMenu(name, anchor, x, y) {
    closeMenu();
    groupFor = name; anchorEl = anchor;
    const ids = membersOf(name), allHidden = ids.every((id) => FieldPrefs.get(id).hidden);
    const g = (act, ico, label, extra = '') => `<button type="button" role="menuitem" class="fm-item ${extra}" data-gact="${act}">${icon(ico)}<span>${T(label)}</span></button>`;
    menu.innerHTML = `<div class="fm-head"><b translate="no">${escapeHtml(name)}</b><span class="num">${ids.length} ${T(ids.length === 1 ? 'field' : 'fields')}</span></div>
      ${g('zoom', 'focus', 'Zoom to group')}
      ${g('vis', allHidden ? 'eye' : 'eyeOff', allHidden ? 'Show the group on the map' : 'Hide the group on the map')}
      ${sep}
      ${g('rename', 'type', 'Rename group')}
      ${g('edit', 'layers', 'Choose fields…')}
      ${sep}
      ${g('ungroup', 'x', 'Ungroup', 'is-danger')}`;
    menu.hidden = false; place(menu, anchor, x, y);
    if (anchor) anchor.setAttribute('aria-expanded', 'true');
    menu.querySelector('.fm-item').focus({ preventScroll: true });
  }
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-gact]'); if (!b) return;
    e.stopPropagation();
    const name = groupFor; closeMenu();
    const act = b.dataset.gact;
    if (act === 'zoom') zoomToGroup(name);
    else if (act === 'vis') setGroupHidden(name, !membersOf(name).every((id) => FieldPrefs.get(id).hidden));
    else if (act === 'rename') renameGroup(name);
    else if (act === 'edit') groupDialog({ editing: name });
    else if (act === 'ungroup') setGroup(membersOf(name), '');
  });

  // ------------------------------------------------------------ export
  function ringsOf(g) { return g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []; }
  function exportField(id, fmt) {
    const f = fieldOf(id); if (!f || !f.geometry) { showError(T('This field has no boundary to export')); return; }
    const base = String(f.name || 'field').replace(/[^\w؀-ۿ-]+/g, '_').slice(0, 60) || 'field';
    const ha = Number.isFinite(f.areaHectares) ? +f.areaHectares.toFixed(4) : null;
    const props = { id: f.id, name: f.name, area_ha: ha, irrigation: f.irrigation || null, farm: (state.farms.find((x) => x.id === state.selectedFarmId) || {}).name || null };
    const polys = ringsOf(f.geometry);
    const x = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const dl = (name, blob) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1500); };
    const done = (n) => showToast(`${T('Exported')} ${n}`);
    if (fmt === 'geojson') {
      dl(base + '.geojson', new Blob([JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: props, geometry: f.geometry }] }, null, 1)], { type: 'application/geo+json' }));
      return done(base + '.geojson');
    }
    if (fmt === 'kml') {
      const coords = (r) => r.map((p) => `${p[0]},${p[1]}`).join(' ');
      const poly = (rings) => `<Polygon><outerBoundaryIs><LinearRing><coordinates>${coords(rings[0])}</coordinates></LinearRing></outerBoundaryIs>${rings.slice(1).map((r) => `<innerBoundaryIs><LinearRing><coordinates>${coords(r)}</coordinates></LinearRing></innerBoundaryIs>`).join('')}</Polygon>`;
      const geom = polys.length === 1 ? poly(polys[0]) : `<MultiGeometry>${polys.map(poly).join('')}</MultiGeometry>`;
      const data = Object.entries(props).map(([k, v]) => `<Data name="${k}"><value>${x(v)}</value></Data>`).join('');
      dl(base + '.kml', new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${x(f.name)}</name><Placemark><name>${x(f.name)}</name><ExtendedData>${data}</ExtendedData>${geom}</Placemark></Document></kml>`], { type: 'application/vnd.google-earth.kml+xml' }));
      return done(base + '.kml');
    }
    if (fmt === 'gpx') {
      const trk = polys.map((rings) => `<trkseg>${rings[0].map((p) => `<trkpt lat="${p[1]}" lon="${p[0]}"/>`).join('')}</trkseg>`).join('');
      dl(base + '.gpx', new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="AgroSyntra One" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${x(f.name)}</name>${trk}</trk></gpx>`], { type: 'application/gpx+xml' }));
      return done(base + '.gpx');
    }
    if (fmt === 'csv') {
      const ring = (r) => '(' + r.map((p) => `${p[0]} ${p[1]}`).join(', ') + ')';
      const wkt = polys.length === 1 ? `POLYGON(${polys[0].map(ring).join(', ')})` : `MULTIPOLYGON(${polys.map((pp) => '(' + pp.map(ring).join(', ') + ')').join(', ')})`;
      const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      dl(base + '.csv', new Blob(['﻿' + ['id,name,area_ha,irrigation,farm,wkt', [props.id, props.name, props.area_ha, props.irrigation, props.farm, wkt].map(q).join(',')].join('\r\n')], { type: 'text/csv' }));
      return done(base + '.csv');
    }
    if (fmt === 'shp') {
      if (!window.Vra || !Vra.writeShapefile) { showError(T('The Shapefile writer is not loaded')); return; }
      const parts = Vra.writeShapefile([{ type: 'polygon', polygons: polys }], [{ NAME: f.name, AREA_HA: ha, IRRIG: f.irrigation || '', FIELD_ID: f.id }],
        [['NAME', 'C', 80], ['AREA_HA', 'N', 14, 4], ['IRRIG', 'C', 20], ['FIELD_ID', 'C', 40]]);
      zipShp(base, parts).then((blob) => { dl(base + '_shp.zip', blob); done(base + '_shp.zip'); }).catch((err) => showError(err.message || T('Could not write the Shapefile')));
    }
  }
  function zipShp(base, parts) {
    const load = () => (window.JSZip ? Promise.resolve(window.JSZip) : new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
      s.onload = () => res(window.JSZip); s.onerror = () => rej(new Error(T('Could not load the zip writer'))); document.head.appendChild(s);
    }));
    return load().then((JSZip) => {
      const z = new JSZip();
      ['shp', 'shx', 'dbf', 'prj', 'cpg'].forEach((k) => z.file(`${base}.${k}`, parts[k]));
      return z.generateAsync({ type: 'blob' });
    });
  }

  // ------------------------------------------------------------ dialogs
  const dlg = document.createElement('dialog');
  dlg.className = 'sheet narrow fm-dialog';
  document.body.appendChild(dlg);
  dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.closest('[data-close]')) dlg.close(); });
  let onClose = null;
  dlg.addEventListener('close', () => { if (onClose) { const f = onClose; onClose = null; f(); } });
  function openDialog(title, body, okLabel, onOk, danger) {
    dlg.innerHTML = `<form method="dialog" class="p-6">
      <div class="mb-4 flex items-center justify-between gap-3">
        <h2 class="text-[17px] font-medium">${title}</h2>
        <button type="button" data-close class="rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700" aria-label="${T('Close')}">${icon('x')}</button>
      </div>
      ${body}
      <p class="fm-err hidden mt-3 text-[13px] text-red-600" role="alert"></p>
      <div class="mt-6 flex justify-end gap-2">
        <button type="button" data-close class="h-10 rounded-lg px-4 text-[14px] font-medium text-gray-700 ring-1 ring-gray-200 transition-colors hover:bg-gray-50">${T('Cancel')}</button>
        <button type="submit" class="fm-ok h-10 rounded-lg px-4 text-[14px] font-medium text-white transition-colors disabled:opacity-50 ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-brand-600 hover:bg-brand-700'}">${okLabel}</button>
      </div></form>`;
    const form = dlg.querySelector('form'), ok = dlg.querySelector('.fm-ok'), err = dlg.querySelector('.fm-err');
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); ok.disabled = true; err.classList.add('hidden');
      try { if ((await onOk(dlg)) !== false) { onClose = null; dlg.close(); } }
      catch (ex) { err.textContent = ex.message || T('Could not complete this action'); err.classList.remove('hidden'); }
      finally { ok.disabled = false; }
    });
    dlg.showModal();
    const first = dlg.querySelector('input,[data-swatch]'); if (first) first.focus();
    return dlg;
  }

  function renameDialog(f) {
    if (readOnly()) return;
    openDialog(T('Rename field'), `<label class="mb-1.5 block text-[12px] font-medium text-gray-500" for="fmName">${T('Name')}</label>
      <input id="fmName" required maxlength="200" class="h-10 w-full rounded-lg border border-gray-200 px-3 text-[14px] outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20" value="${escapeHtml(f.name || '')}">`,
    T('Save'), async (d) => {
      const name = d.querySelector('#fmName').value.trim();
      if (!name) throw new Error(T('The field needs a name'));
      if (name === f.name) return true;
      await apiPatch(`/fields/${f.id}`, { name });
      const open = window.FieldPanel && FieldPanel.fieldId === f.id;
      await reloadFarm();
      if (open) openFieldPanel(f.id);
      showToast(`${T('Renamed to')} ${name}`);
    });
    const inp = dlg.querySelector('#fmName'); inp.select();
  }

  const SWATCHES = ['#22c55e', '#16a34a', '#0ea5e9', '#2563eb', '#f59e0b', '#ea580c', '#dc2626', '#db2777', '#a16207', '#64748b', '#f8fafc', '#111827'];
  function colorDialog(f) {
    const p = FieldPrefs.get(f.id), was = { color: p.color };
    let pick = p.color || null;
    openDialog(T('Field colour'), `<p class="mb-3 text-[13px] text-gray-500">${T('The outline and fill of this field on the map')}</p>
      <div class="fm-swatches" role="radiogroup" aria-label="${T('Colour')}">
        <button type="button" data-swatch="" class="fm-sw is-default" role="radio" aria-checked="${!pick}" title="${T('Default')}"><span>${T('Default')}</span></button>
        ${SWATCHES.map((c) => `<button type="button" data-swatch="${c}" class="fm-sw" role="radio" aria-checked="${pick === c}" style="--sw:${c}" title="${c}"></button>`).join('')}
        <label class="fm-sw fm-custom" title="${T('Custom')}"><input type="color" value="${pick || DEFAULT_COLOR}" aria-label="${T('Custom colour')}"></label>
      </div>`, T('Apply'), () => { renderFieldsList(); showToast(`${f.name}: ${T('colour saved')}`); });
    const preview = (c) => { pick = c || null; FieldPrefs.set(f.id, { color: pick }); restyle(); dlg.querySelectorAll('[data-swatch]').forEach((b) => b.setAttribute('aria-checked', String((b.dataset.swatch || null) === pick))); };
    dlg.querySelectorAll('[data-swatch]').forEach((b) => b.addEventListener('click', () => preview(b.dataset.swatch)));
    dlg.querySelector('input[type=color]').addEventListener('input', (e) => preview(e.target.value));
    onClose = () => { FieldPrefs.set(f.id, was); restyle(); };   // closed without Apply: put it back
  }

  function styleDialog(f) {
    const p = FieldPrefs.get(f.id), was = { fill: p.fill, weight: p.weight, imgOpacity: p.imgOpacity };
    const fill = Math.round((p.fill != null ? p.fill : 0.04) * 100), w = p.weight != null ? p.weight : 2, img = Math.round((p.imgOpacity != null ? p.imgOpacity : 1) * 100);
    const row = (id, label, val, min, max, step, unit) => `<div class="fm-range"><label for="${id}">${T(label)}</label><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${val}"><output for="${id}" class="num">${val}${unit}</output></div>`;
    openDialog(T('Transparency & outline'), `
      ${row('fmImg', 'Satellite layer opacity', img, 0, 100, 5, '%')}
      ${row('fmFill', 'Fill opacity', fill, 0, 80, 2, '%')}
      ${row('fmW', 'Outline width', w, 0, 6, 0.5, ' px')}
      <p class="mt-2 text-[12px] text-gray-500">${T('An outline of 0 px hides the boundary line')}</p>`, T('Apply'), () => showToast(`${f.name}: ${T('style saved')}`));
    const live = () => {
      const im = +dlg.querySelector('#fmImg').value, fi = +dlg.querySelector('#fmFill').value, ww = +dlg.querySelector('#fmW').value;
      dlg.querySelectorAll('.fm-range').forEach((r) => { const i = r.querySelector('input'); r.querySelector('output').textContent = i.value + (i.id === 'fmW' ? ' px' : '%'); });
      FieldPrefs.set(f.id, { imgOpacity: im === 100 ? null : im / 100, fill: fi === 4 ? null : fi / 100, weight: ww === 2 ? null : ww });
      restyle(); applyImageryOpacity();
    };
    dlg.querySelectorAll('input[type=range]').forEach((i) => i.addEventListener('input', live));
    onClose = () => { FieldPrefs.set(f.id, was); restyle(); applyImageryOpacity(); };
  }

  function deleteDialog(f) {
    if (readOnly()) return;
    openDialog(T('Delete field'), `<p class="text-[14px] text-gray-700"><b class="font-medium">${escapeHtml(f.name)}</b> ${T('and its crops, activities and history will be deleted forever. This cannot be undone.')}</p>
      <p class="mt-2 text-[13px] text-gray-500">${T('To keep it recoverable, use Archive instead.')}</p>`, T('Delete forever'), async () => {
      if (window.FieldPanel && FieldPanel.fieldId === f.id) document.getElementById('fpClose').click();
      await apiDelete(`/fields/${f.id}?permanent=true`);
      FieldPrefs.set(f.id, { hidden: null, fav: null, color: null, fill: null, weight: null, imgOpacity: null });
      await reloadFarm();
      showToast(`${f.name} ${T('deleted forever')}`);
    }, true);
  }

  // ------------------------------------------------------------ styles
  const css = document.createElement('style');
  css.textContent = `
    .field-row { position: relative; display: flex; align-items: center; gap: 2px; border-radius: 10px; }
    .field-row .field-card { flex: 1; min-width: 0; }
    .field-row.is-hidden .field-card > svg { opacity: .35; }
    .field-more { flex: none; display: grid; place-items: center; width: 28px; height: 28px; border-radius: 7px; color: var(--t-3, #6b7280); opacity: 0; transition: opacity .12s, background-color .12s, color .12s; }
    .field-more .ico { width: 16px; height: 16px; }
    .field-row:hover .field-more, .field-more:focus-visible, .field-more[aria-expanded="true"], .field-row .field-card[aria-current="true"] ~ .field-more { opacity: 1; }
    .field-more:hover, .field-more[aria-expanded="true"] { background: var(--g-800, #f3f4f6); color: var(--t-1, #111827); }
    @media (hover: none) { .field-more { opacity: 1; } }
    .fm-flag { display: inline-flex; vertical-align: -1px; margin-inline-start: 6px; color: var(--t-3, #9ca3af); } .fm-flag .ico { width: 12px; height: 12px; }
    .fm-menu { position: fixed; z-index: 1400; min-width: 248px; max-width: calc(100vw - 16px); max-height: calc(100vh - 16px); overflow-y: auto; padding: 6px;
      border-radius: 12px; background: var(--g-900, #fff); color: var(--t-1, #111827); box-shadow: 0 0 0 1px var(--line, rgb(0 0 0 / .08)), 0 16px 40px -12px rgb(0 0 0 / .28); }
    .fm-menu[hidden] { display: none; }
    .fm-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 6px 10px 8px; font-size: 12px; color: var(--t-3, #6b7280); }
    .fm-head b { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; color: var(--t-1, #111827); font-size: 13px; }
    .fm-item { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 34px; padding: 6px 10px; border-radius: 8px; text-align: start; font-size: 13px; color: var(--t-1, #374151); transition: background-color .1s; }
    .fm-item:hover, .fm-item:focus-visible { background: var(--g-800, #f3f4f6); outline: none; }
    .fm-item .ico { width: 16px; height: 16px; flex: none; color: var(--t-3, #6b7280); }
    .fm-item > span:not(.fm-chev) { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .fm-chev { display: inline-flex; } .fm-chev .ico { width: 14px; height: 14px; }
    [dir="rtl"] .fm-chev { transform: scaleX(-1); }
    .fm-item.is-fav .ico { color: #d29a12; fill: #e8b230; }
    .fm-item.is-danger, .fm-item.is-danger .ico { color: var(--danger-ink, #dc2626); }
    .fm-sep { height: 1px; margin: 5px 4px; background: var(--line, #e5e7eb); }
    .fm-sub { min-width: 180px; }
    .fm-empty { padding: 8px 10px; font-size: 13px; color: var(--t-3, #6b7280); }
    .fm-swatches { display: grid; grid-template-columns: repeat(7, 1fr); gap: 8px; }
    .fm-sw { position: relative; aspect-ratio: 1; border-radius: 9px; background: var(--sw); box-shadow: inset 0 0 0 1px rgb(0 0 0 / .12); }
    .fm-sw[aria-checked="true"] { box-shadow: 0 0 0 2px var(--g-900, #fff), 0 0 0 4px var(--accent, #16a34a); }
    .fm-sw.is-default { grid-column: span 2; aspect-ratio: auto; font-size: 12px; color: var(--t-2, #4b5563); background: var(--g-850, #f9fafb); }
    .fm-custom { display: block; overflow: hidden; background: conic-gradient(#dc2626, #f59e0b, #22c55e, #0ea5e9, #6366f1, #db2777, #dc2626); cursor: pointer; }
    .fm-custom input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
    .fm-range { display: grid; grid-template-columns: 1fr 64px; align-items: center; gap: 4px 12px; margin-bottom: 14px; font-size: 13px; color: var(--t-2, #374151); }
    .fm-range label { grid-column: 1 / -1; font-size: 12px; font-weight: 500; color: var(--t-3, #6b7280); }
    .fm-range input { width: 100%; accent-color: var(--accent, #16a34a); }
    .fm-range output { text-align: end; font-size: 12px; color: var(--t-1, #111827); }
    .fg { margin: 2px 0 6px; }
    .fg-head { display: flex; align-items: center; gap: 2px; height: 36px; padding-inline: 2px 0; border-radius: 8px; }
    .fg-head:hover { background: var(--g-850, #f9fafb); }
    .fg-head:hover .fg-more, .fg-more:focus-visible, .fg-more[aria-expanded="true"] { opacity: 1; }
    .fg-toggle, .fg-eye { display: grid; place-items: center; width: 26px; height: 26px; flex: none; border-radius: 6px; color: var(--t-3, #6b7280); }
    .fg-toggle:hover, .fg-eye:hover { background: var(--g-800, #f3f4f6); color: var(--t-1, #111827); }
    .fg-toggle .ico, .fg-eye .ico { width: 15px; height: 15px; }
    .fg-toggle .ico { transition: transform .15s; }
    .fg-toggle[aria-expanded="false"] .ico { transform: rotate(-90deg); }
    [dir="rtl"] .fg-toggle[aria-expanded="false"] .ico { transform: rotate(90deg); }
    .fg-eye[aria-pressed="false"] { color: var(--t-4, #9ca3af); }
    .fg-name { flex: 1; min-width: 0; font-size: 13px; font-weight: 500; color: var(--t-1, #111827); cursor: pointer; }
    .fg-meta { flex: none; font-size: 11px; color: var(--t-3, #6b7280); }
    .fg-body { margin-inline-start: 13px; padding-inline-start: 6px; border-inline-start: 1px solid var(--line, #e5e7eb); }
    .fg-body[hidden] { display: none; }
    .fm-checklist { max-height: 260px; overflow-y: auto; border-radius: 10px; box-shadow: inset 0 0 0 1px var(--line, #e5e7eb); padding: 4px; }
    .fm-check { display: flex; align-items: center; gap: 10px; min-height: 34px; padding: 4px 8px; border-radius: 7px; font-size: 13px; color: var(--t-1, #111827); cursor: pointer; }
    .fm-check:hover { background: var(--g-850, #f9fafb); }
    .fm-check input { width: 16px; height: 16px; accent-color: var(--accent, #16a34a); flex: none; }
    .fm-check .truncate { flex: 1; min-width: 0; }
    .fm-check .num { font-size: 12px; color: var(--t-3, #6b7280); }
    .fm-check em { font-style: normal; font-size: 11px; color: var(--t-3, #6b7280); padding: 1px 6px; border-radius: 5px; box-shadow: inset 0 0 0 1px var(--line, #e5e7eb); }
  `;
  document.head.appendChild(css);
})();
