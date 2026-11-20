'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useParams, useRouter } from 'next/navigation';
import { api, getCurrentUser } from '@/lib/api';
import WeatherWidget from '@/components/WeatherWidget';

// Leaflet يحتاج window، لذا يُحمَّل فقط في المتصفح (بدون Server-Side Rendering)
const FieldMap = dynamic(() => import('@/components/FieldMap'), { ssr: false });

interface Field {
  id: string;
  name: string;
  areaHectares: number;
}

interface Farm {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  fields: Field[];
}

export default function FarmDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [farm, setFarm] = useState<Farm | null>(null);
  const [fieldsWithBoundary, setFieldsWithBoundary] = useState<any[]>([]);
  const [weatherDays, setWeatherDays] = useState<any[]>([]);

  useEffect(() => {
    if (!getCurrentUser()) {
      router.replace('/login');
      return;
    }
    loadFarm();
  }, [params.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadFarm() {
    const { data } = await api.get<Farm>(`/farms/${params.id}`);
    setFarm(data);

    const withBoundaries = await Promise.all(
      (data.fields || []).map(async (field) => {
        const { data: geojson } = await api.get(`/fields/${field.id}/boundary.geojson`);
        return { ...field, boundaryGeoJson: geojson };
      }),
    );
    setFieldsWithBoundary(withBoundaries);

    if (data.latitude && data.longitude) {
      const today = new Date();
      const in7Days = new Date(Date.now() + 7 * 86400000);
      const fmt = (d: Date) => d.toISOString().slice(0, 10);
      const firstFieldId = data.fields?.[0]?.id;
      if (firstFieldId) {
        const { data: weather } = await api.get(`/weather/field/${firstFieldId}/forecast`, {
          params: {
            lat: data.latitude,
            lng: data.longitude,
            start: fmt(today),
            end: fmt(in7Days),
          },
        });
        setWeatherDays(weather.days);
      }
    }
  }

  if (!farm) return <main className="p-6 text-gray-400">Loading...</main>;

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <button onClick={() => router.push('/dashboard')} className="mb-4 text-sm text-brand-700 underline">
        ← Back to Farms
      </button>

      <h1 className="mb-4 text-xl font-bold text-brand-900">{farm.name}</h1>

      <section className="mb-6">
        <h2 className="mb-2 font-semibold text-gray-700">Weather (next 7 days)</h2>
        <WeatherWidget days={weatherDays} />
      </section>

      <section>
        <h2 className="mb-2 font-semibold text-gray-700">Field Map</h2>
        {farm.latitude && farm.longitude ? (
          <FieldMap center={[farm.latitude, farm.longitude]} fields={fieldsWithBoundary} />
        ) : (
          <p className="text-sm text-gray-400">No coordinates set for this farm yet.</p>
        )}
      </section>

      <section className="mt-6">
        <h2 className="mb-2 font-semibold text-gray-700">Fields ({farm.fields?.length || 0})</h2>
        <ul className="divide-y rounded-lg border bg-white">
          {farm.fields?.map((f) => (
            <li key={f.id} className="flex justify-between p-3 text-sm">
              <span>{f.name}</span>
              <span className="text-gray-400">{f.areaHectares?.toFixed(2)} ha</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
