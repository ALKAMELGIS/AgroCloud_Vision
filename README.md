# AgroSyntra One — Core (Phase 1)

A multi-tenant agricultural SaaS platform. This is the **real, working foundation**: a live NestJS backend, Next.js frontend, PostGIS database, auth/RBAC, and real weather data — no mock data. Later phases (satellite/NDVI, AI, IoT, mobile, billing) build on top of this same base.

## Structure

```
AgroSyntra_One/
├── backend/     # NestJS + TypeScript + PostgreSQL/PostGIS (API)
├── frontend/    # Next.js + React + Leaflet (web UI)
└── docker-compose.yml
```

## Requirements

- Node.js 20+
- PostgreSQL 15+ with PostGIS (or use Docker below — easiest)
- Docker + Docker Compose (optional, recommended)

## Quick start (Docker)

```bash
cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local
docker compose up --build
```

- Frontend: http://localhost:3000
- API: http://localhost:4000/api/v1
- Database: PostgreSQL+PostGIS on port 5432

## Manual setup (no Docker)

```bash
# 1) Database — create it and enable PostGIS
CREATE EXTENSION IF NOT EXISTS postgis;

# 2) Backend
cd backend && cp .env.example .env && npm install && npm run start:dev

# 3) Frontend
cd frontend && cp .env.local.example .env.local && npm install && npm run dev
```

Tables are created automatically on first run (`DB_SYNCHRONIZE=true`).

## First use

1. Open `http://localhost:3000` → Register — creates an Organization and your first user as **Owner**.
2. Log in → add a Farm.
3. Add a field via the API (map-drawing UI is a later update):
   ```bash
   curl -X POST http://localhost:4000/api/v1/fields \
     -H "Authorization: Bearer <accessToken>" \
     -H "Content-Type: application/json" \
     -d '{"name":"Field 1","farmId":"<farmId>","boundary":{"type":"Polygon","coordinates":[[[31.20,30.05],[31.21,30.05],[31.21,30.06],[31.20,30.06],[31.20,30.05]]]}}'
   ```
4. Open the farm page to see the field on the map with real weather for its location.

## Environment variables

- `EOS_API_KEY` / `EOS_API_ID` in `backend/.env` are reserved for the Phase 2 satellite integration — **never commit real values**.
- `.env` and `.env.local` are already excluded via `.gitignore`.

## Weather — Open-Meteo (open source, optional self-hosting)

`backend/src/weather/weather.service.ts` uses the open-source [Open-Meteo](https://github.com/open-meteo/open-meteo) engine.

**Default (works out of the box):** `OPEN_METEO_FORECAST_URL` / `OPEN_METEO_ARCHIVE_URL` are left blank, so the service falls back to the free public API (`api.open-meteo.com`) — no API key needed.

**To self-host instead** (more control / higher rate limits):
```bash
docker run -it --rm -v open_meteo_data:/app/data ghcr.io/open-meteo/open-meteo \
  sync ecmwf_ifs025 temperature_2m,precipitation,wind_speed_10m
docker compose --profile weather up -d weather-api
```
Then in `backend/.env`:
```bash
OPEN_METEO_FORECAST_URL=http://weather-api:8080/v1/forecast
OPEN_METEO_ARCHIVE_URL=http://weather-api:8080/v1/archive
```
No code changes needed — `WeatherService` reads these at runtime and falls back to the public API if left blank.

## UI components (shadcn/ui)

`frontend/src/components/ui/` follows the standard shadcn path:

- `dashboard-sidebar.tsx` — the app's real sidebar (`SidebarNav` + `AppShell`), wired to live AgroSyntra One modules and used in `app/dashboard/page.tsx`.
- `frontend/src/lib/utils.ts` — the standard `cn()` Tailwind class helper.
- `frontend/components.json` — shadcn CLI config.
- Color tokens live in `globals.css` and are wired into `tailwind.config.js`.

To add more official shadcn components later, run inside `frontend/`:
```bash
npx shadcn@latest add button dialog table
```

## Roles (RBAC)

`owner` · `manager` · `gis_analyst` · `agronomist` · `field_supervisor` · `viewer` — defined in `backend/src/common/decorators/roles.decorator.ts`.

## Roadmap

Phase 2: satellite/NDVI · Phase 3: AI · Phase 4: IoT · Phase 5: mobile · Phase 6: billing & multi-org.
