'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, clearSession, getCurrentUser } from '@/lib/api';
import { AppShell } from '@/components/ui/dashboard-sidebar';

interface Farm {
  id: string;
  name: string;
  address?: string;
  fields: { id: string; name: string; areaHectares: number }[];
}

export default function DashboardPage() {
  const router = useRouter();
  const [farms, setFarms] = useState<Farm[]>([]);
  const [newFarmName, setNewFarmName] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const user = getCurrentUser();
    if (!user) {
      router.replace('/login');
      return;
    }
    loadFarms();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadFarms() {
    setLoading(true);
    const { data } = await api.get<Farm[]>('/farms');
    setFarms(data);
    setLoading(false);
  }

  async function createFarm(e: React.FormEvent) {
    e.preventDefault();
    if (!newFarmName.trim()) return;
    await api.post('/farms', { name: newFarmName });
    setNewFarmName('');
    loadFarms();
  }

  function handleLogout() {
    clearSession();
    router.push('/login');
  }

  return (
    <AppShell title="Home">
      <main className="p-6">
        <div className="mb-6 flex items-center justify-between">
          <p className="text-sm text-gray-500">Overview of your farms</p>
          <button onClick={handleLogout} className="text-sm text-gray-500 underline">
            Log out
          </button>
        </div>

        <form onSubmit={createFarm} className="mb-6 flex gap-2">
          <input
            className="flex-1 rounded-lg border p-3"
            placeholder="New farm name"
            value={newFarmName}
            onChange={(e) => setNewFarmName(e.target.value)}
          />
          <button className="rounded-lg bg-brand-600 px-5 font-semibold text-white hover:bg-brand-700">
            + Add Farm
          </button>
        </form>

        {loading ? (
          <p className="text-gray-400">Loading...</p>
        ) : farms.length === 0 ? (
          <p className="text-gray-400">No farms yet. Add your first farm above.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {farms.map((farm) => (
              <Link
                key={farm.id}
                href={`/farms/${farm.id}`}
                className="rounded-xl border bg-white p-5 shadow-sm transition hover:shadow-md"
              >
                <h2 className="text-lg font-semibold text-brand-900">{farm.name}</h2>
                <p className="mt-1 text-sm text-gray-500">{farm.fields?.length || 0} registered field(s)</p>
              </Link>
            ))}
          </div>
        )}
      </main>
    </AppShell>
  );
}
