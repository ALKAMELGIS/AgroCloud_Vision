'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useParams, useRouter } from 'next/navigation';
import { api, getCurrentUser } from '@/lib/api';
import WeatherWidget from '@/components/WeatherWidget';
import { AppShell } from '@/components/ui/dashboard-sidebar';

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

  if (!farm) {
    return (
      <AppShell title="Loading…">
        <main className="p-6 text-muted-foreground">Loading...</main>
      </AppShell>
    );
  }

  return (
    <AppShell title={farm.name}>
      <main className="p-6">
        <button onClick={() => router.push('/dashboard')} className="mb-4 text-sm text-primary underline">
          ← Back to Farms
        </button>

        <h1 className="mb-4 text-xl font-bold text-foreground">{farm.name}</h1>

        <section className="mb-6">
          <h2 className="mb-2 font-semibold text-foreground/80">Weather (next 7 days)</h2>
          <WeatherWidget days={weatherDays} />
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold text-foreground/80">Field Map</h2>
            <span className="text-[12px] text-muted-foreground">
              Use "Add Field" to draw a boundary directly on the map
            </span>
          </div>
          {farm.latitude && farm.longitude ? (
            <FieldMap
              center={[farm.latitude, farm.longitude]}
              farmId={farm.id}
              fields={fieldsWithBoundary}
              onFieldAdded={loadFarm}
            />
          ) : (
            <p className="text-sm text-muted-foreground">No coordinates set for this farm yet.</p>
          )}
        </section>

        <section className="mt-6">
          <h2 className="mb-2 font-semibold text-foreground/80">Fields ({farm.fields?.length || 0})</h2>
          <ul className="divide-y rounded-lg border border-border/60 bg-card">
            {farm.fields?.map((f) => (
              <li key={f.id} className="flex justify-between p-3 text-sm">
                <span className="text-foreground">{f.name}</span>
                <span className="text-muted-foreground">{f.areaHectares?.toFixed(2)} ha</span>
              </li>
            ))}
            {(!farm.fields || farm.fields.length === 0) && (
              <li className="p-3 text-sm text-muted-foreground">
                No fields yet — draw one on the map above to get started.
              </li>
            )}
          </ul>
        </section>
      </main>
    </AppShell>
  );
}
