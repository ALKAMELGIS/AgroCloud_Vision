---
name: agro-workspace-shell
description: Layout and conventions of the AgroOne map workspace (workspace.html + js/shell.js + css/workspace-dark.css), modelled on the EOS Crop Monitoring screen — map with location search, left tools (split view, zoom, measure), bottom image timeline per screen; side panel with Fields cards and "Check fields with risks" chips; sidebar ported from the user's SidebarNav component (farm switcher, grouped nav with headings, animated children, badges, ⌘K command palette, collapse to icon rail), and English (left-to-right, sidebar left) / Arabic (right-to-left, mirrored) via js/i18n.js. Use it for layout, direction, translation or language-switch changes too. Use it when adding a module or nav item, moving a control, theming, or when the user asks to make the workspace look or behave like EOS / "like the reference screenshot".
---

# Workspace shell

```
┌─ #navRail 248/60 ┬─ #sidePanel 320 ─┬──────────────────────── map (#mapMain) ───────────────────────┐   (English; Arabic mirrors)
│ search (place or "lat, lng")                 scale · attribution│ Fields view       │ logo           │
│ [swipe] [+][−] [ruler]                                          │  farm select, +   │ Season 2026    │
│                                                                 │  search · sort    │ Monitoring ▾   │
│                                   legend                        │  risk chips       │  Fields …      │
│                     [Sentinel-2][index][contrast][cloudy][eye]   │  field cards      │ Weather ▾      │
│ [cal][‹] 16 Oct'26 S2 3% … 15 Nov'26 [›]   ← #imageryDock        │  [Add fields]     │ Activity log   │
└─────────────────────────────────────────────────────────────────┴ #viewModule ──────┴ VRA maps ▾ …   ┘
```

- **Field panel:** opening a field (card or map click) lays `js/field-panel.js` over the side panel. It has a back arrow and the tabs Analytics, Overview, Crops and Activities.
- **Other views:** other nav items render into `#viewModule`.
- **Activity log:** "Field activity log" opens the calendar dialog (`js/activity-log.js`).
- **Add a module:** register it, and the nav item with the same id renders it:
  ```js
  Shell.register('my-view', { title: 'My view', render(el) { el.innerHTML = '…'; } });
  ```
  Re-render on data events with `Shell.rerender('my-view')`. Set a nav count with `Shell.setBadge('notifications', n)`. Add the nav item to `NAV` in `js/shell.js`.
- **Events:**
  - `workspace:fields`: field layers redrawn, `state.fieldsById` filled with geometries.
  - `imagery:change` / `imagery:risks`: new date or index painted; risks ready.
  - `shell:view`: view switched. VRA clears its map layers when you leave.
  - `fieldpanel:close`, `activities:changed`.
- **Globals the modules rely on:** `state`, `mapInstance`, `apiGet/Post/Patch/Delete`, `icon`, `escapeHtml`, `formatHa`, `showToast`, `showError`, `openFieldPanel`, `renderFieldsList`, `currentCropOf`, `downloadCsv`.

## Sidebar (ported from the user's React `SidebarNav`)

The user supplied a React component as the design reference; the site is
vanilla JS, so `js/shell.js` reproduces it. Keep these parts consistent with it:

- **Farm switcher** in place of the workspace switcher: avatar letter, name, `N fields · X ha`, menu with farms and "Create farm" (opens `groupDialog`).
- **`GROUPS`** of items:
  - optional uppercase heading per group;
  - each item has an icon, an optional `badge` (`Shell.setBadge(id, n, alert)`), an optional `shortcut` (keycap shown on hover), and optional `children`;
  - children expand with a `grid-template-rows` 0fr→1fr transition, a vertical guide line and a rotating chevron.
- **Collapse** (`#navCollapse`): the rail narrows to 60 px with icons only, remembered in `localStorage.navCollapsed`. Badges become a red dot. Clicking a parent opens its first child.
- **Location search** (`#geoSearchWrap`): a 44 px search button at the top left. Clicking it opens a 400 px box with the input focused. Esc, the × button, or a click outside with an empty box closes it again. `window.openLocationSearch()` opens it from code; the palette uses it.
- **Command palette** (⌘K / Ctrl+K or "Search"):
  - lists fields, views, actions (draw, upload, split view, measure, create farm), other farms, and "Search places for …";
  - arrow keys, Enter and Esc work.

## Fields panel fold

- **The tab:** `#panelToggle` is a slim graphite tab, 18 px by 56 px with one chevron, on the map edge next to `#sidePanel`. Clicking it toggles `#appRoot.side-collapsed`.
- **Folding:** the panel animates to width 0 while its children keep `min-width: 320px`, so nothing reflows. After the fold, both maps run `invalidateSize`.
- **The chevron** points the way the panel will move and flips in Arabic.
- **Reopening:** `window.setSidePanel(open)` reopens the panel whenever a view is chosen (`show`), a field is opened, or a new field is drawn.
- **Remembered:** the state is kept in `localStorage.panelCollapsed`, which survives sign-out.

## Language and direction (`js/i18n.js`)

- **Loading:** `js/i18n.js` loads first in `<head>` on `workspace.html` and `main.html`. It reads `localStorage.lang` and sets `<html lang dir>` before anything renders.
  - **English** is `ltr`, with the sidebar on the left.
  - **Arabic** is `rtl`, and the whole layout mirrors.
- **Map controls in English:**
  - search and tools (compare, zoom, measure) on the right edge of the map, with their menus opening to the left;
  - scale and the ⓘ credit at the top left;
  - the Add fields menu at the bottom left, next to its button.
- **Map controls in Arabic:** the mirror of the English placement. The rules live in one block in `workspace-dark.css`.
- **DOM order:** `#navRail`, `#sidePanel`, `#mapMain`. The flex row follows the direction, so never hard-code which side the sidebar sits on.
- **Classes:** use logical classes and properties: `ms-` / `me-` / `ps-` / `text-start` / `text-end` / `border-inline-end` / `inset-inline-start`. Use `[dir="rtl"]` overrides only for absolutely placed map controls.
- **The map stays `ltr`** (`#mapRow`, `.leaflet-container`). Leaflet, panes A|B and the swipe clip depend on it. The docks and hover readouts switch back to `rtl` for Arabic text.
- **Translation** happens at runtime, so components keep writing English:
  - A MutationObserver translates text, `placeholder`, `title`, `aria-label` and options through the `AR` dictionary.
  - `RULES` cover strings built from numbers (counts, ha, cloud %, toasts), `MONTHS` covers dates, and strings joined with ` · ` / ` › ` / ` → ` are translated part by part.
  - When you add UI text, add its Arabic to `AR`, or a rule if it contains numbers. Check with `test_i18n.py`, which prints any string still in English.
- **What is never translated:**
  - field and farm names (the `userNames()` check against `state.fieldList` / `state.farms`);
  - anything marked `translate="no"`.
- **Switching:** the language switch is in the sidebar footer, and `main.html` has a button too. `I18n.setLang()` stores the choice and reloads.
  - Sign-out keeps `lang`, `navCollapsed` and `imgProvider`.
  - The Arabic font is IBM Plex Sans Arabic from Google Fonts.

## Compare: swipe and side by side (each screen has its own layer)

The compare button (`#swipeBtn`) opens `#compareMenu` with three choices: **Swipe**, **Side by side** and **Stop comparing**. Code calls `Imagery.setCompare('swipe' | 'split' | 'off')`; the palette and `window.startCompare(mode)` go through the same function. `setSplit(on)` is kept as a shortcut for side by side.

Both modes use the same two views:
- `Imagery.views[0]` is screen A; `views[1]` is screen B, whose ids take a `2` suffix (`#imgIndex2`, `#tlChips2` …).
- Each screen has its own date, index, contrast and timeline.
- Screen B opens on the previous clear date on the same tile.
- Pan and zoom are synced, with a guard flag against loops.

**Side by side:** `#mapPaneB` sits next to A in the flex row. Hovering a field shows the reading on both screens.

**Swipe:**
- `#mapRow.swipe` lays `#mapPaneB` over pane A.
- Only `#mapContainer2` is clipped, with `clip-path: inset(0 0 0 var(--swipe-x))`, so screen B shows right of the divider. The clip also limits clicks, so the left side still drives map A.
- `#mapContainer2` gets an opaque background, so map A never shows through screen B.
- The clip makes `#mapContainer2` its own stacking layer. `#mapContainer` gets `position: relative; z-index: 0` in swipe so B still paints above A; without it, map A's Leaflet panes (z 400) cover screen B. The shell test samples a pixel right of the divider to catch this.
- In swipe, screen B's scale bar shows and A's is hidden.
- Each dock stays in its own fixed half of the map (A left, B right), above the divider, and does not move or resize when the divider is dragged.
- `#swipeDivider` is a 2 px line with a 40 px round handle (`#swipeHandle`, `role="slider"`):
  - drag it with the pointer (pointer capture);
  - ←/→ move it by 2 %, Home/End jump to the edges;
  - `Imagery.setSwipe(frac)` sets it from code and `Imagery.swipe()` reads it.
- The hover readout shows only the screen under the cursor.
- Don't animate the handle with `transform`, and keep exactly one `.swipe-handle` rule. An older duplicate rule drew a second circle.

## Light and dark (`data-theme` on `<html>`)

- `js/i18n.js` sets `document.documentElement.dataset.theme` from `localStorage.theme` (default **light**; dark only when chosen) before first paint, and exposes `window.Theme` (`current`, `set`, `toggle`, `css(varName)`). It fires `theme:change`; switching adds `.theme-fade` for 0.3 s (skipped with reduced motion). The nav rail has an "Appearance" row with a sliding moon/sun pill. `theme` survives logout.
- Every colour in `css/workspace-dark.css` is a variable. `:root` = dark graphite; `:root[data-theme="light"]` = warm limestone and paper (`--g-*` surfaces, `--t-1…--t-4` ink text, deep field green accent `#15803d`). Triples for alpha: `rgb(var(--ink) / .08)` lines and washes, `rgb(var(--glass) / .92)` map controls, `rgb(0 0 0 / calc(.35 * var(--sh)))` shadows (`--sh` 1 dark, .32 light).
- **Never write a literal colour** in CSS or JS for chrome. Canvas and inline SVG read the theme (`Theme.css('--t-3')`, `style="fill:var(--g-900)"`; SVG presentation attributes do not take `var()`). Data colours stay literal: NDVI ramps, index hues (time series has a deeper light palette), risk dots.
- No blue-violet, no neon, no gradients on chrome, in either theme. Light uses one warm white for surfaces (`#fbfaf8`) and pure white for raised cards, inputs and map controls.
- Markup that is white-on-dark by class (`text-white/70` in the hover readout, `bg-brand-900 text-white` selected farm) has light overrides at the end of the CSS.
- Test: `agro-workspace-testing/scripts/test_theme.py` with `THEME=light` and `THEME=dark` (applied before paint, WCAG 4.5 contrast on key text, switch, kept after reload).

## Account menu and Settings (`js/settings.js`)

- Sidebar bottom: a **Settings** row (`Ctrl/⌘ ,`) and the **account row** (initials avatar, email name, organisation · role from `GET /organizations/me`). The account row opens `#acctMenu`: header, Settings, language (`[data-action=lang]`), appearance segmented light/dark/match device (`[data-theme-pref]`), Log out (`[data-action=logout]`). Tests open `#acctBtn` first.
- Settings is a `<dialog id="settingsDialog">`, 820×580, left section nav + body. Sections:
  - General: language, **area unit** (ha / ac ×2.4710538 / dunum ×10 — `window.formatHa` converts everywhere; the report keeps ha + acres + dunum), **first day of week** (Saturday / Sunday / Monday; heatmap rows).
  - Appearance: theme cards Light / Dark / Match device (`Theme.set('system')` follows `prefers-color-scheme` live), reduce motion (`html.reduce-motion`, kills transitions and animations).
  - Map and imagery: default layer (`defaultIndex`, applied on open), imagery source, contrast, pixel size — each applies live by driving the dock control.
  - Account: profile card, reset preferences (reloads), log out.
- Every preference is a localStorage key that survives sign-out (`KEEP` list in settings.js: also add new ones there). Command palette has a Settings group.
- Light theme uses **one white**: rail and panels `#fbfaf8`, raised cards/inputs/map glass `#ffffff`, hover `#f2f0eb`, selected `#eae7e0`. Do not introduce other near-whites.
- Test: `agro-workspace-testing/scripts/test_settings.py`.

## Theme (unslop rules)

- `css/workspace-dark.css` remaps Tailwind's neutral utilities inside `.dark-ui` to one graphite ramp:
  - surfaces: `--g-950` rail, `--g-900` panel, `--g-850` raised, `--g-800` hover;
  - text: `--t-1`, `--t-2`, `--t-3`;
  - one green accent.
- Write components with the normal light classes (`bg-white`, `text-gray-900` …) and they come out dark. Don't hard-code new colours in modules.
- Colour carries meaning only:
  - index ramps;
  - zone colours (Zone 1 green → weak zones red);
  - risk dots (red high drop, amber drop, grey no data, green none);
  - priority pins.
- **Type:** one family in both languages, IBM Plex Sans with IBM Plex Sans Arabic, loaded from Google Fonts.
  - Figures use the same face with tabular numerals. `.font-mono` and `.num` are remapped in `workspace-dark.css`, so keep writing `num font-mono` for numbers; only keycaps stay monospaced.
  - Weights are 400 and 500, with 600 only for small badges.
  - Section headings (nav groups, palette groups) are sentence case at 12 px / 500. Never uppercase or tracked.
- **Copy:** labels, not explanations.
  - No helper paragraphs under headings. The control names say what it does (the VRA type hints and the soil sampling description were removed for this reason).
  - Empty states are a few words ("No open tasks").
  - Source footnotes stay out of panels.
- **Arabic layout:** number ranges get `dir="ltr"`, and `i18n.js` wraps percentages and ranges in Unicode isolates so they read in order.
- **Icons:** lucide line icons from `ICONS` in workspace.html, 16 px, 1.5 stroke. No emoji, no glows.
- **Check before shipping:** `test_click_all.py` clicks every control in every view, the field panel tabs and the activity log, and fails on any JavaScript or 5xx error.
- Inputs that sit inside a styled box get the class `bare`.

## Layering (z-index)

| z-index | Element |
|---|---|
| 395 | imagery pane `img` on each map, below the field outlines (overlayPane 400) |
| 408 | VRA zones and sample points (pane `vra`) |
| 555 | imagery dock |
| 560 | search and tools |
| 570 | hover readout |
| 580 | action bars (select-on-map, edit boundary) at `bottom-[136px]`, above the timeline |
| 600 | Add menu |
| 700 | toasts at `top-[72px]` |
| 900+ | command palette, farm switcher menu |

Map credits sit behind an ⓘ button (`.map-credit`). Esri's imagery terms require a visible credit, so don't remove the button.

Anything clickable near the bottom must sit above the dock. The tests caught two bars hidden under it.

## Branding

The layout and tools follow the reference product, but name, logo and colours
are AgroOne's. Do not copy another product's logo, wordmark or icon artwork.
