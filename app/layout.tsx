import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'TripDock — Your trips, clearly organized',
  description:
    'A calm, structured place to organize destinations, transport, stays, and day-by-day travel plans.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
