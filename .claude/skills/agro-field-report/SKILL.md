---
name: agro-field-report
description: How AgroOne builds the two-page A4 field report (js/field-report.js, opened from Reports) — NDVI and management-zone maps over satellite, zone and class areas that add up to the field, field facts, season curve, indices, change and scouting points, weather, operations and rule-based agronomist notes. Use it whenever someone asks for a report, PDF, printout, field summary, zone areas, agronomic recommendations, or wants the report changed, translated or extended (more pages, farm report, crop-specific rules).
---

# Field report (A4, 2 pages)

Entry: Reports module → "Field report" card (field picker defaults to the open field, `window.__openFieldId`) → `FieldReport.open(fieldId, onStep)`. It opens a tab first (popup blockers allow it inside the click), gathers data, then writes a self-contained HTML document with its own print CSS. The browser's Print saves the PDF. Uses the **date selected on the timeline**; if the field is cloudy that day it stops with a message.

## What is on the pages, and why

Page 1, condition on the image date:
- Title: field, farm, crop + variety, area; image date and % of the field clear.
- Five figures: area (ha + acres), mean NDVI + canopy reading, uniformity (CV %), change since the previous clear date, low-zone area.
- Two maps (SVG: Esri World Imagery tiles + overlay + outline, fractional zoom so the field fills the frame, scale bar, north arrow). NDVI map carries numbered scouting points.
- Zone areas: Low < 90 %, Medium 90–110 %, High > 110 % of the field's mean NDVI. This is how VRA zones are usually drawn; **never use terciles** (every zone is 33 % by definition and tells nothing).
- Field facts: crop, sown date and day after sowing, expected harvest, irrigation, area in ha / acres / dunum, perimeter (haversine), extent, centre.
- NDVI distribution by 0.1 class with area, share and reading.

Page 2, season and actions:
- NDVI curve with P10–P90 band (time series panel points if it shows this field, else up to 14 clear dates in 150 days), sowing marker.
- Indices on the same date, full-width table: NDVI, SAVI, GNDVI, NDRE, NDMI, BSI, SI with what each measures and a reading. SI under a closed canopy says "read on bare patches only"; high SI on sparse cover → soil EC sampling and leaching plan.
- Change vs previous clear date: means, area that dropped against the field, up to 5 scouting points with coordinates (from `Imagery.compare`).
- Weather, last 30 days (archive lags ~6 days): rain, mean max/min, GDD base 10 (cap 35 °C), days ≥ 40 °C (Gulf heat), top-soil moisture.
- Operations, last 12 months: date, operation, product and rate.
- "What the image shows" and "Recommended actions".

## Areas

Field area = stored boundary area (PostGIS, geodesic). Zone and class areas = share of **clear** pixels × field area, so they always add up to the field. The test checks the sum.

## Agronomy rules (keep them careful and crop aware)

- Canopy reading from mean NDVI: < 0.2 bare/emerging, < 0.4 sparse, < 0.6 moderate, < 0.8 good, else dense.
- Uniformity: CV < 10 % uniform, < 20 % moderate, else strong. CV ≥ 15 % → check irrigation uniformity in the low zone (pivot nozzles and pressure, drippers, leaks), then compaction and salinity.
- **Forage crops** (alfalfa, Rhodes, sudan/sorghum, berseem, clover, grass, hay, Arabic names): an NDVI drop ≥ 0.1 is usually a cut. Say so; if a harvest is logged within 14 days, call it the cut. Do not send scouts for it.
- Other crops, drop ≥ 0.1 → visit scouting points within 48 h (water stress, pests/disease, lodging).
- NDMI < 0 → water stress likely, check schedule against ET and soil moisture.
- NDVI > 0.6 with NDRE < 0.25 → chlorophyll low for the canopy: tissue or SPAD test before adding N (never prescribe a rate).
- ≥ 5 days at 40 °C in 30 → heat stress note. Low zone > 30 % → suggest VRA maps.
- If nothing triggers, say no action is needed. Never invent yields or rates.

## Design

Warm paper (`#fffefb`), ink text, one field-green accent, hairlines `#e7e3da`, IBM Plex Sans, tabular figures, sentence case. Zone colours: terracotta / sand / field green. No gradients except the NDVI ramp. Each `.page` is exactly 297 mm; the test asserts no overflow and a 2-page PDF. If real data makes a page too long, `fitPages()` (run **from the opener**: scripts written into the new tab do not run) zooms the page's blocks down in 2 % steps to 84 % at most, after fonts load and before print.

## Test

`agro-workspace-testing/scripts/test_report.py`: creates a crop and operations, opens the report from Reports, checks text, zones add up and are not all equal, maps, indices, forage note, no overflow, PDF has exactly 2 pages. Render pages with `pdftoppm -r 70 -png field_report.pdf fr` and look at them.
