import os, re, json, mimetypes, urllib.request, urllib.error
# Env: GIS_LIBS = node_modules with the CDN packages, REPO = repo root, TAILWIND_SHIM = optional js, S2MOCK = mock Sentinel-2 dir
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

S2MOCK = os.environ.get('S2MOCK', '')
S2LOG = []

def serve_range(route, path, ctype):
    data = open(path, 'rb').read()
    rng = route.request.headers.get('range')
    cors = {'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range, content-length', 'accept-ranges': 'bytes', 'content-type': ctype}
    if rng:
        m = re.match(r'bytes=(\d+)-(\d*)', rng)
        a = int(m.group(1)); b = int(m.group(2)) if m.group(2) else len(data) - 1
        b = min(b, len(data) - 1)
        S2LOG.append((os.path.basename(path), b - a + 1))
        return route.fulfill(status=206, body=data[a:b + 1], headers={**cors, 'content-range': f'bytes {a}-{b}/{len(data)}'})
    S2LOG.append((os.path.basename(path), len(data)))
    return route.fulfill(status=200, body=data, headers=cors)

def install(page, api='http://localhost:4000/api/v1'):
    def handler(route):
        url = route.request.url
        if S2MOCK and url.startswith('https://earth-search.aws.element84.com/v1/search'):
            if route.request.method == 'OPTIONS':
                return route.fulfill(status=204, headers={'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*'})
            S2LOG.append(('search', json.loads(route.request.post_data or '{}').get('collections')))
            return route.fulfill(path=os.path.join(S2MOCK, 'search.json'), headers={'access-control-allow-origin': '*', 'content-type': 'application/geo+json'})
        if S2MOCK and url.startswith('https://e84-earth-search-sentinel-data.s3.us-west-2.amazonaws.com/'):
            if route.request.method == 'OPTIONS':
                return route.fulfill(status=204, headers={'access-control-allow-origin': '*', 'access-control-allow-headers': '*'})
            return serve_range(route, os.path.join(S2MOCK, url.rsplit('/', 1)[1]), 'image/tiff')
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
