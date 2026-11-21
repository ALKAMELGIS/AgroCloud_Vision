/*
 * AgroSyntra One — the two motion scenes on the landing page.
 * Drives landing/motion/motion.js (the workspace's own index analysis on a field model) and fills the
 * workspace-style panel, legend, dock, dates and season stats around each canvas.
 * Each scene starts when it comes near the screen. Strings go through I18n.t, numbers stay as numbers.
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const t = (s) => (window.I18n ? I18n.t(s) : s);
  const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : '–');
  const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
  const whenNear = (el, fn) => {
    if (!('IntersectionObserver' in window)) { fn(); return; }
    new IntersectionObserver((es, io) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); fn(); } }, { rootMargin: '200px' }).observe(el);
  };

  // ------------------------------------------------------------ scene 1: the satellite pass
  function scene1() {
    const canvas = $('sc1Canvas'); if (!canvas || !window.AgroMotion) return;
    let s = null, playing = true, contrast = true, mean = 0, raf = 0;
    const steps = $('sc1Steps'), rows = $('sc1Rows'), dates = $('sc1Dates'), seg = $('sc1Seg'), sel = $('sc1Index');
    const sc = AgroMotion.hero(canvas, (st) => { s = st; render(); count(st.mean); });
    // steps
    steps.innerHTML = sc.steps.map((x, i) => `<button type="button" class="sc-step" data-i="${i}"><span>${String(i + 1).padStart(2, '0')}</span>${t(x.label)}</button>`).join('');
    steps.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (!b) return; sc.setIndex(null); sc.show(+b.dataset.i); setPlaying(false); });
    const setPlaying = (on) => { playing = on; $('sc1Play').textContent = t(on ? 'Pause' : 'Play'); };
    $('sc1Play').addEventListener('click', () => { if (playing) { sc.show(s ? s.step : 0); setPlaying(false); } else { sc.setIndex(null); sc.show(null); setPlaying(true); } });
    sel.addEventListener('change', () => { const v = sel.value; if (v === 'natural') { sc.setIndex(null); sc.show(0); } else sc.setIndex(v); setPlaying(false); });
    $('sc1Contrast').addEventListener('click', () => { contrast = !contrast; sc.setContrast(contrast); $('sc1Contrast').setAttribute('aria-pressed', String(contrast)); });
    rows.addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (!b) return; sc.toggleClass(+b.dataset.c); setPlaying(false); });
    function count(to) {
      const from = mean; const t0 = performance.now(); cancelAnimationFrame(raf);
      to = Number.isFinite(to) ? to : 0;
      const tick = (now) => { const k = Math.min(1, (now - t0) / 650), e = 1 - Math.pow(1 - k, 3); mean = from + (to - from) * e; $('sc1Mean').textContent = mean.toFixed(2); if (k < 1) raf = requestAnimationFrame(tick); };
      raf = requestAnimationFrame(tick);
    }
    function render() {
      steps.querySelectorAll('.sc-step').forEach((b, i) => b.classList.toggle('is-on', i === s.step));
      $('sc1Field').textContent = s.field; $('sc1Ha').textContent = s.ha.toFixed(2);
      $('sc1Idx').textContent = s.indexLabel; $('sc1Date').textContent = s.dates[s.dateIx][0].replace("'", ' 20');
      $('sc1Cloud').textContent = s.cloudPct; $('sc1Clear').textContent = s.clearHa.toFixed(2);
      $('sc1P10').textContent = f2(s.p10); $('sc1P90').textContent = f2(s.p90);
      const total = s.rows.reduce((a, r) => a + r.ha, 0) || 1, filt = new Set(s.filter);
      rows.innerHTML = s.rows.slice().reverse().map((r) => `<button type="button" class="sc-row${filt.has(r.c) ? ' is-on' : ''}${filt.size && !filt.has(r.c) ? ' is-off' : ''}" data-c="${r.c}">
          <i style="background:${rgb(r.color)}"></i><span class="rng">${r.from.toFixed(2)}–${r.to.toFixed(2)}</span><s><b style="width:${Math.round((r.ha / total) * 100)}%;background:${rgb(r.color)}"></b></s><em>${r.ha.toFixed(2)} ${t('ha')}</em></button>`).join('');
      if (filt.size) { const ha = s.rows.filter((r) => filt.has(r.c)).reduce((a, r) => a + r.ha, 0); $('sc1Note').textContent = `${t('Selected on the map')} ${ha.toFixed(2)} ${t('ha')} · ${Math.round((ha / total) * 100)}%`; }
      else $('sc1Note').textContent = t('Click a range to show it on the map');
      $('sc1Leg').textContent = s.natural ? t('Natural colour') : s.indexLabel + (s.contrast ? ' · ' + t('contrast') : '');
      $('sc1Lo').textContent = f2(s.lo); $('sc1Hi').textContent = f2(s.hi);
      seg.innerHTML = s.legend.map((c) => `<i style="background:${rgb(c)}"></i>`).join('');
      sel.value = s.natural ? 'natural' : s.key;
      dates.innerHTML = s.dates.map(([d, c], i) => `<span class="sc-date${i === s.dateIx ? ' is-on' : ''}"><span class="num">${d}</span><small><b>S2</b><span class="num">${c}%</span></small></span>`).join('');
    }
  }

  // ------------------------------------------------------------ scene 2: from a pixel to the season
  const ICONS = [
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M8 12h8M12 8v8"/></svg>',
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10M9 20V5M14 20v-8M19 20V8"/></svg>',
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 4 7.5v9L12 21l8-4.5v-9z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/></svg>',
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/></svg>',
  ];
  const ACTS = [
    ['Pixels', 'Pivot 2 on the clear date: every 10 m pixel inside the boundary, coloured with contrast from the field’s own P2 to P98.'],
    ['Value classes', 'The pixels sort into the ten classes of the NDVI range. Each stack is hectares, and together they make the field.'],
    ['3D skyline', 'The whole year, a column per day: week by week along time, weekday by weekday across. Muted days are estimated between clear images.'],
    ['3D ring', 'The same days wrapped around the pivot, January at the top, so the season reads like the field itself.'],
  ];
  function scene2() {
    const canvas = $('sc2Canvas'); if (!canvas || !window.AgroMotion) return;
    let held = null;
    const acts = $('sc2Acts'), modes = $('sc2Modes');
    acts.innerHTML = ACTS.map(([a, b], i) => `<button type="button" class="sc2-act" data-i="${i}"><span>${String(i + 1).padStart(2, '0')}</span><span><b>${t(a)}</b><small>${t(b)}</small></span></button>`).join('');
    modes.innerHTML = ACTS.map(([a], i) => `<button type="button" data-i="${i}" aria-pressed="false" aria-label="${t(a)}" title="${t(a)}">${ICONS[i]}</button>`).join('');
    const sc = AgroMotion.stats(canvas, (s) => render(s));
    const pick = (e) => { const b = e.target.closest('[data-i]'); if (!b) return; const i = +b.dataset.i; const same = held === i; held = same ? null : i; sc.show(held); };
    acts.addEventListener('click', pick); modes.addEventListener('click', pick);
    const day = (ms) => new Date(ms).toLocaleDateString(window.I18n && I18n.lang === 'ar' ? 'ar' : 'en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    function render(s) {
      acts.querySelectorAll('.sc2-act').forEach((b, i) => b.classList.toggle('is-on', i === s.act));
      modes.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-pressed', String(i === s.act)));
      const S = s.season, st = S.stats;
      $('sc2Status').textContent = `${st.n} ${t('clear dates')} · ${s.field} · ${s.ha.toFixed(2)} ${t('ha')}`;
      $('sc2Lo').textContent = f2(S.lo); $('sc2Hi').textContent = f2(S.hi);
      const ch = (st.change >= 0 ? '+' : '−') + Math.abs(st.change).toFixed(2);
      $('sc2Stats').innerHTML = [
        ['Average', st.avg, `${st.n} ${t('clear dates')}`], ['Peak', st.peak.v, day(st.peak.t)], ['Lowest', st.low.v, day(st.low.t)], ['Latest', st.last.v, `${day(st.last.t)} · ${ch}`],
      ].map(([l, v, sub]) => `<div class="sc2-stat"><span>${t(l)}</span><b>${f2(v)}</b><span class="num">${sub}</span></div>`).join('');
    }
  }

  // ------------------------------------------------------------ sign-in page: the same pass, map only
  function authScene() {
    const canvas = $('authCanvas'); if (!canvas || !window.AgroMotion) return;
    if (!canvas.offsetWidth) { const again = () => { if (canvas.offsetWidth) { removeEventListener('resize', again); authScene(); } }; addEventListener('resize', again); return; }
    const sc = AgroMotion.hero(canvas, (s) => {
      const step = sc.steps[s.step];
      $('authStep').textContent = `${String(s.step + 1).padStart(2, '0')} · ${t(step ? step.label : '')}`;
      $('authLeg').textContent = s.natural ? t('Natural colour') : s.indexLabel + (s.contrast ? ' · ' + t('contrast') : '');
      $('authLo').textContent = s.natural ? '' : f2(s.lo); $('authHi').textContent = s.natural ? '' : f2(s.hi);
      $('authSeg').innerHTML = s.natural ? '' : s.legend.map((c) => `<i style="background:${rgb(c)}"></i>`).join('');
    }, canvas.offsetHeight > canvas.offsetWidth * 0.9 ? { pitch: 1.1, zoom: 1.45, cy: 0.5 } : {});
  }

  function init() {
    const a = $('scene1'), b = $('analysis');
    if (a) whenNear(a, scene1);
    if (b) whenNear(b, scene2);
    authScene();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
