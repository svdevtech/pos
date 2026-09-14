/**
 * Receipt wording in a language the screen is not in.
 *
 * ตั้งค่า → ใบเสร็จ → ภาษาใบเสร็จ lets a shop print Thai receipts while the cashier works in
 * English, or the other way round. next-intl only ever hands the component the active locale's
 * messages, so the other language's `receipt` namespace is fetched as its own chunk the first time
 * it is needed and kept for the life of the page — a till prints hundreds of bills a day.
 *
 * Strings still live only in i18n/messages/*.json, so `npm run i18n:check` keeps covering them.
 */

import type { Locale } from '@/i18n/config';

type Messages = Record<string, unknown>;

const loaders: Record<Locale, () => Promise<{ default: Messages }>> = {
  th: () => import('@/i18n/messages/th.json'),
  en: () => import('@/i18n/messages/en.json'),
};

const cache = new Map<Locale, Messages>();

/** The `receipt` namespace for a locale. Resolves to `{}` if the chunk cannot be loaded. */
export async function loadReceiptNamespace(locale: Locale): Promise<Messages> {
  const hit = cache.get(locale);
  if (hit) return hit;
  let ns: Messages = {};
  try {
    const mod = await loaders[locale]();
    const all = (mod.default ?? mod) as Messages;
    ns = (all.receipt as Messages) ?? {};
  } catch {
    ns = {};
  }
  cache.set(locale, ns);
  return ns;
}

/** Dotted lookup (`methods.cash`); returns the key itself when missing, as next-intl does. */
export function lookup(ns: Messages, key: string): string {
  const v = key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Messages)[k] : undefined), ns);
  return typeof v === 'string' ? v : key;
}
