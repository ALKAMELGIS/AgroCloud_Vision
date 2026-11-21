/*
 * AgroSyntra One — two-page field report (A4), from the Reports module.
 *
 * Page 1, condition on the image date: field facts and areas, NDVI map over satellite,
 * three management zones (below 90 %, 90–110 %, above 110 % of the field's mean NDVI) with area and share, index
 * distribution by 0.1 class.
 * Page 2, season and action: NDVI over the season with the P10–P90 spread, NDVI / NDRE /
 * MSAVI / NDMI on the same date with a reading, change since the previous clear date with
 * scouting points, 30-day weather, operations, and the agronomist's notes (rule based,
 * crop aware: forage crops are cut, so a drop can be a harvest).
 *
 * Areas: field area from the stored boundary (PostGIS, geodesic). Zone and class areas are
 * shares of clear pixels times that area, so they add up to the field. Sentinel-2 pixels
 * are 10 m (0.01 ha).
 *
 * Opens in a new tab with its own print styles; the browser's Print saves it as PDF.
 */
(function () {
  'use strict';

  const DAY = 86400000;
  const I = () => window.Imagery;
  const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : '—');
  const pct = (v) => (Number.isFinite(v) ? `${Math.round(v)}%` : '—');
  const ha = (v) => (Number.isFinite(v) ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const day = (d) => new Date((typeof d === 'number' ? d : Date.parse(d + 'T00:00:00Z'))).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const dayShort = (d) => new Date(Date.parse(d + 'T00:00:00Z')).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const FORAGE = /alfalfa|lucerne|rhodes|sudan|sorghum|forage|berseem|clover|grass|hay|panicum|برسيم|رودس|علف|حشيش/i;
  const ZONES = [
    { key: 'low', label: 'Low', color: '#c4572e' },
    { key: 'mid', label: 'Medium', color: '#e0b84f' },
    { key: 'high', label: 'High', color: '#3f8f35' },
  ];

  // ------------------------------------------------------------ geometry

  function rings(g) { return g.type === 'Polygon' ? [g.coordinates] : g.coordinates; }
  function haversine(a, b) {
    const R = 6371008.8, r = Math.PI / 180;
    const dLat = (b[1] - a[1]) * r, dLng = (b[0] - a[0]) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function perimeter(g) { let m = 0; rings(g).forEach((poly) => poly.forEach((ring) => { for (let i = 1; i < ring.length; i++) m += haversine(ring[i - 1], ring[i]); })); return m; }
  function bbox(g) {
    let w = 180, s = 90, e = -180, n = -90;
    rings(g).forEach((poly) => poly[0].forEach(([x, y]) => { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }));
    return { w, s, e, n };
  }

  // ------------------------------------------------------------ maps (satellite tiles + overlay, as SVG)

  const merc = (lng, lat, z) => {
    const k = 256 * 2 ** z, s = Math.sin((lat * Math.PI) / 180);
    return [((lng + 180) / 360) * k, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * k];
  };
  function mapSvg(field, overlay, bounds, W, H, opts = {}) {
    const b = bbox(field.geometry);
    let z = 19;
    for (; z > 3; z--) {
      const [x0, y0] = merc(b.w, b.n, z), [x1, y1] = merc(b.e, b.s, z);
      if (x1 - x0 <= W * 0.84 && y1 - y0 <= H * 0.84) break;
    }
    // fractional zoom: tiles of level z drawn k times larger so the field fills ~84 % of the frame
    const [ax0, ay0] = merc(b.w, b.n, z), [bx0, by0] = merc(b.e, b.s, z);
    const k = Math.max(1, Math.min(1.99, (W * 0.84) / (bx0 - ax0 || 1), (H * 0.84) / (by0 - ay0 || 1)));
    const merc0 = merc;
    const mk = (lng, lat) => merc0(lng, lat, z).map((v) => v * k);
    const [ax, ay] = mk(b.w, b.n), [bx, by] = mk(b.e, b.s);
    const ox = (ax + bx) / 2 - W / 2, oy = (ay + by) / 2 - H / 2;
    const T = 256 * k;
    const tiles = [];
    for (let tx = Math.floor(ox / T); tx <= Math.floor((ox + W) / T); tx++) {
      for (let ty = Math.floor(oy / T); ty <= Math.floor((oy + H) / T); ty++) {
        tiles.push(`<image href="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${ty}/${tx}" x="${(tx * T - ox).toFixed(1)}" y="${(ty * T - oy).toFixed(1)}" width="${T.toFixed(2)}" height="${T.toFixed(2)}"/>`);
      }
    }
    let ov = '';
    if (overlay && bounds) {
      const [[s, w], [n, e]] = bounds;
      const [px0, py0] = mk(w, n), [px1, py1] = mk(e, s);
      ov = `<image href="${overlay}" x="${(px0 - ox).toFixed(1)}" y="${(py0 - oy).toFixed(1)}" width="${(px1 - px0).toFixed(1)}" height="${(py1 - py0).toFixed(1)}" preserveAspectRatio="none" style="image-rendering:pixelated"/>`;
    }
    const path = rings(field.geometry).map((poly) => poly.map((ring) => 'M' + ring.map(([x, y]) => { const [px, py] = mk(x, y); return `${(px - ox).toFixed(1)} ${(py - oy).toFixed(1)}`; }).join('L') + 'Z').join('')).join('');
    // scale bar
    const lat = (b.n + b.s) / 2, mpp = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z / k;
    const target = (W * 0.22) * mpp, p10 = 10 ** Math.floor(Math.log10(target));
    const len = [1, 2, 5, 10].map((k) => k * p10).filter((v) => v <= target).pop() || p10;
    const sbw = len / mpp, sbl = len >= 1000 ? `${len / 1000} km` : `${len} m`;
    const marks = (opts.marks || []).map((m, i) => { const [px, py] = mk(m.lng, m.lat); return `<g transform="translate(${(px - ox).toFixed(1)} ${(py - oy).toFixed(1)})"><circle r="7" fill="#1c1b19" stroke="#fff" stroke-width="1.5"/><text y="3" text-anchor="middle" font-size="8" fill="#fff" font-weight="600">${i + 1}</text></g>`; }).join('');
    const id = 'c' + Math.random().toString(36).slice(2, 8);
    return `<svg class="map" viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg">
      <defs><clipPath id="${id}"><rect width="${W}" height="${H}" rx="6"/></clipPath></defs>
      <g clip-path="url(#${id})"><rect width="${W}" height="${H}" fill="#d9d4c7"/>${tiles.join('')}<rect width="${W}" height="${H}" fill="#000" opacity="${opts.dim ?? 0.18}"/>${ov}
      <path d="${path}" fill="none" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/>${marks}</g>
      <g transform="translate(10 ${H - 14})"><rect x="-4" y="-12" width="${sbw + 8 + 34}" height="20" rx="4" fill="#fff" opacity=".9"/><rect width="${sbw.toFixed(1)}" height="3" fill="#1c1b19"/><text x="${(sbw + 6).toFixed(1)}" y="4" font-size="8" fill="#1c1b19">${sbl}</text></g>
      <g transform="translate(${W - 18} 20)"><circle r="10" fill="#fff" opacity=".9"/><path d="M0 -7 L4 4 L0 2 L-4 4 Z" fill="#1c1b19"/><text y="-12" text-anchor="middle" font-size="7" fill="#fff" font-weight="600">N</text></g>
    </svg>`;
  }

  /** Paints zone ids (0,1,2; 255 = none) on the analysis grid as a data URL. */
  function zoneImage(r, zone) {
    const c = document.createElement('canvas'); c.width = r.w; c.height = r.h;
    const g = c.getContext('2d'), im = g.createImageData(r.w, r.h);
    const cols = ZONES.map((z) => [1, 3, 5].map((i) => parseInt(z.color.slice(i, i + 2), 16)));
    for (let i = 0; i < zone.length; i++) {
      if (!r.inField[i]) continue;
      if (zone[i] === 255) { im.data.set([150, 150, 150, 170], i * 4); continue; }
      im.data.set([...cols[zone[i]], 235], i * 4);
    }
    g.putImageData(im, 0, 0);
    return c.toDataURL();
  }

  // ------------------------------------------------------------ data

  async function gather(field, onStep) {
    const img = I(); const step = (t) => onStep && onStep(t);
    const scene = img.current();
    if (!scene) throw new Error('Pick a date on the timeline first');
    step('Reading the image');
    const r = await img.analyse(field, scene, 'ndvi');
    if (!Number.isFinite(r.mean)) throw new Error('The field is covered by cloud on this date. Pick a clear date on the timeline');
    const others = {};
    await Promise.all(['savi', 'gndvi', 'ndre', 'ndmi', 'bsi', 'si'].map(async (k) => { try { others[k] = await img.analyse(field, scene, k); } catch { /* skip */ } }));

    // zones relative to the field mean (as in VRA practice): low < 90 %, high > 110 % of the mean
    const vals = []; for (let i = 0; i < r.values.length; i++) if (r.inField[i] && Number.isFinite(r.values[i])) vals.push(r.values[i]);
    const fm = vals.reduce((s, v) => s + v, 0) / (vals.length || 1);
    const cuts = [fm * 0.9, fm * 1.1];
    const zone = new Uint8Array(r.values.length).fill(255);
    const zs = ZONES.map(() => ({ n: 0, sum: 0, min: Infinity, max: -Infinity, sx: 0, sy: 0 }));
    for (let i = 0; i < r.values.length; i++) {
      const v = r.values[i]; if (!r.inField[i] || !Number.isFinite(v)) continue;
      const z = v < cuts[0] ? 0 : v < cuts[1] ? 1 : 2; zone[i] = z;
      const s = zs[z]; s.n++; s.sum += v; s.min = Math.min(s.min, v); s.max = Math.max(s.max, v); s.sx += i % r.w; s.sy += Math.floor(i / r.w);
    }
    const fieldHa = field.areaHectares || r.fieldHa;
    const clear = vals.length;
    const zones = ZONES.map((z, k) => ({ ...z, n: zs[k].n, share: clear ? (100 * zs[k].n) / clear : 0, area: clear ? (fieldHa * zs[k].n) / clear : 0, mean: zs[k].n ? zs[k].sum / zs[k].n : NaN, min: zs[k].min, max: zs[k].max }));
    const mean = vals.reduce((s, v) => s + v, 0) / (clear || 1);
    const sd = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / (clear || 1));
    const classes = r.classes.map((v, k) => ({ lo: r.edges[k], hi: Math.min(r.edges[k + 1], 1), area: clear ? (fieldHa * (v / 0.01)) / clear : 0, share: clear ? (100 * (v / 0.01)) / clear : 0 }));

    // change since the previous clear date
    step('Comparing with the previous clear date');
    let change = null;
    try {
      const prev = await img.previousClear(field, scene, 'ndvi');
      if (prev) {
        const c = img.compare(r, prev);
        change = { prev, delta: r.mean - prev.mean, median: c.median, dropHa: c.anomalyHa, points: c.clusters.slice(0, 5), compared: c.comparedHa };
      }
    } catch { /* different tile or too few pixels */ }

    // season curve: the time series panel's points if it shows this field, else up to 14 clear dates in 150 days
    step('Building the season curve');
    let season = [];
    const TS = window.TimeSeries && TimeSeries.state;
    if (TS && TS.fieldId === field.id && TS.points.some((p) => p.v && p.v.ndvi)) {
      season = TS.points.filter((p) => p.v.ndvi).map((p) => ({ day: p.day, t: p.t, mean: p.v.ndvi.mean, p10: p.v.ndvi.p10, p90: p.v.ndvi.p90 }));
    } else {
      try {
        const sc = (await img.searchScenes([field.geometry], 'rep:' + field.id, 150))
          .filter((s) => s.tileCloud < 70 && s.covers !== false).sort((a, b) => (a.day < b.day ? 1 : -1)).slice(0, 24);
        let k = 0;
        const work = async () => { while (k < sc.length && season.length < 14) { const s = sc[k++]; try { const x = await img.analyse(field, s, 'ndvi'); if (x.cloudPct <= 40 && Number.isFinite(x.mean)) season.push({ day: s.day, t: Date.parse(s.day + 'T00:00:00Z'), mean: x.mean, p10: x.p10, p90: x.p90 }); } catch { /* skip */ } } };
        await Promise.all([work(), work(), work(), work()]);
      } catch { /* no curve */ }
    }
    season.sort((a, b) => a.t - b.t);

    // crops, operations, weather
    step('Collecting crops, operations and weather');
    const [crops, acts, weather] = await Promise.all([
      apiGet(`/crops/by-field/${field.id}`).catch(() => []),
      apiGet(`/activities/by-farm/${state.selectedFarmId}?from=${new Date(Date.now() - 365 * DAY).toISOString().slice(0, 10)}&to=${new Date().toISOString().slice(0, 10)}`).then((a) => (a || []).filter((x) => x.fieldId === field.id)).catch(() => []),
      (async () => {
        const c = L.geoJSON(field.geometry).getBounds().getCenter();
        const end = new Date(Date.now() - 6 * DAY).toISOString().slice(0, 10), start = new Date(Date.now() - 36 * DAY).toISOString().slice(0, 10);
        const w = await apiGet(`/weather/field/${field.id}/history?lat=${c.lat.toFixed(4)}&lng=${c.lng.toFixed(4)}&start=${start}&end=${end}`);
        return (w && w.days) || [];
      })().catch(() => []),
    ]);
    const crop = (crops || []).filter((c) => c.growthStage !== 'harvested').sort((a, b) => (a.plantingDate < b.plantingDate ? 1 : -1))[0] || null;
    const farm = (state.farms || []).find((f) => f.id === state.selectedFarmId);
    return { field, farm, scene, r, others, zones, zone, cuts, mean, sd, cv: mean ? (100 * sd) / mean : NaN, classes, fieldHa, clearPct: 100 - r.cloudPct, change, season, crop, acts: (acts || []).sort((a, b) => (a.date < b.date ? 1 : -1)), weather };
  }

  // ------------------------------------------------------------ agronomy

  function vigour(v) { return v < 0.2 ? 'Bare soil or emerging' : v < 0.4 ? 'Sparse canopy' : v < 0.6 ? 'Moderate canopy' : v < 0.8 ? 'Good canopy' : 'Dense canopy'; }
  function uniformity(cv) { return cv < 10 ? 'Uniform' : cv < 20 ? 'Moderate variation' : 'Strong variation'; }
  function readIndex(k, v, ndvi) {
    if (!Number.isFinite(v)) return '—';
    if (k === 'ndvi') return vigour(v);
    if (k === 'msavi') return v < 0.3 ? 'Soil still shows between plants' : 'Canopy closing';
    if (k === 'savi') return v < 0.15 ? 'Mostly soil' : v < 0.3 ? 'Sparse cover' : v < 0.5 ? 'Moderate cover' : 'Vigorous cover';
    if (k === 'gndvi') return v < 0.3 ? 'Low chlorophyll / nitrogen' : v < 0.55 ? 'Moderate nitrogen status' : 'Good nitrogen status';
    if (k === 'bsi') return v > 0.15 ? 'Bare soil' : v > 0 ? 'Little cover' : v > -0.15 ? 'Partial cover' : 'Full cover';
    if (k === 'si') return ndvi > 0.4 ? 'Canopy hides the soil; read on bare patches only' : v > 0.2 ? 'High salinity signal: confirm with EC test' : v > 0.14 ? 'Moderate salinity signal' : 'Low salinity signal';
    if (k === 'ndre') return ndvi > 0.6 && v < 0.25 ? 'Chlorophyll low for this canopy' : v < 0.2 ? 'Low chlorophyll' : v < 0.4 ? 'Moderate chlorophyll' : 'High chlorophyll';
    if (k === 'ndmi') return v < 0 ? 'Water stress likely' : v < 0.2 ? 'Moderate water content' : 'Adequate water content';
    return '';
  }

  function weatherSummary(days) {
    if (!days.length) return null;
    const t = days.filter((d) => d.temperatureMaxC != null && d.temperatureMinC != null);
    const rain = days.reduce((s, d) => s + (d.precipitationMm || 0), 0);
    const gdd = t.reduce((s, d) => s + Math.max(0, (Math.min(d.temperatureMaxC, 35) + Math.max(d.temperatureMinC, 10)) / 2 - 10), 0);
    const sm = days.filter((d) => d.soilMoisture != null);
    return {
      n: days.length, rain, tmax: t.length ? t.reduce((s, d) => s + d.temperatureMaxC, 0) / t.length : NaN, tmin: t.length ? t.reduce((s, d) => s + d.temperatureMinC, 0) / t.length : NaN,
      hot: t.filter((d) => d.temperatureMaxC >= 40).length, gdd, soil: sm.length ? sm.reduce((s, d) => s + d.soilMoisture, 0) / sm.length : NaN,
      from: days[0].date, to: days[days.length - 1].date,
    };
  }

  function notes(d, w) {
    const out = [], act = [];
    const forage = d.crop && FORAGE.test(d.crop.cropType);
    const low = d.zones[0];
    out.push(`${vigour(d.mean)} (mean NDVI ${f2(d.mean)}) and ${uniformity(d.cv).toLowerCase()} across the field (CV ${pct(d.cv)}).`);
    if (d.cv >= 15) act.push(`Check irrigation uniformity in the low zone (${ha(low.area)} ha): nozzles and pressure on pivots, blocked drippers, or leaks, then soil compaction and salinity.`);
    if (d.change) {
      const dd = d.change.delta;
      const cut = d.acts.some((a) => a.type === 'harvest' && Math.abs(Date.parse(a.date) - Date.parse(d.scene.day)) < 14 * DAY);
      if (dd <= -0.1) {
        if (forage) out.push(`NDVI fell ${f2(Math.abs(dd))} since ${dayShort(d.change.prev.scene.day)}. ${cut ? 'A harvest is logged in that window, so this is the cut.' : 'For a forage crop this is usually a cut; log the harvest so the next report can tell them apart.'}`);
        else { out.push(`NDVI fell ${f2(Math.abs(dd))} since ${dayShort(d.change.prev.scene.day)}.`); act.push('Visit the scouting points within 48 hours: look for water stress, pests or disease, and lodging.'); }
      } else if (dd >= 0.05) out.push(`Canopy is growing: NDVI up ${f2(dd)} since ${dayShort(d.change.prev.scene.day)}.`);
      else out.push(`Stable since ${dayShort(d.change.prev.scene.day)} (change ${dd >= 0 ? '+' : '−'}${f2(Math.abs(dd))}).`);
      if (d.change.dropHa > 0.1 && !forage) act.push(`${ha(d.change.dropHa)} ha dropped more than the rest of the field: start scouting at point 1 on page 1.`);
    }
    const ndmi = d.others.ndmi && d.others.ndmi.mean, ndre = d.others.ndre && d.others.ndre.mean;
    if (Number.isFinite(ndmi) && ndmi < 0) act.push('NDMI is below 0: check the irrigation schedule against crop water use (ET) and soil moisture before the next heat spell.');
    if (Number.isFinite(ndre) && d.mean > 0.6 && ndre < 0.25) act.push('Chlorophyll (NDRE) is low for this canopy: take a tissue or SPAD sample before adding nitrogen.');
    const si = d.others.si && d.others.si.mean;
    if (Number.isFinite(si) && si > 0.2 && d.mean < 0.4) act.push('The salinity signal is high on exposed soil: take soil EC samples in the low zone before the next sowing, and plan leaching if EC is high.');
    if (w && w.hot >= 5) out.push(`${w.hot} days at 40 °C or more in the last ${w.n} days: expect heat stress, especially in the low zone.`);
    if (low.share > 30) act.push(`The low zone covers ${pct(low.share)} of the field: map it for variable-rate seeding or fertiliser (VRA maps).`);
    if (!act.length) act.push('No action needed now. Keep the next clear image under watch, and log operations so changes can be explained.');
    return { out, act };
  }

  // ------------------------------------------------------------ charts

  function seasonChart(d, W, H) {
    const pts = d.season; if (pts.length < 2) return '<div class="empty">Not enough clear dates in the last 150 days for a curve</div>';
    const P = { l: 30, r: 8, t: 10, b: 20 };
    const a = pts[0].t, b = pts[pts.length - 1].t;
    const lo = 0, hi = 1;
    const X = (t) => P.l + ((t - a) / (b - a || 1)) * (W - P.l - P.r), Y = (v) => P.t + (1 - (v - lo) / (hi - lo)) * (H - P.t - P.b);
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)} ${Y(p.mean).toFixed(1)}`).join('');
    const band = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)} ${Y(p.p90).toFixed(1)}`).join('') + pts.slice().reverse().map((p) => `L${X(p.t).toFixed(1)} ${Y(p.p10).toFixed(1)}`).join('') + 'Z';
    const months = []; const m = new Date(a); m.setUTCDate(1); if (+m < a) m.setUTCMonth(m.getUTCMonth() + 1);
    while (+m <= b) { months.push(+m); m.setUTCMonth(m.getUTCMonth() + 1); }
    const plant = d.crop && Date.parse(d.crop.plantingDate + 'T00:00:00Z');
    return `<svg viewBox="0 0 ${W} ${H}" width="100%">
      ${[0, 0.25, 0.5, 0.75, 1].map((v) => `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="#e7e3da"/><text x="${P.l - 5}" y="${Y(v) + 3}" text-anchor="end" class="ax">${v.toFixed(2)}</text>`).join('')}
      ${months.map((t) => `<text x="${X(t)}" y="${H - 6}" text-anchor="middle" class="ax">${new Date(t).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })}</text>`).join('')}
      ${plant && plant >= a && plant <= b ? `<line x1="${X(plant)}" x2="${X(plant)}" y1="${P.t}" y2="${H - P.b}" stroke="#8a857c" stroke-dasharray="3 3"/><text x="${X(plant) + 4}" y="${P.t + 8}" class="ax">Sown</text>` : ''}
      <path d="${band}" fill="#3f8f35" opacity=".12"/>
      <path d="${line}" fill="none" stroke="#2f7a29" stroke-width="1.8" stroke-linejoin="round"/>
      ${pts.map((p) => `<circle cx="${X(p.t).toFixed(1)}" cy="${Y(p.mean).toFixed(1)}" r="2.4" fill="#fff" stroke="#2f7a29" stroke-width="1.3"/>`).join('')}
    </svg>`;
  }

  // ------------------------------------------------------------ document

  function html(d) {
    const img = I();
    const { field, farm, scene, r, zones, classes, change, crop } = d;
    const w = weatherSummary(d.weather);
    const n = notes(d, w);
    const ndviMap = img.paint(r, { contrast: false });
    const zoneMap = zoneImage(r, d.zone);
    const per = perimeter(field.geometry), b = bbox(field.geometry);
    const ctr = L.geoJSON(field.geometry).getBounds().getCenter();
    const das = crop ? Math.floor((Date.parse(scene.day) - Date.parse(crop.plantingDate)) / DAY) : null;
    const now = new Date();
    const pin = change ? change.points : [];
    const ramp = img.gradient(img.indices.ndvi.ramp);
    const idxRows = [['ndvi', r], ['savi', d.others.savi], ['gndvi', d.others.gndvi], ['ndre', d.others.ndre], ['ndmi', d.others.ndmi], ['bsi', d.others.bsi], ['si', d.others.si]].filter(([, x]) => x && Number.isFinite(x.mean));
    const maxShare = Math.max(...classes.map((c) => c.share), 1);
    const typeLabel = Object.fromEntries((window.ActivityTypes || []).map(([v, l]) => [v, l]));
    const header = (page) => `
      <header class="hd">
        <div class="brand"><span class="mark">A</span>AgroSyntra One</div>
        <div class="hd-meta">Field report · ${esc(field.name)} · page ${page} of 2</div>
      </header>`;
    const footer = `<footer class="ft"><span>Sentinel-2 L2A, 10 m pixels, clouds masked with the scene classification band. Zones: below 90 %, 90–110 % and above 110 % of the field's mean NDVI. Areas from the stored boundary.</span><span>Generated ${day(+now)}</span></footer>`;
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(field.name)} · field report · ${scene.day}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; background: #e9e6df; font: 9.5pt/1.45 "IBM Plex Sans", system-ui, sans-serif; color: #1c1b19; font-variant-numeric: tabular-nums; }
  .bar { position: sticky; top: 0; z-index: 2; display: flex; justify-content: center; gap: 8px; padding: 10px; background: rgba(233,230,223,.92); backdrop-filter: blur(6px); }
  .bar button { height: 34px; padding: 0 16px; border: 0; border-radius: 8px; font: 500 13px "IBM Plex Sans", sans-serif; cursor: pointer; background: #15803d; color: #fff; }
  .bar button.ghost { background: #fff; color: #1c1b19; box-shadow: inset 0 0 0 1px #d4cfc4; }
  .page { position: relative; width: 210mm; height: 297mm; margin: 0 auto 10mm; padding: 13mm 14mm 12mm; background: #fffefb; box-shadow: 0 10px 30px rgba(28,27,25,.12); display: flex; flex-direction: column; overflow: hidden; }
  .hd { display: flex; align-items: center; justify-content: space-between; padding-bottom: 3mm; border-bottom: 1px solid #e7e3da; }
  .brand { display: flex; align-items: center; gap: 7px; font-weight: 500; font-size: 9.5pt; }
  .mark { display: grid; place-items: center; width: 18px; height: 18px; border-radius: 4px; background: #14532d; color: #fff; font-size: 9pt; font-weight: 600; }
  .hd-meta { font-size: 8.5pt; color: #6b675f; }
  .title { display: flex; justify-content: space-between; align-items: flex-end; margin: 5mm 0 4mm; }
  h1 { margin: 0; font-size: 21pt; font-weight: 500; letter-spacing: -.01em; line-height: 1.1; }
  .sub { margin-top: 2px; color: #6b675f; font-size: 9.5pt; }
  .stamp { text-align: right; font-size: 8.5pt; color: #6b675f; line-height: 1.5; }
  .stamp b { color: #1c1b19; font-weight: 500; }
  h2 { margin: 0 0 2.5mm; font-size: 10.5pt; font-weight: 500; }
  .kpis { display: grid; grid-template-columns: repeat(5, 1fr); border: 1px solid #e7e3da; border-radius: 8px; overflow: hidden; margin-bottom: 4.5mm; }
  .kpi { padding: 3mm 3.5mm 3.4mm; border-inline-start: 1px solid #e7e3da; min-width: 0; }
  .kpi .s { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .kpi:first-child { border: 0; }
  .kpi .l { font-size: 7.8pt; color: #6b675f; }
  .kpi .v { font-size: 15pt; font-weight: 500; line-height: 1.25; }
  .kpi .v small { font-size: 8.5pt; font-weight: 400; color: #6b675f; margin-inline-start: 2px; }
  .kpi .s { font-size: 7.8pt; color: #6b675f; }
  .up { color: #2f7a29; } .down { color: #b42318; }
  .maps { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; margin-bottom: 4mm; }
  .card { border: 1px solid #e7e3da; border-radius: 8px; padding: 3mm; }
  .map { display: block; border-radius: 6px; }
  .cap { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2mm; font-size: 8.5pt; }
  .cap b { font-weight: 500; font-size: 9.5pt; }
  .ramp { display: flex; align-items: center; gap: 5px; margin-top: 2mm; font-size: 7.5pt; color: #6b675f; }
  .ramp i { flex: 1; height: 5px; border-radius: 3px; }
  .zl { display: flex; gap: 10px; margin-top: 2mm; font-size: 7.5pt; color: #6b675f; }
  .sw { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-inline-end: 4px; vertical-align: -1px; }
  table { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
  th { text-align: start; font-weight: 500; color: #6b675f; font-size: 7.8pt; padding: 1.4mm 2mm; border-bottom: 1px solid #e7e3da; }
  td { padding: 1.5mm 2mm; border-bottom: 1px solid #f0ede6; }
  th, td.r, .two td:nth-child(2) { white-space: nowrap; }
  td.r, th.r { text-align: right; }
  tr:last-child td { border-bottom: 0; }
  tfoot td { font-weight: 500; border-top: 1px solid #e7e3da; }
  .two { display: grid; grid-template-columns: 1.3fr 1fr; gap: 4mm; }
  .meter { display: block; height: 5px; border-radius: 3px; background: #f0ede6; overflow: hidden; }
  .meter i { display: block; height: 100%; border-radius: 3px; }
  .facts { display: grid; grid-template-columns: auto 1fr; gap: 1.1mm 4mm; font-size: 8.5pt; }
  .facts dt { color: #6b675f; } .facts dd { margin: 0; }
  .ax { font-size: 7px; fill: #8a857c; }
  .empty { padding: 8mm 0; text-align: center; color: #8a857c; font-size: 8.5pt; }
  .notes { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; }
  .notes ul { margin: 0; padding-inline-start: 4mm; } .notes li { margin-bottom: 1.4mm; }
  .notes .act, .card.act { background: #f4f8f1; border-color: #d8e6d0; }
  .notes1 ul { margin: 0; padding-inline-start: 4mm; } .notes1 li { margin-bottom: 1.2mm; }
  .wx { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2mm 4mm; }
  .wx div { font-size: 7.8pt; color: #6b675f; } .wx b { display: block; font-size: 10.5pt; font-weight: 500; color: #1c1b19; white-space: nowrap; }
  .sp { flex: 1; }
  .ft span:last-child { white-space: nowrap; }
  .ft { display: flex; justify-content: space-between; gap: 8mm; margin-top: 3mm; padding-top: 2.5mm; border-top: 1px solid #e7e3da; font-size: 7pt; color: #8a857c; }
  .mb { margin-bottom: 4mm; }
  .p2 .title { margin: 4mm 0 3mm; } .p2 h1 { font-size: 17pt; }
  .p2 .mb { margin-bottom: 3mm; } .p2 .card { padding: 2.6mm 3mm; } .p2 h2 { margin-bottom: 1.6mm; }
  .p2 td { padding: 1mm 2mm; } .p2 th { padding: 1mm 2mm; }
  .p2 .empty { padding: 4mm 0; }
  @media print { body { background: #fff; } .bar { display: none; } .page { margin: 0; box-shadow: none; page-break-after: always; } .page:last-child { page-break-after: auto; } }
</style></head><body>
<div class="bar"><button type="button" onclick="print()">Print or save as PDF</button><button type="button" class="ghost" onclick="close()">Close</button></div>

<section class="page">
  ${header(1)}
  <div class="title">
    <div><h1>${esc(field.name)}</h1><div class="sub">${esc(farm ? farm.name : '')}${crop ? ` · ${esc(crop.cropType)}${crop.variety ? ' ' + esc(crop.variety) : ''}` : ' · No crop recorded'} · ${ha(d.fieldHa)} ha</div></div>
    <div class="stamp">Image <b>${day(scene.day)}</b><br>Sentinel-2 · ${pct(d.clearPct)} of the field clear</div>
  </div>

  <div class="kpis">
    <div class="kpi"><div class="l">Field area</div><div class="v">${ha(d.fieldHa)}<small>ha</small></div><div class="s">${(d.fieldHa * 2.4710538).toFixed(1)} acres</div></div>
    <div class="kpi"><div class="l">Mean NDVI</div><div class="v">${f2(d.mean)}</div><div class="s">${vigour(d.mean)}</div></div>
    <div class="kpi"><div class="l">Uniformity</div><div class="v">${pct(d.cv)}<small>CV</small></div><div class="s">${uniformity(d.cv)}</div></div>
    <div class="kpi"><div class="l">Change</div><div class="v ${change ? (change.delta < 0 ? 'down' : 'up') : ''}">${change ? `${change.delta >= 0 ? '+' : '−'}${f2(Math.abs(change.delta))}` : '—'}</div><div class="s">${change ? 'since ' + dayShort(change.prev.scene.day) : 'No earlier clear date'}</div></div>
    <div class="kpi"><div class="l">Low zone</div><div class="v">${ha(zones[0].area)}<small>ha</small></div><div class="s">${pct(zones[0].share)} of the field</div></div>
  </div>

  <div class="maps">
    <div class="card">
      <div class="cap"><b>NDVI</b><span>${day(scene.day)}</span></div>
      ${mapSvg(field, ndviMap, r.bounds, 300, 230, { marks: pin })}
      <div class="ramp"><span>0</span><i style="background:${ramp}"></i><span>1</span><span class="sw" style="background:#787e87;margin-inline-start:8px"></span>Cloud</div>
    </div>
    <div class="card">
      <div class="cap"><b>Management zones</b><span>against the field mean</span></div>
      ${mapSvg(field, zoneMap, r.bounds, 300, 230)}
      <div class="zl">${zones.map((z, k) => `<span><span class="sw" style="background:${z.color}"></span>${z.label} ${['< 90%', '90–110%', '> 110%'][k]}</span>`).join('')}</div>
    </div>
  </div>

  <div class="two mb">
    <div class="card">
      <h2>Zone areas</h2>
      <table><thead><tr><th>Zone</th><th>NDVI</th><th class="r">Mean</th><th class="r">Area, ha</th><th class="r">Share</th><th style="width:16%"></th></tr></thead>
      <tbody>${zones.slice().reverse().map((z) => `<tr><td><span class="sw" style="background:${z.color}"></span>${z.label}</td><td>${z.n ? `${f2(z.min)}–${f2(z.max)}` : '—'}</td><td class="r">${z.n ? f2(z.mean) : '—'}</td><td class="r">${ha(z.area)}</td><td class="r">${pct(z.share)}</td><td><span class="meter"><i style="width:${z.share}%;background:${z.color}"></i></span></td></tr>`).join('')}</tbody>
      <tfoot><tr><td>Field</td><td>${f2(Math.min(...zones.filter((z) => z.n).map((z) => z.min)))}–${f2(Math.max(...zones.filter((z) => z.n).map((z) => z.max)))}</td><td class="r">${f2(d.mean)}</td><td class="r">${ha(d.fieldHa)}</td><td class="r">100%</td><td></td></tr></tfoot></table>
    </div>
    <div class="card">
      <h2>Field facts</h2>
      <dl class="facts">
        <dt>Crop</dt><dd>${crop ? esc(crop.cropType) + (crop.variety ? ' · ' + esc(crop.variety) : '') : '—'}</dd>
        <dt>Sown</dt><dd>${crop ? `${day(crop.plantingDate)}${das != null && das >= 0 ? ` · day ${das}` : ''}` : '—'}</dd>
        <dt>Expected harvest</dt><dd>${crop && crop.expectedHarvestDate ? day(crop.expectedHarvestDate) : '—'}</dd>
        <dt>Irrigation</dt><dd>${esc(field.irrigation || '—')}</dd>
        <dt>Area</dt><dd>${ha(d.fieldHa)} ha · ${(d.fieldHa * 2.4710538).toFixed(1)} acres · ${Math.round(d.fieldHa * 10).toLocaleString('en-US')} dunum</dd>
        <dt>Perimeter</dt><dd>${per >= 1000 ? (per / 1000).toFixed(2) + ' km' : Math.round(per) + ' m'}</dd>
        <dt>Extent</dt><dd>${Math.round(haversine([b.w, ctr.lat], [b.e, ctr.lat]))} × ${Math.round(haversine([ctr.lng, b.s], [ctr.lng, b.n]))} m</dd>
        <dt>Centre</dt><dd>${ctr.lat.toFixed(5)}, ${ctr.lng.toFixed(5)}</dd>
      </dl>
    </div>
  </div>

  <div class="card">
    <h2>NDVI distribution</h2>
    <table><thead><tr><th>NDVI class</th><th class="r">Area, ha</th><th class="r">Share</th><th style="width:46%"></th><th>Reading</th></tr></thead>
    <tbody>${classes.filter((c) => c.share >= 0.05).reverse().map((c) => { const col = img.css(img.rampAt(img.indices.ndvi.ramp, (c.lo + c.hi) / 2)); return `<tr><td><span class="sw" style="background:${col}"></span>${c.lo.toFixed(1)}–${c.hi.toFixed(1)}</td><td class="r">${ha(c.area)}</td><td class="r">${c.share.toFixed(1)}%</td><td><span class="meter"><i style="width:${(100 * c.share) / maxShare}%;background:${col}"></i></span></td><td>${vigour((c.lo + c.hi) / 2)}</td></tr>`; }).join('')}</tbody></table>
  </div>
  <div class="sp"></div>
  ${footer}
</section>

<section class="page p2">
  ${header(2)}
  <div class="title"><div><h1>Season and actions</h1><div class="sub">${esc(field.name)}${crop ? ' · ' + esc(crop.cropType) : ''}</div></div><div class="stamp">Image <b>${day(scene.day)}</b></div></div>

  <div class="card mb">
    <div class="cap"><b>NDVI over the season</b><span>mean and P10–P90 spread · ${d.season.length} clear dates</span></div>
    ${seasonChart(d, 680, 92)}
  </div>

  <div class="card mb">
      <h2>Indices on ${dayShort(scene.day)}</h2>
      <table><thead><tr><th>Index</th><th>Measures</th><th class="r">Mean</th><th class="r">P10–P90</th><th>Reading</th></tr></thead>
      <tbody>${idxRows.map(([k, x]) => `<tr><td><b style="font-weight:500">${img.indices[k].label}</b></td><td style="color:#6b675f">${img.indices[k].name}</td><td class="r">${f2(x.mean)}</td><td class="r">${f2(x.p10)}–${f2(x.p90)}</td><td>${readIndex(k, x.mean, d.mean)}</td></tr>`).join('')}</tbody></table>
    </div>
  <div class="two mb">
    <div class="card">
      <h2>Change since the previous clear date</h2>
      ${change ? `<table><tbody>
        <tr><td>Previous clear date</td><td class="r">${day(change.prev.scene.day)}</td></tr>
        <tr><td>Mean NDVI</td><td class="r">${f2(change.prev.mean)} → ${f2(r.mean)}</td></tr>
        <tr><td>Area that dropped against the field</td><td class="r">${ha(change.dropHa)} ha · ${pct((100 * change.dropHa) / (d.fieldHa || 1))}</td></tr>
      </tbody></table>
      ${pin.length ? `<table style="margin-top:2mm"><thead><tr><th>Scouting point</th><th class="r">Area, ha</th><th class="r">Drop</th><th class="r">Location</th></tr></thead><tbody>${pin.map((p, i) => `<tr><td>${i + 1}</td><td class="r">${ha(p.ha)}</td><td class="r">${f2(p.meanDrop)}</td><td class="r">${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty" style="padding:3mm 0">No patch dropped against the rest of the field</div>'}`
        : '<div class="empty">No earlier clear date on the same tile</div>'}
    </div>
    <div class="card">
      <h2>Weather, last ${w ? w.n : 30} days</h2>
      ${w ? `<div class="wx">
        <div>Rain<b>${w.rain.toFixed(1)} mm</b></div>
        <div>Mean max / min<b>${w.tmax.toFixed(1)} / ${w.tmin.toFixed(1)} °C</b></div>
        <div>Growing degree days<b>${Math.round(w.gdd)}</b>base 10 °C</div>
        <div>Days ≥ 40 °C<b>${w.hot}</b></div>
        <div>Soil moisture<b>${Number.isFinite(w.soil) ? w.soil.toFixed(2) + ' m³/m³' : '—'}</b></div>
        <div>Period<b style="font-size:9pt">${dayShort(w.from)} – ${dayShort(w.to)}</b></div>
      </div>` : '<div class="empty">Weather archive not reachable</div>'}
    </div>
  </div>
  <div class="two mb">
    <div class="card">
      <h2>Operations, last 12 months</h2>
      ${d.acts.length ? `<table><thead><tr><th>Date</th><th>Operation</th><th>Product, rate</th></tr></thead><tbody>${d.acts.slice(0, 7).map((a) => `<tr><td>${dayShort(a.date)}</td><td>${esc(typeLabel[a.type] || a.type)}</td><td>${esc([a.product, a.rate != null ? `${a.rate} ${a.unit || ''}` : ''].filter(Boolean).join(' · ') || a.notes || '—').slice(0, 48)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No operations logged for this field</div>'}
    </div>
    <div class="card notes1"><h2>What the image shows</h2><ul>${n.out.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
  </div>
  <div class="card act notes1"><h2>Recommended actions</h2><ul>${n.act.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
  <div class="sp"></div>
  ${footer}
</section>
</body></html>`;
  }

  /** Long notes or many operations: scale the page's blocks down a little rather than spill onto a third page. */
  function fitPages(doc) {
    doc.querySelectorAll('.page').forEach((pg) => {
      const parts = pg.querySelectorAll(':scope > .card, :scope > .two, :scope > .maps, :scope > .kpis, :scope > .notes');
      let z = 1; parts.forEach((x) => { x.style.zoom = ''; });
      while (pg.scrollHeight > pg.clientHeight + 1 && z > 0.84) { z -= 0.02; parts.forEach((x) => { x.style.zoom = z; }); }
    });
  }
  function keepFitted(win) {
    const run = () => { try { if (!win.closed) fitPages(win.document); } catch { /* closed */ } };
    run(); win.addEventListener('load', run); win.addEventListener('beforeprint', run);
    if (win.document.fonts) { win.document.fonts.ready.then(run); win.document.fonts.addEventListener('loadingdone', run); }
    setTimeout(run, 400); setTimeout(run, 1500);
  }

  /** Builds the report for a field and opens it in a new tab. */
  async function open(fieldId, onStep) {
    const field = state.fieldsById && state.fieldsById.get(fieldId);
    if (!field || !field.geometry) throw new Error('Pick a field');
    const win = window.open('', '_blank');
    if (win) win.document.write('<!doctype html><title>Field report</title><body style="font:14px system-ui;color:#5b5852;display:grid;place-items:center;height:100vh;margin:0;background:#f8f7f3">Preparing the field report</body>');
    try {
      const d = await gather(field, onStep);
      const doc = html(d);
      if (win && !win.closed) { win.document.open(); win.document.write(doc); win.document.close(); keepFitted(win); }
      else { const u = URL.createObjectURL(new Blob([doc], { type: 'text/html' })); window.open(u, '_blank'); }
      return d;
    } catch (err) { if (win && !win.closed) win.close(); throw err; }
  }

  window.FieldReport = { open, gather, html, fitPages };
})();
