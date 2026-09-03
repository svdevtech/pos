import type { Metadata, Viewport } from 'next';
import { getLocale, getMessages, getTranslations } from 'next-intl/server';
import { Noto_Sans_Thai, Sarabun } from 'next/font/google';
import type { ReactNode } from 'react';
import Providers from '@/components/Providers';
import { resolveLocale } from '@/i18n/config';
import './globals.css';

const sarabun = Sarabun({
  subsets: ['thai', 'latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-sarabun',
  display: 'swap',
});

const notoSansThai = Noto_Sans_Thai({
  subsets: ['thai', 'latin'],
  weight: ['400', '500', '700'],
  variable: '--font-noto-sans-thai',
  display: 'swap',
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('common');
  return {
    title: { default: t('appName'), template: `%s · ${t('appName')}` },
    description: t('appName'),
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0f2027',
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const locale = resolveLocale(await getLocale());
  const messages = await getMessages();

  return (
    <html lang={locale} className={`${sarabun.variable} ${notoSansThai.variable}`}>
      <body>
        <Providers locale={locale} messages={messages}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
