---
name: agro-landing
description: The public pages of AgroSyntra One — the landing page (index.html) and the sign-in / registration page (main.html), built on landing/ (landing.css, landing.js, ar.js) and modelled on the section order of EOS Crop Monitoring's product page. Use it whenever someone asks to change the home page, landing, marketing copy, hero, features, tools, FAQ, pricing text, footer, the sign-in or sign-up page, or their Arabic text, or wants the site to look or read "like EOS".
---

# Landing and sign-in pages

## Files

| File | What it holds |
|---|---|
| `index.html` | The landing page. Plain HTML, no Tailwind runtime, one icon sprite at the top. |
| `main.html` | Sign in and register (same IDs as before: `authForm`, `registerFields`, `email`, `password`, `submitBtn`, `toggleMode`, `errorMsg`, `subtitle`, `subtitleHint`, `langBtn`). `?mode=register` opens registration; every "Start free" links there. The right half is motion scene 1 on `#authCanvas` (map only, legend `#auth*`, step in `#authStep`); on tall canvases `AgroMotion.hero(canvas, onState, { pitch, zoom, cy })` looks down more steeply so the fields fill it. Hidden under 900 px and started on resize. |
| `landing/landing.css` | Tokens and components for both pages. Warm paper neutrals, one green (`--green`) for actions, six type sizes (`.t-display`, `.t-h2`, `.t-h3`, `.t-lead`, `.t-body`, `.t-meta`). |
| `landing/landing.js` | Draws the art (fields as 10 m pixels with the app's own ramps: RDYLGN, MOIST, SOIL), the ten tool tabs (arrow keys move), the language button, the year. |
| `landing/ar.js` | Arabic for every string on both pages, added with `I18n.add({...})` before the page renders. |

`js/i18n.js` must load first, then `landing/ar.js`, in `<head>`.

## Live demo (section `#live`, after the scenes: the real system, real Sentinel-2)

- The live section's product view is the real workspace: `workspace.html?demo&tour` in an iframe (`#demoStage`), loaded when
  the hero comes near the screen. The drawn still (`#demoPoster`) holds the place until the demo posts `ready`, then
  the frame fades in. Wide screens: the workspace renders at 1440 px and is scaled to fit; under 760 px it runs its
  own compact layout. The caption bar (`#demoStep`) shows each tour step (translated by `I18n.t`).
- `js/demo.js` (first script in workspace.html) makes `?demo`: storage in memory (never touches a real session or
  preferences), a read-only API with one farm in the Texas High Plains whose fields are the centre pivots detected in
  the latest clear Sentinel-2 image (Hough circles on NDVI edges, cached 7 days in `agroDemoPivots:v1`; two fixed
  circles if detection fails), weather straight from Open-Meteo. `?tour` drives the real controls: field, value
  classes, a class filter, NDMI/NDWI/BSI, time series chart → heatmap → 3D skyline → 3D ring. A real touch pauses it
  for 25 s; the wheel scrolls the page until the map is clicked.
- Everything on screen is computed by the workspace itself: nothing about the analysis is faked. Keep it that way.

## Section order (follows EOS Crop Monitoring's product page)

1. Hero: one-line promise, Start free + Sign in, then motion scene 1 (`#scene1`): the satellite pass with the workspace's Analytics panel, legend, dock, dates and six steps. This is the one colourful moment; everything else stays quiet.
   Then `#analysis` (motion scene 2: pixel → value classes → 3D skyline → 3D ring, Average/Peak/Lowest/Latest) and `#live` (the live demo).
2. Five ways it helps (EOS "Ways to make your farm work efficiently"): crop analytics, remote crop health, field risks, input savings, field reports.
3. Six steps (EOS "Simplify farming in 6 steps"): add fields, get imagery, read the trend, check risks, take action, share.
4. Tools (EOS "Top tools"): ten tabs, each with text, three points and a drawn picture: indices, time series and heatmap, field risks, VRA, soil sampling, activity log, scout tasks, weather, reports, team and roles.
5. Start free band (EOS "Join now for free"), without app-store badges: there is no mobile app.
6. Who it is for (EOS "Who can benefit"): growers and farm managers, agronomists and consultants; obstacles beside what changes.
7. Built on open data (in place of EOS's awards and partner logos): Sentinel-2 L2A, scene classification, Open-Meteo, PostGIS.
8. Questions (EOS "Still have a question?") as `<details>`.
9. Closing call to action, then a four-column footer.

EOS sections left out on purpose: case studies, testimonials and partner logos. There are none yet, and inventing them is not allowed. Add them only with real, permitted material.

## Rules for the copy

- Every claim must be true of the code today. Check before writing (for example: soil sampling exports GPX, KML, CSV and Shapefile from `js/vra.js`; the activity log filters by type and downloads a month as CSV). Remove a claim rather than stretch it.
- Super-resolution is "a model's estimate, not a new measurement".
- No prices on the page until billing exists. Say "free during early access".
- US spelling for words the app already uses (organization, fertilizer), so the shared Arabic dictionary matches.
- One sentence = one text node. Inline tags inside a sentence break the translation (it works node by node).
- Every new English string needs its Arabic line in `landing/ar.js`. Field names in the art (Pivot 2, Fodder block) can stay.

## Design rules

- Fluid frame: `.wrap` has gutters `--gutter: clamp(20px, 4.4vw, 64px)` and content up to 1600 px, so wide screens
  do not show empty bands at the sides. The hero splits (headline | lead and actions) from 1000 px up.
- Check 1920, 1440, 1024, 768 and 390 after any change.

- Chrome stays neutral; colour only inside the fields and charts, from the app's real ramps.
- Signed numbers (`.chg`, `.f-field .big`) are isolated left-to-right so Arabic shows −0.11, not 0.11−.
- SVG art is `direction: ltr`; its text is translated by `I18n.t` after drawing.
- Mobile: the field list and season card hide under 1000 px; only three date chips under 640 px.

## Test

`python3 .claude/skills/agro-workspace-testing/scripts/test_landing.py` (setup as in the agro-workspace-testing skill):
no page errors and no sideways scroll at 1440 and 390 in both languages; ten tabs each show their own panel and art; no untranslated string in Arabic on either page; Start free → register → workspace; sign in → workspace; a wrong password shows a readable error.

## Motion scenes (design canvas "AgroSyntra One — Motion hero")

`landing/motion/motion.js` is the engine behind both the canvas boards and the landing scenes (satellite pass;
pixel → classes → 3D skyline → 3D ring). `landing/scenes.js` drives it on the page: `AgroMotion.hero(canvas, onState)`
fills `#sc1*` (panel rows click → `toggleClass`, index select, contrast, dates, steps, Play/Pause) and
`AgroMotion.stats(canvas, onState)` fills `#sc2*` (acts and mode buttons hold a step; click again to play). Each starts
when it nears the screen. Phones (≤700 px) hide the field panel and the period chips; the status line takes its own row.
Class stacks are 4×4 cubes a layer rising upward, so their height is the hectares; keep the edge labels in front and the
ha labels on top, or they collide with the stacks. Keep `motion.js` identical in the canvas project and the site. Its analysis must stay the system's own:
- reflectances per pixel (B02 B03 B04 B05 B08 B8A B11) and an SCL class; NDVI/NDMI/NDWI/BSI with the formulas,
  ranges and ramps of `js/imagery.js` (copy them, never retune by eye);
- SCL 3/8/9/10 masked and painted rgba(120,126,135,.59); cloud % and clear hectares per field;
- contrast = the field's P2–P98; ten classes = tenths of the index range, in hectares; P10/P90;
- season as `js/ts-calendar.js` builds it: a value per clear date, days between interpolated and mixed 45 % with
  the empty-day colour, colours from the period's low to high, Average/Peak/Lowest/Latest.
The canvas cannot reach Sentinel-2, so the reflectances come from a field model; say so wherever it is shown.
The live, real-data version is the hero demo (`workspace.html?demo&tour`).

## Real imagery in the scenes (`landing/motion/real.js`)

The hero scene (`#scene1`) and the sign-in art (`#authCanvas`) start on the field model, then `liveScene()` in
`scenes.js` swaps to `AgroReal.hero()` when `AgroReal.load()` resolves (45 s limit, about 20 s uncached; on failure the model stays):
- ground = Esri World Imagery: z16 over the analysed area (Texas High Plains, −102.322, 34.116; 5 × 3.4 km) and z14
  three times wider around it (`OUTER`), drawn first, so tilting or turning never shows empty ground;
- fields = centre pivots fitted to their real rims (`pivotsFrom`): Hough votes on red/NIR/SWIR edges, then each
  candidate refined (centre and radius ±3 px) to the circle whose rim is an outward edge; kept only with ≥ 70 % of
  the rim on an edge and wholly inside the area (radius 240–720 m). No cache, no guessed circles: a wrong or small
  circle on the imagery is worse than a missing one. The open field is the most varied among the large ones;
- index layers = Sentinel Hub WMS evalscript (B02 B03 B04 B08 B8A B11 SCL, FLOAT32) on the instance's L2A layer
  (found in GetCapabilities, e.g. `3_NDVI`; a wrong LAYERS name gives HTTP 400), for the latest clear date (< 5 %)
  and a cloudy one (15–75 %), with the system's formulas, SCL masking, P2–P98 contrast and ten classes;
- both are drawn on the 3D ground with an affine triangle mesh (`drawGround`); the index texture is opaque inside the
  pivots (a translucent one shows the mesh seams) and smoothed ×4, clipped to the circles;
- requests are cached three days with the Cache API (`agro-landing-v1`); credit "Imagery © Esri, Maxar · Sentinel-2
  L2A © Copernicus" shows once real data is on;
- script tags carry `?v=…`: GitHub Pages caches for 10 minutes, and an old motion.js without `AgroMotion.kit` makes
  real.js do nothing. Bump the version with every change to landing scripts.
Tests mock Esri tiles (plain PNG) and the 7-band evalscript (cdn_routes.py); check the real result in the browser pane.

