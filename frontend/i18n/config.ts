export const locales = ['th', 'en'] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'th';
export const LOCALE_COOKIE = 'NEXT_LOCALE';
export const TIME_ZONE = 'Asia/Bangkok';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (locales as readonly string[]).includes(value);
}

export function resolveLocale(value: unknown): Locale {
  return isLocale(value) ? value : defaultLocale;
}
