import type { Locale } from '@/i18n/config';

type DateInput = string | number | Date | null | undefined;

function intlLocale(locale: Locale): string {
  return locale === 'th' ? 'th-TH' : 'en-US';
}

function dateLocale(locale: Locale): string {
  // Thai locale renders the Buddhist calendar year (พ.ศ.).
  return locale === 'th' ? 'th-TH-u-ca-buddhist' : 'en-US';
}

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export const CURRENCY_SYMBOL = '฿';
export const TIME_ZONE = 'Asia/Bangkok';

/** `฿ 1,234.50` (thousands separators, always 2 decimals). */
export function formatMoney(value: number | string | null | undefined, locale: Locale = 'th'): string {
  const n = toNumber(value);
  if (n === null) return '-';
  const formatted = new Intl.NumberFormat(intlLocale(locale), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
  return `${CURRENCY_SYMBOL} ${formatted}`;
}

/** Number without currency, up to `maxDecimals` (default 3) and no trailing zeros. */
export function formatQty(value: number | string | null | undefined, locale: Locale = 'th', maxDecimals = 3): string {
  const n = toNumber(value);
  if (n === null) return '-';
  return new Intl.NumberFormat(intlLocale(locale), {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDecimals,
  }).format(n);
}

export function formatNumber(value: number | string | null | undefined, locale: Locale = 'th', decimals = 2): string {
  const n = toNumber(value);
  if (n === null) return '-';
  return new Intl.NumberFormat(intlLocale(locale), {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

/** `02/09/2569` (th, Buddhist year) or `Sep 2, 2026` (en). */
export function formatDate(value: DateInput, locale: Locale = 'th'): string {
  const d = toDate(value);
  if (!d) return '-';
  return new Intl.DateTimeFormat(dateLocale(locale), {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: locale === 'th' ? '2-digit' : 'short',
    day: locale === 'th' ? '2-digit' : 'numeric',
  }).format(d);
}

/** Date plus 24h time, e.g. `02/09/2569 14:05` or `Sep 2, 2026, 14:05`. */
export function formatDateTime(value: DateInput, locale: Locale = 'th', withSeconds = false): string {
  const d = toDate(value);
  if (!d) return '-';
  return new Intl.DateTimeFormat(dateLocale(locale), {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: locale === 'th' ? '2-digit' : 'short',
    day: locale === 'th' ? '2-digit' : 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: withSeconds ? '2-digit' : undefined,
    hour12: false,
  }).format(d);
}

/** Time only, 24h. */
export function formatTime(value: DateInput, locale: Locale = 'th', withSeconds = true): string {
  const d = toDate(value);
  if (!d) return '-';
  return new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone: TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: withSeconds ? '2-digit' : undefined,
    hour12: false,
  }).format(d);
}

/** Long date with weekday, e.g. `วันพุธที่ 2 กันยายน 2569`. */
export function formatLongDate(value: DateInput, locale: Locale = 'th'): string {
  const d = toDate(value);
  if (!d) return '-';
  return new Intl.DateTimeFormat(dateLocale(locale), {
    timeZone: TIME_ZONE,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(d);
}
