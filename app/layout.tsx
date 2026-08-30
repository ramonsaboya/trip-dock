import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://tripdock-preview.ramonsaboyag.chatgpt.site'),
  title: 'TripDock — Your trips, clearly organized',
  description:
    'A calm, structured place to organize destinations, transport, stays, and day-by-day travel plans.',
  alternates: {
    canonical: '/',
  },
  openGraph: {
    type: 'website',
    title: 'TripDock — Your trips, clearly organized',
    description:
      'A calm, structured place to organize destinations, transport, stays, and day-by-day travel plans.',
    images: [
      {
        url: '/og.png',
        width: 1200,
        height: 630,
        alt: 'TripDock route from Rome to Florence to Venice',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'TripDock — Your trips, clearly organized',
    description:
      'A calm, structured place to organize destinations, transport, stays, and day-by-day travel plans.',
    images: ['/og.png'],
  },
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
