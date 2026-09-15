/**
 * What a customer's phone talks to after scanning a table's QR. No sign-in: the token in the
 * URL is the whole authority, so this deliberately does not go through the authenticated client.
 */

import type { LineInput, MenuView, Order } from '@/lib/fnb/api';

export interface TableView {
  store_id: string;
  store_name: string;
  table_code: string;
  menu: MenuView;
  orders: Order[];
  /** True when the tablet's own address opened the page; guest_token is then the code to show as a QR. */
  kiosk: boolean;
  guest_token?: string;
  /** The shop takes QR orders only from a table staff opened; `open` says whether this one is. */
  requires_open: boolean;
  open: boolean;
}

const base = (token: string) => `/api/v1/public/fnb/t/${encodeURIComponent(token)}`;

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) {
    let message = `${res.status}`;
    try {
      message = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? message;
    } catch {
      /* not json */
    }
    throw new Error(message);
  }
  return (text ? JSON.parse(text) : null) as T;
}

export const tableApi = {
  view: (token: string) => call<TableView>('GET', base(token)),
  orders: (token: string) => call<Order[]>('GET', `${base(token)}/orders`),
  order: (token: string, lines: LineInput[], note?: string) => call<Order>('POST', `${base(token)}/orders`, { lines, note }),
  /** The table's own event feed; plain EventSource is fine here, there is no auth header to carry. */
  streamUrl: (token: string) => `${base(token)}/stream`,
};

/**
 * The URL a QR carries. Built on the client from the page's own origin, so it survives a domain
 * change. The same route serves the tablet fixed to the table when given its kiosk token.
 */
export const tableUrl = (token: string) => `${typeof window === 'undefined' ? '' : window.location.origin}/t/${encodeURIComponent(token)}`;
