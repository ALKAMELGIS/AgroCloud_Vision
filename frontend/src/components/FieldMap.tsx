'use client';

import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw/dist/leaflet.draw.css';
import 'leaflet-draw';
import { Hexagon, Circle as CircleIcon, Plus, X, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';

interface FieldRecord {
  id: string;
  name: string;
  boundaryGeoJson?: any;
}

interface FieldMapProps {
  center: [number, number];
  farmId: string;
  fields: FieldRecord[];
  /** Called after a new field has been saved, so the parent can reload real data from the API. */
  onFieldAdded?: () => void;
}

type DrawMode = 'polygon' | 'circle' | null;

/**
 * خريطة تفاعلية (Leaflet) تعرض حدود الحقول الحقيقية (GeoJSON/PostGIS) وتتيح رسم
 * حقل جديد مباشرة على الخريطة بأداة "Add Field" — مضلّع حر أو دائرة — ثم تسجّله
 * فعلياً عبر POST /fields، فيصبح الحقل الناتج هو الكيان الذي تُبنى عليه بقية
 * عمليات النظام (الطقس، الأقمار الصناعية لاحقاً، سجل العمليات الزراعية...).
 */
export default function FieldMap({ center, farmId, fields, onFieldAdded }: FieldMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMapRef = useRef<L.Map | null>(null);
  const drawnLayerRef = useRef<L.Layer | null>(null);
  const activeHandlerRef = useRef<any>(null);

  const [drawMenuOpen, setDrawMenuOpen] = useState(false);
  const [pendingGeometry, setPendingGeometry] = useState<{ type: 'Polygon'; coordinates: number[][][] } | null>(
    null,
  );
  const [fieldName, setFieldName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ====== تهيئة الخريطة مرة واحدة ======
  useEffect(() => {
    if (!mapRef.current || leafletMapRef.current) return;

    const map = L.map(mapRef.current).setView(center, 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    leafletMapRef.current = map;

    map.on((L as any).Draw.Event.CREATED, (event: any) => {
      const layer = event.layer;
      const geometry = layerToPolygonGeoJson(layer, event.layerType);

      // أزِل أي رسم مؤقّت سابق لم يُحفظ بعد
      if (drawnLayerRef.current) {
        map.removeLayer(drawnLayerRef.current);
      }
      layer.setStyle?.({ color: '#16a34a', weight: 2, fillOpacity: 0.12, dashArray: '4 4' });
      layer.addTo(map);
      drawnLayerRef.current = layer;

      setPendingGeometry(geometry);
      setFieldName('');
      setError(null);
    });

    return () => {
      map.remove();
      leafletMapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ====== رسم حدود الحقول الحقيقية الموجودة فعلاً ======
  useEffect(() => {
    const map = leafletMapRef.current;
    if (!map) return;

    const layers: L.Layer[] = [];
    fields.forEach((field) => {
      if (!field.boundaryGeoJson) return;
      const layer = L.geoJSON(field.boundaryGeoJson, {
        style: { color: '#16a34a', weight: 2, fillOpacity: 0.15 },
      }).bindPopup(field.name);
      layer.addTo(map);
      layers.push(layer);
    });

    return () => {
      layers.forEach((l) => map.removeLayer(l));
    };
  }, [fields]);

  function startDrawing(mode: DrawMode) {
    const map = leafletMapRef.current;
    if (!map || !mode) return;

    setDrawMenuOpen(false);
    activeHandlerRef.current?.disable?.();

    const shapeOptions = { color: '#16a34a', weight: 2, fillOpacity: 0.12 };
    const handler =
      mode === 'polygon'
        ? new (L as any).Draw.Polygon(map, { allowIntersection: false, showArea: true, shapeOptions })
        : new (L as any).Draw.Circle(map, { shapeOptions });

    activeHandlerRef.current = handler;
    handler.enable();
  }

  function cancelPending() {
    const map = leafletMapRef.current;
    if (map && drawnLayerRef.current) {
      map.removeLayer(drawnLayerRef.current);
    }
    drawnLayerRef.current = null;
    setPendingGeometry(null);
    setFieldName('');
    setError(null);
  }

  async function saveField() {
    if (!pendingGeometry || !fieldName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await api.post('/fields', {
        name: fieldName.trim(),
        farmId,
        boundary: pendingGeometry,
      });

      const map = leafletMapRef.current;
      if (map && drawnLayerRef.current) {
        map.removeLayer(drawnLayerRef.current);
      }
      drawnLayerRef.current = null;
      setPendingGeometry(null);
      setFieldName('');
      onFieldAdded?.();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Could not save this field. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="relative h-[460px] w-full overflow-hidden rounded-xl border border-border/50">
      <div ref={mapRef} className="h-full w-full" />

      {/* زر "Add Field" الاحترافي + قائمة اختيار أداة الرسم */}
      <div className="absolute right-3 top-3 z-[500] flex flex-col items-end gap-2">
        <button
          type="button"
          onClick={() => setDrawMenuOpen((v) => !v)}
          className="flex items-center gap-2 rounded-lg bg-card px-3 py-2 text-[13px] font-medium text-foreground shadow-md ring-1 ring-border/60 transition-colors hover:bg-primary hover:text-primary-foreground"
        >
          <Plus className="h-4 w-4" strokeWidth={2} />
          Add Field
        </button>

        {drawMenuOpen && (
          <div className="flex flex-col gap-1 rounded-lg bg-card p-1.5 shadow-md ring-1 ring-border/60">
            <button
              type="button"
              onClick={() => startDrawing('polygon')}
              className="flex items-center gap-2 rounded-md px-3 py-2 text-left text-[13px] text-foreground/80 transition-colors hover:bg-primary/10 hover:text-primary"
            >
              <Hexagon className="h-4 w-4" strokeWidth={1.5} />
              Draw polygon
            </button>
            <button
              type="button"
              onClick={() => startDrawing('circle')}
              className="flex items-center gap-2 rounded-md px-3 py-2 text-left text-[13px] text-foreground/80 transition-colors hover:bg-primary/10 hover:text-primary"
            >
              <CircleIcon className="h-4 w-4" strokeWidth={1.5} />
              Draw circle
            </button>
          </div>
        )}
      </div>

      {/* لوحة تسمية وحفظ الحقل بعد الرسم */}
      {pendingGeometry && (
        <div className="absolute bottom-3 left-1/2 z-[500] w-[min(420px,92%)] -translate-x-1/2 rounded-xl bg-card p-3 shadow-xl ring-1 ring-border/60">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[13px] font-medium text-foreground">Name this field</span>
            <button
              type="button"
              onClick={cancelPending}
              className="rounded-md p-1 text-muted-foreground hover:bg-black/5 hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex gap-2">
            <input
              autoFocus
              value={fieldName}
              onChange={(e) => setFieldName(e.target.value)}
              placeholder="e.g. North Wheat Block"
              className="flex-1 rounded-md border border-border/60 bg-background px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-primary/40"
            />
            <button
              type="button"
              disabled={saving || !fieldName.trim()}
              onClick={saveField}
              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-[13px] font-medium text-primary-foreground transition-opacity disabled:opacity-50"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save
            </button>
          </div>
          {error && <p className="mt-2 text-[12px] text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}

/**
 * يحوّل طبقة مرسومة (مضلّع حر أو دائرة) إلى GeoJSON Polygon قياسي متوافق مع
 * ST_GeomFromGeoJSON في الـ Backend. الدائرة تُقرَّب إلى مضلّع بـ 64 ضلعاً
 * لأن GeoJSON لا يملك نوع هندسي "Circle" أصلاً.
 */
function layerToPolygonGeoJson(layer: any, layerType: string): { type: 'Polygon'; coordinates: number[][][] } {
  if (layerType === 'circle') {
    const latlng = layer.getLatLng();
    const radius = layer.getRadius(); // بالأمتار
    return { type: 'Polygon', coordinates: [circleToRingCoordinates(latlng, radius)] };
  }

  const geoJson = layer.toGeoJSON();
  return geoJson.geometry as { type: 'Polygon'; coordinates: number[][][] };
}

function circleToRingCoordinates(center: L.LatLng, radiusMeters: number, points = 64): number[][] {
  const earthRadius = 6378137; // نصف قطر الأرض بالأمتار (WGS84)
  const latRad = (center.lat * Math.PI) / 180;
  const ring: number[][] = [];

  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * 2 * Math.PI;
    const dx = radiusMeters * Math.cos(angle);
    const dy = radiusMeters * Math.sin(angle);
    const dLat = dy / earthRadius;
    const dLng = dx / (earthRadius * Math.cos(latRad));
    const pointLat = center.lat + (dLat * 180) / Math.PI;
    const pointLng = center.lng + (dLng * 180) / Math.PI;
    ring.push([pointLng, pointLat]); // GeoJSON: [lng, lat]
  }

  return ring;
}
