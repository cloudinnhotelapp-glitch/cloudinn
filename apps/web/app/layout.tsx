// Root layout that wraps every page with the HTML shell, the theme font, global styles, and page metadata.
import type { Metadata } from 'next';
import { Google_Sans } from 'next/font/google';
import { ZOOM_BOOT_SCRIPT } from '@/lib/zoom';
import './globals.css';

// Google Sans (self-hosted by next/font at build time), exposed as a CSS variable used by the "font-sans" theme token.
const googleSans = Google_Sans({ subsets: ['latin'], weight: 'variable', variable: '--font-google-sans', display: 'swap' });

// Browser tab title and description; search engines are told not to index this internal tool.
export const metadata: Metadata = {
  title: 'CloudInn',
  description: 'CloudInn: internal hotel operations platform for hotel teams',
  applicationName: 'CloudInn',
  robots: { index: false, follow: false },
};

// Renders the outer HTML structure shared by all pages.
export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${googleSans.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        {/* Applies the zoom chosen in the header before the first paint (see lib/zoom.ts). */}
        <script dangerouslySetInnerHTML={{ __html: ZOOM_BOOT_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
