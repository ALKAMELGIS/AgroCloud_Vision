---
name: agro-workspace-shell
description: Layout and conventions of the AgroCloud Vision map workspace (workspace.html + js/shell.js + css/workspace-dark.css), modelled on the EOS Crop Monitoring screen — map with location search, left tools (split view, zoom, measure), bottom image timeline per screen; side panel with Fields cards and "Check fields with risks" chips; sidebar ported from the user's SidebarNav component (farm switcher, grouped nav with headings, animated children, badges, ⌘K command palette, collapse to icon rail). Use it when adding a module or nav item, moving a control, theming, or when the user asks to make the workspace look or behave like EOS / "like the reference screenshot".
---

# Workspace shell

```
┌──────────────────────── map (#mapMain) ───────────────────────┬─ #sidePanel 320 ─┬─ #navRail 248/60 ┐
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
- Each dock covers its own side of the divider.
- `#swipeDivider` is a 2 px line with a 40 px round handle (`#swipeHandle`, `role="slider"`):
  - drag it with the pointer (pointer capture);
  - ←/→ move it by 2 %, Home/End jump to the edges;
  - `Imagery.setSwipe(frac)` sets it from code and `Imagery.swipe()` reads it.
- The hover readout shows only the screen under the cursor.
- Don't animate the handle with `transform`, and keep exactly one `.swipe-handle` rule. An older duplicate rule drew a second circle.

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
- Figures use `num font-mono` (tabular). Labels are sentence case. Icons are lucide line icons from `ICONS` in workspace.html, 16 px, 1.5 stroke. No emoji, no glows.
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
are AgroCloud's. Do not copy another product's logo, wordmark or icon artwork.
