"""Local stand-in for Supabase, for the browser tests (the sandbox cannot reach supabase.co).

It runs the real SQL (supabase/migrations/*_api.sql applied to a local PostGIS database, SB_DSN) and answers
what the site asks Supabase for:
  - Auth:  POST /auth/v1/token?grant_type=password|refresh_token, POST /auth/v1/logout, GET /auth/v1/user
  - RPC:   POST /rest/v1/rpc/{api,me,register_account}
cdn_routes.py sends https://hrhhafiolowjxypbbxxb.supabase.co/* here (handle()).

`python3 sbmock.py serve` also answers the old REST shape on http://localhost:4000/api/v1 (auth/register,
auth/login and every /api/v1 path through public.api), so tests that set data up over HTTP keep working.
Tokens are unsigned JWTs whose payload carries sub and email; that is enough for a local mock.
"""
import base64, json, os, sys, time, urllib.parse
import psycopg2

DSN = os.environ.get('SB_DSN', 'host=localhost dbname=sbtest user=postgres password=pgtest')
import threading
_local = threading.local()
def db():
    c = getattr(_local, 'conn', None)
    if c is None or c.closed:
        c = _local.conn = psycopg2.connect(DSN); c.autocommit = False
    return c

def _b64(d): return base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip('=')
def jwt(sub, email):
    return f"{_b64({'alg': 'HS256', 'typ': 'JWT'})}.{_b64({'sub': str(sub), 'email': email, 'role': 'authenticated', 'aud': 'authenticated', 'exp': int(time.time()) + 3600})}.mock"
def claims(token):
    try:
        p = token.split('.')[1]; p += '=' * (-len(p) % 4)
        return json.loads(base64.urlsafe_b64decode(p))
    except Exception:
        return {}

def _q(sql, args=(), sub=None):
    c = db(); cur = c.cursor()
    try:
        cur.execute("select set_config('request.jwt.claim.sub', %s, true)", (str(sub) if sub else '',))
        cur.execute(sql, args)
        row = cur.fetchone() if cur.description else None
        c.commit()
        return row
    except Exception:
        c.rollback(); raise

def session_for(uid, email):
    t = jwt(uid, email)
    return {'access_token': t, 'token_type': 'bearer', 'expires_in': 3600, 'expires_at': int(time.time()) + 3600,
            'refresh_token': 'r-' + str(uid), 'user': {'id': str(uid), 'email': email, 'aud': 'authenticated', 'role': 'authenticated',
            'app_metadata': {'provider': 'email'}, 'user_metadata': {}, 'created_at': '2026-01-01T00:00:00Z'}}

def password_login(email, password):
    row = _q("select id, email from auth.users where lower(email) = lower(%s) and encrypted_password = crypt(%s, encrypted_password)", (email, password))
    return session_for(row[0], row[1]) if row else None

def rpc(fn, args, sub):
    if fn == 'api':
        row = _q('select public.api(%s, %s, %s::jsonb, %s::jsonb)', (args.get('p_method'), args.get('p_path'), json.dumps(args.get('p_query') or {}), json.dumps(args['p_body']) if args.get('p_body') is not None else None), sub)
    elif fn == 'me':
        row = _q('select public.me()', (), sub)
    elif fn == 'register_account':
        row = _q('select public.register_account(%s, %s, %s, %s)', (args.get('p_organization'), args.get('p_full_name'), args.get('p_email'), args.get('p_password')))
    else:
        return 404, {'message': f'Could not find the function public.{fn}', 'code': 'PGRST202'}
    return 200, row[0]

CORS = {'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'content-type': 'application/json'}

def handle(method, url, headers, body):
    """Answers one Supabase request: returns (status, json-able body)."""
    u = urllib.parse.urlsplit(url); q = dict(urllib.parse.parse_qsl(u.query)); path = u.path
    data = json.loads(body) if body else {}
    auth = (headers.get('authorization') or headers.get('Authorization') or '').replace('Bearer ', '')
    sub = claims(auth).get('sub') if auth.count('.') == 2 and auth.endswith('.mock') else None
    if path == '/auth/v1/token':
        if q.get('grant_type') == 'password':
            s = password_login(data.get('email', ''), data.get('password', ''))
            return (200, s) if s else (400, {'error': 'invalid_grant', 'error_description': 'Invalid login credentials', 'code': 400, 'msg': 'Invalid login credentials'})
        if q.get('grant_type') == 'refresh_token':
            rt = data.get('refresh_token', '')
            row = _q('select id, email from auth.users where id::text = %s', (rt[2:],)) if rt.startswith('r-') else None
            return (200, session_for(row[0], row[1])) if row else (400, {'error': 'invalid_grant', 'error_description': 'Invalid Refresh Token'})
    if path == '/auth/v1/logout': return 204, None
    if path == '/auth/v1/user':
        c = claims(auth)
        return (200, session_for(c['sub'], c.get('email'))['user']) if sub else (401, {'msg': 'invalid JWT'})
    if path.startswith('/rest/v1/rpc/'):
        return rpc(path.rsplit('/', 1)[1], data, sub)
    return 404, {'message': 'not mocked: ' + path}

# ---------------------------------------------------------------- the old REST shape on :4000, for test setup
def rest(method, path, query, body, token):
    if path == '/auth/register':
        st, r = rpc('register_account', {'p_organization': body.get('organizationName'), 'p_full_name': body.get('fullName'), 'p_email': body.get('email'), 'p_password': body.get('password')}, None)
        if not r.get('ok'): return 400, {'statusCode': 400, 'message': r.get('message')}
        path = '/auth/login'
    if path == '/auth/login':
        s = password_login(body.get('email', ''), body.get('password', ''))
        if not s: return 401, {'statusCode': 401, 'message': 'Wrong email or password'}
        me = rpc('me', {}, s['user']['id'])[1]
        return 201, {'accessToken': s['access_token'], 'refreshToken': s['refresh_token'], 'user': me}
    sub = claims(token).get('sub') if token else None
    st, r = rpc('api', {'p_method': method, 'p_path': path, 'p_query': query, 'p_body': body or None}, sub)
    return r['status'], r['body']

def serve(port=4000):
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    class H(BaseHTTPRequestHandler):
        def _go(self):
            u = urllib.parse.urlsplit(self.path)
            n = int(self.headers.get('content-length') or 0); raw = self.rfile.read(n) if n else b''
            body = json.loads(raw) if raw else None
            tok = (self.headers.get('authorization') or '').replace('Bearer ', '')
            try:
                st, out = rest(self.command, u.path.replace('/api/v1', '', 1), dict(urllib.parse.parse_qsl(u.query)), body or {}, tok)
            except Exception as e:
                st, out = 500, {'statusCode': 500, 'message': str(e)}
            data = json.dumps(out).encode()
            self.send_response(st); self.send_header('content-type', 'application/json'); self.send_header('content-length', str(len(data))); self.end_headers(); self.wfile.write(data)
        do_GET = do_POST = do_PATCH = do_DELETE = _go
        def log_message(self, *a): pass
    print(f'sbmock on :{port}', flush=True)
    ThreadingHTTPServer(('127.0.0.1', port), H).serve_forever()

if __name__ == '__main__' and sys.argv[1:] == ['serve']:
    serve(int(os.environ.get('PORT', '4000')))
