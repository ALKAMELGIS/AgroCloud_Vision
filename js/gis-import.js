/*
 * AgroSyntra One — GIS import
 *
 * Reads field boundaries from GeoJSON, KML / KMZ, zipped ESRI Shapefile
 * (.shp .shx .dbf .prj), zipped File Geodatabase (.gdb) and GeoPackage,
 * converts any projection to WGS84 (EPSG:4326) and turns every polygon into
 * a field. A `name` attribute (any case) becomes the field name.
 *
 * Everything runs in the browser. Parsers load lazily on first use:
 *   GeoJSON            built-in (proj4 only when the file declares a CRS)
 *   KML / KMZ          @tmcw/togeojson (+ JSZip for KMZ)
 *   Shapefile          shpjs (reads .prj, reprojects with proj4)
 *   GDB / GeoPackage   gdal3.js (GDAL compiled to WebAssembly, ~30 MB, cached)
 *
 * Public API (window.GisImport):
 *   readFiles(files, onStatus)  -> { format, crs, layers: [{ name, features }] }
 *   toFieldPolygons(result, baseName) -> [{ name, geometry, areaHa, layer }]
 *   ACCEPT                       value for <input type=file accept=...>
 */
(function () {
  'use strict';

  var CDN = 'https://cdn.jsdelivr.net/npm/';
  var LIBS = {
    jszip: { url: CDN + 'jszip@3.10.1/dist/jszip.min.js', global: 'JSZip' },
    togeojson: { url: CDN + '@tmcw/togeojson@5.8.1/dist/togeojson.umd.js', global: 'toGeoJSON' },
    shp: { url: CDN + 'shpjs@4.0.4/dist/shp.min.js', global: 'shp' },
    proj4: { url: CDN + 'proj4@2.11.0/dist/proj4.js', global: 'proj4' },
    gdal: { url: CDN + 'gdal3.js@2.8.1/dist/package/gdal3.js', global: 'initGdalJs' },
  };
  var GDAL_PATH = CDN + 'gdal3.js@2.8.1/dist/package';

  var ACCEPT = '.geojson,.json,.kml,.kmz,.zip,.gpkg,.shp,.shx,.dbf,.prj,.cpg';

  // ---------------------------------------------------------------- loading

  var pending = {};
  function loadLib(key) {
    var lib = LIBS[key];
    if (window[lib.global]) return Promise.resolve(window[lib.global]);
    if (pending[key]) return pending[key];
    pending[key] = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = lib.url;
      s.async = true;
      s.onload = function () {
        if (window[lib.global]) resolve(window[lib.global]);
        else reject(new Error('Could not start the ' + key + ' reader'));
      };
      s.onerror = function () {
        delete pending[key];
        reject(new Error('Could not download the ' + key + ' reader. Check your connection and try again.'));
      };
      document.head.appendChild(s);
    });
    return pending[key];
  }

  var gdalPromise = null;
  function getGdal(onStatus) {
    if (!gdalPromise) {
      onStatus && onStatus('Loading the GIS engine (first time only, about 30 MB)');
      gdalPromise = loadLib('gdal')
        .then(function (initGdalJs) { return initGdalJs({ path: GDAL_PATH, useWorker: false }); })
        .catch(function (err) { gdalPromise = null; throw err; });
    }
    return gdalPromise;
  }

  // ---------------------------------------------------------------- helpers

  function ext(name) {
    var m = /\.([a-z0-9]+)$/i.exec(name || '');
    return m ? m[1].toLowerCase() : '';
  }
  function baseName(name) {
    return (name || 'Field').replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
  }
  function readText(file) { return file.text ? file.text() : new Response(file).text(); }
  function readBuffer(file) { return file.arrayBuffer ? file.arrayBuffer() : new Response(file).arrayBuffer(); }

  function asCollection(obj) {
    if (!obj) return { type: 'FeatureCollection', features: [] };
    if (obj.type === 'FeatureCollection') return obj;
    if (obj.type === 'Feature') return { type: 'FeatureCollection', features: [obj] };
    if (obj.type && obj.coordinates || obj.type === 'GeometryCollection') {
      return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: obj }] };
    }
    throw new Error('This JSON file is not GeoJSON');
  }

  function mapPositions(geometry, fn) {
    if (!geometry) return geometry;
    if (geometry.type === 'GeometryCollection') {
      return { type: 'GeometryCollection', geometries: geometry.geometries.map(function (g) { return mapPositions(g, fn); }) };
    }
    function walk(c) { return typeof c[0] === 'number' ? fn(c) : c.map(walk); }
    return { type: geometry.type, coordinates: walk(geometry.coordinates) };
  }

  function forEachPosition(geometry, fn) {
    if (!geometry) return;
    if (geometry.type === 'GeometryCollection') { geometry.geometries.forEach(function (g) { forEachPosition(g, fn); }); return; }
    (function walk(c) { if (typeof c[0] === 'number') fn(c); else c.forEach(walk); })(geometry.coordinates || []);
  }

  function looksGeographic(layers) {
    var ok = true, seen = 0;
    layers.forEach(function (layer) {
      layer.features.forEach(function (f) {
        if (!ok || seen > 5000) return;
        forEachPosition(f.geometry, function (p) {
          seen++;
          if (!(Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90)) ok = false;
        });
      });
    });
    return ok;
  }

  // EPSG code from a GeoJSON "crs" member ("EPSG:3857", "urn:ogc:def:crs:EPSG::32614", CRS84 ...)
  function crsCode(fc) {
    var name = fc && fc.crs && fc.crs.properties && fc.crs.properties.name;
    if (!name) return null;
    if (/CRS84|EPSG:+4326$/i.test(name)) return 4326;
    var m = /EPSG:+(\d+)/i.exec(name);
    return m ? parseInt(m[1], 10) : null;
  }

  // Projections proj4 can handle without a lookup; anything else goes to GDAL.
  function proj4Def(code) {
    if (code === 3857 || code === 900913 || code === 3785 || code === 102100) {
      return '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +no_defs';
    }
    if (code >= 32601 && code <= 32660) return '+proj=utm +zone=' + (code - 32600) + ' +datum=WGS84 +units=m +no_defs';
    if (code >= 32701 && code <= 32760) return '+proj=utm +zone=' + (code - 32700) + ' +south +datum=WGS84 +units=m +no_defs';
    return null;
  }

  // ---------------------------------------------------------------- readers

  async function readGeoJsonText(text, name, onStatus) {
    var fc;
    try { fc = asCollection(JSON.parse(text)); }
    catch (e) { throw new Error(name + ': ' + (e.message.indexOf('GeoJSON') >= 0 ? e.message : 'not valid JSON')); }
    var code = crsCode(fc);
    if (code && code !== 4326) {
      var def = proj4Def(code);
      if (def) {
        var proj4 = await loadLib('proj4');
        var to = proj4(def, 'EPSG:4326');
        fc.features = fc.features.map(function (f) {
          return Object.assign({}, f, { geometry: mapPositions(f.geometry, function (p) { return to.forward([p[0], p[1]]); }) });
        });
      } else {
        // Uncommon projection: let GDAL (which ships the full EPSG database) convert it.
        return readWithGdal(new File([text], baseName(name) + '.geojson'), [], 'GeoJSON', onStatus);
      }
    }
    var layers = [{ name: baseName(name), features: fc.features }];
    if (!looksGeographic(layers)) {
      throw new Error(name + ': coordinates are not longitude/latitude and the file does not say which projection they use. Export it in WGS84, or as a Shapefile with its .prj or a GeoPackage.');
    }
    return { format: 'GeoJSON', crs: code && code !== 4326 ? 'EPSG:' + code : 'WGS84', layers: layers };
  }

  async function readKmlText(text, name) {
    var tgj = await loadLib('togeojson');
    var doc = new DOMParser().parseFromString(text, 'text/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error(name + ': not a valid KML file');
    var fc = tgj.kml(doc);
    return { format: 'KML', crs: 'WGS84', layers: [{ name: baseName(name), features: fc.features }] };
  }

  async function readKmz(buffer, name) {
    var JSZip = await loadLib('jszip');
    var zip = await JSZip.loadAsync(buffer);
    var kmls = Object.keys(zip.files).filter(function (p) { return /\.kml$/i.test(p) && !zip.files[p].dir; });
    if (!kmls.length) throw new Error(name + ': no .kml inside this KMZ');
    kmls.sort(function (a, b) { return (/(^|\/)doc\.kml$/i.test(b) ? 1 : 0) - (/(^|\/)doc\.kml$/i.test(a) ? 1 : 0); });
    var result = await readKmlText(await zip.files[kmls[0]].async('string'), name);
    result.format = 'KMZ';
    return result;
  }

  function prjLabel(prjText) {
    if (!prjText) return null;
    var m = /^\s*(?:PROJCS|GEOGCS|PROJCRS|GEOGCRS)\s*\[\s*"([^"]+)"/i.exec(prjText);
    return m ? m[1].replace(/_/g, ' ') : 'from .prj';
  }

  async function readShapefileZip(buffer, name, zip) {
    var shp = await loadLib('shp');
    var prjs = Object.keys(zip.files).filter(function (p) { return /\.prj$/i.test(p); });
    var prjText = prjs.length ? await zip.files[prjs[0]].async('string') : null;
    var out = await shp(buffer);
    var collections = Array.isArray(out) ? out : [out];
    var layers = collections.map(function (fc) { return { name: baseName(fc.fileName || name), features: fc.features || [] }; });
    if (!looksGeographic(layers)) {
      throw new Error(name + ': this Shapefile has no .prj, so its projection is unknown. Zip it together with the .prj file.');
    }
    var label = prjLabel(prjText);
    return { format: 'Shapefile', crs: label || 'WGS84 (no .prj, assumed)', layers: layers };
  }

  async function readWithGdal(file, vfs, formatLabel, onStatus) {
    var Gdal = await getGdal(onStatus);
    onStatus && onStatus('Reading ' + formatLabel);
    var opened = await Gdal.open(file, [], vfs || []);
    if (!opened.datasets || !opened.datasets.length) {
      var why = (opened.errors || []).map(function (e) { return e.message || e; }).join(' ');
      throw new Error((file.name || formatLabel) + ': GDAL could not open it' + (why ? ' (' + why.trim() + ')' : ''));
    }
    var layers = [], crs = null, stamp = Date.now();
    try {
      for (var d = 0; d < opened.datasets.length; d++) {
        var ds = opened.datasets[d];
        var info = await Gdal.getInfo(ds);
        var layerNames = (info.layers || []).map(function (l) { return l.name; });
        for (var i = 0; i < layerNames.length; i++) {
          var lname = layerNames[i];
          // Source CRS, read from one feature so the dialog can say what was converted.
          if (!crs) {
            try {
              var probe = await Gdal.ogr2ogr(ds, ['-f', 'GeoJSON', '-limit', '1', lname], 'p' + stamp + '_' + d + '_' + i);
              var pj = JSON.parse(new TextDecoder().decode(await Gdal.getFileBytes(probe)));
              var c = crsCode(pj);
              crs = c && c !== 4326 ? 'EPSG:' + c : 'WGS84';
            } catch (e) { /* label only */ }
          }
          onStatus && onStatus('Converting layer ' + lname + ' to WGS84');
          var out = await Gdal.ogr2ogr(ds, ['-f', 'GeoJSON', '-t_srs', 'EPSG:4326', '-lco', 'RFC7946=YES', lname], 'l' + stamp + '_' + d + '_' + i);
          var fc = JSON.parse(new TextDecoder().decode(await Gdal.getFileBytes(out)));
          layers.push({ name: lname, features: fc.features || [] });
        }
      }
    } finally {
      for (var k = 0; k < opened.datasets.length; k++) { try { await Gdal.close(opened.datasets[k]); } catch (e) { /* ignore */ } }
    }
    return { format: formatLabel, crs: crs || 'unknown', layers: layers };
  }

  // One file (or an in-memory blob) -> result
  async function readOne(file, onStatus) {
    var name = file.name || 'file';
    var e = ext(name);
    onStatus && onStatus('Reading ' + name);

    if (e === 'geojson' || e === 'json') return readGeoJsonText(await readText(file), name, onStatus);
    if (e === 'kml') return readKmlText(await readText(file), name);
    if (e === 'kmz') return readKmz(await readBuffer(file), name);
    if (e === 'gpkg') return readWithGdal(file, [], 'GeoPackage', onStatus);
    if (e === 'shp') throw new Error('Select the .shp together with its .shx, .dbf and .prj files, or zip them first');

    if (e === 'zip') {
      var JSZip = await loadLib('jszip');
      var buffer = await readBuffer(file);
      var zip = await JSZip.loadAsync(buffer);
      var paths = Object.keys(zip.files);
      if (paths.some(function (p) { return /\.gdb\//i.test(p) || /\.gdbtable$/i.test(p); })) {
        return readWithGdal(file, ['vsizip'], 'File Geodatabase', onStatus);
      }
      if (paths.some(function (p) { return /\.shp$/i.test(p); })) return readShapefileZip(buffer, name, zip);
      var inner = paths.find(function (p) { return /\.(gpkg|kml|kmz|geojson|json)$/i.test(p) && !zip.files[p].dir; });
      if (inner) {
        var blob = await zip.files[inner].async('blob');
        return readOne(new File([blob], inner.replace(/^.*\//, '')), onStatus);
      }
      throw new Error(name + ': no Shapefile, File Geodatabase, GeoPackage, KML or GeoJSON inside this zip');
    }
    throw new Error(name + ': unsupported file type. Use GeoJSON, KML, KMZ, a zipped Shapefile or File Geodatabase, or a GeoPackage');
  }

  async function readFiles(fileList, onStatus) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) throw new Error('No file selected');

    // Loose Shapefile parts picked together -> zip them in memory.
    var shpParts = files.filter(function (f) { return /\.(shp|shx|dbf|prj|cpg)$/i.test(f.name); });
    var others = files.filter(function (f) { return shpParts.indexOf(f) < 0; });
    var jobs = others.slice();
    if (shpParts.length) {
      if (!shpParts.some(function (f) { return ext(f.name) === 'shp'; })) throw new Error('A .shp file is missing from the selection');
      if (!shpParts.some(function (f) { return ext(f.name) === 'dbf'; })) throw new Error('A .dbf file is missing from the selection');
      var JSZip = await loadLib('jszip');
      var z = new JSZip();
      shpParts.forEach(function (f) { z.file(f.name, f); });
      var shpName = shpParts.find(function (f) { return ext(f.name) === 'shp'; }).name;
      jobs.push(new File([await z.generateAsync({ type: 'blob' })], baseName(shpName) + '.zip'));
    }

    var merged = null;
    for (var i = 0; i < jobs.length; i++) {
      var r = await readOne(jobs[i], onStatus);
      if (!merged) merged = r;
      else {
        merged.layers = merged.layers.concat(r.layers);
        if (merged.format !== r.format) merged.format = 'Mixed';
        if (merged.crs !== r.crs) merged.crs = 'several';
      }
    }
    merged.fileName = files.length === 1 ? files[0].name : files.length + ' files';
    return merged;
  }

  // ---------------------------------------------------------------- polygons -> fields

  // Authalic (equal-area) radius: matches PostGIS geography ST_Area to ~0.02%
  var R = 6371007.2;
  function ringArea(ring) {
    // Spherical excess approximation used by Leaflet.draw / Google; m²
    var area = 0, n = ring.length;
    if (n < 3) return 0;
    for (var i = 0; i < n - 1; i++) {
      var p1 = ring[i], p2 = ring[i + 1];
      area += ((p2[0] - p1[0]) * Math.PI / 180) * (2 + Math.sin(p1[1] * Math.PI / 180) + Math.sin(p2[1] * Math.PI / 180));
    }
    return Math.abs(area * R * R / 2);
  }
  function polygonAreaHa(coords) {
    var a = ringArea(coords[0]);
    for (var i = 1; i < coords.length; i++) a -= ringArea(coords[i]);
    return Math.max(a, 0) / 10000;
  }

  function cleanRing(ring) {
    var out = [];
    for (var i = 0; i < ring.length; i++) {
      var p = ring[i];
      if (!p || !isFinite(p[0]) || !isFinite(p[1])) continue;
      var q = [+p[0], +p[1]];
      var last = out[out.length - 1];
      if (!last || last[0] !== q[0] || last[1] !== q[1]) out.push(q);
    }
    if (out.length && (out[0][0] !== out[out.length - 1][0] || out[0][1] !== out[out.length - 1][1])) out.push(out[0].slice());
    return out.length >= 4 ? out : null;
  }

  function polygonsOf(geometry) {
    if (!geometry) return [];
    if (geometry.type === 'Polygon') return [geometry.coordinates];
    if (geometry.type === 'MultiPolygon') return geometry.coordinates;
    if (geometry.type === 'GeometryCollection') {
      return geometry.geometries.reduce(function (acc, g) { return acc.concat(polygonsOf(g)); }, []);
    }
    return [];
  }

  function nameOf(props) {
    if (!props) return '';
    var keys = Object.keys(props);
    var key = keys.find(function (k) { return k.toLowerCase() === 'name'; });
    var v = key != null ? props[key] : null;
    return v == null ? '' : String(v).trim();
  }

  function toFieldPolygons(result, fallbackBase) {
    var fields = [], unnamed = 0, skipped = 0;
    var base = baseName(fallbackBase || result.fileName || 'Field');
    result.layers.forEach(function (layer) {
      layer.features.forEach(function (feature) {
        var polys = polygonsOf(feature.geometry);
        if (!polys.length) return;
        var name = nameOf(feature.properties);
        if (!name) name = base + ' ' + (++unnamed);
        var parts = [];
        polys.forEach(function (rings) {
          var outer = cleanRing(rings[0] || []);
          if (!outer) { skipped++; return; }
          var holes = rings.slice(1).map(cleanRing).filter(Boolean);
          parts.push([outer].concat(holes));
        });
        parts.forEach(function (coords, i) {
          fields.push({
            name: parts.length > 1 ? name + ' (' + (i + 1) + ')' : name,
            geometry: { type: 'Polygon', coordinates: coords },
            areaHa: polygonAreaHa(coords),
            layer: layer.name,
          });
        });
      });
    });
    fields.skipped = skipped;
    return fields;
  }

  window.GisImport = {
    ACCEPT: ACCEPT,
    readFiles: readFiles,
    toFieldPolygons: toFieldPolygons,
    polygonAreaHa: polygonAreaHa,
    preloadGdal: function () { return getGdal(); },
  };
})();
