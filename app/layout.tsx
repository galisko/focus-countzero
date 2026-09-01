import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://focus-protocol.galileohtb.chatgpt.site'),
  title: 'Focus Protocol — Private Pomodoro Timer',
  description: 'A private, offline-first Pomodoro timer for focused work.',
  applicationName: 'Focus Protocol',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg', apple: '/icon.svg' },
  openGraph: {
    title: 'FOCUS/PROTOCOL',
    description: 'Private. Offline. In control.',
    type: 'website',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Focus Protocol — Private. Offline. In control.' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'FOCUS/PROTOCOL',
    description: 'Private. Offline. In control.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
