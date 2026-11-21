---
name: agro-deploy
description: How AgroSyntra One is deployed and run — GitHub Pages serves the static site (index.html, main.html, workspace.html, js/) from main, Render runs the NestJS backend + PostGIS (render.yaml) and the optional Next.js frontend, plus the local no-Docker setup and the git workflow from a shallow clone. Use it when changes don't show up on the site, the API sleeps or 404s on a new route, a deploy/env var/CORS question comes up, or when pushing changes.
---

# Deploying and running

| Part | Where | Updates |
|---|---|---|
| Static site (`*.html`, `js/`) | GitHub Pages, `main` branch root (`.nojekyll`) | about 1 minute after a push to `main` |
| API (`backend/`) | Render web service `agrocloud-backend` (free, sleeps) | on push if auto-deploy is on, else **Manual Deploy** |
| Database | Supabase project `AgroCloud` (ref `hrhhafiolowjxypbbxxb`, ap-south-1, free; PostGIS in schema `extensions`). Backend reads `DATABASE_URL` = session pooler URI (IPv4, TLS). Render Postgres `agrocloud-db` is the old copy | migrations in `backend/src/migrations` run on boot (`migrationsRun`); `DB_SYNCHRONIZE=false` |
| Next.js app | Render `agrocloud-frontend` | optional second client |

## Schema changes (migrations)

`synchronize` is off in production: it can drop a renamed column with its data.
Every entity change ships with a migration in the same commit:

1. Make a scratch DB from the current schema (`createdb x`, `CREATE EXTENSION postgis`,
   `DB_DATABASE=x npx typeorm migration:run -d dist/config/typeorm.config.js`).
2. `DB_DATABASE=x npx typeorm-ts-node-commonjs migration:generate -d src/config/typeorm.config.ts src/migrations/<Name>`.
3. Read it: a rename must be `RENAME COLUMN`, never DROP + ADD.
4. Check there is no drift: the same generate again prints "No changes in database schema".

`1795258352581-Baseline.ts` is the schema as of 2026-11-21. On a database that
already has tables (built by the old synchronize) it records itself and does nothing.

## Supabase

- Free plan: 500 MB, paused after a week without activity (the app's own traffic counts); a pause keeps the data, restore from the dashboard.
- Every table in `public` has RLS on with no policies, so Supabase's REST API exposes nothing; the backend connects as `postgres` (bypasses RLS). A migration that adds a table must also `ALTER TABLE … ENABLE ROW LEVEL SECURITY`, then check `get_advisors(security)`.
- The schema was created by the Supabase MCP (`apply_migration agroone_baseline`) with the `migrations` row already recorded.
- Data move from Render: `.github/workflows/db-move.yml` (manual, type MOVE). Copies rows only, one transaction, refuses if Supabase already has organisations. Run it before the backend points at Supabase, or the seeded owner blocks it.
- `typeorm.config.ts`: `DATABASE_URL` wins over `DB_*`; TLS on (CA not pinned) unless localhost or `DB_SSL=false`; pool max `DB_POOL_MAX` (5).

## CORS

`main.ts` allows `https://alkamelgis.github.io`, `agrocloud-frontend*.onrender.com`
and localhost only. More origins: env `CORS_ORIGINS` (comma-separated). A new
custom domain or a renamed GitHub account must be added here, or every call fails.

## Backups

`.github/workflows/db-backup.yml` runs nightly (03:17 Dubai) and on demand:
pg_dump (postgres:17 image) → gpg AES256 → workflow artifact kept 30 days.
Needs secrets `DATABASE_URL` (Render external URL) and `BACKUP_PASSPHRASE`;
without them it only warns. Restore steps are in the file's header.

## Order of release

The static site goes live before the API. New pages must work, or degrade
cleanly, against the old API:

- `/fields/bulk` → falls back to one `POST /fields` per field on 404.
- `/fields/by-farm/:id/boundaries.geojson` → falls back to one boundary per field.
- Fields the old API doesn't know (`irrigation`) are rejected by
  `forbidNonWhitelisted`, so tell the user to redeploy the backend before using them.

After pushing, tell the user exactly which Render service to redeploy.

## Free-tier facts

- The API sleeps after idle, so the first request takes 30–60 s. Pages say so in their error text.
- 512 MB RAM: no GDAL or raster processing on the server. GIS conversion (gdal3.js) and NDVI (geotiff.js) run in the browser.
- JSON body limit is 25 MB (`main.ts`) for large imported boundaries.

## Git from this sandbox

- Clones are shallow. Push with `git -c push.negotiate=true push origin main`.
- If the push is rejected, `git fetch --depth=50 origin main` and rebase. The user also merges PRs on GitHub, so expect new commits.
- `gh` GraphQL is blocked here. Open PRs with the REST API: `gh api repos/ALKAMELGIS/AgroSyntra_One/pulls -f title=… -f head=… -f base=main -F body=@file`.
- The user prefers direct pushes to `main` for requested changes.
- Never commit `.env` / `.env.local`; they are in `.gitignore`.
- A stop hook flags uncommitted or unpushed work. Build output (`next-env.d.ts`, tsconfig rewrites) belongs in its own commit or should be excluded.

## Local run

See the agro-workspace-testing skill. In short: PostGIS, then
`backend/.env` from `.env.example`, then `npm run build && node dist/main`.
The owner account is seeded automatically.
