---
name: agro-workspace-shell
description: Layout and conventions of the AgroCloud Vision map workspace (workspace.html + js/shell.js + css/workspace-dark.css), modelled on the EOS Crop Monitoring screen — map with location search, left tools (swipe, zoom, measure), bottom image timeline; side panel with Fields cards, farm selector, "Check fields with risks" chips; right navigation rail (Monitoring, Weather, Field activity log, VRA maps, Scout tasks, Notifications). Use it when adding a module or nav item, moving a control, theming, or when the user asks to make the workspace look or behave like EOS / "like the reference screenshot".
---

# Workspace shell

```
┌──────────────────────── map (#mapMain) ───────────────────────┬─ #sidePanel 320 ─┬─ #navRail 212 ─┐
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
| 405 / 406 | imagery panes `imgA` / `imgB` |
| 408 | VRA zones and sample points (pane `vra`) |
| 555 | imagery dock |
| 560 | search and tools |
| 565 | swipe bar |
| 580 | action bars (select-on-map, edit boundary) at `bottom-[136px]`, above the timeline |
| 600 | Add menu |
| 700 | toasts at `top-[72px]` |

Anything clickable near the bottom must sit above the dock. The tests caught two bars hidden under it.

## Branding

The layout and tools follow the reference product, but name, logo and colours
are AgroCloud's. Do not copy another product's logo, wordmark or icon artwork.
