---
name: agro-landing
description: The public pages of AgroSyntra One — the landing page (index.html) and the sign-in / registration page (main.html), built on landing/ (landing.css, landing.js, ar.js) and modelled on the section order of EOS Crop Monitoring's product page. Use it whenever someone asks to change the home page, landing, marketing copy, hero, features, tools, FAQ, pricing text, footer, the sign-in or sign-up page, or their Arabic text, or wants the site to look or read "like EOS".
---

# Landing and sign-in pages

## Files

| File | What it holds |
|---|---|
| `index.html` | The landing page. Plain HTML, no Tailwind runtime, one icon sprite at the top. |
| `main.html` | Sign in and register (same IDs as before: `authForm`, `registerFields`, `email`, `password`, `submitBtn`, `toggleMode`, `errorMsg`, `subtitle`, `subtitleHint`, `langBtn`). `?mode=register` opens registration; every "Start free" links there. |
| `landing/landing.css` | Tokens and components for both pages. Warm paper neutrals, one green (`--green`) for actions, six type sizes (`.t-display`, `.t-h2`, `.t-h3`, `.t-lead`, `.t-body`, `.t-meta`). |
| `landing/landing.js` | Draws the art (fields as 10 m pixels with the app's own ramps: RDYLGN, MOIST, SOIL), the ten tool tabs (arrow keys move), the language button, the year. |
| `landing/ar.js` | Arabic for every string on both pages, added with `I18n.add({...})` before the page renders. |

`js/i18n.js` must load first, then `landing/ar.js`, in `<head>`.

## Section order (follows EOS Crop Monitoring's product page)

1. Hero: one-line promise, Start free + Sign in, then a still of the workspace (field list, pixel fields, field card with value classes, season curve, legend, date chips). This is the one colourful moment; everything else stays quiet.
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
