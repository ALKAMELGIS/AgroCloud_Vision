---
name: agro-field-operations
description: The AgroCloud Vision field record after a boundary exists — field edit/move/delete (PATCH/DELETE /fields/:id), crops and growth stages (/crops), the activity log with product/rate/unit (/activities, by field and by farm), the field panel UI (js/field-panel.js) and the farm Activity log calendar (js/activity-log.js), plus organization isolation. Use it for anything about crops, seasons, operations, fertilizer/spraying/irrigation records, scouting visits, reports/CSV of operations, roles on these endpoints, or a "field panel" change.
---

# Field operations

## API (NestJS, all behind JWT + RolesGuard)

| Endpoint | Roles | Notes |
|---|---|---|
| `PATCH /fields/:id` | owner, manager, gis_analyst | `name`, `irrigation` (`''` clears), `farmId` (move), `boundary` (area recalculated) |
| `DELETE /fields/:id` | owner, manager | crops and activities cascade; weather snapshots deleted explicitly |
| `POST /crops`, `PATCH /crops/:id`, `DELETE /crops/:id` | owner, manager, agronomist | growth stage: planted → … → harvested |
| `PATCH /crops/:id/growth-stage` | + field_supervisor | |
| `POST /activities`, `DELETE /activities/:id` | everyone except viewer | types: tillage, planting, fertilization, irrigation, spraying, pruning, harvest, scouting_visit, other; optional `product`, `rate` (≥ 0), `unit` |
| `GET /activities/by-farm/:farmId?from=&to=` | any | joined with field name, feeds the calendar and CSV |

**Every handler checks the organization.** Fields go through
`FieldsService.assertFieldInOrganization(fieldId, orgId)`, which joins
fields → farms and filters on `organizationId`; farms go through
`assertFarmInOrganization`. Another tenant's ids return **404**, never 403, so
ids cannot be probed. Crops and activities modules import `FieldsModule` to
reuse the check. Any new endpoint that takes a field, crop or activity id needs
the same check.

## UI

- **`js/field-panel.js`:** opens from a map click or the field list (`openFieldPanel(id, tab)`).
  - Tabs: Overview (rename / irrigation / move farm; this season; latest activities; 7-day weather at the field centroid), Crops, Activities, Monitoring (agro-satellite-ndvi skill).
  - Edit boundary uses Leaflet.draw's `L.Edit.Poly` and shows the live area. Delete asks first.
  - It dispatches `activities:changed` and `fieldpanel:close`.
- **`js/activity-log.js`:** month calendar for the farm, with fields as rows, days as columns, a dot per activity coloured by type, a type filter, CSV with a BOM (opens correctly in Excel, including Arabic text), and clicking a field opens its panel on Activities.
- **Default units follow the activity:** fertilizer kg/ha, spraying L/ha, irrigation mm, harvest t/ha.
- **NDVI compare can log a `scouting_visit`** with the anomaly areas and their coordinates in the notes.

Both files use workspace globals (`state`, `apiGet/Post/Patch/Delete`, `icon`,
`formatHa`, `showToast` …) and load after the main script.

## Scout tasks (`js/scout.js`, `backend/src/scout`)

`ScoutTask`: field, title, issue (pests, disease, weeds, water_stress,
nutrient, other), priority (low/medium/high), status (open, in_progress, done;
`closedAt` set on done), dueDate, lat/lng, assignee, notes. API: `POST /scout-tasks`, `GET
/scout-tasks/by-farm/:farmId` (with field name; open first, by due date),
`PATCH/DELETE /scout-tasks/:id`, all with the organization check. The UI shows
pins coloured by priority, the nav badge counts overdue tasks, a new task is a
click inside a field, and "Create scout task" in field Analytics pre-fills it
from the largest NDVI drop. CSV export.

## Next steps from the research (in order)

1. Rain and growing degree days counted from the planting date (Open-Meteo archive).
2. Photos on scout tasks (needs file storage) and a scout report tab.
3. Multi-season productivity (more than one year of imagery) for zones; see agro-vra-zones.
4. Lab results import for soil samples, interpolated into P&K maps.
