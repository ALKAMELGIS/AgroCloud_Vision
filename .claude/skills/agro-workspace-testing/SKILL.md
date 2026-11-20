---
name: agro-workspace-testing
description: How to run and test the AgroCloud Vision static workspace (workspace.html, main.html, index.html on GitHub Pages) end to end in headless Chrome against a local NestJS + PostGIS backend, with the CDN libraries, Tailwind and Sentinel-2 imagery served locally. Use it before shipping any change to the workspace pages or js/*.js, when a change "works on my machine" but needs proof, or when the sandbox cannot reach the CDN, Render or satellite hosts.
---

# Testing the workspace end to end

The live site is static HTML on GitHub Pages that calls the Render API
(`https://agrocloud-backend-e9ea.onrender.com/api/v1`) and loads Leaflet,
Tailwind, gdal3.js, geotiff.js and others from CDNs. A sandbox usually cannot
reach any of those, so the tests intercept every request and answer it locally.
That keeps the code under test byte-for-byte what users get.

## One-time setup

```bash
# 1. Database with PostGIS
apt-get install -y postgresql-16-postgis-3 && service postgresql start
su postgres -c "psql -c \"CREATE USER agrocloud WITH PASSWORD 'change_me' SUPERUSER;\""
su postgres -c "createdb -O agrocloud agrocloud_vision"
su postgres -c "psql -d agrocloud_vision -c 'CREATE EXTENSION IF NOT EXISTS postgis;'"
# 2. Backend (tables are created by DB_SYNCHRONIZE=true; owner account is seeded on start)
cd backend && cp .env.example .env && npm install && npm run build && node dist/main   # keep running
# 3. CDN packages, outside the repo
npm i gdal3.js@2.8.1 shpjs@4.0.4 @tmcw/togeojson@5.8.1 jszip@3.10.1 proj4@2.11.0 \
      leaflet@1.9.4 leaflet-draw@1.0.4 geotiff@2.1.3 tailwindcss@3.4.17
```

Tailwind's Play CDN cannot run offline, so build the CSS the pages use and wrap
it as a stand-in script. Include `js/*.js`, because those files inject markup:

```bash
npx tailwindcss -c tw.config.js -i tw.in.css -o tw.out.css --minify   # content: repo *.html + js/*.js, brand colours from the page config
node -e "const c=require('fs').readFileSync('tw.out.css','utf8');require('fs').writeFileSync('tailwind-shim.js','window.tailwind={config:{}};(function(){var s=document.createElement(\"style\");s.textContent='+JSON.stringify(c)+';document.head.appendChild(s);})();')"
```

## The router (`scripts/cdn_routes.py`)

`install(page)` handles requests as follows:

| Request | Served from |
|---|---|
| `https://alkamelgis.github.io/AgroCloud_Vision/<path>` | the repo (`REPO`) |
| jsDelivr / unpkg package URLs | `GIS_LIBS` (node_modules) |
| `cdn.tailwindcss.com` | `TAILWIND_SHIM` |
| Render API | proxied to `http://localhost:4000/api/v1`, including OPTIONS |
| Earth Search STAC and Sentinel-2 assets | `S2MOCK` (see the agro-satellite-ndvi skill), with real **206 range responses**, because geotiff.js needs them |
| Esri tiles | blank 204 |
| Anything else | printed as `BLOCKED` and aborted |

Log in through the API, then put the token in `localStorage` with
`context.add_init_script` before opening `workspace.html?farm=<id>`.

## Test suites

- `test_import_e2e.py`: the Add field menu, all import formats, select on map, draw, group.
- `test_panel.py`: the field panel (rename, irrigation, crops, activities), the activity log calendar and CSV, editing the boundary (area drops to a quarter), deleting a field.
- `test_superres.py`: sharpening 10 m → 5 m / 2.5 m (onnxruntime-web, models from the repo), NDVI mean kept, hover on the fine grid, natural colour, NDRE disables the control, choice remembered, model cached, Arabic. Needs `onnxruntime-web@1.22.0` in `GIS_LIBS` and `blue`/`green` assets in the mock.
- `test_shell.py` (30 checks): timeline, painting, risk chips, cards, coordinate search, NDMI/NDRE/NDVI values, value classes, compare → anomaly → scout task, swipe clipping, leaderboard, reports, notifications, Vegetation VRA (zones, rates, average, Shapefile verified with GDAL, ISO-XML DDI values), Sowing, soil sampling and GPX, forecast.

Each suite prints `PASS`/`FAIL` per check and `ALL PASS`.

```bash
WORK=<dir with fixtures/ s2mock/ shots/> S2MOCK=$WORK/s2mock GIS_LIBS=$PWD/node_modules \
TAILWIND_SHIM=$PWD/tailwind-shim.js REPO=<repo> python3 scripts/test_panel.py
```

## Lessons that cost time

- **`npm install --no-save X` prunes everything not in package.json** in `GIS_LIBS`. Install test libs with `--save`, or fonts and Leaflet disappear and pages time out.

- **Assert numbers you can derive.** Fixtures are generated with known areas and NDVI, so a test can say "≈ 0.749" and not "something rendered".
- **Wait for the result, not for an element.** Loading states reuse the same tags (a spinner is also an `svg`).
- **Mid-animation screenshots lie.** A dialog fading in looks translucent, and a map mid-`fitBounds` looks wrongly zoomed. Trace `fitBounds`/`setView` calls before calling something a bug.
- **The bottom of the map is crowded.** The imagery dock covers anything placed at `bottom-6`; action bars belong at `bottom-[136px]` and above z 555.
- **Update the list before showing the toast.** A toast before `refreshLists()` let a user start the next entry and have it wiped by the re-render.
- **Restarting the API:** `pkill -f "node dist/main"` and start it again. Kill the old frontend's port before starting a new one.
- **TypeORM foreign keys to uuid primary keys are `uuid` columns.** In raw SQL, compare with `::text` on both sides.
- **`UPDATE … RETURNING` through `repo.query` returns `[rows, count]`.**
