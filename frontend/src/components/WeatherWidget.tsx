'use client';

interface WeatherDay {
  date: string;
  temperatureMaxC: number;
  temperatureMinC: number;
  precipitationMm: number;
  windSpeedMaxKmh: number;
}

export default function WeatherWidget({ days }: { days: WeatherDay[] }) {
  if (!days?.length) return <p className="text-sm text-gray-400">لا توجد بيانات طقس بعد.</p>;

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {days.slice(0, 7).map((d) => (
        <div key={d.date} className="min-w-[110px] rounded-lg border bg-white p-3 text-center shadow-sm">
          <p className="text-xs text-gray-400">{d.date}</p>
          <p className="mt-1 text-lg font-bold text-brand-900">
            {Math.round(d.temperatureMaxC)}°
            <span className="text-sm font-normal text-gray-400">/{Math.round(d.temperatureMinC)}°</span>
          </p>
          <p className="mt-1 text-xs text-blue-600">💧 {d.precipitationMm} مم</p>
          <p className="text-xs text-gray-400">💨 {Math.round(d.windSpeedMaxKmh)} كم/س</p>
        </div>
      ))}
    </div>
  );
}
