import os, re, mimetypes, urllib.request, urllib.error
# Env: GIS_LIBS = node_modules dir with the CDN packages, REPO = repo root, TAILWIND_SHIM = optional js
LIBS = os.environ.get('GIS_LIBS', os.path.abspath('node_modules')) + '/'
REPO = os.environ.get('REPO', os.path.abspath(os.path.join(os.path.dirname(__file__), '../../../..'))) + '/'
TW = os.environ.get('TAILWIND_SHIM', '')

def local_for(url):
    m = re.match(r'https://cdn\.jsdelivr\.net/npm/((?:@[^/]+/)?[^@/]+)@[^/]+/(.*)', url) or \
        re.match(r'https://unpkg\.com/((?:@[^/]+/)?[^@/]+)@[^/]+/(.*)', url)
    if m: return os.path.join(LIBS, m.group(1), m.group(2).split('?')[0])
    if url.startswith('https://cdn.tailwindcss.com'): return TW
    m = re.match(r'https://alkamelgis\.github\.io/AgroCloud_Vision/(.*)', url)
    if m: return os.path.join(REPO, m.group(1).split('?')[0] or 'index.html')
    return None

def install(page, api='http://localhost:4000/api/v1'):
    def handler(route):
        url = route.request.url
        if url.startswith('https://agrocloud-backend-e9ea.onrender.com/api/v1'):
            new = api + url[len('https://agrocloud-backend-e9ea.onrender.com/api/v1'):]
            r = route.request
            cors = {'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*'}
            if r.method == 'OPTIONS':
                return route.fulfill(status=204, headers=cors)
            hdrs = {k: v for k, v in r.headers.items() if k.lower() in ('authorization', 'content-type')}
            req = urllib.request.Request(new, data=r.post_data_buffer, headers=hdrs, method=r.method)
            try:
                resp = urllib.request.urlopen(req); status = resp.status; body = resp.read()
            except urllib.error.HTTPError as e:
                status = e.code; body = e.read()
            return route.fulfill(status=status, body=body, headers={**cors, 'content-type': 'application/json'})
        p = local_for(url)
        if p and os.path.isfile(p):
            ct = mimetypes.guess_type(p)[0] or 'application/octet-stream'
            if p.endswith('.wasm'): ct = 'application/wasm'
            if p.endswith('.js'): ct = 'application/javascript'
            return route.fulfill(path=p, headers={'content-type': ct, 'access-control-allow-origin': '*'})
        if url.startswith('http://localhost') or url.startswith('data:') or url.startswith('blob:'):
            return route.continue_()
        if 'arcgisonline' in url:  # map tiles: blank
            return route.fulfill(status=204)
        print('BLOCKED', url)
        return route.abort()
    page.route('**/*', handler)
