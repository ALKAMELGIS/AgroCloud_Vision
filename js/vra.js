/*
 * AgroOne — VRA maps and soil sampling
 *
 * Zones engine shared by Sowing, Vegetation, P&K, Map builder and Soil sampling:
 *  - source grid: one index on one date (Vegetation), the mean of each date's
 *    value / field mean over the clearest dates (productivity: Sowing, P&K), or
 *    up to five weighted layers (Map builder). Cloud gaps are filled from the
 *    nearest clear pixel so zones cover the whole field.
 *  - zoning: k-means (default) or equal area, 2–7 zones (default 3); Zone 1
 *    holds the highest values. 3×3 majority smoothing, then patches smaller
 *    than the minimum zone (default 0.1 ha = 1000 m²) are merged into the
 *    neighbouring zone they touch most.
 *  - polygons: zone outlines traced along pixel edges (holes kept), WGS84.
 *  - rates: per zone, or distributed from a target average (direct = more to
 *    stronger zones, inverse = more to weaker zones), totals and savings
 *    against a flat rate.
 *  - export: Shapefile (zip: shp, shx, dbf, prj, cpg), ISO-XML TASKDATA
 *    (DDI 6 mass kg/ha × 100, DDI 1 volume L/ha × 10000, DDI 11 count
 *    seeds/ha × 0.1), GeoJSON, KML.
 * Soil sampling: grid (cell size in ha) or zones (points per zone); points sit
 *   on the pixel farthest from the zone or field edge; GPX, KML, CSV, SHP export.
 */
(function () {
  'use strict';
  const I = () => window.Imagery;
  const ZONE_COLORS = ['#1a9850', '#66bd63', '#a6d96a', '#fee08b', '#fdae61', '#f46d43', '#d73027'];
  const zoneColor = (z, k) => ZONE_COLORS[Math.round((z * (ZONE_COLORS.length - 1)) / Math.max(1, k - 1))];
  const fmtDay = (d) => (d ? new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');
  const status = (t) => `<div class="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2.5 text-[13px] text-gray-600">${icon('loader', 'spin text-gray-400')}<span>${escapeHtml(t)}</span></div>`;
  const errBox = (t) => `<div class="rounded-lg bg-red-50 p-3 text-[13px] text-red-700 ring-1 ring-red-100">${escapeHtml(t)}</div>`;

  const TYPES = {
    'vra-vegetation': { title: 'Vegetation map', source: 'date', unit: 'kg/ha', avg: 120, product: 'Nitrogen', strategy: 'inverse', ddi: 6,
      hint: 'Nitrogen or growth regulator by the crop’s condition on one image date. Weaker zones get more by default' },
    'vra-sowing': { title: 'Sowing map', source: 'productivity', unit: 'seeds/ha', avg: 75000, product: 'Seed', strategy: 'direct', ddi: 11,
      hint: 'Seeding rate by long-term productivity. Stronger zones get more seed by default' },
    'vra-pk': { title: 'P&K map', source: 'productivity', unit: 'kg/ha', avg: 150, product: 'P2O5 / K2O', strategy: 'inverse', ddi: 6,
      hint: 'Phosphorus and potassium by productivity zone. Weaker zones get more by default' },
    'vra-builder': { title: 'Map builder', source: 'builder', unit: 'kg/ha', avg: 100, product: 'Product', strategy: 'direct', ddi: 6,
      hint: 'Combine up to five index layers with weights. Zone 1 holds the highest combined values' },
  };
  const UNITS = ['kg/ha', 'L/ha', 'seeds/ha', 't/ha'];

  // ------------------------------------------------------------ source grids

  function fillGaps(vals, inField, w, h) {
    const out = Float32Array.from(vals); let changed = true, guard = 0;
    while (changed && guard++ < 200) {
      changed = false; const next = Float32Array.from(out);
      for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
        const i = r * w + c; if (!inField[i] || !Number.isNaN(out[i])) continue;
        let s = 0, n = 0;
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const rr = r + dr, cc = c + dc; if (rr < 0 || cc < 0 || rr >= h || cc >= w) continue; const v = out[rr * w + cc]; if (!Number.isNaN(v)) { s += v; n++; } }
        if (n) { next[i] = s / n; changed = true; }
      }
      out.set(next);
    }
    return out;
  }
  const sameGrid = (a, b) => a.w === b.w && a.h === b.h && a.gx0 === b.gx0 && a.gy0 === b.gy0;

  async function combine(field, layers, onStatus) {
    // layers: [{ scene, indexKey, weight }] → weighted mean of value / field mean
    let base = null; const acc = []; let wsum = 0; const used = [];
    for (let i = 0; i < layers.length; i++) {
      const L_ = layers[i];
      onStatus && onStatus(`Reading ${I().indices[L_.indexKey].label} ${fmtDay(L_.scene.day)} (${i + 1} of ${layers.length})`);
      const r = await I().analyse(field, L_.scene, L_.indexKey);
      if (!Number.isFinite(r.mean) || r.mean === 0) continue;
      if (base && !sameGrid(base, r)) continue;
      if (!base) base = r;
      acc.push({ r, w: L_.weight }); wsum += L_.weight; used.push(L_);
    }
    if (!base) throw new Error('No clear image of this field among the selected dates');
    const n = base.w * base.h; const vals = new Float32Array(n).fill(NaN);
    if (acc.length === 1) {  // one layer: keep the index's own values
      for (let i = 0; i < n; i++) if (base.inField[i]) vals[i] = base.values[i];
      return { grid: base, values: fillGaps(vals, base.inField, base.w, base.h), used, wsum };
    }
    for (let i = 0; i < n; i++) {
      if (!base.inField[i]) continue;
      let s = 0, ws = 0;
      acc.forEach(({ r, w }) => { const v = r.values[i]; if (!Number.isNaN(v)) { s += w * (v / r.mean); ws += w; } });
      if (ws > 0) vals[i] = s / ws;
    }
    return { grid: base, values: fillGaps(vals, base.inField, base.w, base.h), used, wsum };
  }

  // ------------------------------------------------------------ zoning

  function kmeans1d(sorted, k) {
    let c = Array.from({ length: k }, (_, i) => sorted[Math.floor(((i + 0.5) / k) * sorted.length)]);
    for (let it = 0; it < 30; it++) {
      const s = new Array(k).fill(0), n = new Array(k).fill(0);
      sorted.forEach((v) => { let b = 0; for (let j = 1; j < k; j++) if (Math.abs(v - c[j]) < Math.abs(v - c[b])) b = j; s[b] += v; n[b]++; });
      const nc = c.map((x, j) => (n[j] ? s[j] / n[j] : x));
      if (nc.every((x, j) => Math.abs(x - c[j]) < 1e-6)) break;
      c = nc;
    }
    c.sort((a, b) => a - b);
    return c.slice(0, -1).map((x, j) => (x + c[j + 1]) / 2); // thresholds
  }

  function zoneGrid(src, opts) {
    const { grid, values } = src; const { w, h, inField } = grid; const k = opts.zones;
    const vals = []; for (let i = 0; i < w * h; i++) if (inField[i] && !Number.isNaN(values[i])) vals.push(values[i]);
    if (vals.length < k * 4) throw new Error('The field is too small for this many zones');
    vals.sort((a, b) => a - b);
    const cuts = opts.method === 'quantile' ? Array.from({ length: k - 1 }, (_, j) => vals[Math.floor(((j + 1) / k) * vals.length)]) : kmeans1d(vals, k);
    let zone = new Int8Array(w * h).fill(-1);
    for (let i = 0; i < w * h; i++) {
      if (!inField[i] || Number.isNaN(values[i])) continue;
      let cls = 0; while (cls < k - 1 && values[i] >= cuts[cls]) cls++;
      zone[i] = k - 1 - cls; // Zone 1 (index 0) = highest
    }
    // majority smoothing
    const sm = Int8Array.from(zone);
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
      const i = r * w + c; if (zone[i] < 0) continue;
      const cnt = new Array(k).fill(0);
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const rr = r + dr, cc = c + dc; if (rr < 0 || cc < 0 || rr >= h || cc >= w) continue; const z = zone[rr * w + cc]; if (z >= 0) cnt[z]++; }
      let best = zone[i]; cnt.forEach((v, z) => { if (v > cnt[best]) best = z; });
      if (cnt[best] >= 5) sm[i] = best;
    }
    zone = sm;
    // merge patches below the minimum zone area
    const minPx = Math.max(1, Math.round(opts.minHa / grid.pxHa));
    for (let pass = 0; pass < 6; pass++) {
      const seen = new Uint8Array(w * h); let merged = 0;
      for (let i = 0; i < w * h; i++) {
        if (zone[i] < 0 || seen[i]) continue;
        const z = zone[i], stack = [i], members = []; seen[i] = 1;
        const border = new Array(k).fill(0);
        while (stack.length) {
          const p = stack.pop(); members.push(p);
          const r = Math.floor(p / w), c = p % w;
          for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const rr = r + dr, cc = c + dc; if (rr < 0 || cc < 0 || rr >= h || cc >= w) continue;
            const q = rr * w + cc, zq = zone[q];
            if (zq === z && !seen[q]) { seen[q] = 1; stack.push(q); } else if (zq >= 0 && zq !== z) border[zq]++;
          }
        }
        if (members.length < minPx) {
          let to = -1; border.forEach((v, zz) => { if (v && (to < 0 || v > border[to])) to = zz; });
          if (to >= 0) { members.forEach((p) => { zone[p] = to; }); merged++; }
        }
      }
      if (!merged) break;
    }
    let stats = Array.from({ length: k }, () => ({ px: 0, sum: 0 }));
    for (let i = 0; i < w * h; i++) if (zone[i] >= 0) { stats[zone[i]].px++; stats[zone[i]].sum += values[i]; }
    // drop empty zones (uniform fields cannot fill every class) and renumber from the top
    const keep = stats.map((s, z) => (s.px ? z : -1)).filter((z) => z >= 0);
    if (keep.length < k) {
      const remap = new Int8Array(k).fill(-1); keep.forEach((z, j) => { remap[z] = j; });
      for (let i = 0; i < w * h; i++) if (zone[i] >= 0) zone[i] = remap[zone[i]];
      stats = keep.map((z) => stats[z]);
    }
    return { zone, k: stats.length, cuts, stats: stats.map((s, z) => ({ zone: z + 1, ha: s.px * grid.pxHa, mean: s.sum / s.px })) };
  }

  // ------------------------------------------------------------ polygons (pixel-edge tracing)

  function tracePolygons(zone, w, h, z) {
    const edges = new Map(); // "x,y" -> [[x2,y2], ...]
    const add = (x1, y1, x2, y2) => { const k = x1 + ',' + y1; if (!edges.has(k)) edges.set(k, []); edges.get(k).push([x2, y2]); };
    const at = (r, c) => (r < 0 || c < 0 || r >= h || c >= w ? -2 : zone[r * w + c]);
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
      if (zone[r * w + c] !== z) continue;
      if (at(r - 1, c) !== z) add(c, r, c + 1, r);
      if (at(r, c + 1) !== z) add(c + 1, r, c + 1, r + 1);
      if (at(r + 1, c) !== z) add(c + 1, r + 1, c, r + 1);
      if (at(r, c - 1) !== z) add(c, r + 1, c, r);
    }
    const rings = [];
    while (edges.size) {
      const startKey = edges.keys().next().value;
      let [x, y] = startKey.split(',').map(Number);
      const ring = [[x, y]]; let px = null, py = null;
      for (let guard = 0; guard < 1e6; guard++) {
        const k = x + ',' + y; const outs = edges.get(k); if (!outs || !outs.length) break;
        let pick = 0;
        if (outs.length > 1 && px !== null) {
          const dx = x - px, dy = y - py;  // prefer a right turn (keeps diagonal touches apart)
          const score = ([nx, ny]) => { const ex = nx - x, ey = ny - y; const cross = dx * ey - dy * ex; return cross > 0 ? 0 : cross === 0 ? 1 : 2; };
          pick = outs.map(score).indexOf(Math.min(...outs.map(score)));
        }
        const [nx, ny] = outs.splice(pick, 1)[0];
        if (!outs.length) edges.delete(k);
        px = x; py = y; x = nx; y = ny;
        ring.push([x, y]);
        if (x + ',' + y === startKey && !(edges.get(startKey) || []).length) break;
        if (x + ',' + y === startKey) break;
      }
      // drop collinear points
      const simp = ring.filter((p, i) => { if (i === 0 || i === ring.length - 1) return true; const a = ring[i - 1], b = ring[i + 1]; return (p[0] - a[0]) * (b[1] - p[1]) !== (p[1] - a[1]) * (b[0] - p[0]); });
      if (simp.length >= 4) rings.push(simp);
    }
    return rings;
  }
  const signedArea = (ring) => { let s = 0; for (let i = 0; i < ring.length - 1; i++) s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]; return s / 2; };
  function pip(pt, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  /** Zone → MultiPolygon in WGS84 (RFC 7946 winding: outer counter-clockwise). */
  function zonePolygons(zr, grid) {
    const from = proj4(utmDefOf(grid.code), 'EPSG:4326');
    const toLL = ([c, r]) => { const [lng, lat] = from.forward([grid.gx0 + c * 10, grid.gy0 - r * 10]); return [+lng.toFixed(7), +lat.toFixed(7)]; };
    const out = [];
    for (let z = 0; z < zr.k; z++) {
      const rings = tracePolygons(zr.zone, grid.w, grid.h, z).map((r) => r.map(toLL));
      const outers = [], holes = [];
      rings.forEach((r) => (signedArea(r) < 0 ? outers : holes).push(r)); // pixel squares trace clockwise in lon/lat → outer
      const polys = outers.map((o) => [o.slice().reverse()]);
      holes.forEach((hl) => { const i = outers.findIndex((o) => pip(hl[0], o)); if (i >= 0) polys[i].push(hl.slice().reverse()); });
      out.push({ zone: z + 1, polygons: polys });
    }
    return out;
  }
  function utmDefOf(code) {
    return code > 32700 ? `+proj=utm +zone=${code - 32700} +south +datum=WGS84 +units=m +no_defs` : `+proj=utm +zone=${code - 32600} +datum=WGS84 +units=m +no_defs`;
  }

  // ------------------------------------------------------------ writers

  const JSZIP_URL = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
  function loadJsZip() {
    if (window.JSZip) return Promise.resolve(window.JSZip);
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = JSZIP_URL; s.onload = () => res(window.JSZip); s.onerror = () => rej(new Error('Could not load the zip writer')); document.head.appendChild(s); });
  }
  const WGS84_PRJ = 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';

  /** features: [{ type: 'polygon', polygons: [[ring...]...] } | { type: 'point', xy: [lng, lat] }], props: [{...}], fields: [[name, 'N'|'C', len, dec]] */
  function writeShapefile(features, props, fields) {
    const isPoint = features[0].type === 'point';
    const recs = features.map((f) => {
      if (isPoint) { const b = new ArrayBuffer(20); const v = new DataView(b); v.setInt32(0, 1, true); v.setFloat64(4, f.xy[0], true); v.setFloat64(12, f.xy[1], true); return { buf: b, box: [f.xy[0], f.xy[1], f.xy[0], f.xy[1]] }; }
      // shapefile: outer rings clockwise, holes counter-clockwise (opposite of GeoJSON)
      const rings = f.polygons.flatMap((poly) => poly.map((r) => r.slice().reverse()));
      const pts = rings.flat(); const nParts = rings.length, nPts = pts.length;
      const b = new ArrayBuffer(44 + 4 * nParts + 16 * nPts); const v = new DataView(b);
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      v.setInt32(0, 5, true); box.forEach((x, i) => v.setFloat64(4 + i * 8, x, true));
      v.setInt32(36, nParts, true); v.setInt32(40, nPts, true);
      let o = 44, idx = 0; rings.forEach((r) => { v.setInt32(o, idx, true); o += 4; idx += r.length; });
      pts.forEach((p) => { v.setFloat64(o, p[0], true); v.setFloat64(o + 8, p[1], true); o += 16; });
      return { buf: b, box };
    });
    const all = recs.reduce((a, r) => [Math.min(a[0], r.box[0]), Math.min(a[1], r.box[1]), Math.max(a[2], r.box[2]), Math.max(a[3], r.box[3])], [Infinity, Infinity, -Infinity, -Infinity]);
    const header = (len) => { const b = new ArrayBuffer(100); const v = new DataView(b); v.setInt32(0, 9994, false); v.setInt32(24, len / 2, false); v.setInt32(28, 1000, true); v.setInt32(32, isPoint ? 1 : 5, true); all.forEach((x, i) => v.setFloat64(36 + i * 8, x, true)); return new Uint8Array(b); };
    const shpLen = 100 + recs.reduce((s, r) => s + 8 + r.buf.byteLength, 0);
    const shp = new Uint8Array(shpLen); shp.set(header(shpLen), 0);
    const shx = new Uint8Array(100 + 8 * recs.length); shx.set(header(shx.length), 0);
    let off = 100;
    recs.forEach((r, i) => {
      const hv = new DataView(shp.buffer, off, 8); hv.setInt32(0, i + 1, false); hv.setInt32(4, r.buf.byteLength / 2, false);
      shp.set(new Uint8Array(r.buf), off + 8);
      const xv = new DataView(shx.buffer, 100 + i * 8, 8); xv.setInt32(0, off / 2, false); xv.setInt32(4, r.buf.byteLength / 2, false);
      off += 8 + r.buf.byteLength;
    });
    // dbf
    const recLen = 1 + fields.reduce((s, f) => s + f[2], 0), hdrLen = 32 + 32 * fields.length + 1;
    const dbf = new Uint8Array(hdrLen + recLen * props.length + 1).fill(0x20); const dv = new DataView(dbf.buffer);
    dbf.fill(0, 0, hdrLen);
    const d = new Date(); dv.setUint8(0, 3); dv.setUint8(1, d.getFullYear() - 1900); dv.setUint8(2, d.getMonth() + 1); dv.setUint8(3, d.getDate());
    dv.setUint32(4, props.length, true); dv.setUint16(8, hdrLen, true); dv.setUint16(10, recLen, true); dv.setUint8(29, 0x57);
    const enc = new TextEncoder();
    fields.forEach(([name, type, len, dec], i) => {
      const o = 32 + i * 32; dbf.set(enc.encode(name.slice(0, 10)), o); dv.setUint8(o + 11, type.charCodeAt(0)); dv.setUint8(o + 16, len); dv.setUint8(o + 17, dec || 0);
    });
    dv.setUint8(hdrLen - 1, 0x0d);
    props.forEach((p, ri) => {
      let o = hdrLen + ri * recLen; dbf[o++] = 0x20;
      fields.forEach(([name, type, len, dec]) => {
        const v = p[name];
        let s = v == null ? '' : type === 'N' ? (+v).toFixed(dec || 0) : String(v);
        let bytes = enc.encode(s); if (bytes.length > len) bytes = bytes.slice(0, len);
        if (type === 'N') dbf.set(bytes, o + len - bytes.length); else dbf.set(bytes, o);
        o += len;
      });
    });
    dbf[dbf.length - 1] = 0x1a;
    return { shp, shx, dbf, prj: WGS84_PRJ, cpg: 'UTF-8' };
  }

  async function zipShapefile(base, parts) {
    const JSZip = await loadJsZip(); const z = new JSZip();
    z.file(base + '.shp', parts.shp); z.file(base + '.shx', parts.shx); z.file(base + '.dbf', parts.dbf);
    z.file(base + '.prj', parts.prj); z.file(base + '.cpg', parts.cpg);
    return z.generateAsync({ type: 'blob' });
  }

  function download(name, blob) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  }
  const safe = (s) => String(s || 'map').replace(/[^\w-]+/g, '_').slice(0, 40);
  const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

  function isoxml(field, rx) {
    const ddi = rx.unit === 'L/ha' ? 1 : rx.unit === 'seeds/ha' ? 11 : 6;
    const scale = ddi === 1 ? 10000 : ddi === 11 ? 0.1 : 100;  // L/ha → mm³/m² @0.01 · seeds/ha → /m² @0.001 · kg/ha → mg/m²
    const ddiHex = ddi.toString(16).toUpperCase().padStart(4, '0');
    const lsg = (ring, a) => `<LSG A="${a}">${ring.map(([lng, lat]) => `<PNT A="2" C="${lat.toFixed(9)}" D="${lng.toFixed(9)}"/>`).join('')}</LSG>`;
    const boundary = (field.geometry.type === 'Polygon' ? [field.geometry.coordinates] : field.geometry.coordinates)
      .map((poly) => `<PLN A="1">${poly.map((r, i) => lsg(r, i ? 2 : 1)).join('')}</PLN>`).join('');
    const zonesXml = rx.polys.map((zp) => {
      const z = rx.zones[zp.zone - 1];
      return `<TZN A="${zp.zone}" B="Zone ${zp.zone}"><PDV A="${ddiHex}" B="${Math.round(z.rate * scale)}" C="PDT1"/>${zp.polygons.map((poly) => `<PLN A="2">${poly.map((r, i) => lsg(r, i ? 2 : 1)).join('')}</PLN>`).join('')}</TZN>`;
    }).join('');
    return `<?xml version="1.0" encoding="UTF-8"?>
<ISO11783_TaskData VersionMajor="3" VersionMinor="3" ManagementSoftwareManufacturer="AgroOne" ManagementSoftwareVersion="1.0" DataTransferOrigin="1">
<CTR A="CTR1" B="${xml(state.farms.find((f) => f.id === state.selectedFarmId)?.name || 'Customer')}"/>
<FRM A="FRM1" B="${xml(state.farms.find((f) => f.id === state.selectedFarmId)?.name || 'Farm')}" I="CTR1"/>
<PDT A="PDT1" B="${xml(rx.product)}"/>
<PFD A="PFD1" C="${xml(field.name)}" D="${Math.round(field.areaHectares * 10000)}" E="CTR1" F="FRM1">${boundary}</PFD>
<TSK A="TSK1" B="${xml(rx.title + ' ' + field.name)}" C="CTR1" D="FRM1" E="PFD1" G="1" H="1">${zonesXml}</TSK>
</ISO11783_TaskData>`;
  }

  // ------------------------------------------------------------ map layers

  let zoneLayer = null, outlineLayer = null, sampleLayer = null;
  function clearMap() {
    [zoneLayer, outlineLayer, sampleLayer].forEach((l) => l && mapInstance.removeLayer(l));
    zoneLayer = outlineLayer = sampleLayer = null;
  }
  function ensurePane() {
    if (!mapInstance.getPane('vra')) { const p = mapInstance.createPane('vra'); p.style.zIndex = 408; }
  }
  function paintZones(zr, grid, opacity) {
    ensurePane();
    const c = document.createElement('canvas'); c.width = grid.w; c.height = grid.h;
    const ctx = c.getContext('2d'); const im = ctx.createImageData(grid.w, grid.h);
    const rgb = ZONE_COLORS.map((h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
    for (let i = 0; i < grid.w * grid.h; i++) {
      const z = zr.zone[i]; if (z < 0) continue;
      const col = rgb[Math.round((z * (ZONE_COLORS.length - 1)) / Math.max(1, zr.k - 1))];
      im.data.set([col[0], col[1], col[2], 255], i * 4);
    }
    ctx.putImageData(im, 0, 0);
    if (zoneLayer) mapInstance.removeLayer(zoneLayer);
    zoneLayer = L.imageOverlay(c.toDataURL(), grid.bounds, { pane: 'vra', className: 'img-px', opacity, interactive: false }).addTo(mapInstance);
  }
  document.addEventListener('shell:view', (e) => { if (!String(e.detail).startsWith('vra') && e.detail !== 'soil-sampling') clearMap(); });

  // ------------------------------------------------------------ VRA view

  const vs = {};  // per view type state
  function fieldOptions(sel) {
    return (state.fieldList || []).map((f) => `<option value="${f.id}" ${f.id === sel ? 'selected' : ''}>${escapeHtml(f.name)} · ${formatHa(f.areaHectares)}</option>`).join('');
  }
  function clearScenes(field, n) {
    const img = I(); const cur = img.current();
    return img.state.scenes.filter((s) => s.covers && (!cur || s.tile === cur.tile) && s.tileCloud < 40).slice().sort((a, b) => a.tileCloud - b.tileCloud).slice(0, n);
  }

  function renderVra(type) {
    return (el) => {
      const T = TYPES[type]; const img = I();
      const st = vs[type] || (vs[type] = { fieldId: null, zones: 3, method: 'kmeans', minHa: 0.1, opacity: 0.8, index: 'ndvi', dates: 6, layers: [], unit: T.unit, product: T.product, avg: T.avg, spread: 20, strategy: T.strategy, flat: T.avg, price: 0, result: null });
      const list = state.fieldList || [];
      if (!list.length) { el.innerHTML = '<p class="text-[13px] text-gray-500">Add fields first</p>'; return; }
      if (!st.fieldId || !list.some((f) => f.id === st.fieldId)) st.fieldId = (window.FieldPanel && FieldPanel.fieldId) || list[0].id;
      const cur = img && img.current();
      const sameTile = img ? img.state.scenes.filter((s) => s.tileCloud < 80 && (!cur || s.tile === cur.tile)) : [];
      if (type === 'vra-builder' && !st.layers.length && cur) st.layers = [{ sceneId: cur.id, index: 'ndvi', weight: 100 }];
      el.innerHTML = `
        <div class="mt-4 space-y-3">
          <div><label class="fp-label">Field</label><select id="vraField" class="fp-input">${fieldOptions(st.fieldId)}</select></div>
          ${T.source === 'date' ? `
            <div class="grid grid-cols-2 gap-3">
              <div><label class="fp-label">Image date</label><div class="num flex h-9 items-center rounded-lg bg-gray-50 px-2.5 font-mono text-[12px] text-gray-900">${cur ? fmtDay(cur.day) : 'Pick on timeline'}</div></div>
              <div><label class="fp-label">Index</label><select id="vraIndex" class="fp-input">${['ndvi', 'ndre', 'reci', 'msavi'].map((k) => `<option value="${k}" ${k === st.index ? 'selected' : ''}>${img.indices[k].label}</option>`).join('')}</select></div>
            </div>` : ''}
          ${T.source === 'productivity' ? `
            <div><label class="fp-label" for="vraDates">Dates</label>
              <select id="vraDates" class="fp-input">${[3, 6, 10, 16].map((n) => `<option value="${n}" ${n === st.dates ? 'selected' : ''}>${n} clearest NDVI dates</option>`).join('')}</select></div>` : ''}
          ${T.source === 'builder' ? `
            <div><label class="fp-label">Layers (up to 5)</label>
              <div id="vraLayers" class="space-y-2">${st.layers.map((Lr, i) => `
                <div class="grid grid-cols-[1fr_84px_56px_24px] items-center gap-1.5">
                  <select data-l="${i}" data-k="sceneId" class="fp-input !h-8 !text-[12px]">${sameTile.map((s) => `<option value="${s.id}" ${s.id === Lr.sceneId ? 'selected' : ''}>${fmtDay(s.day)}</option>`).join('')}</select>
                  <select data-l="${i}" data-k="index" class="fp-input !h-8 !text-[12px]">${['ndvi', 'ndre', 'msavi', 'reci', 'ndmi'].map((k) => `<option value="${k}" ${k === Lr.index ? 'selected' : ''}>${img.indices[k].label}</option>`).join('')}</select>
                  <input data-l="${i}" data-k="weight" type="number" min="0" max="100" value="${Lr.weight}" class="fp-input num !h-8 !text-[12px]" title="Weight %"/>
                  <button type="button" data-rm="${i}" class="text-gray-400 hover:text-red-600" title="Remove">${icon('x')}</button>
                </div>`).join('')}</div>
              ${st.layers.length < 5 ? '<button type="button" id="vraAddLayer" class="mt-2 text-[12px] font-medium text-brand-700">Add layer</button>' : ''}</div>` : ''}
          <div class="grid grid-cols-3 gap-3">
            <div><label class="fp-label">Zones</label><select id="vraZones" class="fp-input">${[2, 3, 4, 5, 6, 7].map((n) => `<option ${n === st.zones ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
            <div><label class="fp-label">Method</label><select id="vraMethod" class="fp-input !px-1.5 !text-[12px]"><option value="kmeans" ${st.method === 'kmeans' ? 'selected' : ''}>K-means</option><option value="quantile" ${st.method === 'quantile' ? 'selected' : ''}>Equal area</option></select></div>
            <div><label class="fp-label">Min zone, ha</label><input id="vraMin" type="number" step="0.05" min="0" value="${st.minHa}" class="fp-input num"/></div>
          </div>
          <button type="button" id="vraCalc" class="fp-btn w-full">Calculate</button>
        </div>
        <div id="vraOut" class="mt-5"></div>`;
      const $ = (id) => el.querySelector('#' + id);
      $('vraField').addEventListener('change', (e) => { st.fieldId = e.target.value; st.result = null; clearMap(); renderVra(type)(el); });
      if ($('vraIndex')) $('vraIndex').addEventListener('change', (e) => { st.index = e.target.value; });
      if ($('vraDates')) $('vraDates').addEventListener('change', (e) => { st.dates = +e.target.value; });
      $('vraZones').addEventListener('change', (e) => { st.zones = +e.target.value; });
      $('vraMethod').addEventListener('change', (e) => { st.method = e.target.value; });
      $('vraMin').addEventListener('change', (e) => { st.minHa = Math.max(0, +e.target.value || 0); });
      el.querySelectorAll('[data-l]').forEach((inp) => inp.addEventListener('change', () => { const Lr = st.layers[+inp.dataset.l]; Lr[inp.dataset.k] = inp.dataset.k === 'weight' ? +inp.value : inp.value; }));
      el.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { st.layers.splice(+b.dataset.rm, 1); renderVra(type)(el); }));
      if ($('vraAddLayer')) $('vraAddLayer').addEventListener('click', () => { st.layers.push({ sceneId: (sameTile[1] || sameTile[0] || {}).id, index: 'ndre', weight: 50 }); renderVra(type)(el); });
      $('vraCalc').addEventListener('click', () => calculate(type, el));
      if (st.result) drawResult(type, el);
    };
  }

  async function calculate(type, el) {
    const T = TYPES[type], st = vs[type], img = I();
    const out = el.querySelector('#vraOut');
    const field = state.fieldsById.get(st.fieldId);
    const meta = (state.fieldList || []).find((f) => f.id === st.fieldId);
    if (!field || !img) return;
    let layers;
    if (T.source === 'date') { const s = img.current(); if (!s) { out.innerHTML = errBox('Pick an image date on the timeline first'); return; } layers = [{ scene: s, indexKey: st.index, weight: 1 }]; }
    else if (T.source === 'productivity') { layers = clearScenes(field, st.dates).map((s) => ({ scene: s, indexKey: 'ndvi', weight: 1 })); if (!layers.length) { out.innerHTML = errBox('No clear dates in this period. Widen the period from the timeline calendar'); return; } }
    else { layers = st.layers.filter((Lr) => Lr.weight > 0 && img.sceneById(Lr.sceneId)).map((Lr) => ({ scene: img.sceneById(Lr.sceneId), indexKey: Lr.index, weight: Lr.weight })); if (!layers.length) { out.innerHTML = errBox('Add at least one layer with a weight'); return; } }
    try {
      const src = await combine(field, layers, (t) => { out.innerHTML = status(t); });
      out.innerHTML = status('Building zones');
      const zr = zoneGrid(src, { zones: st.zones, method: st.method, minHa: st.minHa });
      const polys = zonePolygons(zr, src.grid);
      st.result = { field: { ...field, name: meta ? meta.name : field.name, areaHectares: meta ? meta.areaHectares : field.areaHectares }, src, zr, polys, used: src.used };
      distribute(st);
      drawResult(type, el);
      mapInstance.fitBounds(L.latLngBounds(src.grid.bounds), { paddingTopLeft: [80, 80], paddingBottomRight: [40, 160], maxZoom: 16 });
    } catch (err) { out.innerHTML = errBox(img.friendly(err)); }
  }

  function distribute(st) {
    const zs = st.result.zr.stats; const k = zs.length;
    const sign = st.strategy === 'direct' ? 1 : st.strategy === 'inverse' ? -1 : 0;
    // zone 1 (highest) gets t = +1, last zone t = -1
    let rates = zs.map((_, i) => st.avg * (1 + sign * (st.spread / 100) * (k === 1 ? 0 : 1 - (2 * i) / (k - 1))));
    const ha = zs.reduce((s, z) => s + z.ha, 0);
    const mean = zs.reduce((s, z, i) => s + z.ha * rates[i], 0) / (ha || 1);
    rates = rates.map((r) => Math.max(0, (r * st.avg) / (mean || 1)));
    const round = st.unit === 'seeds/ha' ? 100 : 1;
    st.zones_ = zs.map((z, i) => ({ ...z, rate: Math.round(rates[i] / round) * round }));
  }

  function drawResult(type, el) {
    const T = TYPES[type], st = vs[type], R = st.result; const out = el.querySelector('#vraOut');
    paintZones(R.zr, R.src.grid, st.opacity);
    const zones = st.zones_;
    const totalHa = zones.reduce((s, z) => s + z.ha, 0);
    const total = zones.reduce((s, z) => s + z.ha * z.rate, 0);
    const flatTotal = st.flat * totalHa;
    const saved = flatTotal - total;
    const u = st.unit.split('/')[0];
    out.innerHTML = `
      <div class="space-y-4">
        <div class="flex items-center justify-between text-[12px] text-gray-500">
          <span>${R.used.length} layer${R.used.length > 1 ? 's' : ''} · ${R.used.map((x) => fmtDay(x.scene.day).replace(/ \d{4}$/, '')).join(', ')}</span>
          <label class="flex items-center gap-2">Opacity<input id="vraOpacity" type="range" min="0.2" max="1" step="0.05" value="${st.opacity}" class="w-20 accent-brand-600"/></label>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="fp-label">Product</label><input id="vraProduct" class="fp-input" maxlength="40" value="${escapeHtml(st.product)}"/></div>
          <div><label class="fp-label">Unit</label><select id="vraUnit" class="fp-input">${UNITS.map((x) => `<option ${x === st.unit ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
        </div>
        <div class="rounded-lg bg-gray-50 p-3">
          <div class="text-[12px] font-medium text-gray-500">Distribute from an average</div>
          <div class="mt-2 grid grid-cols-[1fr_72px] gap-2">
            <input id="vraAvg" type="number" min="0" step="any" value="${st.avg}" class="fp-input num" title="Average rate"/>
            <input id="vraSpread" type="number" min="0" max="100" value="${st.spread}" class="fp-input num" title="Spread between zones, %"/>
          </div>
          <div class="mt-2 flex rounded-md bg-gray-100 p-0.5 text-[12px]">${[['direct', 'More to strong'], ['inverse', 'More to weak'], ['flat', 'Flat']].map(([k, l]) => `<button type="button" data-strat="${k}" class="h-7 flex-1 rounded ${st.strategy === k ? 'bg-white text-gray-900' : 'text-gray-500'}">${l}</button>`).join('')}</div>
        </div>
        <table class="num w-full text-[12px]">
          <thead><tr class="text-left text-gray-500"><th class="pb-2 font-medium">Zone</th><th class="pb-2 text-right font-medium">Area</th><th class="pb-2 text-right font-medium">Index</th><th class="pb-2 pl-2 text-right font-medium">Rate, ${escapeHtml(st.unit)}</th></tr></thead>
          <tbody>${zones.map((z, i) => `<tr class="border-t border-gray-100">
            <td class="py-1.5"><span class="flex items-center gap-2"><span class="h-3 w-3 rounded-sm" style="background:${zoneColor(i, zones.length)}"></span>${z.zone}</span></td>
            <td class="py-1.5 text-right font-mono text-gray-600">${formatHa(z.ha)}</td>
            <td class="py-1.5 text-right font-mono text-gray-600">${z.mean.toFixed(2)}</td>
            <td class="py-1.5 pl-2"><input data-rate="${i}" type="number" min="0" step="any" value="${z.rate}" class="fp-input num !h-8 !w-24 text-right !text-[12px] ml-auto block"/></td>
          </tr>`).join('')}</tbody>
        </table>
        <div class="rounded-lg bg-gray-50 p-3 text-[12px]">
          <div class="flex justify-between"><span class="text-gray-500">Total ${escapeHtml(st.product)}</span><span class="num font-mono text-gray-900">${Math.round(total).toLocaleString('en-US')} ${escapeHtml(u)}</span></div>
          <div class="mt-1 flex justify-between"><span class="text-gray-500">Average</span><span class="num font-mono text-gray-900">${(total / (totalHa || 1)).toFixed(1)} ${escapeHtml(st.unit)}</span></div>
          <div class="mt-3 grid grid-cols-2 gap-2">
            <div><label class="fp-label">Flat rate to compare</label><input id="vraFlat" type="number" min="0" step="any" value="${st.flat}" class="fp-input num"/></div>
            <div><label class="fp-label">Price per ${escapeHtml(u)}</label><input id="vraPrice" type="number" min="0" step="any" value="${st.price}" class="fp-input num"/></div>
          </div>
          <div class="mt-2 flex justify-between"><span class="text-gray-500">${saved >= 0 ? 'Saved' : 'Extra'} vs flat rate</span><span class="num font-mono ${saved >= 0 ? 'text-brand-700' : 'text-amber-700'}">${Math.round(Math.abs(saved)).toLocaleString('en-US')} ${escapeHtml(u)}${st.price ? ` · ${(Math.abs(saved) * st.price).toLocaleString('en-US', { maximumFractionDigits: 0 })}` : ''}</span></div>
        </div>
        <div>
          <div class="fp-h">Export</div>
          <div class="grid grid-cols-2 gap-2">
            <button type="button" data-exp="shp" class="fp-ghost">Shapefile</button>
            <button type="button" data-exp="iso" class="fp-ghost">ISO-XML</button>
            <button type="button" data-exp="geojson" class="fp-ghost">GeoJSON</button>
            <button type="button" data-exp="kml" class="fp-ghost">KML</button>
          </div>
          <p class="mt-2 text-[11px] leading-4 text-gray-400">Zone polygons in WGS84 with ZONE, RATE, UNIT, AREA_HA and PRODUCT. ISO-XML uses DDI ${st.unit === 'L/ha' ? '1 (L/ha × 10000)' : st.unit === 'seeds/ha' ? '11 (seeds/ha × 0.1)' : '6 (kg/ha × 100)'}; check it on your terminal before the first field run</p>
        </div>
      </div>`;
    const q = (id) => out.querySelector('#' + id);
    q('vraOpacity').addEventListener('input', (e) => { st.opacity = +e.target.value; if (zoneLayer) zoneLayer.setOpacity(st.opacity); });
    q('vraProduct').addEventListener('change', (e) => { st.product = e.target.value || 'Product'; drawResult(type, el); });
    q('vraUnit').addEventListener('change', (e) => { st.unit = e.target.value; distribute(st); drawResult(type, el); });
    q('vraAvg').addEventListener('change', (e) => { st.avg = Math.max(0, +e.target.value || 0); st.flat = st.avg; distribute(st); drawResult(type, el); });
    q('vraSpread').addEventListener('change', (e) => { st.spread = Math.max(0, Math.min(100, +e.target.value || 0)); distribute(st); drawResult(type, el); });
    out.querySelectorAll('[data-strat]').forEach((b) => b.addEventListener('click', () => { st.strategy = b.dataset.strat; distribute(st); drawResult(type, el); }));
    out.querySelectorAll('[data-rate]').forEach((inp) => inp.addEventListener('change', () => { st.zones_[+inp.dataset.rate].rate = Math.max(0, +inp.value || 0); drawResult(type, el); }));
    q('vraFlat').addEventListener('change', (e) => { st.flat = Math.max(0, +e.target.value || 0); drawResult(type, el); });
    q('vraPrice').addEventListener('change', (e) => { st.price = Math.max(0, +e.target.value || 0); drawResult(type, el); });
    out.querySelectorAll('[data-exp]').forEach((b) => b.addEventListener('click', () => exportRx(type, b.dataset.exp)));
    // outlines
    if (outlineLayer) mapInstance.removeLayer(outlineLayer);
    outlineLayer = L.geoJSON(rxGeoJSON(type), { pane: 'vra', style: { color: '#ffffff', weight: 1, opacity: 0.7, fillOpacity: 0 },
      onEachFeature: (f, l) => l.bindTooltip(`Zone ${f.properties.ZONE} · ${f.properties.AREA_HA} ha · ${f.properties.RATE} ${f.properties.UNIT}`, { sticky: true }) }).addTo(mapInstance);
  }

  function rxGeoJSON(type) {
    const st = vs[type], R = st.result;
    return { type: 'FeatureCollection', features: R.polys.filter((p) => p.polygons.length).map((p) => {
      const z = st.zones_[p.zone - 1];
      return { type: 'Feature', properties: { ZONE: p.zone, RATE: z.rate, UNIT: st.unit, AREA_HA: +z.ha.toFixed(2), PRODUCT: st.product },
        geometry: { type: 'MultiPolygon', coordinates: p.polygons } };
    }) };
  }

  async function exportRx(type, fmt) {
    const T = TYPES[type], st = vs[type], R = st.result;
    const base = safe(`${T.title}_${R.field.name}`);
    try {
      const fc = rxGeoJSON(type);
      if (fmt === 'geojson') return download(base + '.geojson', new Blob([JSON.stringify(fc)], { type: 'application/geo+json' }));
      if (fmt === 'kml') {
        const k = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${xml(base)}</name>${fc.features.map((f, i) => `<Placemark><name>Zone ${f.properties.ZONE}</name><Style><PolyStyle><color>99${zoneColor(i, fc.features.length).slice(5, 7)}${zoneColor(i, fc.features.length).slice(3, 5)}${zoneColor(i, fc.features.length).slice(1, 3)}</color></PolyStyle></Style><ExtendedData>${Object.entries(f.properties).map(([kk, v]) => `<Data name="${kk}"><value>${xml(v)}</value></Data>`).join('')}</ExtendedData><MultiGeometry>${f.geometry.coordinates.map((poly) => `<Polygon>${poly.map((r, j) => `<${j ? 'innerBoundaryIs' : 'outerBoundaryIs'}><LinearRing><coordinates>${r.map((p) => p.join(',')).join(' ')}</coordinates></LinearRing></${j ? 'innerBoundaryIs' : 'outerBoundaryIs'}>`).join('')}</Polygon>`).join('')}</MultiGeometry></Placemark>`).join('')}</Document></kml>`;
        return download(base + '.kml', new Blob([k], { type: 'application/vnd.google-earth.kml+xml' }));
      }
      if (fmt === 'shp') {
        const parts = writeShapefile(fc.features.map((f) => ({ type: 'polygon', polygons: f.geometry.coordinates })), fc.features.map((f) => f.properties),
          [['ZONE', 'N', 4, 0], ['RATE', 'N', 14, 2], ['UNIT', 'C', 10], ['AREA_HA', 'N', 12, 2], ['PRODUCT', 'C', 40]]);
        return download(base + '_shp.zip', await zipShapefile(base, parts));
      }
      if (fmt === 'iso') {
        const JSZip = await loadJsZip(); const z = new JSZip();
        z.file('TASKDATA/TASKDATA.XML', isoxml(R.field, { ...st, title: T.title, polys: R.polys, zones: st.zones_ }));
        return download(base + '_ISOXML.zip', await z.generateAsync({ type: 'blob' }));
      }
    } catch (err) { showError(err.message || 'Export failed'); }
  }

  Object.keys(TYPES).forEach((t) => Shell.register(t, { title: TYPES[t].title, render: renderVra(t) }));
  document.addEventListener('imagery:change', () => { if (['vra-vegetation', 'vra-builder'].includes(Shell.current) && !(vs[Shell.current] || {}).result) Shell.rerender(Shell.current); });

  // ------------------------------------------------------------ soil sampling

  const ss = { fieldId: null, method: 'grid', cellHa: 2.5, perZone: 2, zones: 3, points: null };
  function interiorDistance(mask, w, h) {
    const d = new Int32Array(w * h).fill(-1); const q = [];
    for (let i = 0; i < w * h; i++) {
      if (!mask[i]) { d[i] = 0; continue; }
      const r = Math.floor(i / w), c = i % w;
      if (r === 0 || c === 0 || r === h - 1 || c === w - 1 || !mask[i - 1] || !mask[i + 1] || !mask[i - w] || !mask[i + w]) { d[i] = 1; q.push(i); }
    }
    for (let qi = 0; qi < q.length; qi++) {
      const i = q[qi], r = Math.floor(i / w), c = i % w;
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const rr = r + dr, cc = c + dc; if (rr < 0 || cc < 0 || rr >= h || cc >= w) continue; const j = rr * w + cc; if (d[j] === -1) { d[j] = d[i] + 1; q.push(j); } }
    }
    return d;
  }
  function pixelLL(grid, i) {
    const from = proj4(utmDefOf(grid.code), 'EPSG:4326');
    const [lng, lat] = from.forward([grid.gx0 + ((i % grid.w) + 0.5) * 10, grid.gy0 - (Math.floor(i / grid.w) + 0.5) * 10]);
    return [+lng.toFixed(7), +lat.toFixed(7)];
  }

  async function samplePoints(field, out) {
    const img = I();
    const scenes = clearScenes(field, 6);
    if (!scenes.length) throw new Error('No clear dates in this period to place points on the field grid');
    const src = await combine(field, scenes.map((s) => ({ scene: s, indexKey: 'ndvi', weight: 1 })), (t) => { out.innerHTML = status(t); });
    const g = src.grid, n = g.w * g.h;
    const pts = [];
    if (ss.method === 'grid') {
      const cell = Math.max(10, Math.round(Math.sqrt(ss.cellHa * 10000) / 10)); // cell size in pixels
      const dist = interiorDistance(g.inField, g.w, g.h);
      for (let r0 = 0; r0 < g.h; r0 += cell) for (let c0 = 0; c0 < g.w; c0 += cell) {
        let inside = 0, best = -1, bestScore = -Infinity;
        const cr = r0 + cell / 2, cc = c0 + cell / 2;
        for (let r = r0; r < Math.min(g.h, r0 + cell); r++) for (let c = c0; c < Math.min(g.w, c0 + cell); c++) {
          const i = r * g.w + c; if (!g.inField[i]) continue; inside++;
          const score = Math.min(dist[i], 3) * 100 - Math.hypot(r - cr, c - cc);
          if (score > bestScore) { bestScore = score; best = i; }
        }
        if (inside >= 0.3 * cell * cell && best >= 0) pts.push({ i: best, zone: null, cell: `${Math.floor(r0 / cell) + 1}-${Math.floor(c0 / cell) + 1}` });
      }
    } else {
      const zr = zoneGrid(src, { zones: ss.zones, method: 'kmeans', minHa: 0.1 });
      for (let z = 0; z < zr.k; z++) {
        const mask = new Uint8Array(n); for (let i = 0; i < n; i++) mask[i] = zr.zone[i] === z ? 1 : 0;
        const dist = interiorDistance(mask, g.w, g.h);
        const cand = []; for (let i = 0; i < n; i++) if (mask[i] && dist[i] >= 2) cand.push(i);
        if (!cand.length) for (let i = 0; i < n; i++) if (mask[i]) cand.push(i);
        if (!cand.length) continue;
        // spread points: farthest-point sampling starting at the most interior pixel
        const chosen = [cand.reduce((a, b) => (dist[b] > dist[a] ? b : a))];
        while (chosen.length < Math.min(ss.perZone, cand.length)) {
          let best = cand[0], bd = -1;
          cand.forEach((i) => { const r = Math.floor(i / g.w), c = i % g.w; const md = Math.min(...chosen.map((j) => Math.hypot(r - Math.floor(j / g.w), c - (j % g.w)))); if (md > bd) { bd = md; best = i; } });
          chosen.push(best);
        }
        chosen.forEach((i) => pts.push({ i, zone: z + 1 }));
      }
    }
    return pts.map((p, k) => { const [lng, lat] = pixelLL(g, p.i); return { id: 'S' + String(k + 1).padStart(2, '0'), lat, lng, zone: p.zone, cell: p.cell }; });
  }

  function renderSoil(el) {
    const list = state.fieldList || [];
    if (!list.length) { el.innerHTML = '<p class="text-[13px] text-gray-500">Add fields first</p>'; return; }
    if (!ss.fieldId || !list.some((f) => f.id === ss.fieldId)) ss.fieldId = (window.FieldPanel && FieldPanel.fieldId) || list[0].id;
    el.innerHTML = `
      <div class="mt-4 space-y-3">
        <div><label class="fp-label">Field</label><select id="ssField" class="fp-input">${fieldOptions(ss.fieldId)}</select></div>
        <div class="flex rounded-md bg-gray-100 p-0.5 text-[12px]">${[['grid', 'Grid'], ['zones', 'By zones']].map(([k, l]) => `<button type="button" data-m="${k}" class="h-7 flex-1 rounded ${ss.method === k ? 'bg-white text-gray-900' : 'text-gray-500'}">${l}</button>`).join('')}</div>
        ${ss.method === 'grid'
          ? `<div><label class="fp-label">Cell size</label><select id="ssCell" class="fp-input">${[1, 2, 2.5, 5].map((v) => `<option value="${v}" ${v === ss.cellHa ? 'selected' : ''}>${v} ha${v === 1 ? ' (about 2.5 ac)' : ''}</option>`).join('')}</select></div>`
          : `<div class="grid grid-cols-2 gap-3"><div><label class="fp-label">Zones</label><select id="ssZones" class="fp-input">${[2, 3, 4, 5].map((v) => `<option ${v === ss.zones ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
             <div><label class="fp-label">Points per zone</label><select id="ssPer" class="fp-input">${[1, 2, 3, 4, 5].map((v) => `<option ${v === ss.perZone ? 'selected' : ''}>${v}</option>`).join('')}</select></div></div>`}
        <button type="button" id="ssCalc" class="fp-btn w-full">Create sampling map</button>
      </div>
      <div id="ssOut" class="mt-5"></div>`;
    const $ = (id) => el.querySelector('#' + id);
    $('ssField').addEventListener('change', (e) => { ss.fieldId = e.target.value; ss.points = null; clearMap(); renderSoil(el); });
    el.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => { ss.method = b.dataset.m; renderSoil(el); }));
    if ($('ssCell')) $('ssCell').addEventListener('change', (e) => { ss.cellHa = +e.target.value; });
    if ($('ssZones')) $('ssZones').addEventListener('change', (e) => { ss.zones = +e.target.value; });
    if ($('ssPer')) $('ssPer').addEventListener('change', (e) => { ss.perZone = +e.target.value; });
    $('ssCalc').addEventListener('click', async () => {
      const out = $('ssOut');
      try {
        const field = state.fieldsById.get(ss.fieldId);
        ss.points = await samplePoints(field, out);
        drawSoil(el);
      } catch (err) { out.innerHTML = errBox(I().friendly(err)); }
    });
    if (ss.points) drawSoil(el);
  }

  function drawSoil(el) {
    const out = el.querySelector('#ssOut'); const pts = ss.points;
    if (sampleLayer) mapInstance.removeLayer(sampleLayer);
    ensurePane();
    sampleLayer = L.layerGroup(pts.map((p) => L.marker([p.lat, p.lng], { pane: 'vra', icon: L.divIcon({ className: '', html: `<div style="transform:translate(-50%,-50%);background:#111827;color:#fff;border:2px solid #fff;border-radius:999px;padding:1px 6px;font:500 11px ui-monospace,monospace;white-space:nowrap">${p.id}</div>` }) }))).addTo(mapInstance);
    const field = (state.fieldList || []).find((f) => f.id === ss.fieldId);
    out.innerHTML = `
      <div class="flex items-center justify-between text-[12px] text-gray-500"><span>${pts.length} points · ${field ? formatHa(field.areaHectares) : ''}</span><span>${ss.method === 'grid' ? `${ss.cellHa} ha grid` : `${ss.zones} zones`}</span></div>
      <div class="mt-2 max-h-56 divide-y divide-gray-100 overflow-y-auto">${pts.map((p) => `<button type="button" data-p="${p.id}" class="num flex w-full justify-between py-1.5 text-left font-mono text-[12px]"><span class="text-gray-900">${p.id}${p.zone ? ` · zone ${p.zone}` : ''}</span><span class="text-gray-500">${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}</span></button>`).join('')}</div>
      <div class="mt-4 grid grid-cols-2 gap-2">
        <button type="button" data-sx="gpx" class="fp-ghost">GPX</button><button type="button" data-sx="kml" class="fp-ghost">KML</button>
        <button type="button" data-sx="csv" class="fp-ghost">CSV</button><button type="button" data-sx="shp" class="fp-ghost">Shapefile</button>
      </div>`;
    out.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => { const p = pts.find((x) => x.id === b.dataset.p); mapInstance.setView([p.lat, p.lng], 17); }));
    out.querySelectorAll('[data-sx]').forEach((b) => b.addEventListener('click', async () => {
      const base = safe(`soil_sampling_${field ? field.name : 'field'}`);
      const f = b.dataset.sx;
      if (f === 'csv') return window.downloadCsv(base + '.csv', [['id', 'lat', 'lng', 'zone', 'cell']].concat(pts.map((p) => [p.id, p.lat, p.lng, p.zone || '', p.cell || ''])));
      if (f === 'gpx') return download(base + '.gpx', new Blob([`<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="AgroOne" xmlns="http://www.topografix.com/GPX/1/1">${pts.map((p) => `<wpt lat="${p.lat}" lon="${p.lng}"><name>${p.id}</name>${p.zone ? `<desc>Zone ${p.zone}</desc>` : ''}</wpt>`).join('')}</gpx>`], { type: 'application/gpx+xml' }));
      if (f === 'kml') return download(base + '.kml', new Blob([`<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>${pts.map((p) => `<Placemark><name>${p.id}</name>${p.zone ? `<description>Zone ${p.zone}</description>` : ''}<Point><coordinates>${p.lng},${p.lat}</coordinates></Point></Placemark>`).join('')}</Document></kml>`], { type: 'application/vnd.google-earth.kml+xml' }));
      if (f === 'shp') {
        const parts = writeShapefile(pts.map((p) => ({ type: 'point', xy: [p.lng, p.lat] })), pts.map((p) => ({ ID: p.id, ZONE: p.zone || 0, CELL: p.cell || '' })), [['ID', 'C', 8], ['ZONE', 'N', 4, 0], ['CELL', 'C', 10]]);
        return download(base + '_shp.zip', await zipShapefile(base, parts));
      }
    }));
  }
  Shell.register('soil-sampling', { title: 'Soil sampling', render: renderSoil });

  window.Vra = { zoneGrid, tracePolygons, zonePolygons, writeShapefile, isoxml, state: vs, soil: ss, combine };
})();
