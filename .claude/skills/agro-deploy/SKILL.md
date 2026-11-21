---
name: agro-deploy
description: How AgroSyntra One is deployed and run — GitHub Pages serves the whole site (index.html, main.html, workspace.html, js/) from main, and Supabase is the only backend (Auth + PostGIS + the public.api() function that answers the site's REST calls). No Render. Covers SQL changes, the one-time move of data from Render, backups, and the git workflow from a shallow clone. Use it when changes don't show up on the site, an API call fails or 404s, a Supabase/SQL/migration/RLS question comes up, or when pushing changes.
---

# Deploying and running

| Part | Where | Updates |
|---|---|---|
| Site (`*.html`, `js/`, `landing/`) | GitHub Pages, `main` branch root (`.nojekyll`) | about 1 minute after a push to `main` |
| Backend | Supabase project ref `hrhhafiolowjxypbbxxb` (free, PostGIS in schema `extensions`) | SQL in `supabase/migrations/`, applied with the Supabase MCP (`apply_migration`) |
| Sign-in | Supabase Auth (email + password), from the browser with supabase-js 2.45.4 (UMD, jsdelivr) | — |

Render is retired (21 Nov 2026, the user works from GitHub only): `render.yaml` and the deploy workflow are gone.
`backend/` (NestJS) and `frontend/` (Next.js) stay in the repo as reference only; nothing runs them.

## How the site talks to Supabase

- `js/supa.js` (after supabase-js, before page scripts) creates the client with the **publishable** key (public by design)
  and session key `agrosyntra-auth`. It mirrors the token into localStorage `accessToken` and the profile (`rpc('me')`)
  into `user`, because older code reads those.
- The workspace's `authFetch` calls `SB.api(url, init)`, which sends every REST path to
  `rpc('api', { p_method, p_path, p_query, p_body })` and turns `{ status, body }` back into a `Response`. So `apiGet`,
  `apiPost`… and every module kept their REST calls (`/farms`, `/fields/by-farm/:id`, `/fields/check`, …).
  Weather goes from the browser to Open-Meteo directly.
- `public.api()` (SECURITY DEFINER) is the old server in SQL: routes, roles, organization isolation and all field
  rules (normalize → validate/repair → overlaps/duplicates → reject/skip/clip/allow, `copyOf`, history, archive/restore,
  permanent delete). Errors keep the old body: `{ statusCode, message, code?, conflicts?, where?, problems? }`.
  Unknown route → 404 "Cannot GET /api/v1/…".
- Accounts: `register_account(org, name, email, password)` (anon) creates the organization, owner profile and the
  Supabase sign-in (auth.users + auth.identities, bcrypt via pgcrypto), then the page signs in. No confirmation email.
  `ensure_owner()` keeps demo@agrocloud.test / Demo12345! (the prefilled owner); `sync_auth_users()` gives copied users
  a sign-in with their old bcrypt password.
- Security: RLS on for every table with **no policies** — the browser reaches data only through `api()`/`me()`.
  Helpers `_*` have EXECUTE revoked from anon/authenticated. A new table must `ENABLE ROW LEVEL SECURITY`; a new route
  goes into `api()`; then run `get_advisors(security)`.

## SQL changes

1. Edit/add a file in `supabase/migrations/`.
2. Test locally: `sbtest` database (schema of the old backend + stub `auth` schema, see agro-workspace-testing) →
   `psql sbtest -f supabase/migrations/…sql` → `SB_DSN=… python3 supabase/tests/test_api.py` (59 checks) → browser tests.
3. Apply with the Supabase MCP `apply_migration` (large files in parts). The MCP may ask the user to approve; if the
   approval times out, tell the user and wait.

## Moving the data off Render (once)

`.github/workflows/db-move.yml` (Actions → Move database to Supabase → type MOVE). Secrets:
`RENDER_DATABASE_URL` (Render → agrocloud-db → External Database URL) and `DATABASE_URL` (Supabase → Connect →
Session pooler URI with the password). One transaction: empty Supabase tables → copy rows → `sync_auth_users()` →
`ensure_owner()`. Then Render can be deleted (the user does that in the Render dashboard).

## Backups

`.github/workflows/db-backup.yml` nightly (03:17 Dubai) and on demand: pg_dump → gpg AES256 → artifact kept 30 days.
Secrets `DATABASE_URL` (Supabase session pooler) and `BACKUP_PASSPHRASE`; without them it only warns.

## Free-tier facts

- Supabase free: 500 MB, paused after a week without activity (the app's own traffic counts); restore from the dashboard.
- No server: GIS conversion (gdal3.js) and NDVI (geotiff.js / Sentinel Hub) run in the browser.

## Git from this sandbox

- Clones are shallow. Push with `git -c push.negotiate=true push origin main`.
- If the push is rejected, `git fetch --depth=50 origin main` and rebase.
- `gh` GraphQL is blocked here; use the REST API for PRs. The user prefers direct pushes to `main`.
- Never commit `.env`.
- The sandbox cannot reach supabase.co; test against `sbmock.py` (agro-workspace-testing), and check the live site in
  the user's browser pane when one is available.
