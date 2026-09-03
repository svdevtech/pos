/** Helpers shared by the back-office query hooks. */

/** Go `decimal.Decimal` values arrive as JSON strings; numbers are accepted too. */
export type Dec = string | number;

/** Parses a decimal string/number into a JS number; `0` for anything unparsable. */
export function num(value: Dec | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Serialises a JS number as a decimal string for the API (avoids float noise). */
export function decStr(value: number | string | null | undefined, dp = 2): string {
  const n = num(value);
  return n.toFixed(dp);
}

export type PaymentMethod = 'cash' | 'credit' | 'transfer' | 'card' | 'qr' | 'other';

/** Payment methods accepted for receiving money (credit excluded). */
export const RECEIVE_METHODS: readonly PaymentMethod[] = ['cash', 'transfer', 'card', 'qr', 'other'];

export interface ListParams {
  page?: number;
  page_size?: number;
}

export interface ListTotals {
  total: number;
  page: number;
  page_size: number;
}
