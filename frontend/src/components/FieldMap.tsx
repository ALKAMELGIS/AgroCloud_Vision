'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface FieldMapProps {
  center: [number, number];
  fields: { id: string; name: string; boundaryGeoJson?: any }[];
}

/**
 * خريطة تفاعلية بسيطة (Leaflet) تعرض حدود الحقول (GeoJSON) القادمة من الـ Backend
 * (PostGIS). جاهزة لاحقاً لإضافة طبقات NDVI/الأقمار الصناعية فوق نفس الخريطة (Phase 2).
 */
export default function FieldMap({ center, fields }: FieldMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!mapRef.current || leafletMapRef.current) return;

    const map = L.map(mapRef.current).setView(center, 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    leafletMapRef.current = map;

    return () => {
      map.remove();
      leafletMapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  return <div ref={mapRef} className="h-[420px] w-full rounded-xl border" />;
}
