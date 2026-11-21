---
name: gis-field-import
description: How AgroOne turns GIS files into fields — the browser converter js/gis-import.js (GeoJSON, KML/KMZ, zipped Shapefile, zipped File Geodatabase, GeoPackage, any projection to WGS84), the Add field menu in workspace.html (draw, select on map, upload file, add GIS data, create group) and POST /fields/bulk. Use it whenever you add or fix an import format, a projection or CRS problem, field names or areas from a file, the Add field menu or its dialogs, reference GIS layers, or bulk field saving — even if the request only says "the file won't import", "wrong location on the map" or "add support for X".
---

# GIS field import

Field boundaries reach the database through one path. Keep it that way: a
second path means a second set of projection and naming bugs.

```
file(s) ──► js/gis-import.js ──► toFieldPolygons() ──► import dialog ──► POST /fields/bulk
            readFiles()          one Polygon per        (names, farm,      one INSERT … SELECT
            → WGS84 layers       field, name attr       irrigation)        in a transaction
```

## Where things live

| Piece | File | What it owns |
|---|---|---|
| Converter | `js/gis-import.js` | Format detection, lazy library loading, reprojection to EPSG:4326, polygon explode/clean, `name` lookup, area preview |
| Workspace UI | `workspace.html` | Add field menu, New field / Import fields / New group dialogs, GIS layers panel, select-on-map bar, drag and drop |
| API | `backend/src/fields/*` | `POST /fields`, `POST /fields/bulk`, `GET /fields/by-farm/:id/boundaries.geojson`, Polygon + WGS84 validation, organization check |

The workspace runs as a static page on GitHub Pages and talks to the Render
backend, so the converter must work entirely in the browser. Libraries come
from jsDelivr and load only when a file needs them.

## The rules the converter keeps, and why

- **Everything leaves `readFiles()` as WGS84.** The database column is
  `geometry(Polygon, 4326)` and the API rejects coordinates outside ±180/±90.
  Converting late, or in two places, is how fields end up in the ocean.
- **Pick the lightest reader that is exact.** GeoJSON is built in; KML/KMZ use
  togeojson; Shapefile uses shpjs, which reads the `.prj`. GeoJSON in EPSG:3857
  or UTM (326xx/327xx) reprojects with proj4. Anything else (File Geodatabase,
  GeoPackage, a GeoJSON in an unusual CRS) goes to gdal3.js. GDAL ships the
  full EPSG database, but it is ~30 MB, so never load it for a format a small
  reader handles.
- **Never guess a projection.** If coordinates are not lon/lat and the file does
  not say which CRS it uses (GeoJSON without `crs`, Shapefile without `.prj`),
  throw an error that tells the user what to export instead. A wrong guess
  silently saves fields in the wrong place, which is worse than a clear error.
- **Every polygon becomes a field.** MultiPolygon and GeometryCollection are
  exploded. Parts are named `Name (1)`, `Name (2)`. Holes are kept. Z/M values are
  dropped (the API also applies `ST_Force2D`). Points and lines are ignored for
  fields but shown in reference layers.
- **Names come from the `name` attribute in any case** (`name`, `Name`, `NAME`).
  Otherwise the name is `<file base name> <n>`. The user can rename every row in
  the dialog before saving.
- **Area preview uses the authalic radius 6371007.2 m**, so the dialog matches
  PostGIS `ST_Area(geography)` to about 0.02%. The equatorial radius was off by
  0.25%, and users notice when the two numbers differ.

## Adding a format

1. Add a reader in `gis-import.js` that returns `{ format, crs, layers: [{ name, features }] }` already in WGS84. Set `crs` to the *source* CRS label, because the dialog shows "converted from … to WGS84".
2. Route it in `readOne()` by extension. For zips, route by the paths inside them.
3. Add the extension to `ACCEPT` and to the Upload file caption in `workspace.html`.
4. Add a fixture for it to `scripts/make-fixtures.js`, using the same five features in a *non-WGS84* projection, and add the file to the `cases` list in `scripts/test_import.py`.
5. Run the tests below. The new format must yield the same five fields as `fields.geojson`.

## Testing

The fixture set is five features: two pivots, one with a hole; a two-part
MultiPolygon; an unnamed rectangle; and a point that must be ignored. Each
format is written in a different projection, so a reprojection bug shows up
as a wrong area.

```bash
# once, somewhere outside the repo
npm i gdal3.js@2.8.1 shpjs@4.0.4 @tmcw/togeojson@5.8.1 jszip@3.10.1 proj4@2.11.0 leaflet@1.9.4 leaflet-draw@1.0.4
NODE_PATH=$PWD/node_modules node <repo>/.claude/skills/gis-field-import/scripts/make-fixtures.js fixtures
GIS_LIBS=$PWD/node_modules REPO=<repo> python3 <repo>/.claude/skills/gis-field-import/scripts/test_import.py fixtures
```

`test_import.py` opens the converter in headless Chrome and serves the CDN
libraries from local `node_modules`. It prints `PASS` only when every format
gives the same names, ring counts and areas (within 0.5%) as the GeoJSON
baseline. `cdn_routes.py` can also proxy the Render API to a local backend
(`http://localhost:4000/api/v1`), which lets you test `workspace.html` end to
end: log in through the API, put the token in `localStorage`, and drive the Add
field menu.

Expected baseline: Pivot 1 ≈ 81.30 ha, Pivot 2 ≈ 79.21 ha (2 rings),
East block (1) ≈ 78.14 ha, East block (2) ≈ 28.13 ha, unnamed rectangle ≈ 30.71 ha.

## API notes

- Geometry always goes to SQL as a bound parameter
  (`ST_GeomFromGeoJSON($n)`). An earlier version interpolated the JSON into the
  SQL string, which was an injection hole. Keep it parameterized.
- `/fields/bulk` takes up to 2000 fields and inserts them in one statement
  (`jsonb_array_elements` + `LATERAL`), so a bad shape saves nothing rather than
  half the file. The client sends chunks of 400. If the server returns 404 (an
  older deploy), it falls back to `POST /fields` with four requests in flight.
- The JSON body limit is 25 MB (`main.ts`), because surveyed boundaries
  can have thousands of vertices.
- Both endpoints check that the farm belongs to the caller's organization.

## UI conventions (from the unslop pass)

Chrome stays quiet so the satellite imagery stays the focus: lucide line
icons at 16 px with a 1.5 stroke, sentence-case labels, and no emoji or glyph
icons. Areas use `tabular-nums` mono with two decimals and ` ha`. Colours
carry meaning on the map: green is saved fields, amber dashed is a draft or
import preview, white hairline is a reference layer, and amber fill is a
selected reference shape. A "group" is stored as a farm. There is no separate
group model.
