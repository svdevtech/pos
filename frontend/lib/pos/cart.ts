import type { CreateSaleInput, ProductView, SaleLineInput, TenderInput } from './types';
import { dec, money } from './types';

/** One line of the cashier's cart (client-side state). */
export interface CartLine {
  /** Client key, stable across edits. */
  key: string;
  product_id: string;
  sku: string;
  name: string;
  name_en?: string;
  unit_name?: string;
  /** Base sell price as shown on the product; the server may re-price by member tier. */
  unit_price: number;
  /** Manual override (only honoured by the server when `allow_price_edit`). */
  price_override?: number;
  qty: number;
  discount: number;
  is_free: boolean;
  is_serial: boolean;
  serial_no?: string;
}

export interface CartState {
  lines: CartLine[];
  member_id: string | null;
  bill_discount: number;
  bill_discount_pct: number;
  note: string;
  held_bill_id: string | null;
}

/** JSON persisted with POST /held-bills so a bill can be recalled later. */
export interface HeldCart {
  version: 1;
  lines: CartLine[];
  member_id: string | null;
  bill_discount: number;
  bill_discount_pct: number;
  note: string;
}

export const emptyCart = (): CartState => ({
  lines: [],
  member_id: null,
  bill_discount: 0,
  bill_discount_pct: 0,
  note: '',
  held_bill_id: null,
});

let keySeq = 0;
export function nextKey(): string {
  keySeq += 1;
  return `l${Date.now().toString(36)}${keySeq}`;
}

export function lineFromProduct(p: ProductView, qty = 1): CartLine {
  return {
    key: nextKey(),
    product_id: p.id,
    sku: p.sku,
    name: p.name,
    name_en: p.name_en,
    unit_name: p.unit_name,
    unit_price: dec(p.sell_price),
    qty,
    discount: 0,
    is_free: false,
    is_serial: Boolean(p.is_serial),
  };
}

/** Local estimate of a line total (server quote is authoritative). */
export function lineTotal(l: CartLine): number {
  if (l.is_free) return 0;
  const price = l.price_override ?? l.unit_price;
  const t = money(l.qty * price) - l.discount;
  return t < 0 ? 0 : money(t);
}

export function cartGross(lines: CartLine[]): number {
  return money(lines.filter((l) => !l.is_free).reduce((s, l) => s + money(l.qty * (l.price_override ?? l.unit_price)), 0));
}

export function cartItemCount(lines: CartLine[]): number {
  return lines.reduce((s, l) => s + l.qty, 0);
}

/**
 * Adds a product to the cart: merges with an existing non-serial line of the same product
 * (and same free flag), otherwise appends a new line. Serial items are always separate lines.
 */
export function addProduct(lines: CartLine[], p: ProductView, qty = 1): { lines: CartLine[]; key: string } {
  if (!p.is_serial) {
    const idx = lines.findIndex((l) => l.product_id === p.id && !l.is_free && !l.price_override);
    if (idx >= 0) {
      const next = lines.slice();
      next[idx] = { ...next[idx], qty: money(next[idx].qty + qty) };
      return { lines: next, key: next[idx].key };
    }
  }
  const line = lineFromProduct(p, qty);
  return { lines: [...lines, line], key: line.key };
}

export function toSaleLines(lines: CartLine[]): SaleLineInput[] {
  return lines.map((l) => ({
    product_id: l.product_id,
    qty: l.qty,
    unit_price: l.price_override,
    discount: l.discount,
    is_free: l.is_free,
    serial_no: l.serial_no?.trim() || undefined,
  }));
}

export function toQuoteInput(cart: CartState): CreateSaleInput {
  return {
    member_id: cart.member_id ?? undefined,
    lines: toSaleLines(cart.lines),
    payments: [],
    bill_discount: cart.bill_discount,
    bill_discount_pct: cart.bill_discount_pct,
  };
}

export function toSaleInput(cart: CartState, payments: TenderInput[], terminal?: string): CreateSaleInput {
  return {
    ...toQuoteInput(cart),
    payments,
    note: cart.note || undefined,
    terminal,
    held_bill_id: cart.held_bill_id ?? undefined,
  };
}

export function toHeldCart(cart: CartState): HeldCart {
  return {
    version: 1,
    lines: cart.lines,
    member_id: cart.member_id,
    bill_discount: cart.bill_discount,
    bill_discount_pct: cart.bill_discount_pct,
    note: cart.note,
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Restores a cart from a held bill payload, tolerating missing/odd fields. */
export function fromHeldCart(raw: unknown, heldBillId: string, memberId?: string | null): CartState | null {
  if (!isRecord(raw) || !Array.isArray(raw.lines)) return null;
  const lines: CartLine[] = [];
  for (const item of raw.lines) {
    if (!isRecord(item) || typeof item.product_id !== 'string') continue;
    lines.push({
      key: nextKey(),
      product_id: item.product_id,
      sku: typeof item.sku === 'string' ? item.sku : '',
      name: typeof item.name === 'string' ? item.name : '',
      name_en: typeof item.name_en === 'string' ? item.name_en : undefined,
      unit_name: typeof item.unit_name === 'string' ? item.unit_name : undefined,
      unit_price: dec(item.unit_price as string | number | undefined),
      price_override: item.price_override === undefined || item.price_override === null ? undefined : dec(item.price_override as string | number),
      qty: dec(item.qty as string | number | undefined) || 1,
      discount: dec(item.discount as string | number | undefined),
      is_free: Boolean(item.is_free),
      is_serial: Boolean(item.is_serial),
      serial_no: typeof item.serial_no === 'string' ? item.serial_no : undefined,
    });
  }
  return {
    lines,
    member_id: (typeof raw.member_id === 'string' ? raw.member_id : null) ?? memberId ?? null,
    bill_discount: dec(raw.bill_discount as string | number | undefined),
    bill_discount_pct: dec(raw.bill_discount_pct as string | number | undefined),
    note: typeof raw.note === 'string' ? raw.note : '',
    held_bill_id: heldBillId,
  };
}

/** True when the scan-box text looks like a barcode (digits, optionally with dashes/spaces). */
export function looksLikeBarcode(text: string): boolean {
  const s = text.trim();
  if (s.length < 3) return false;
  return /^[0-9][0-9\-\s]*[0-9]$/.test(s) || /^[A-Za-z0-9]{8,}$/.test(s) && /\d/.test(s) && !/\s/.test(s);
}

/** Splits `3*CODE` → {qty:3, text:'CODE'}; `CODE` → {qty:1, text:'CODE'}. */
export function parseQtyPrefix(text: string): { qty: number; text: string } {
  const m = text.match(/^\s*(\d+(?:\.\d+)?)\s*[*xX×]\s*(.+)$/);
  if (m) {
    const qty = Number(m[1]);
    if (Number.isFinite(qty) && qty > 0) return { qty, text: m[2].trim() };
  }
  return { qty: 1, text: text.trim() };
}
