---
name: agro-field-registration
description: How AgroSyntra One saves and manages field boundaries, OneSoil-style. Covers the editable New field card, server checks (crossing edges, ring closure, 100 m² to 10,000 ha, auto names "Field N"), overlap and duplicate handling (409 with reject/clip/allow, bulk skip), field history with boundary restore, and recoverable delete (Recently deleted, Undo, permanent delete). Use it for any change to adding, drawing, importing, editing, deleting or restoring fields, or for problems such as duplicate, overlapping, invalid or lost fields.
---

# Field registration and management

The data model is: user → organization → farms → fields. Each field carries boundary, crops (seasons), activities, scout tasks, irrigation and history. Boundary checks run in PostGIS, so the browser, imports and any future mobile app follow the same rules.

## Problems this fixed (and must not come back)

| Before | Now |
|---|---|
| A self-crossing ("bow-tie") boundary was saved with 0 ha | Refused with the crossing point (`where`), which the map marks in red |
| The same field could be saved twice, e.g. by importing a file again | Overlap of 90 % or more of both shapes counts as a duplicate and is never saved |
| Overlapping fields were saved without a warning | 409 `FIELD_OVERLAP` with the list; the user can cut the overlap, keep it, or keep editing |
| Open rings, 1 m² slivers and continent-sized shapes were accepted | Rings are closed, repeated points dropped, and a field must be 100 m² to 10,000 ha |
| A blank name saved as `""` | Blank names become `Field N` |
| Cancelling the name dialog threw the drawing away, and the shape could not be adjusted | The drawing stays on the map with draggable corners next to a non-modal card |
| Delete removed the field, crops and activities for good | Delete moves the field to Recently deleted, with Undo and Restore; only the owner can delete permanently |
| Boundary edits overwrote the old shape | Every shape change is kept in `field_history` and can be shown or restored |

## API (`backend/src/fields`)

| Endpoint | Purpose |
|---|---|
| `POST /fields` | `{ farmId, boundary, name?, irrigation?, overlap?: reject\|clip\|allow }`. Returns the row plus `repaired`, `clippedHa` and `overlapsKept`. |
| `POST /fields/bulk` | `overlap?: reject\|skip\|clip\|allow`; returns `{ fields, skipped, repaired, clipped }`. In `reject` mode nothing is saved and the 409/400 response lists `problems[]` (`index`, `name`, `code`, `message`, `conflicts`). Items run in one transaction, so each is also checked against earlier items. |
| `POST /fields/check` | `{ boundary, excludeId? }`; returns `{ ok, areaHa, repaired, conflicts, duplicate }`, or `{ ok: false, code, message, where }`. Saves nothing. |
| `PATCH /fields/:id` | Takes the same `overlap` choice for a new boundary. Renames, farm moves and irrigation changes are logged. |
| `GET /fields/:id/history` | Newest first. Shape events carry `boundary` GeoJSON. |
| `POST /fields/:id/history/:hid/restore` | Puts an earlier boundary back, with the same overlap checks. |
| `DELETE /fields/:id` | Archives the field (`archivedAt`). Add `?permanent=true` to delete for good (owner only). |
| `GET /fields/archived?farmId=` · `POST /fields/:id/restore` | Recently deleted list and restore, with overlap checks. |

Rules:
- The order is `normalizePolygon` → `prepare`, which uses `ST_IsValid`, then `ST_MakeValid` only when the result is one polygon → `conflicts` → `clip`. `clip` uses `ST_Difference` and keeps the largest piece.
- Constants: overlap counts when it is ≥ 0.01 ha and ≥ 1 % of the smaller field, so shared edges don't count. A duplicate is ≥ 90 % of both fields. Limits are `MIN_FIELD_HA` and `MAX_FIELD_HA`.
- Overlaps are checked across the whole organization, not just the farm. Archived fields are ignored.
- Archived fields are left out of `/fields/by-farm`, the farm's boundaries GeoJSON, `GET /farms` and the activity and scout by-farm lists. Keep that true for any new list.
- The global exception filter passes `code` and extra keys through. The client reads them from `err.data`, which `apiSend` and `apiPost` attach.

## UI

- **`js/field-editor.js`:** the `#draftPanel` New field card. `FieldEditor.openDraft(layer, type)` runs on `L.Draw.Event.CREATED`.
  - A debounced `/fields/check` feeds `statusHtml` and `showMarks`, which outlines the conflicting fields in amber and marks the crossing point in red.
  - Save is disabled for invalid shapes and duplicates.
  - `askOverlap` renders the cut / keep / keep editing choice.
- **The same file also holds:**
  - the history list (`renderHistory`, shown in the field panel's Overview tab as `#fpHistory`);
  - `deleteField`, which shows a toast with Undo (`showToast(msg, { label, run })`);
  - Recently deleted (`#deletedSection` under the fields list).
- **Boundary edit (`js/field-panel.js`):** the same live check runs in `#fpEditStatus`, and a 409 asks the same question.
- **Import (`workspace.html`):** sends everything in one request. On `FIELD_IMPORT_PROBLEMS`, `#importProblems` lists them and offers skip, clip or allow. Duplicates and invalid shapes are always skipped.

## Tests (`scripts/`)

- `test_field_rules.py` runs 35 API checks on a fresh organization: validation, repair, overlap modes, history, delete/restore, bulk and organization isolation.
- `test_field_flow.py` drives the browser through the flow: draft card, live overlap, cut, duplicate, crossing edges, history and restore, Undo, Recently deleted and import problems. It needs `cdn_routes.py` from agro-workspace-testing.
- Browser tests must register a new organization each run (`cdn_routes.fresh_login()`); otherwise the duplicate rule blocks the fixtures on the second run.

## Next steps

- Seasons as OneSoil has them: a field belongs to a season, each season has its own boundary, and fields are copied to the next season.
- A Cut tool to remove trees or water from inside a field (holes are already accepted).
- Soil data and sensors per field.
