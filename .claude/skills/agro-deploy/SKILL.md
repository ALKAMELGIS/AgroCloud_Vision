---
name: agro-deploy
description: How AgroOne Vision is deployed and run — GitHub Pages serves the static site (index.html, main.html, workspace.html, js/) from main, Render runs the NestJS backend + PostGIS (render.yaml) and the optional Next.js frontend, plus the local no-Docker setup and the git workflow from a shallow clone. Use it when changes don't show up on the site, the API sleeps or 404s on a new route, a deploy/env var/CORS question comes up, or when pushing changes.
---

# Deploying and running

| Part | Where | Updates |
|---|---|---|
| Static site (`*.html`, `js/`) | GitHub Pages, `main` branch root (`.nojekyll`) | about 1 minute after a push to `main` |
| API (`backend/`) | Render web service `agrocloud-backend` (free, sleeps) | on push if auto-deploy is on, else **Manual Deploy** |
| Database | Render Postgres 15 + PostGIS, `DB_SYNCHRONIZE=true` | new columns (e.g. `irrigation`, activity `product/rate/unit`) are created on boot |
| Next.js app | Render `agrocloud-frontend` | optional second client |

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
- `gh` GraphQL is blocked here. Open PRs with the REST API: `gh api repos/ALKAMELGIS/AgroCloud_Vision/pulls -f title=… -f head=… -f base=main -F body=@file`.
- The user prefers direct pushes to `main` for requested changes.
- Never commit `.env` / `.env.local`; they are in `.gitignore`.
- A stop hook flags uncommitted or unpushed work. Build output (`next-env.d.ts`, tsconfig rewrites) belongs in its own commit or should be excluded.

## Local run

See the agro-workspace-testing skill. In short: PostGIS, then
`backend/.env` from `.env.example`, then `npm run build && node dist/main`.
The owner account is seeded automatically.
