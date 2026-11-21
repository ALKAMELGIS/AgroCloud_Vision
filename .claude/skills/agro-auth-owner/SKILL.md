---
name: agro-auth-owner
description: Sign-in, registration, roles and the default owner account in AgroSyntra One — main.html (live sign-in on GitHub Pages), frontend/src/app/login (Next.js), Supabase Auth via js/supa.js, the six roles checked inside public.api(), and the owner account Admin@AgroSyntra.com (stored as admin@agrosyntra.com; its password lives only in Supabase, never in this public repo or page) kept by public.ensure_owner(). Use it when someone cannot sign in, asks for the owner/admin account, sees "[object Object]" or another unreadable error, wants roles or permissions changed, or edits either login page.
---

# Auth and the owner account (Supabase)

- **Sign-in is Supabase Auth** from the browser (`js/supa.js`): `SB.signIn` = `signInWithPassword`, then
  `rpc('me')` → localStorage `user`; the session lives in `agrosyntra-auth` and supabase-js refreshes it. The old
  NestJS JWT + `/auth/refresh` are gone with Render. A leftover old token is dropped on load (no session → no token).
- **Create an organization:** `rpc('register_account', org, full name, email, password)` (anon) makes the
  organization, the owner profile (`public.users`, same id as the auth user) and the sign-in, then the page signs in.
  No confirmation e-mail. Same e-mail twice, a bad e-mail or a password under 8 characters → readable message.
- **Owner account:** `public.ensure_owner()` keeps Admin@AgroSyntra.com (stored as admin@agrosyntra.com; its password lives only in Supabase, never in this public repo or page) (the page prefills the e-mail only). The repo is
  public, so for real use change that password in Supabase → Authentication → Users.
- **Roles** (owner, manager, gis_analyst, agronomist, field_supervisor, viewer) are checked in `public.api()`:
  farms create = owner/manager; fields create/import/edit = owner/manager/gis_analyst; archive/restore/delete =
  owner/manager; crops = owner/manager/agronomist (stage also field_supervisor); activities and scout tasks = all but
  viewer. 403 "Your role cannot do this…".
- **Errors are strings:** `public.api` returns `{ statusCode, message, … }` like the old filter, so "[object Object]"
  cannot come back. Wrong password → "Wrong email or password".
- **`main.html` never jumps by itself.** With a saved session it shows "You are signed in as …" with *Open the
  workspace* / *Use another account* (`SB.signOut`).
- **Sign-out** (`AppLogout` in js/settings.js) calls `SB.signOut()` and removes only `accessToken`, `refreshToken`,
  `user`. Never `localStorage.clear()`: alkamelgis.github.io is shared with the owner's other sites.
- **Moving users from Render:** `sync_auth_users()` (run by db-move.yml) gives each copied user a Supabase sign-in with
  the same bcrypt hash, so old passwords keep working.
- The Next.js `frontend/` login is retired with Render.
