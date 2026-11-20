---
name: agro-auth-owner
description: Sign-in, registration, roles and the default owner account in AgroCloud Vision — main.html (live sign-in on GitHub Pages), frontend/src/app/login (Next.js), JWT auth, the six roles, and the owner account seeded on every backend start (demo@agrocloud.test / Demo12345!, overridable with OWNER_EMAIL / OWNER_PASSWORD / OWNER_ORGANIZATION). Use it when someone cannot sign in, asks for the owner/admin account, sees "[object Object]" or another unreadable error, wants roles or permissions changed, or edits either login page.
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
  (`generateValue: true` on Render). The workspace clears `localStorage` and
  returns to `main.html` on any 401.
