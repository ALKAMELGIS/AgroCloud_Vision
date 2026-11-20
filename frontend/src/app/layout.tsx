import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'AgroCloud Vision',
  description: 'منصة إدارة المزارع والذكاء الزراعي',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
