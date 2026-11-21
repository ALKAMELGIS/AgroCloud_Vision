---
name: agro-vra-zones
description: The zones engine in AgroOne (js/vra.js) behind VRA maps — Vegetation (one date and index), Sowing and P&K (productivity from the clearest dates), Map builder (up to 5 weighted layers) — and Soil sampling; zoning (k-means / equal area, 2–7 zones, Zone 1 highest, smoothing, minimum zone), pixel-edge polygon tracing, rate distribution and savings, and exports (Shapefile written in JS, ISO-XML TASKDATA with DDI units, GeoJSON, KML, GPX, CSV). Use it for prescriptions, variable rate, zones, productivity maps, seeding/fertilizer rates, terminal exports (John Deere, Trimble, ISO-XML), or soil sampling grids and points.
---

# Zones, VRA and soil sampling

## Pipeline

1. **Source grid.** `combine(field, layers)` produces values on the field's 10 m grid.
   - With **one layer**, the raw index values are kept (Vegetation map), so the "Index" column shows real NDVI.
   - With **several layers**, each layer is divided by its field mean and the results are averaged with weights (productivity, Map builder). Layers must share the tile grid.
   - Cloud gaps are filled from neighbours so the zones cover the whole field.
2. **Zoning.** `zoneGrid(src, { zones, method, minHa })`.
   - Method: k-means 1D (default; EOS's API exposes `kmean`) or equal-area quantiles.
   - Zone 1 is the **highest** values.
   - 3×3 majority smoothing, then patches under `minHa` (default 0.1 ha = EOS's 1000 m²) are merged into the neighbour they touch most.
   - **Empty zones are dropped and renumbered**, because a uniform field can't fill every class.
3. **Polygons.** `tracePolygons` walks pixel edges (a right-turn rule keeps diagonal touches apart). Clockwise rings in lon/lat are outers; holes are assigned by containment. GeoJSON output is RFC 7946 (outer rings counter-clockwise). The shapefile writer reverses rings to the ESRI convention.
4. **Rates.** `distribute`: rate = avg × (1 ± spread × t), with t from +1 (Zone 1) to −1, then rescaled so the **area-weighted average equals the target**.
   - "More to strong" is direct (the sowing default); "More to weak" is inverse (the N and P&K default); "Flat" gives every zone the same rate.
   - Seed rates are rounded to 100. Totals and saved/extra amounts against a flat rate are shown, with a price option.

## Exports

| Format | Contents |
|---|---|
| Shapefile ZIP | `.shp .shx .dbf .prj (WGS84) .cpg (UTF-8)`; one MultiPolygon per zone; fields `ZONE N4, RATE N14.2, UNIT C10, AREA_HA N12.2, PRODUCT C40` (names ≤ 10 characters). Soil points use point shapes with `ID, ZONE, CELL`. |
| ISO-XML | `TASKDATA/TASKDATA.XML`: CTR, FRM, PDT, PFD (boundary PLN A=1), TSK with one TZN per zone holding a PDV and treatment-zone PLN A=2. |
| GeoJSON / KML | the same zones with properties. |

ISO-XML DDI units, also printed in the UI:

| DDI | Quantity | Conversion |
|---|---|---|
| 6 | mass per area | kg/ha × 100 → mg/m² |
| 1 | volume per area | L/ha × 10000 → mm³/m² at 0.01 resolution |
| 11 | count per area | seeds/ha × 0.1 → /m² at 0.001 resolution |

Brand-specific SHP column presets (John Deere, Trimble, Amazone) are not
public. Keep the universal file and ask the user to confirm on their terminal.

## Soil sampling

- **Grid:** cell size 1 / 2 / 2.5 / 5 ha on the 10 m grid. A cell needs ≥ 30% of its area inside the field. The point is the pixel nearest the cell centre that is at least 3 pixels from the edge.
- **By zones:** productivity zones; points per zone are placed by farthest-point sampling starting from the most interior pixel (≥ 2 px from the zone edge).
- **Labels and export:** points are labelled `S01…`. Export GPX, KML, CSV or SHP.

## Verify an export independently

`scripts/verify-shp.js <zip>` opens the shapefile with GDAL (gdal3.js) and
prints each feature's attributes, ring count, ring closure and geodesic area.

Expected on the mock Pivot 1 (Vegetation, NDVI, 15 Nov, 3 zones, inverse,
120 kg/ha): zones of 37.27, 37.02 and 7.05 ha (the stress patch); rates 104,
130 and 156; ISO-XML PDV values 10400, 13000 and 15600.
