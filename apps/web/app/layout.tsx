import type { Metadata, Viewport } from 'next';
import './globals.css';

export const viewport: Viewport = {
  themeColor: '#174f47',
};

export const metadata: Metadata = {
  metadataBase: new URL(process.env.WEB_ORIGIN ?? 'http://localhost:3000'),
  applicationName: 'TripDock',
  title: 'TripDock — Your trips, clearly organized',
  description:
    'A calm, structured place for destinations, transport, stays, activities, and reviewable AI trip changes.',
  manifest: '/site.webmanifest',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/favicon-32x32.png', type: 'image/png', sizes: '32x32' },
      { url: '/icons/icon-512.png', type: 'image/png', sizes: '512x512' },
    ],
    shortcut: '/favicon.ico',
    apple: [{ url: '/apple-touch-icon.png', type: 'image/png', sizes: '180x180' }],
  },
  appleWebApp: {
    capable: true,
    title: 'TripDock',
    statusBarStyle: 'default',
  },
  alternates: {
    canonical: '/',
  },
  openGraph: {
    type: 'website',
    siteName: 'TripDock',
    title: 'TripDock — Your trips, clearly organized',
    description:
      'A calm, structured place for destinations, transport, stays, activities, and reviewable AI trip changes.',
    images: [
      {
        url: '/og.png',
        width: 1200,
        height: 630,
        type: 'image/png',
        alt: 'TripDock logo on a warm neutral background',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'TripDock — Your trips, clearly organized',
    description:
      'A calm, structured place for destinations, transport, stays, activities, and reviewable AI trip changes.',
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
