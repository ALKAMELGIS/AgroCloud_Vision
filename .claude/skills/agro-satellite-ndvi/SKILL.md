---
name: agro-satellite-ndvi
description: How AgroCloud Vision computes per-field Sentinel-2 NDVI in the browser (js/ndvi.js) from Element84 Earth Search with geotiff.js range reads, SCL cloud masking, per-field cloud %, NDVI classes, true colour, season curve and two-date anomaly detection, and how to test it offline with mock scenes. Use it for anything about satellite imagery, vegetation indices (NDVI, NDMI, NDRE), cloud masking, monitoring, anomalies, zones/VRA built on NDVI, or when imagery fails to load, looks wrong, or a new index/source must be added.
---

# Satellite monitoring (NDVI)

`js/ndvi.js` renders the **Monitoring** tab of the field panel. Everything
runs in the browser; the backend is not involved. That matters because Render's
free tier has 512 MB and sleeps when idle.

```
POST Earth Search /v1/search (intersects = field, last 150 days, tile cloud < 80%)
  → one scene per day: full coverage, then the field's main MGRS tile, then least cloud
  → geotiff.js fromUrl(asset) → read only the field window (HTTP Range)
      red, nir @10 m  ·  scl @20 m  ·  visual @10 m (true colour)
  → reflectance = DN·scale + offset → NDVI per pixel inside the polygon, SCL-masked
  → stats, classes, overlay (L.imageOverlay), compare, season curve
```

All tunables are in `CONFIG` at the top of the file (`window.NdviConfig`).

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

| Date | What it contains |
|---|---|
| 15 Nov | a 7.07 ha stress patch (NDVI 0.42) in Pivot 1 |
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

Then run `test_panel.py` from the agro-workspace-testing skill with
`S2MOCK=$WORK/s2mock`. Expected values: Pivot 1 mean on 15 Nov 0.749; cloud
on 26 Oct about 51%; anomaly 15 Nov vs 5 Nov about 7.05 ha in one area; three
dates on the season curve.

## Not verified yet (do this once on the live site)

Whether Earth Search's STAC API and the `e84-earth-search-sentinel-data` bucket
send CORS headers and answer range requests from `alkamelgis.github.io`.

1. Open Monitoring on a real field.
2. If the panel says the browser cannot read the image, add a backend proxy route, or switch to the Copernicus Data Space Statistical API through a NestJS token proxy. The free quota is 10,000 processing units per month.

Landsat on Earth Search is requester-pays, so use Planetary Computer for Landsat.

## Adding an index

Add a band read in `analyseScene`, compute the index next to `ndvi`, and add a
toggle next to NDVI / True colour. NDMI uses `nir08` and `swir16`, which are
20 m bands, so use the same window logic as SCL. NDRE uses `rededge1`.
