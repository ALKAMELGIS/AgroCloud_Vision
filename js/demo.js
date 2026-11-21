/*
 * AgroSyntra One — public demo of the real workspace (workspace.html?demo).
 *
 * Loaded first in <head>. Without ?demo it does nothing. With it:
 *  - storage is kept in memory, so the demo never touches a real session or real preferences;
 *  - the API is answered here, read-only: one demo farm in the Texas High Plains, whose fields are
 *    the centre pivots found in the latest clear Sentinel-2 image (circles detected in the NDVI
 *    edges), so every boundary sits on a real pivot. If detection fails, two fixed demo pivots;
 *  - weather comes straight from Open-Meteo (the same request the backend makes);
 *  - ?demo&tour plays a guided tour through the real tools and reports each step to the page
 *    that embeds it (postMessage {type:'agro-demo', ...}). Any touch pauses it; it resumes when idle.
 * Everything shown (imagery, index values, classes, time series) is computed by the workspace itself.
 */
(function () {
  'use strict';
  const q = new URLSearchParams(location.search);
  if (!q.has('demo')) return;

  // ------------------------------------------------------------ storage in memory
  const real = (() => { try { return window.localStorage; } catch { return null; } })();
  const mem = new Map();
  ['lang', 'theme'].forEach((k) => { try { const v = real && real.getItem(k); if (v) mem.set(k, v); } catch { /* ignore */ } });
  if (q.get('lang')) mem.set('lang', q.get('lang') === 'ar' ? 'ar' : 'en');
  mem.set('imgProvider', 'sh'); mem.set('imgContrast', '1'); mem.set('tsMode', 'chart'); mem.set('tsIndices', 'ndvi');
  mem.set('accessToken', 'demo'); mem.set('user', JSON.stringify({ email: 'demo@agrosyntra.one', fullName: 'Demo', role: 'viewer' }));
  mem.set('navCollapsed', '1');
  const store = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => { mem.set(k, String(v)); }, removeItem: (k) => { mem.delete(k); },
    clear: () => mem.clear(), key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size; },
  };
  try { Object.defineProperty(window, 'localStorage', { configurable: true, get: () => store }); } catch { /* keep the real one */ }

  // ------------------------------------------------------------ the demo farm
  const AOI = { lng: -102.322, lat: 34.116, w: 3400, h: 2300 };   // metres on the ground
  const FARM = { id: 'demo-farm', name: 'Texas High Plains · demo', latitude: AOI.lat, longitude: AOI.lng, organizationId: 'demo' };
  const R = 6378137, DEG = Math.PI / 180;
  const toMerc = (lng, lat) => [lng * DEG * R, Math.log(Math.tan(Math.PI / 4 + lat * DEG / 2)) * R];
  const fromMerc = (x, y) => [x / R / DEG, (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) / DEG];
  const k = 1 / Math.cos(AOI.lat * DEG);                          // Mercator metres per ground metre
  const [mx, my] = toMerc(AOI.lng, AOI.lat);
  const BOX = [mx - AOI.w / 2 * k, my - AOI.h / 2 * k, mx + AOI.w / 2 * k, my + AOI.h / 2 * k];
  const GW = Math.round(AOI.w / 10), GH = Math.round(AOI.h / 10); // 10 m pixels

  function circle(cxm, cym, rGround, n = 72) {
    const ring = [];
    for (let i = 0; i <= n; i++) { const a = (i % n) / n * Math.PI * 2; ring.push(fromMerc(cxm + Math.cos(a) * rGround * k, cym + Math.sin(a) * rGround * k)); }
    return { type: 'Polygon', coordinates: [ring] };
  }
  const FALLBACK = [[-1050, 250, 400], [150, -250, 400]].map(([dx, dy, r]) => ({ cx: mx + dx * k, cy: my + dy * k, r }));

  // ------------------------------------------------------------ pivots from the latest clear image
  const SH = { base: 'https://services.sentinel-hub.com/ogc', instance: '60de79ca-16a7-4afd-bcbd-0261bf0156fa' };
  const shUrl = (svc, p) => `${SH.base}/${svc}/${SH.instance}?` + new URLSearchParams(p).toString();
  const SCRIPT = `//VERSION=3
function setup() {
  return { input: [{ bands: ["B02", "B03", "B04", "B05", "B08", "B8A", "B11", "SCL"] }], output: { bands: 8, sampleType: "FLOAT32" } };
}
function evaluatePixel(s) { return [s.B02, s.B03, s.B04, s.B05, s.B08, s.B8A, s.B11, s.SCL]; }`;
  const loadScript = (src) => new Promise((ok, no) => { if (window.GeoTIFF) return ok(); const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = no; document.head.appendChild(s); });

  async function latestClearDay() {
    const end = new Date(), start = new Date(Date.now() - 120 * 86400000);
    const res = await fetch(shUrl('wfs', { SERVICE: 'WFS', REQUEST: 'GetFeature', VERSION: '2.0.0', TYPENAMES: 'DSS2', OUTPUTFORMAT: 'application/json', SRSNAME: 'EPSG:3857',
      BBOX: BOX.join(','), TIME: start.toISOString().slice(0, 10) + '/' + end.toISOString().slice(0, 10), MAXFEATURES: '100' }));
    if (!res.ok) throw new Error('dates ' + res.status);
    const feats = ((await res.json()).features || []).map((f) => f.properties || {}).filter((p) => p.date);
    feats.sort((a, b) => (a.cloudCoverPercentage ?? 100) - (b.cloudCoverPercentage ?? 100) || (a.date < b.date ? 1 : -1));
    const clear = feats.filter((p) => (p.cloudCoverPercentage ?? 100) < 10).sort((a, b) => (a.date < b.date ? 1 : -1));
    return (clear[0] || feats[0] || {}).date;
  }
  async function ndviGrid(day) {
    let layer = 'NDVI';
    try {
      const cap = await fetch(shUrl('wms', { SERVICE: 'WMS', REQUEST: 'GetCapabilities', VERSION: '1.3.0' }));
      const xml = new DOMParser().parseFromString(await cap.text(), 'text/xml');
      const names = [...xml.getElementsByTagName('Layer')].map((l) => [...l.children].find((c) => c.localName === 'Name')).filter(Boolean).map((n) => n.textContent.trim());
      layer = names.find((n) => /NDVI/i.test(n)) || names[0] || layer;
    } catch { /* keep NDVI */ }
    const res = await fetch(shUrl('wms', { SERVICE: 'WMS', REQUEST: 'GetMap', VERSION: '1.3.0', LAYERS: layer, CRS: 'EPSG:3857', BBOX: BOX.join(','),
      WIDTH: String(GW), HEIGHT: String(GH), FORMAT: 'image/tiff', TIME: day + '/' + day, MAXCC: '100', SHOWLOGO: 'false', EVALSCRIPT: btoa(SCRIPT) }));
    if (!res.ok) throw new Error('image ' + res.status);
    await loadScript('https://cdn.jsdelivr.net/npm/geotiff@2.1.3/dist-browser/geotiff.js');
    const img = await (await GeoTIFF.fromArrayBuffer(await res.arrayBuffer())).getImage();
    const r = await img.readRasters();
    const red = r[2], nir = r[4], n = new Float32Array(GW * GH);
    for (let i = 0; i < n.length; i++) { const s = nir[i] + red[i]; n[i] = s > 0 ? (nir[i] - red[i]) / s : 0; }
    return n;
  }

  /** Circles in an NDVI grid: Sobel edges vote for centres along the gradient (Hough), radius 18–56 px. */
  function findPivots(N, W, H) {
    const g = new Float32Array(W * H);                       // smooth 3×3
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      let s = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) s += N[(y + j) * W + x + i]; g[y * W + x] = s / 9;
    }
    const gx = new Float32Array(W * H), gy = new Float32Array(W * H), mag = new Float32Array(W * H);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const a = (i, j) => g[(y + j) * W + x + i];
      const sx = a(1, -1) + 2 * a(1, 0) + a(1, 1) - a(-1, -1) - 2 * a(-1, 0) - a(-1, 1);
      const sy = a(-1, 1) + 2 * a(0, 1) + a(1, 1) - a(-1, -1) - 2 * a(0, -1) - a(1, -1);
      const i = y * W + x; gx[i] = sx; gy[i] = sy; mag[i] = Math.hypot(sx, sy);
    }
    const sorted = Array.from(mag).sort((a, b) => b - a), thr = Math.max(0.12, sorted[Math.floor(sorted.length * 0.12)] || 0);
    const RAD = []; for (let r = 18; r <= 56; r += 2) RAD.push(r);
    const acc = RAD.map(() => new Float32Array(W * H));
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x, m = mag[i]; if (m < thr) continue;
      const ux = gx[i] / m, uy = gy[i] / m;
      RAD.forEach((r, ri) => {
        for (const sgn of [1, -1]) {
          const cx = Math.round(x + sgn * ux * r), cy = Math.round(y + sgn * uy * r);
          if (cx >= 0 && cy >= 0 && cx < W && cy < H) acc[ri][cy * W + cx] += 1;
        }
      });
    }
    const cands = [];
    RAD.forEach((r, ri) => {
      const A = acc[ri];
      for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
        let s = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) s += A[(y + j) * W + x + i];
        const score = s / (2 * Math.PI * r);
        if (score > 0.32 && x - r >= 0 && y - r >= 0 && x + r < W && y + r < H) cands.push({ x, y, r, score });
      }
    });
    cands.sort((a, b) => b.score - a.score);
    const out = [];
    for (const c of cands) {
      if (out.length >= 8) break;
      if (out.some((o) => Math.hypot(o.x - c.x, o.y - c.y) < (o.r + c.r) * 0.92)) continue;
      // a pivot is one crop: its inside differs from the ring just outside it
      let si = 0, ni = 0, so = 0, no = 0;
      for (let y = Math.max(0, c.y - c.r - 6); y < Math.min(H, c.y + c.r + 6); y++) for (let x = Math.max(0, c.x - c.r - 6); x < Math.min(W, c.x + c.r + 6); x++) {
        const d = Math.hypot(x - c.x, y - c.y);
        if (d < c.r * 0.85) { si += N[y * W + x]; ni++; } else if (d > c.r * 1.05 && d < c.r * 1.2) { so += N[y * W + x]; no++; }
      }
      if (!ni || !no || Math.abs(si / ni - so / no) < 0.06) continue;
      out.push(c);
    }
    return out;
  }

  let fieldsP = null;
  function demoFields() {
    if (fieldsP) return fieldsP;
    fieldsP = (async () => {
      let circles = null, source = 'fixed';
      try {
        const cached = JSON.parse(real && real.getItem('agroDemoPivots:v1') || 'null');
        if (cached && Date.now() - cached.at < 7 * 86400000 && cached.circles.length >= 2) { circles = cached.circles; source = cached.source; }
      } catch { /* none */ }
      if (!circles) {
        try {
          const day = await latestClearDay();
          const N = await ndviGrid(day);
          const found = findPivots(N, GW, GH);
          if (found.length >= 2) {
            circles = found.map((c) => ({ cx: BOX[0] + (c.x + 0.5) * 10 * k, cy: BOX[3] - (c.y + 0.5) * 10 * k, r: c.r * 10 }));
            source = 'detected ' + day;
            try { real && real.setItem('agroDemoPivots:v1', JSON.stringify({ at: Date.now(), circles, source })); } catch { /* ignore */ }
          }
        } catch (e) { console.warn('demo: pivot detection failed', e); }
      }
      if (!circles) circles = FALLBACK;
      // west to east, north to south
      circles.sort((a, b) => (Math.abs(a.cy - b.cy) > 300 * k ? b.cy - a.cy : a.cx - b.cx));
      window.DEMO.source = source;
      return circles.map((c, i) => ({
        id: 'demo-' + (i + 1), name: 'Pivot ' + (i + 1), farmId: FARM.id, irrigation: 'center_pivot',
        areaHectares: Math.round(Math.PI * c.r * c.r / 100) / 100, createdAt: '2026-01-01T00:00:00Z', geometry: circle(c.cx, c.cy, c.r),
      }));
    })();
    return fieldsP;
  }

  // ------------------------------------------------------------ the API, read-only
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  async function weather(u, historical) {
    const p = new URL(u, location.href).searchParams;
    const api = new URL(historical ? 'https://archive-api.open-meteo.com/v1/archive' : 'https://api.open-meteo.com/v1/forecast');
    api.searchParams.set('latitude', p.get('lat')); api.searchParams.set('longitude', p.get('lng'));
    api.searchParams.set('start_date', p.get('start')); api.searchParams.set('end_date', p.get('end'));
    api.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,precipitation_sum,windspeed_10m_max'); api.searchParams.set('timezone', 'auto');
    if (historical) api.searchParams.set('hourly', 'soil_moisture_0_to_7cm');
    const d = await (await fetch(api)).json();
    const soil = new Map();
    if (d.hourly && d.hourly.time) d.hourly.time.forEach((t, i) => { const v = d.hourly.soil_moisture_0_to_7cm[i]; if (v == null) return; const day = t.slice(0, 10); if (!soil.has(day)) soil.set(day, []); soil.get(day).push(v); });
    const mean = (a) => (a && a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
    return { fieldId: 'demo', source: 'open-meteo', days: (d.daily ? d.daily.time : []).map((date, i) => ({ date, temperatureMaxC: d.daily.temperature_2m_max[i], temperatureMinC: d.daily.temperature_2m_min[i], precipitationMm: d.daily.precipitation_sum[i], windSpeedMaxKmh: d.daily.windspeed_10m_max[i], soilMoisture: mean(soil.get(date)) })) };
  }
  async function api(url, init = {}) {
    const method = (init.method || 'GET').toUpperCase();
    const path = url.replace(/^https?:\/\/[^/]+\/api\/v1/, '').split('?')[0];
    if (method !== 'GET') return json({ message: 'This is a read-only demo. Create a free account to save your own fields.' }, 403);
    const fields = await demoFields();
    if (path === '/farms') return json([{ ...FARM, fieldCount: fields.length }]);
    if (path === '/farms/' + FARM.id) return json({ ...FARM, fields: fields.map(({ geometry, ...f }) => f) });
    if (path === '/organizations/me') return json({ id: 'demo', name: 'AgroSyntra One demo', plan: 'trial' });
    if (path === `/fields/by-farm/${FARM.id}`) return json(fields.map(({ geometry, ...f }) => f));
    if (path === `/fields/by-farm/${FARM.id}/boundaries.geojson`) return json({ type: 'FeatureCollection', features: fields.map((f) => ({ type: 'Feature', properties: { id: f.id, name: f.name, areaHectares: f.areaHectares }, geometry: f.geometry })) });
    const b = path.match(/^\/fields\/([^/]+)\/boundary\.geojson$/); if (b) { const f = fields.find((x) => x.id === b[1]); return f ? json(f.geometry) : json({ message: 'Not found' }, 404); }
    if (/^\/weather\/field\/[^/]+\/history/.test(path)) { try { return json(await weather(url, true)); } catch { return json({ message: 'Weather is not available right now' }, 502); } }
    if (/^\/weather\/field\/[^/]+\/forecast/.test(path)) { try { return json(await weather(url, false)); } catch { return json({ message: 'Weather is not available right now' }, 502); } }
    if (/^\/fields\/archived/.test(path) || /^\/(activities|crops|scout-tasks)\//.test(path) || /\/history$/.test(path)) return json([]);
    return json({ message: 'Not available in the demo' }, 404);
  }
  window.DEMO = { tour: q.has('tour'), api, source: 'pending' };

  // ------------------------------------------------------------ the tour
  if (!q.has('tour')) return;
  const post = (msg) => { try { window.parent.postMessage({ type: 'agro-demo', ...msg }, '*'); } catch { /* not embedded */ } };
  const $ = (s) => document.querySelector(s);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (test, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (test()) return true; await sleep(150); } return false; };
  let paused = false, idleTimer = 0, runId = 0;
  const hold = () => { paused = true; post({ step: 'paused' }); clearTimeout(idleTimer); idleTimer = setTimeout(() => { paused = false; post({ step: 'resumed' }); }, 25000); };
  ['pointerdown', 'keydown'].forEach((e) => addEventListener(e, (ev) => { if (ev.isTrusted) hold(); }, { capture: true, passive: true }));
  async function wait(ms) { const t0 = Date.now(); while (Date.now() - t0 < ms || paused) { await sleep(100); } }
  const setIndex = (key) => { const s = $('#imgIndex'); if (s && s.value !== key) { s.value = key; s.dispatchEvent(new Event('change', { bubbles: true })); } };

  async function tour() {
    const me = ++runId;
    await until(() => document.querySelectorAll('#fieldsList .field-card').length > 0, 60000);
    await until(() => document.querySelector('#imgLegend:not(.hidden)'), 60000);
    // embedded in the landing page: the wheel scrolls the page until the map is clicked
    try {
      if (window.parent !== window && typeof mapInstance !== 'undefined' && mapInstance) {
        mapInstance.scrollWheelZoom.disable();
        mapInstance.once('click', () => mapInstance.scrollWheelZoom.enable());
      }
    } catch { /* no map yet */ }
    post({ step: 'ready', source: window.DEMO.source });
    let f = 0;
    while (me === runId) {
      const cards = document.querySelectorAll('#fieldsList .field-card'); if (!cards.length) { await wait(1000); continue; }
      post({ step: 'farm', text: 'Every field on the latest clear image, NDVI' }); setIndex('ndvi'); await wait(3500);
      const card = cards[f % cards.length]; f++;
      card.click(); post({ step: 'field', text: 'A field opens with its value classes in hectares', field: card.querySelector('.truncate, .font-medium')?.textContent || '' });
      await until(() => document.querySelector('.fa-cls'), 15000); await wait(3500);
      // the lowest class that has area (its last number is the hectares or the share, in any language)
      const low = [...document.querySelectorAll('.fa-cls')].find((b) => +((b.textContent.replace(/[\u2066\u2069]/g, '').match(/([\d.]+)[^\d]*$/) || [])[1] || 0) > 0);
      if (low) { low.click(); post({ step: 'class', text: 'Click a class: only those pixels stay on the map' }); await wait(3500); low.click(); }
      for (const [key, text] of [['ndmi', 'NDMI: water in the crop'], ['ndwi', 'NDWI: open water'], ['bsi', 'BSI: bare soil'], ['ndvi', 'Back to NDVI']]) { setIndex(key); post({ step: 'index', text, index: key }); await wait(3200); }
      const tb = $('#tsBtn'); if (tb && tb.getAttribute('aria-pressed') !== 'true') tb.click();
      post({ step: 'series', text: 'The whole season for this field' });
      await until(() => document.querySelector('#tsPanel:not([hidden])'), 10000); await wait(5000);
      for (const [mode, text] of [['heat', 'Heatmap: every day of the year'], ['sky', '3D skyline: drag to turn it'], ['ring', '3D ring: the pivot over the season']]) {
        const b = document.querySelector(`#tsModes [data-mode="${mode}"]`); if (b) b.click(); post({ step: 'mode', text, mode }); await wait(mode === 'heat' ? 4500 : 6000);
      }
      const m = document.querySelector('#tsModes [data-mode="chart"]'); if (m) m.click();
      const c = $('#tsClose'); if (c) c.click();
      const back = $('#fpBack') || $('#fpClose'); if (back) back.click();
      await wait(800);
    }
  }
  if (document.readyState === 'complete') tour(); else addEventListener('load', tour);
  addEventListener('message', (e) => { if (e.data && e.data.type === 'agro-demo-cmd' && e.data.cmd === 'pause') hold(); });
})();
