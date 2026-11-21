/*
 * AgroSyntra One — preferences, Settings window and the account menu.
 *
 * Preferences live in this browser (localStorage) and survive sign-out:
 *   General     language, area unit (ha / ac / dunum), first day of the week
 *   Appearance  light / dark / match device, reduce motion
 *   Map         default layer, imagery source, contrast, pixel size
 *   Account     profile (email, role, organisation), reset preferences, log out
 *
 * The account row at the bottom of the sidebar opens a small menu with Settings,
 * language, appearance and log out. Settings opens from there, from the command
 * palette (Settings) and with Ctrl/⌘ + ,.
 */
(function () {
  'use strict';

  const UNITS = {
    ha: { label: 'Hectares', short: 'ha', k: 1 },
    ac: { label: 'Acres', short: 'ac', k: 2.4710538 },
    dunum: { label: 'Dunums', short: 'dunum', k: 10 },
  };
  const get = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } };
  const set = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ } };

  const Prefs = {
    get unit() { return UNITS[get('areaUnit', 'ha')] ? get('areaUnit', 'ha') : 'ha'; },
    get weekStart() { return +get('weekStart', '1'); },   // 1 Monday, 6 Saturday, 0 Sunday
    UNITS,
  };
  window.Prefs = Prefs;

  // Area everywhere goes through formatHa: convert to the chosen unit.
  window.formatHa = function formatHa(ha) {
    if (ha == null || !isFinite(ha)) return '—';
    const u = UNITS[Prefs.unit];
    return (ha * u.k).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + u.short;
  };

  const KEEP = ['lang', 'navCollapsed', 'panelCollapsed', 'imgProvider', 'imgContrast', 'imgRes', 'tsIndices', 'tsChart', 'tsMode', 'theme', 'areaUnit', 'weekStart', 'reduceMotion', 'defaultIndex'];
  function logout() {
    const keep = KEEP.map((k) => [k, get(k, null)]);
    try { localStorage.clear(); } catch { /* ignore */ }
    keep.forEach(([k, v]) => { if (v != null) set(k, v); });
    window.location.href = 'main.html';
  }
  window.AppLogout = logout;

  const user = () => { try { return JSON.parse(localStorage.getItem('user') || 'null') || {}; } catch { return {}; } };
  let org = null;
  const loadOrg = () => (org ? Promise.resolve(org) : apiGet('/organizations/me').then((o) => { org = o; return o; }).catch(() => null));
  const initials = (email) => (email || '?').split('@')[0].split(/[._-]/).filter(Boolean).slice(0, 2).map((x) => x[0].toUpperCase()).join('') || '?';
  const roleLabel = (r) => (r ? r.charAt(0).toUpperCase() + r.slice(1).replace(/_/g, ' ') : '');

  // ------------------------------------------------------------ account row + menu

  function mountAccount() {
    const host = document.getElementById('navBottom'); if (!host) return;
    const u = user();
    const toArabic = !(window.I18n && I18n.lang === 'ar');
    host.innerHTML = `
      <button type="button" class="nav-row" data-action="settings" title="Settings"><span class="nav-label">${icon('settings')}<span>Settings</span></span><span class="nav-meta kbd-hint" translate="no">${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'} ,</span></button>
      <button type="button" class="acct-row" id="acctBtn" aria-haspopup="menu" aria-expanded="false" title="${escapeHtml(u.email || '')}">
        <span class="acct-avatar" translate="no">${initials(u.email)}</span>
        <span class="acct-text"><span class="acct-name" translate="no">${escapeHtml((u.email || '').split('@')[0])}</span><span class="acct-org" id="acctOrg">${escapeHtml(roleLabel(u.role))}</span></span>
        ${icon('chevronUp', 'acct-chev')}
      </button>
      <div class="acct-menu" id="acctMenu" role="menu" hidden>
        <div class="acct-head">
          <span class="acct-avatar is-lg" translate="no">${initials(u.email)}</span>
          <div class="min-w-0"><div class="acct-name" translate="no">${escapeHtml(u.email || '')}</div><div class="acct-org"><span id="acctOrgName"></span>${u.role ? `<span class="acct-role">${escapeHtml(roleLabel(u.role))}</span>` : ''}</div></div>
        </div>
        <div class="acct-sep"></div>
        <button type="button" role="menuitem" class="acct-item" data-open-settings="general">${icon('settings')}<span>Settings</span></button>
        <button type="button" role="menuitem" class="acct-item lang-switch" data-action="lang" translate="no" lang="${toArabic ? 'ar' : 'en'}">${icon('globe')}<span>${toArabic ? 'العربية' : 'English'}</span><span class="acct-meta">${toArabic ? 'AR' : 'EN'}</span></button>
        <div class="acct-item is-static">${icon('sun')}<span>Appearance</span>
          <span class="seg-mini" role="radiogroup" aria-label="Appearance" data-action="theme">
            ${[['light', 'sun', 'Light'], ['dark', 'moon', 'Dark'], ['system', 'monitor', 'Match device']].map(([v, ic, t]) => `<button type="button" role="radio" data-theme-pref="${v}" title="${t}" aria-label="${t}">${icon(ic)}</button>`).join('')}
          </span></div>
        <div class="acct-sep"></div>
        <button type="button" role="menuitem" class="acct-item" data-action="logout">${icon('logOut')}<span>Log out</span></button>
      </div>`;
    hydrateIcons(host);
    const btn = host.querySelector('#acctBtn'), menu = host.querySelector('#acctMenu');
    const setOpen = (on) => { menu.hidden = !on; btn.setAttribute('aria-expanded', String(on)); if (on) syncThemeSeg(); };
    btn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(menu.hidden); });
    menu.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => setOpen(false));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { setOpen(false); btn.focus(); } });
    host.querySelector('[data-action="settings"]').addEventListener('click', () => open('general'));
    menu.querySelector('[data-open-settings]').addEventListener('click', () => { setOpen(false); open('general'); });
    menu.querySelector('[data-action="lang"]').addEventListener('click', () => window.I18n && I18n.setLang(toArabic ? 'ar' : 'en'));
    menu.querySelector('[data-action="logout"]').addEventListener('click', logout);
    menu.querySelectorAll('[data-theme-pref]').forEach((b) => b.addEventListener('click', () => window.Theme && Theme.set(b.dataset.themePref)));
    loadOrg().then((o) => {
      if (!o) return;
      const n = host.querySelector('#acctOrgName'); if (n) n.textContent = o.name;
      const r = host.querySelector('#acctOrg'); if (r) r.textContent = o.name + (u.role ? ' · ' + roleLabel(u.role) : '');
    });
  }
  function syncThemeSeg() {
    const p = window.Theme ? Theme.pref : 'light';
    document.querySelectorAll('[data-theme-pref]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.themePref === p)));
  }
  document.addEventListener('theme:pref', syncThemeSeg);

  // ------------------------------------------------------------ Settings window

  const SECTIONS = [
    ['general', 'General', 'settings'],
    ['appearance', 'Appearance', 'sun'],
    ['map', 'Map and imagery', 'layers'],
    ['account', 'Account', 'user'],
  ];
  let dlg = null, section = 'general';

  const row = (label, hint, control) => `<div class="set-row"><div class="set-label"><div>${label}</div>${hint ? `<div class="set-hint">${hint}</div>` : ''}</div><div class="set-control">${control}</div></div>`;
  const seg = (name, value, opts) => `<span class="seg" role="radiogroup" data-seg="${name}">${opts.map(([v, l]) => `<button type="button" role="radio" data-v="${v}" aria-checked="${String(v) === String(value)}">${l}</button>`).join('')}</span>`;
  const toggle = (name, on) => `<button type="button" class="switch" role="switch" data-toggle-pref="${name}" aria-checked="${!!on}"><span></span></button>`;

  function body() {
    const I = window.Imagery; const u = user();
    if (section === 'general') {
      return `<h3>General</h3>
        ${row('Language', 'Arabic mirrors the layout right to left', seg('lang', window.I18n ? I18n.lang : 'en', [['en', 'English'], ['ar', '<span lang="ar" translate="no">العربية</span>']]))}
        ${row('Area unit', 'Field, zone and class areas', seg('areaUnit', Prefs.unit, Object.entries(UNITS).map(([k, x]) => [k, x.label])))}
        ${row('First day of the week', 'Heatmap rows and the calendar', seg('weekStart', Prefs.weekStart, [[6, 'Saturday'], [0, 'Sunday'], [1, 'Monday']]))}`;
    }
    if (section === 'appearance') {
      const p = window.Theme ? Theme.pref : 'light';
      const card = (v, label) => `<button type="button" class="theme-card" data-theme-pref="${v}" aria-checked="${p === v}" role="radio">
          <span class="theme-prev is-${v}"><i></i><b></b><b></b><em></em></span><span class="theme-name">${label}</span></button>`;
      return `<h3>Appearance</h3>
        <div class="set-row is-stack"><div class="set-label"><div>Theme</div></div>
          <div class="theme-cards" role="radiogroup" aria-label="Theme">${card('light', 'Light')}${card('dark', 'Dark')}${card('system', 'Match device')}</div></div>
        ${row('Reduce motion', 'Turns off transitions and the heatmap and 3D animations', toggle('reduceMotion', get('reduceMotion', '0') === '1'))}`;
    }
    if (section === 'map') {
      const idx = I ? Object.entries(I.indices).filter(([, x]) => !x.composite).map(([k, x]) => `<option value="${k}"${get('defaultIndex', 'ndvi') === k ? ' selected' : ''}>${x.label} · ${x.name}</option>`).join('') : '';
      return `<h3>Map and imagery</h3>
        ${row('Default layer', 'Shown when the workspace opens', `<select class="set-select" data-pref-select="defaultIndex">${idx}</select>`)}
        ${row('Imagery source', 'Sentinel-2 L2A from either service; the other is used if one fails', seg('imgProvider', get('imgProvider', 'sh'), [['sh', 'Sentinel Hub'], ['es', 'Earth Search']]))}
        ${row('Contrast stretch', 'Spread colours over each field’s own values (P2–P98)', toggle('imgContrast', get('imgContrast', '1') !== '0'))}
        ${row('Pixel size', '5 m and 2.5 m are sharpened by a model from 10 m bands', seg('imgRes', get('imgRes', '10'), [['10', '10 m'], ['x2', '5 m'], ['x4', '2.5 m']]))}`;
    }
    return `<h3>Account</h3>
      <div class="acct-card"><span class="acct-avatar is-xl" translate="no">${initials(u.email)}</span>
        <div class="min-w-0"><div class="acct-name" translate="no">${escapeHtml(u.email || '')}</div><div class="acct-org"><span data-org-name>${org ? escapeHtml(org.name) : ''}</span>${u.role ? `<span class="acct-role">${escapeHtml(roleLabel(u.role))}</span>` : ''}</div></div></div>
      ${row('Preferences', 'Settings are kept in this browser and stay after you sign out', '<button type="button" class="set-btn" data-reset>Reset to defaults</button>')}
      ${row('Session', '', '<button type="button" class="set-btn is-quiet" data-logout>Log out</button>')}`;
  }

  function render() {
    dlg.querySelector('.set-nav').innerHTML = SECTIONS.map(([k, l, ic]) => `<button type="button" data-sec="${k}" aria-current="${k === section ? 'page' : 'false'}">${icon(ic)}<span>${l}</span></button>`).join('');
    dlg.querySelector('.set-body').innerHTML = body();
    hydrateIcons(dlg);
    dlg.querySelectorAll('[data-sec]').forEach((b) => b.addEventListener('click', () => { section = b.dataset.sec; render(); }));
    dlg.querySelectorAll('[data-seg]').forEach((g) => g.querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => apply(g.dataset.seg, b.dataset.v))));
    dlg.querySelectorAll('[data-toggle-pref]').forEach((b) => b.addEventListener('click', () => apply(b.dataset.togglePref, b.getAttribute('aria-checked') !== 'true')));
    dlg.querySelectorAll('[data-pref-select]').forEach((s) => s.addEventListener('change', () => apply(s.dataset.prefSelect, s.value)));
    dlg.querySelectorAll('.theme-card').forEach((b) => b.addEventListener('click', () => { if (window.Theme) Theme.set(b.dataset.themePref); render(); }));
    const reset = dlg.querySelector('[data-reset]'); if (reset) reset.addEventListener('click', resetAll);
    const lo = dlg.querySelector('[data-logout]'); if (lo) lo.addEventListener('click', logout);
    if (section === 'account' && !org) loadOrg().then(() => { if (section === 'account' && dlg.open) render(); });
  }

  /** Applies one preference now, where it can be applied live. */
  function apply(key, val) {
    const I = window.Imagery, v0 = I && I.views && I.views[0];
    if (key === 'lang') { if (window.I18n && I18n.lang !== val) I18n.setLang(val); return; }
    if (key === 'areaUnit') { set('areaUnit', val); document.dispatchEvent(new CustomEvent('prefs:change', { detail: key })); if (typeof renderFieldsList === 'function' && typeof state !== 'undefined' && state.fieldList) renderFieldsList(state.fieldList); }
    if (key === 'weekStart') { set('weekStart', String(val)); if (window.TimeSeries) TimeSeries.redraw(); }
    if (key === 'reduceMotion') { set('reduceMotion', val ? '1' : '0'); document.documentElement.classList.toggle('reduce-motion', !!val); }
    if (key === 'defaultIndex') { set('defaultIndex', val); const sel = document.getElementById('imgIndex'); if (sel && sel.value !== val) { sel.value = val; sel.dispatchEvent(new Event('change')); } }
    if (key === 'imgProvider') { if (I && I.setProvider) I.setProvider(val); else set('imgProvider', val); }
    if (key === 'imgContrast') { set('imgContrast', val ? '1' : '0'); if (v0 && v0.contrast !== !!val) { const b = document.getElementById('imgContrast'); if (b) b.click(); } }
    if (key === 'imgRes') { const sel = document.getElementById('imgRes'); set('imgRes', val); if (sel && !sel.disabled && sel.value !== val) { sel.value = val; sel.dispatchEvent(new Event('change')); } }
    document.dispatchEvent(new CustomEvent('prefs:change', { detail: key }));
    render();
  }

  function resetAll() {
    ['areaUnit', 'weekStart', 'reduceMotion', 'defaultIndex', 'imgContrast', 'imgRes', 'tsIndices', 'tsChart', 'tsMode'].forEach((k) => set(k, null));
    if (window.Theme) Theme.set('light');
    document.documentElement.classList.remove('reduce-motion');
    showToast('Preferences reset');
    setTimeout(() => window.location.reload(), 500);
  }

  function open(sec) {
    if (sec) section = sec;
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.id = 'settingsDialog'; dlg.className = 'set-dlg';
      dlg.setAttribute('aria-labelledby', 'setTitle');
      dlg.innerHTML = `<div class="set-shell">
          <aside class="set-side"><div class="set-title" id="setTitle">Settings</div><nav class="set-nav"></nav></aside>
          <section class="set-body"></section>
          <button type="button" class="set-close" aria-label="Close" data-close>${icon('x')}</button>
        </div>`;
      document.body.appendChild(dlg);
      dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
      dlg.querySelector('[data-close]').addEventListener('click', () => dlg.close());
    }
    render();
    if (!dlg.open) dlg.showModal();
  }

  window.Settings = { open, Prefs };
  document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === ',') { e.preventDefault(); open(); } });
  // the default layer applies when the workspace opens
  document.addEventListener('DOMContentLoaded', () => {
    const d = get('defaultIndex', null);
    if (d) setTimeout(() => { const sel = document.getElementById('imgIndex'); if (sel && sel.value !== d && [...sel.options].some((o) => o.value === d)) { sel.value = d; sel.dispatchEvent(new Event('change')); } }, 0);
  });
  window.mountAccount = mountAccount;
})();
