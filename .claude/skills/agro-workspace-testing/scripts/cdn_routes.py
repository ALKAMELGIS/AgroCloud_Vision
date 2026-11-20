import os, re, json, mimetypes, urllib.request, urllib.error
LIBS = os.environ.get('GIS_LIBS', 'libs/node_modules') + '/'
REPO = os.environ.get('REPO', os.getcwd()) + '/'
TW = os.environ.get('TAILWIND_SHIM', 'tailwind-shim.js')

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

SHMOCK = os.environ.get('SHMOCK', '')
SHLOG = []

def sh_mock(route):
    import io, datetime, urllib.parse, base64
    import numpy as np, tifffile
    url = route.request.url
    q = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(url).query))
    cors = {'access-control-allow-origin': '*'}
    SHLOG.append(q)
    if q.get('REQUEST') == 'GetCapabilities':
        xml = '<?xml version="1.0"?><WMS_Capabilities version="1.3.0"><Capability><Layer><Title>root</Title><Layer><Name>TRUE-COLOR</Name></Layer><Layer><Name>NDVI</Name></Layer></Layer></Capability></WMS_Capabilities>'
        return route.fulfill(body=xml, headers={**cors, 'content-type': 'text/xml'})
    if q.get('REQUEST') == 'GetFeature':
        today = datetime.date.today()
        days = [(5, 10.0), (15, 60.0), (25, 5.0)] if q.get('FEATURE_OFFSET', '0') == '0' else []
        feats = [{'type': 'Feature', 'geometry': None, 'properties': {'id': f'S2B_T39RVJ_{d}', 'date': str(today - datetime.timedelta(days=d)), 'time': '07:05:31', 'cloudCoverPercentage': c}} for d, c in days]
        return route.fulfill(body=json.dumps({'type': 'FeatureCollection', 'features': feats}), headers={**cors, 'content-type': 'application/json'})
    if q.get('REQUEST') == 'GetMap':
        w, h = int(q['WIDTH']), int(q['HEIGHT'])
        script = base64.b64decode(q['EVALSCRIPT']).decode()
        assert 'B8A' in script and 'SCL' in script and q['FORMAT'] == 'image/tiff'
        col = np.tile(np.arange(w, dtype=np.float32) / max(1, w - 1), (h, 1))
        nir = 0.3 + 0.3 * col
        old = q['TIME'].split('/')[0] != str(datetime.date.today() - datetime.timedelta(days=5))
        if old: nir = nir + 0.1          # older date greener -> drop to now
        bands = [np.full((h, w), v, np.float32) for v in (0.04, 0.07, 0.05, 0.15)] + [nir, nir, np.full((h, w), 0.2, np.float32), np.full((h, w), 4, np.float32)]
        buf = io.BytesIO(); tifffile.imwrite(buf, np.stack(bands).astype(np.float32), photometric='minisblack', planarconfig='separate')
        return route.fulfill(body=buf.getvalue(), headers={**cors, 'content-type': 'image/tiff'})
    return route.fulfill(status=400, body='<ServiceExceptionReport><ServiceException>bad</ServiceException></ServiceExceptionReport>', headers=cors)

def install(page, api='http://localhost:4000/api/v1'):
    def handler(route):
        url = route.request.url
        if url.startswith('https://services.sentinel-hub.com/ogc/'):
            if SHMOCK: return sh_mock(route)
            return route.abort()
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
