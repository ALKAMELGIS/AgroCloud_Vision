---
name: agro-auth-owner
description: Sign-in, registration, roles and the default owner account in AgroSyntra One — main.html (live sign-in on GitHub Pages), frontend/src/app/login (Next.js), JWT auth, the six roles, and the owner account seeded on every backend start (demo@agrocloud.test / Demo12345!, overridable with OWNER_EMAIL / OWNER_PASSWORD / OWNER_ORGANIZATION). Use it when someone cannot sign in, asks for the owner/admin account, sees "[object Object]" or another unreadable error, wants roles or permissions changed, or edits either login page.
---

# Auth and the owner account

- **The live sign-in page is `main.html`** on GitHub Pages. The Next.js
  `frontend/src/app/login` is a second client (Render). Change both or say which
  one you changed: the user once tested `main.html` after only the Next.js page
  had been edited.
- **Owner seeding** (`AuthService.onApplicationBootstrap`): on every start the
  owner account exists, is active, has role `owner`, and has the configured
  password. If missing, it is created with its own organization. The defaults
  live in a public repo, so recommend setting `OWNER_PASSWORD` on Render for
  any real deployment.
- **Both login pages prefill the owner account** and set
  `autocomplete="off"` / `new-password` with custom input names, so Chrome
  doesn't overwrite them with saved credentials. A light-blue field background
  means the browser autofilled it, not the code. Switching to "Create an
  organization" clears the prefill.
- **Errors are always strings.** `HttpExceptionFilter` flattens Nest's
  `{message: string[]}` into one string, and both clients still read any shape
  (`getErrorMessage` in the Next.js app, inline in `main.html`). This was the
  cause of "[object Object]".
- **Roles:** owner, manager, gis_analyst, agronomist, field_supervisor, viewer.
  Fields (create/import/edit) are owner, manager and gis_analyst; deleting is
  owner and manager. See agro-field-operations for crops and activities.
- **JWT:** access token 15 min, refresh 7 days; secrets come from env
  (`generateValue: true` on Render). When renewal fails the workspace removes
  only `accessToken`, `refreshToken` and `user` and returns to `main.html`.
  Never `localStorage.clear()`: alkamelgis.github.io is one origin shared by
  the owner's other sites, and clearing it wiped their data and the language.
- **`main.html` never jumps by itself.** With a saved token it shows "You are
  signed in as …" with *Open the workspace* / *Use another account* (the old
  silent redirect bounced people between the pages with stale tokens).
- **Sign-in waits for the free server:** `call()` retries 502/503/504 and
  network errors for up to 90 s (30 s per try) and shows "The server is waking
  up · N s" in `#waitMsg`; the email is trimmed and lower-cased; a double click
  sends one request; a non-JSON reply still gives a readable error.

## Session renewal (access 15 min, refresh 7 days)

- `POST /auth/refresh { refreshToken }` (throttled 30/min) verifies with `JWT_REFRESH_SECRET`, checks the user still exists and is active, and returns a new access + refresh pair. An access token is not accepted as a refresh token.
- Workspace: every API call goes through `authFetch` — on a 401 it renews once (`renewSession`, one shared in-flight promise) and retries. Only when renewal fails does it sign out, via `AppLogout`, which keeps per-browser preferences (theme, area unit, layers…). Never `localStorage.clear()` on 401 again: that both logged users out every 15 minutes and wiped their settings.
- Needs a backend deploy on Render for `/auth/refresh`. Test: `agro-workspace-testing/scripts/test_session.py`. Long browser tests must also set `refreshToken`, or they bounce to sign-in after 15 minutes.
