---
name: agro-satellite-ndvi
description: How AgroCloud Vision reads Sentinel-2 in the browser (js/imagery.js) — the map timeline, source/index toolbar, indices (NDVI, NDRE, MSAVI, NDMI, ReCI, VMI, natural colour), SCL cloud masking with per-field cloud %, swipe between dates, per-field risks (NDVI change vs previous clear date), and the field Analytics tab (js/analytics.js) with value classes, compare/anomalies and season curve — plus offline testing with mock scenes. Use it for anything about satellite imagery, vegetation indices (NDVI, NDMI, NDRE), cloud masking, monitoring, anomalies, zones/VRA built on NDVI, or when imagery fails to load, looks wrong, or a new index/source must be added.
---

# Satellite imagery (indices, timeline, swipe, risks)

`js/imagery.js` is the engine and the map UI. Each screen (`views[0]`, plus
`views[1]` in split view) has its own timeline, Sentinel-2 / index toolbar,
legend, contrast and layers. It paints every field of the
farm for the selected date and index, then computes risks per field.
`js/analytics.js` renders the field's **Analytics** tab, plus Leaderboard,
Reports and Notifications from the same results. Everything
runs in the browser; the backend is not involved. That matters because Render's
free tier has 512 MB and sleeps when idle.

```
POST Earth Search /v1/search (intersects = field, last 150 days, tile cloud < 80%)
  → one scene per day: full coverage, then the field's main MGRS tile, then least cloud
  → geotiff.js fromUrl(asset) → read only the field window (HTTP Range)
      red, nir @10 m  ·  scl @20 m  ·  visual @10 m (true colour)
  → reflectance = DN·scale + offset → NDVI per pixel inside the polygon, SCL-masked
  → stats, 10 value classes, overlay per field in each view's `img` pane (z 395, under the outlines)
  → hover: UTM pixel lookup in each view's results → "Field · NDVI 0.85 · Dense vegetation" on both screens
  → risks: NDVI change vs the field's previous clear date on the same tile
     (high ≤ −0.10, low ≤ −0.03, no data when > 30% cloud) → chips, cards, leaderboard, notifications
```

Index formulas (reflectance; 20 m bands sampled on the 10 m grid):

| Index | Bands | Formula | Display range |
|---|---|---|---|
| NDVI | red, nir | (N−R)/(N+R) | 0 to 1 |
| NDRE | rededge1 (B05), nir08 (B8A) | (B8A−B05)/(B8A+B05) | 0 to 0.7 |
| MSAVI | red, nir | (2N+1−√((2N+1)²−8(N−R)))/2 | 0 to 1 |
| NDMI | nir08, swir16 | (B8A−B11)/(B8A+B11) | −0.4 to 0.6, brown→teal |
| ReCI | nir, rededge1 | N/RE − 1 | 0 to 8 |
| VMI | the above | RGB = MSAVI, NDRE, NDVI | composite |

EOS writes ReCI as N/Red − 1; it is treated as a typo for the red-edge form.

## Sources

| Source | Dates | Pixels |
|---|---|---|
| **Sentinel Hub** (default) | WFS `TYPENAMES=DSS2` (Sentinel-2 L2A), bbox in EPSG:3857 | one WMS GetMap per field: FLOAT32 GeoTIFF on the field's UTM 10 m grid. The evalscript returns B02 B03 B04 B05 B08 B8A B11 SCL and overrides the instance's layer. |
| **Earth Search** | STAC search | COG range reads |

- Sentinel Hub uses the configuration instance in `CONFIG.sentinelHub.instance`. An OGC instance ID is meant to be used from web pages. Never put an OAuth client secret in the frontend; that belongs in the backend's environment on Render.
- The instance must contain at least one layer. The layer name comes from GetCapabilities, preferring a layer named NDVI.
- If the chosen source cannot list dates, the other one is used automatically.
- The user's choice is kept in `localStorage.imgProvider` (`sh` / `es`) and can be changed in the dock's source select.
- Tests: `scripts/test_sentinelhub.py` with `SHMOCK=1`. The mock in `cdn_routes.py` serves capabilities, WFS and GetMap TIFFs.

Public API: `window.Imagery`:
- `analyse(field, scene, index)`, `compare(cur, prev)`;
- `current()` (main screen), `resultFor(fieldId)`, `riskFor(fieldId)`;
- `setSplit(on)`, `setProvider('sh'|'es')`, `provider()`, `views`, `labelFor(index, v)`, `showDelta`, `invalidate()`;
- events `imagery:change` (main), `imagery:change-b` (second screen) and `imagery:risks`.

All tunables are in `CONFIG` at the top of `js/imagery.js` (`Imagery.config`): collection, look-back, tile cloud threshold (50%, like EOS), risk thresholds, anomaly rule.

## Rules and why

- **Collection id is configurable** (`sentinel-2-c1-l2a`). Earth Search v2 renames it; change one line.
- **Reflectance comes from the asset's `raster:bands` scale/offset.** Without it, baseline ≥ 04.00 with the offset not applied means `(DN−1000)/10000`. Ignoring the 2022 offset pulls NDVI toward zero.
- **Cloud % is measured inside the field from SCL**, keeping classes 4/5/6/7. The tile's `eo:cloud_cover` describes 110 km and is shown only as `~x%` until the field is read.
- **Comparing two dates needs the same tile grid.** The date list prefers the field's dominant MGRS tile, and the compare list only offers dates on the same tile. `compare()` throws if windows differ.
- **Anomaly rule (starting values, tune per crop):** take ΔNDVI minus the field's median Δ, flag ≤ −0.10, skip edge pixels, keep 8-connected clusters ≥ 0.1 ha. No vendor publishes theirs; see the research report in `reports/`.
- **The season curve only uses dates with ≥ 60% clear pixels in the field**, up to 16 of the clearest.
- **NDVI colours are RdYlGn with fixed stops**; "Contrast" stretches P2–P98 within the field. Δ uses a diverging ramp, and flagged pixels are solid red.

## Offline test with mock scenes

`scripts/make-s2mock.mjs` writes four dates over the test pivots near
−102.33, 34.12, in UTM 13N on a real 10/20 m grid, with c1-l2a scale/offset
metadata:

All bands, including rededge1, nir08 and swir16 at 20 m, with a gentle NDVI gradient inside each pivot so zoning has continuous data.

| Date | What it contains |
|---|---|
| 15 Nov | a 7.07 ha stress patch (NDVI 0.42, NDMI 0.15) in Pivot 1 |
| 5 Nov | healthy |
| 26 Oct | cloud (SCL 9) over the west half of Pivot 1 |
| 16 Oct | early season |

Rasters are written as PNM, then `scripts/to-cog.js` lets GDAL add the
georeferencing and write tiled DEFLATE GeoTIFFs. Don't write test TIFFs with
geotiff.js's writer: its `StripByteCounts` is invalid, and even GDAL rejects
the files.

```bash
node make-s2mock.mjs $WORK/s2mock && node to-cog.js $WORK/s2mock   # run where gdal3.js/geotiff/proj4 are installed
```

Then run `test_shell.py` from the agro-workspace-testing skill with
`S2MOCK=$WORK/s2mock`. Expected values: Pivot 1 NDVI on 15 Nov 0.75, NDMI 0.34,
NDRE 0.52; anomaly 15 Nov vs 5 Nov about 7.05 ha in one area; four dates on the
timeline; risk chips "No risks 3".

## Not verified yet (do this once on the live site)

Whether Earth Search's STAC API and the `e84-earth-search-sentinel-data` bucket
send CORS headers and answer range requests from `alkamelgis.github.io`.

1. Open Monitoring on a real field.
2. If the panel says the browser cannot read the image, add a backend proxy route, or switch to the Copernicus Data Space Statistical API through a NestJS token proxy. The free quota is 10,000 processing units per month.

Landsat on Earth Search is requester-pays, so use Planetary Computer for Landsat.

## Adding an index

Add an entry to `INDICES` in `js/imagery.js` with its `bands` (asset names;
add aliases to `ASSET_ALIASES` if needed), `f(reflectances)`, `range` and `ramp`.
`readBand` handles any resolution; the index appears in the toolbar automatically.
Add the band to `make-s2mock.mjs` with a known value and assert it in `test_shell.py`.
