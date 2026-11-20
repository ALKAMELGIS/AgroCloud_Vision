'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUser } from '@/lib/api';

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    const user = getCurrentUser();
    router.replace(user ? '/dashboard' : '/login');
  }, [router]);

  return (
    <main className="flex h-screen items-center justify-center text-gray-500">
      جارٍ التحميل...
    </main>
  );
}
