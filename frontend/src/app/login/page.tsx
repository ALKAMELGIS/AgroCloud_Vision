'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { login, register, saveSession } from '@/lib/api';
import { getErrorMessage } from '@/lib/utils';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('demo@agrocloud.test');
  const [password, setPassword] = useState('Demo12345!');
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
      setError(getErrorMessage(err, 'An error occurred during authentication'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-brand-50 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-lg">
        <h1 className="mb-1 text-2xl font-bold text-brand-900">AgroOne</h1>
        <p className="mb-6 text-sm text-gray-500">
          {mode === 'login' ? 'Sign in to your account' : 'Create a new organization'}
        </p>

        <form onSubmit={handleSubmit} autoComplete="off" className="space-y-4">
          {mode === 'register' && (
            <>
              <input
                className="w-full rounded-lg border p-3"
                placeholder="Organization / Farm name"
                value={organizationName}
                onChange={(e) => setOrganizationName(e.target.value)}
                required
              />
              <input
                className="w-full rounded-lg border p-3"
                placeholder="Full name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
              />
            </>
          )}
          <input
            type="email"
            autoComplete="off"
            name="agro-email"
            className="w-full rounded-lg border p-3"
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            type="password"
            autoComplete="new-password"
            name="agro-password"
            className="w-full rounded-lg border p-3"
            placeholder="Password"
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
            {loading ? '...' : mode === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        <button
          className="mt-4 w-full text-center text-sm text-brand-700 underline"
          onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
        >
          {mode === 'login' ? "Don't have an account? Create an organization" : 'Already have an account? Sign in'}
        </button>
      </div>
    </main>
  );
}
