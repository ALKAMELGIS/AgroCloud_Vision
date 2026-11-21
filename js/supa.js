/*
 * AgroSyntra One — the site talks to Supabase directly (no server of its own).
 *
 * Load after @supabase/supabase-js (UMD, global `supabase`) and before the page scripts.
 *  - SB.api(url, init): the workspace's REST calls (/farms, /fields/…) go to the Postgres function
 *    public.api(method, path, query, body), which answers { status, body } like the old server did.
 *    Weather goes straight to Open-Meteo. Returns a fetch Response, so apiGet/apiPost stay as they were.
 *  - SB.signIn / SB.register / SB.signOut for main.html; the session is kept and refreshed by supabase-js.
 *  - For the code that reads them, the access token and the profile are mirrored into
 *    localStorage "accessToken" and "user" (as the old sign-in stored them).
 * The publishable key is public by design: every table has row-level security on and no policies,
 * so the browser reaches data only through public.api(), which checks the signed-in user.
 */
(function () {
  'use strict';
  if (window.DEMO) return;   // the landing demo has its own read-only API
  const SUPABASE_URL = 'https://hrhhafiolowjxypbbxxb.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_qG4G8SmoVQbxQ0oRxtRlwQ_Mut1TFHQ';
  const STORAGE_KEY = 'agrosyntra-auth';
  if (!window.supabase || !supabase.createClient) { console.error('supabase-js did not load'); return; }

  const ls = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage off */ } },
    del: (k) => { try { localStorage.removeItem(k); } catch { /* storage off */ } },
  };
  const client = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: STORAGE_KEY },
  });

  // Mirror the stored session now (synchronously), so the page knows at once whether it is signed in.
  function mirror(session) {
    if (session && session.access_token) ls.set('accessToken', session.access_token);
    else { ls.del('accessToken'); ls.del('user'); ls.del('refreshToken'); }
  }
  try { const s = JSON.parse(ls.get(STORAGE_KEY) || 'null'); mirror(s && (s.currentSession || s)); } catch { mirror(null); }
  client.auth.onAuthStateChange((event, session) => { if (event !== 'INITIAL_SESSION' || session) mirror(session); });

  const json = (body, status = 200) => new Response(JSON.stringify(body ?? null), { status, headers: { 'Content-Type': 'application/json' } });

  async function weather(u, historical) {
    const p = new URL(u, location.href).searchParams;
    const api = new URL(historical ? 'https://archive-api.open-meteo.com/v1/archive' : 'https://api.open-meteo.com/v1/forecast');
    api.searchParams.set('latitude', p.get('lat')); api.searchParams.set('longitude', p.get('lng'));
    api.searchParams.set('start_date', p.get('start')); api.searchParams.set('end_date', p.get('end'));
    api.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,precipitation_sum,windspeed_10m_max'); api.searchParams.set('timezone', 'auto');
    if (historical) api.searchParams.set('hourly', 'soil_moisture_0_to_7cm');
    const r = await fetch(api); if (!r.ok) throw new Error('weather ' + r.status);
    const d = await r.json();
    const soil = new Map();
    if (d.hourly && d.hourly.time) d.hourly.time.forEach((t, i) => { const v = d.hourly.soil_moisture_0_to_7cm[i]; if (v == null) return; const day = t.slice(0, 10); if (!soil.has(day)) soil.set(day, []); soil.get(day).push(v); });
    const mean = (a) => (a && a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
    const fieldId = (new URL(u, location.href).pathname.match(/\/weather\/field\/([^/]+)/) || [])[1] || null;
    return { fieldId, source: 'open-meteo', days: (d.daily ? d.daily.time : []).map((date, i) => ({ date, temperatureMaxC: d.daily.temperature_2m_max[i], temperatureMinC: d.daily.temperature_2m_min[i], precipitationMm: d.daily.precipitation_sum[i], windSpeedMaxKmh: d.daily.windspeed_10m_max[i], soilMoisture: mean(soil.get(date)) })) };
  }

  async function api(url, init = {}) {
    const u = new URL(url, location.href);
    const path = u.pathname.replace(/^.*\/api\/v1/, '') || '/';
    const method = (init.method || 'GET').toUpperCase();
    if (/^\/weather\/field\/[^/]+\/(history|forecast)/.test(path)) {
      try { return json(await weather(url, /\/history/.test(path))); } catch { return json({ statusCode: 502, message: 'Weather is not available right now' }, 502); }
    }
    const query = {}; u.searchParams.forEach((v, k) => { query[k] = v; });
    let body = null;
    if (init.body) { try { body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body; } catch { body = null; } }
    const { data: s } = await client.auth.getSession();   // refreshes an expired token first
    if (!s || !s.session) return json({ statusCode: 401, message: 'Sign in again' }, 401);
    const { data, error } = await client.rpc('api', { p_method: method, p_path: path, p_query: query, p_body: body });
    if (error) {
      const expired = /jwt|token|401/i.test(`${error.message} ${error.code}`);
      return json({ statusCode: expired ? 401 : 502, message: expired ? 'Sign in again' : `Could not reach the database: ${error.message}` }, expired ? 401 : 502);
    }
    return json(data && data.body, (data && data.status) || 200);
  }

  async function loadProfile() {
    const { data, error } = await client.rpc('me');
    if (error || !data) throw new Error(error ? error.message : 'This account has no organization');
    ls.set('user', JSON.stringify(data));
    return data;
  }

  async function signIn(email, password) {
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw new Error(/invalid login credentials/i.test(error.message) ? 'Wrong email or password' : error.message);
    mirror(data.session);
    await loadProfile();
    return data;
  }

  async function register(organizationName, fullName, email, password) {
    const { data, error } = await client.rpc('register_account', { p_organization: organizationName, p_full_name: fullName, p_email: email, p_password: password });
    if (error) throw new Error(error.message);
    if (!data || !data.ok) throw new Error((data && data.message) || 'Could not create the organization');
    return signIn(email, password);
  }

  async function signOut() {
    try { await client.auth.signOut({ scope: 'local' }); } catch { /* offline: the local session is dropped below */ }
    ls.del(STORAGE_KEY); mirror(null);
  }

  if (ls.get('accessToken') && !ls.get('user')) loadProfile().catch(() => {});
  window.SB = { client, api, signIn, register, signOut, loadProfile, url: SUPABASE_URL };
})();
