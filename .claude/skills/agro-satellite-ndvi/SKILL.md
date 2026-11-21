---
name: agro-satellite-ndvi
description: How AgroCloud Vision reads Sentinel-2 in the browser (js/imagery.js) — the map timeline, source/index toolbar, indices (NDVI, NDRE, MSAVI, NDMI, ReCI, VMI, natural colour), SCL cloud masking with per-field cloud %, swipe between dates, per-field risks (NDVI change vs previous clear date), and the field Analytics tab (js/analytics.js) with the date's value and value classes (compare and the season curve were removed from it on request: use swipe and the time series instead), sharpening to 5 m / 2.5 m with super-resolution models (js/superres.js) — plus offline testing with mock scenes. Use it for anything about satellite imagery, vegetation indices (NDVI, NDMI, NDRE), cloud masking, monitoring, anomalies, zones/VRA built on NDVI, super-resolution, higher resolution or 1 m requests, or when imagery fails to load, looks wrong, or a new index/source must be added.
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

## Time series (`js/timeseries.js`)

- **Opening:** the chart button `#tsBtn` sits in the map tools under the ruler. It opens `#tsPanel`, a 304 px drawer under the map: `#mapMain.ts-open` shortens `#mapRow`, then both maps are invalidated.
- **Data:**
  - `Imagery.searchScenes([field.geometry], 'ts:'+fieldId, lookback)`, filtered to the period, tile cloud < 70 %, and the scene covering the field;
  - `Imagery.analyse` with three workers;
  - only dates with the field ≤ 40 % cloudy are kept;
  - points arrive progressively and the status shows `done / total`.
- **Chart:** an SVG drawn by hand, consistent with the rest of the app:
  - the mean as a monotone cubic line (no overshoot) with a soft area fill, and the P10–P90 band at 8 %;
  - month ticks, with the year on January;
  - crop seasons (`/crops/by-field`) as labelled bands along the top;
  - weather from `/weather/field/:id/history` on a right axis: Temp is the daily mean as a 7-day running line, Rain is bars, Soil is the daily mean of hourly `soil_moisture_0_to_7cm`.
  - Weather stays dimmer than the index line, which leads.
- **Interaction:**
  - hovering shows a tooltip;
  - clicking a point calls `Imagery.showScene(scene)`, which also adds dates older than the timeline;
  - the strip below zooms: drag the window or its handles, double-click or use the reset button to show everything;
  - quick periods 3M / 6M / 1Y / 2Y; the period is at most 3 years;
  - CSV export: date, mean, P10, P90, cloud, temperature, rain, soil.
- **Tests:** `test_timeseries.py` (agro-workspace-testing) mocks the weather history route.

**Layers and chart types.** `#tsIndex` is a button with a checkbox menu (`#tsIndexMenu`, on `<body>` so the side column does not clip it); at least one layer stays ticked. Selection in `localStorage.tsIndices`, chart in `tsChart`.
- One colour per index, chosen for what it measures, never the UI accent: NDVI leaf `#7cc46a`, NDRE red-edge copper `#e08a5b`, MSAVI soil ochre `#d4b26a`, NDMI water `#5ea7e0`, ReCI chlorophyll teal `#4fb8a5`. 
- **Weather overlay = one clean line** (owner rejected bands, fills, bars and a separate panel as noisy): temperature terracotta (light `#c2511f`, dark `#f0894a`), rain blue (`#2f6fb3` / `#62a3dc`), soil moisture teal (`#167a73` / `#4cc3b0`), 1.6 px, round caps, over the index on the right axis. Smoothed with centred triangular weights over ±6 days: temperature and soil moisture = weekly mean, rain = weekly total (weighted mean × 7, mm per week). Right-axis numbers in the weather colour; legend says "weekly mean/total · unit, right axis". Tooltip still gives the day's own value.
- Points hold `v[index] = { mean, p10, p90 }` per date; cloud % is per date.
- Left axis = union of the selected indices' ranges. ReCI (0–8) next to other layers goes to the right axis and weather is disabled.
- `#tsChartType`: Area (default), Line, Bars (grouped per date), Points (with P10–P90 whiskers), Change (bars of the change since the previous clear date, zero line, signed ticks). The P10–P90 band shows only with one layer on Area/Line.

**Speed and motion.** Six workers read dates; all layers of one date are analysed together (shared band reads; `Imagery.analyse` caches by scene|field|index, so toggling a layer or the period reloads from cache).
- **No animation in the chart** (owner asked twice): lines, areas, band, points and bars are drawn as they are, including while dates still load (thin grey progress bar on top). Do not add sweeps, pops or grows back. Heatmap/3D views keep their entry motion.

**Views: chart / heatmap / 3D skyline / 3D ring** (`#tsModes`, `localStorage.tsMode`; heatmap and skyline in `js/ts-calendar.js`, registered as `window.TimeSeriesViews`, drawn into `#tsAlt` while `#tsSvg`, the zoom strip and the chart-type select hide).
- Day cells: week columns, weekday rows (Mon first). One layer at a time (first ticked, or the chip in the legend).
- Days between two clear dates are **linear estimates, drawn muted** and labelled "Estimated A – B" in the tooltip; days outside the first/last clear date are empty. Never present estimates as measurements.
- **Colours = the map's colours**: each cell uses the index's own ramp (`Imagery.rampAt(idx.ramp, …)`, e.g. NDVI red-yellow-green, BSI green-sand-umber). With the map's contrast on, the ramp spans the period's lowest to highest value; off, the index's fixed range. Legend shows the same gradient bar and numbers. Estimated days are the same colour mixed 45 % into the ground. Column height in 3D is relative to the period.
- **Linked to the map**: changing the index on the map switches the heatmap/skyline to it (if plotted); a layer chip in the heatmap legend switches the map's index. The date open on the map is outlined (`is-cur`, and a bright top edge in 3D). Clicking a clear day opens it on the map.
- Stats: Average (n clear dates), Peak, Lowest, Latest with change.
- Heatmap motion: cells settle in as a wave along time (col·9 + row·14 ms). Skyline (canvas, painter's order by rotated depth, only sides facing the viewer drawn): starts flat at 88°, tilts to 34° in 0.75 s while columns rise along time; drag turns (yaw), double-click eases back. Hover hit-tests the drawn polygons; click opens a clear date.
- **3D ring** (`ring` in ts-calendar.js, tab icon `donut`): the period wraps once around a circle like a centre pivot — week = sector clockwise from the top (small gap marks start/end), weekday = concentric ring (inner radius ≈ 1/Δθ − 3.5 so cells stay square), height and colour as the skyline, soft annulus floor, month names on the rim. Built as `Object.create(sky)`: inherits loop/hit/bind; drag turns 360°, double-click eases back to yaw 0. Only faces whose normal faces the viewer are drawn (outer/inner arcs, two radial sides), painter's order by rotated depth.
- Gotcha: `.ts-chart svg` is absolute and 100% high for the chart; the heatmap SVG needs inline width/height or it covers the top bar.
- Visual probe with a synthetic year: `agro-workspace-testing/scripts/probe_cal.py`.

**Several layers = categorical colours.** With 2+ layers plotted, index hues clash (NDVI, SAVI, EVI, GNDVI are all green), so `colorOf(k)` gives each plotted layer the next colour of a categorical palette in list order (light: blue, orange, green, red, brown, teal, olive, grey…; dark: lighter versions, 5th is warm white). Checked: min ΔE76 ≥ 26 between the first 8. Used by lines, points, bars, legend, layer button dots, menu swatches of ticked layers, tooltip, mini strip and heatmap chips. In this mode: no ramp colouring, no area fills (lines only), points only when ≤ 40 dates are in view (else only on the hovered date). One layer keeps its own ramp/hue.

**Coloured by the map's ramp, linked to the map.** With one plotted layer, it is coloured by value with its own ramp: the line stroke is a horizontal `linearGradient` (`#tsRamp-<k>`, userSpaceOnUse, one stop per date at its x), points/bars/whiskers take their value's colour; band and area turn neutral grey so only the data carries colour. Ramp range follows the map's contrast (period min–max) or the index range. Other plotted layers keep their identity colour. "Change" chart keeps identity colours.
- Map → chart: changing the map index switches a single plotted layer to it (adds it when several are plotted). Chart → map: clicking a legend key sets the map index. The map's class filter fades points/bars outside the chosen classes.
- Points on Line/Area: radius 2.2, stroke 1.25 (owner asked for smaller); fixed size, no hover growth or transitions (hover only fills the point). Points chart (scatter) keeps 3.5.

**Zoom strip** is thin and quiet: 16 px track (`rgb(ink/.035)` + hairline), the series traced as a 1 px `--t-3` line (style attribute, not `stroke=var()`), the window a soft lens (ink 5 % fill, 32 % hairline), grips 4×12 px with a larger invisible hit area. Do not bring back the tall green strip.

**Layout.** Side column 236 px, no scroll (`overflow: hidden`): dates sit side by side. The legend has its own row under the controls (never next to them: at 1366 px it was squeezed and spilled over the chart). Year ranges in the legend are `dir="ltr"`. Check with `probe_side.py` (en + ar at 1366×650).

## Sharpening / super-resolution (`js/superres.js`)

Dock control `#imgRes`: 10 m (original) / 5 m / 2.5 m. Choice kept in `localStorage.imgRes`.

- Models in `models/sr/` (Apache 2.0, from openearthplatforminitiative/sentinel2-super-resolution):
  `s2v2x2_spatrad.onnx` (x2, Sen2Venus, more faithful) and `wsx4_spatrad.onnx` (x4, WorldStrat, sharper, can invent detail).
  Input B02 B03 B04 B08 at 10 m as reflectance x 10000, output the same 4 bands. Max is x4 = 2.5 m.
  **There is no 1 m model in that repo** (`s2v2x4_spatrad.onnx` upstream is an empty file). Do not chain models or
  upsample to claim 1 m: it adds no information. Say so if asked.
- Runs in the browser with onnxruntime-web 1.22.0 from jsDelivr: WebGPU when `navigator.gpu`, else WASM.
  Models (~18 MB each) download once and stay in Cache Storage `agro-sr-v1`.
- Per field: read the 4 bands with a margin of ceil(margin/factor) input px (33), run 96 px core tiles,
  crop margin*factor output px. Field mask rasterised on a canvas. Cloud mask still from 20 m SCL.
- Only NDVI, MSAVI, natural colour (no red-edge/SWIR in the model). Other indices disable the control.
- Order: the open field (`window.__openFieldId`) first, then fields in view; re-runs on map `moveend`.
  The 10 m layer shows first, each field is swapped when its sharpened layer is ready.
- Sharpened results live in `view.sr` (hover reads them). `view.results`, stats, zones, compare and time series stay 10 m
  because the model output is an estimate, not a measurement.
- Test: `agro-workspace-testing/scripts/test_superres.py` (mock scenes need `blue` and `green` assets).

## Index catalogue (`INDICES` in js/imagery.js, grouped in the dock and the time series menu)

| Group | Index | Formula (reflectance) | Range shown | Ramp | Notes |
|---|---|---|---|---|---|
| Vegetation | NDVI | (NIR−R)/(NIR+R) | 0–1 | red-yellow-green | |
| | SAVI | 1.5(NIR−R)/(NIR+R+0.5) | 0–0.9 | red-yellow-green | Huete 1988, L=0.5: sparse canopy, soil shows |
| | EVI | 2.5(NIR−R)/(NIR+6R−7.5B+1) | 0–1 | red-yellow-green | dense canopy, does not saturate; clamped −1…1.2 |
| | GNDVI | (NIR−G)/(NIR+G) | 0–0.9 | red-yellow-green | chlorophyll / nitrogen status |
| | NDRE, MSAVI, ReCI, VMI | as before | | | |
| Water | NDMI | (B8A−B11)/(B8A+B11) | −0.4–0.6 | brown-teal | canopy water |
| | NDWI | (G−NIR)/(G+NIR) | −0.6–0.4 | dry soil → open water blue | McFeeters: ponding, flooding |
| Soil | BSI | ((B11+R)−(NIR+B))/((B11+R)+(NIR+B)) | −0.4–0.4 | green cover → sand → umber | bare soil, tillage, fallow |
| | SI | √(B·R) | 0.03–0.3 | dark loam → pale crust → rust | Khan 2005 salinity; **only meaningful on bare/sparse soil**, confirm with EC |

Hover readings and report readings exist for every index. Sharpening supports indices built only from blue, green, red, NIR (NDVI, MSAVI, SAVI, EVI, GNDVI, NDWI, SI, natural colour); red-edge/SWIR ones disable the control. New ramps must stay earth/water/plant colours, never violet or neon. Test: `agro-workspace-testing/scripts/test_indices.py` (mock blue = green = red, so NDWI = −GNDVI and SAVI < NDVI are known answers).

## Value classes linked across the screen (class filter)

One set of 10 value classes per index (`Imagery.edgesFor(k)`; NDVI 0.1 steps, others the range split in 10; `classOf(edges, v)`), used by the map legend, the field statistics (Analytics tab), the heatmap/3D and the report.
- **Map legend** is a 10-segment bar (`.cls-seg`, class colour = ramp at the class middle on the fixed range). Click = show only that class; shift-click or drag = a range; × or clicking the only selected class clears. Selected range and its area/% of the farm (all fields on this date) show in the legend.
- `Imagery.setClassFilter(classes | null, indexKey)` sets `Imagery.filter = { indexKey, classes:Set }`, repaints every layer with `layer.setUrl(paint(r, { contrast, filter }))` (no re-analysis), re-renders legends and emits `imagery:filter`. While a filter is on, the chosen pixels use the **fixed** range colours (so they match the legend), others are faint grey; contrast is ignored.
- **Field statistics**: rows are buttons (`[data-cls]`), highlighted/faded with the filter, plus "Selected on the map: ha · %" for the open field. A row click sets the filter (shift extends).
- **Heatmap/3D**: days whose field mean is outside the classes fade.
- Changing the index clears the filter (classes differ per index).
- Test: `agro-workspace-testing/scripts/test_classfilter.py` (pixel-level check: only in-class pixels keep their colour).

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
- The field Analytics tab no longer has "Compare with an earlier date" or the season curve (owner asked to remove them there). `Imagery.compare/showDelta` and `ScoutTasks.createFromAnomaly` still exist for other callers.
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
