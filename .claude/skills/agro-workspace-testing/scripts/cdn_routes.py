import os, re, json, mimetypes, urllib.request, urllib.error
LIBS = os.environ.get('GIS_LIBS', 'libs/node_modules') + '/'
REPO = os.environ.get('REPO', os.getcwd()) + '/'
TW = os.environ.get('TAILWIND_SHIM', 'tailwind-shim.js')

def local_for(url):
    m = re.match(r'https://cdn\.jsdelivr\.net/npm/((?:@[^/]+/)?[^@/]+)@[^/]+/(.*)', url) or \
        re.match(r'https://unpkg\.com/((?:@[^/]+/)?[^@/]+)@[^/]+/(.*)', url)
    if m: return os.path.join(LIBS, m.group(1), m.group(2).split('?')[0])
    if url.startswith('https://cdn.tailwindcss.com'): return TW
    m = re.match(r'https://alkamelgis\.github\.io/AgroSyntra_One/(.*)', url)
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
        red = np.full((h, w), 0.05, np.float32)
        if q.get('CRS') == 'EPSG:3857' and w > 200:
            # the public demo (js/demo.js) looks for centre pivots: draw six green discs on dry ground
            yy, xx = np.mgrid[0:h, 0:w]
            nir = np.full((h, w), 0.22, np.float32); red = np.full((h, w), 0.16, np.float32)
            for cx, cy, r in [(55, 60, 40), (150, 60, 40), (245, 62, 38), (60, 165, 40), (155, 168, 40), (280, 170, 30)]:
                d = (xx - cx) ** 2 + (yy - cy) ** 2 < r * r
                nir[d] = 0.45; red[d] = 0.05
        bands = [np.full((h, w), v, np.float32) for v in (0.04, 0.07)] + [red, np.full((h, w), 0.15, np.float32)] + [nir, nir, np.full((h, w), 0.2, np.float32), np.full((h, w), 4, np.float32)]
        if 'bands: 7' in script:   # landing/motion/real.js: B02 B03 B04 B08 B8A B11 SCL
            bands = [np.full((h, w), v, np.float32) for v in (0.04, 0.07)] + [red, nir, nir, np.full((h, w), 0.2, np.float32), np.full((h, w), 4, np.float32)]
        buf = io.BytesIO(); tifffile.imwrite(buf, np.stack(bands).astype(np.float32), photometric='minisblack', planarconfig='separate')
        return route.fulfill(body=buf.getvalue(), headers={**cors, 'content-type': 'image/tiff'})
    return route.fulfill(status=400, body='<ServiceExceptionReport><ServiceException>bad</ServiceException></ServiceExceptionReport>', headers=cors)

def meteo_mock(route):
    """Open-Meteo forecast/archive: a steady made-up season (hot days above 35 °C, some rain, soil moisture)."""
    import datetime, math, urllib.parse
    q = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(route.request.url).query))
    a = datetime.date.fromisoformat(q.get('start_date')); b = datetime.date.fromisoformat(q.get('end_date'))
    days = [a + datetime.timedelta(days=i) for i in range((b - a).days + 1)]
    doy = lambda d: d.timetuple().tm_yday
    tmax = [round(31 + 9 * math.sin((doy(d) - 100) / 365 * 2 * math.pi) + (3 if doy(d) % 9 == 0 else 0), 1) for d in days]
    out = {'daily': {'time': [str(d) for d in days], 'temperature_2m_max': tmax, 'temperature_2m_min': [round(t - 12, 1) for t in tmax],
                     'precipitation_sum': [round(8 * (doy(d) % 11 == 0) + 2.5 * (doy(d) % 17 == 0), 1) for d in days],
                     'windspeed_10m_max': [round(12 + 6 * math.sin(doy(d) / 7), 1) for d in days]}}
    if 'hourly' in q:
        times = [f'{d}T{h:02d}:00' for d in days for h in range(0, 24, 6)]
        out['hourly'] = {'time': times, 'soil_moisture_0_to_7cm': [round(0.2 + 0.08 * math.sin(i / 40), 3) for i in range(len(times))]}
    return route.fulfill(body=json.dumps(out), headers={'access-control-allow-origin': '*', 'content-type': 'application/json'})

_TILE = None
def esri_tile():
    global _TILE
    if _TILE is None:
        import io
        from PIL import Image
        buf = io.BytesIO(); Image.new('RGB', (256, 256), (196, 178, 140)).save(buf, 'PNG'); _TILE = buf.getvalue()
    return _TILE

def fonts_css():
    out = []
    for fam, pkg, subset in [('IBM Plex Sans', 'ibm-plex-sans', 'latin'), ('IBM Plex Sans Arabic', 'ibm-plex-sans-arabic', 'arabic')]:
        for w in (400, 500, 600):
            out.append(f"@font-face{{font-family:'{fam}';font-weight:{w};font-style:normal;src:url(https://fonts.gstatic.com/local/{pkg}/files/{pkg}-{subset}-{w}-normal.woff2) format('woff2');}}")
    return '\n'.join(out)

# Tests put the old-style accessToken in localStorage; turn it into the supabase-js session that js/supa.js reads.
SUPA_PRELUDE = r"""(function(){try{var t=localStorage.getItem('accessToken');if(t&&/\.mock$/.test(t)&&!localStorage.getItem('agrosyntra-auth')){var p=JSON.parse(atob(t.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
localStorage.setItem('agrosyntra-auth',JSON.stringify({access_token:t,refresh_token:'r-'+p.sub,token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:p.sub,email:p.email,aud:'authenticated',role:'authenticated',app_metadata:{provider:'email'},user_metadata:{}}}));}}catch(e){}})();
"""

def install(page, api='http://localhost:4000/api/v1'):
    import sbmock
    def handler(route):
        url = route.request.url
        if url.startswith('https://hrhhafiolowjxypbbxxb.supabase.co/'):
            r = route.request
            if r.method == 'OPTIONS': return route.fulfill(status=204, headers=sbmock.CORS)
            try:
                st, out = sbmock.handle(r.method, url, r.headers, r.post_data)
            except Exception as e:
                st, out = 500, {'message': str(e)}
            return route.fulfill(status=st, body='' if out is None else json.dumps(out), headers=sbmock.CORS)
        if url.startswith('https://alkamelgis.github.io/AgroSyntra_One/js/supa.js'):
            return route.fulfill(body=SUPA_PRELUDE + open(os.path.join(REPO, 'js/supa.js')).read(), headers={'content-type': 'application/javascript'})
        if url.startswith('https://fonts.googleapis.com/css2'):
            return route.fulfill(body=fonts_css(), headers={'content-type': 'text/css', 'access-control-allow-origin': '*'})
        if url.startswith('https://fonts.gstatic.com/local/'):
            path = os.path.join(LIBS, '@fontsource', url.split('/local/', 1)[1])
            return route.fulfill(path=path, headers={'content-type': 'font/woff2', 'access-control-allow-origin': '*'})
        if url.startswith('https://api.open-meteo.com/v1/forecast') or url.startswith('https://archive-api.open-meteo.com/v1/archive'):
            return meteo_mock(route)
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
        if 'arcgisonline' in url:  # map tiles: a plain desert-coloured tile (the landing scene needs real image bytes)
            return route.fulfill(body=esri_tile(), headers={'content-type': 'image/png', 'access-control-allow-origin': '*'})
        print('BLOCKED', url)
        return route.abort()
    page.route('**/*', handler)

def fresh_login(api='http://localhost:4000/api/v1'):
    """Registers a new organization per test run: saved fields are checked for duplicates across the organization."""
    import time
    stamp = str(int(time.time() * 1000))
    body = json.dumps({'organizationName': 'Test ' + stamp, 'fullName': 'Test Owner', 'email': f'owner{stamp}@agrocloud.test', 'password': 'Owner12345!'}).encode()
    urllib.request.urlopen(urllib.request.Request(api + '/auth/register', data=body, headers={'Content-Type': 'application/json'}, method='POST'))
    body = json.dumps({'email': f'owner{stamp}@agrocloud.test', 'password': 'Owner12345!'}).encode()
    return json.load(urllib.request.urlopen(urllib.request.Request(api + '/auth/login', data=body, headers={'Content-Type': 'application/json'}, method='POST')))
