import Link from 'next/link';

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-emerald-50 via-white to-white">
      {/* Nav */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white font-bold">
            A
          </div>
          <span className="text-lg font-bold text-brand-900">AgroCloud Vision</span>
        </div>
        <nav className="flex items-center gap-4">
          <Link href="/login" className="text-sm font-medium text-gray-600 hover:text-brand-700">
            Sign In
          </Link>
          <Link
            href="/login"
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
          >
            Get Started
          </Link>
        </nav>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-4xl px-6 py-20 text-center">
        <h1 className="text-4xl font-extrabold tracking-tight text-brand-900 sm:text-5xl">
          Run every farm from one intelligent dashboard
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-gray-600">
          Farm management, field boundaries, real weather data, and agricultural
          activity logs — unified in one platform built for modern agriculture.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link
            href="/login"
            className="rounded-lg bg-brand-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-600/20 hover:bg-brand-700"
          >
            Create your organization
          </Link>
          <Link
            href="/login"
            className="rounded-lg border border-gray-300 bg-white px-6 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            Sign in
          </Link>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-5xl px-6 pb-24">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
          <div className="rounded-xl border bg-white p-6 shadow-sm">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
              🌾
            </div>
            <h3 className="font-semibold text-brand-900">Farm &amp; Field Management</h3>
            <p className="mt-2 text-sm text-gray-500">
              Register farms and fields with real PostGIS-backed boundaries and
              automatic area calculation.
            </p>
          </div>
          <div className="rounded-xl border bg-white p-6 shadow-sm">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
              🌦️
            </div>
            <h3 className="font-semibold text-brand-900">Real Weather Data</h3>
            <p className="mt-2 text-sm text-gray-500">
              Live forecasts for every field, powered by Open-Meteo, with a
              7-day outlook on your dashboard.
            </p>
          </div>
          <div className="rounded-xl border bg-white p-6 shadow-sm">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
              📋
            </div>
            <h3 className="font-semibold text-brand-900">Activity &amp; Crop Logs</h3>
            <p className="mt-2 text-sm text-gray-500">
              Track irrigation, fertilizing, and crop growth stages across
              every field in one place.
            </p>
          </div>
        </div>
      </section>

      <footer className="border-t py-8 text-center text-xs text-gray-400">
        © {new Date().getFullYear()} AgroCloud Vision
      </footer>
    </main>
  );
}
