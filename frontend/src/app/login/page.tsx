'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { login, register, saveSession } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const response =
        mode === 'login'
          ? await login(email, password)
          : await register({ organizationName, fullName, email, password });
      saveSession(response);
      router.push('/dashboard');
    } catch (err: any) {
      setError(err?.response?.data?.message || 'حدث خطأ أثناء المصادقة');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-brand-50 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-lg">
        <h1 className="mb-1 text-2xl font-bold text-brand-900">AgroCloud Vision</h1>
        <p className="mb-6 text-sm text-gray-500">
          {mode === 'login' ? 'تسجيل الدخول إلى حسابك' : 'إنشاء مؤسسة جديدة'}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'register' && (
            <>
              <input
                className="w-full rounded-lg border p-3"
                placeholder="اسم المؤسسة / المزرعة"
                value={organizationName}
                onChange={(e) => setOrganizationName(e.target.value)}
                required
              />
              <input
                className="w-full rounded-lg border p-3"
                placeholder="الاسم الكامل"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
              />
            </>
          )}
          <input
            type="email"
            className="w-full rounded-lg border p-3"
            placeholder="البريد الإلكتروني"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            type="password"
            className="w-full rounded-lg border p-3"
            placeholder="كلمة المرور"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-brand-600 p-3 font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {loading ? '...' : mode === 'login' ? 'دخول' : 'إنشاء الحساب'}
          </button>
        </form>

        <button
          className="mt-4 w-full text-center text-sm text-brand-700 underline"
          onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
        >
          {mode === 'login' ? 'ليس لديك حساب؟ أنشئ مؤسسة جديدة' : 'لديك حساب بالفعل؟ سجّل الدخول'}
        </button>
      </div>
    </main>
  );
}
