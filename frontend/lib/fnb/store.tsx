'use client';

/**
 * Order state for the F&B prototype, kept in the browser.
 *
 * The three prototype screens — counter, kitchen, floor — have to feel like one shop: a drink
 * rung up at the counter must appear on the bar's screen a moment later, and the table it was
 * for must change colour on the floor plan. Until the order API and its SSE stream exist this
 * context plays that part: orders live in localStorage and every change is broadcast to the
 * other tabs, so the demo can run the counter and the kitchen side by side on two devices'
 * worth of browser tabs.
 *
 * Shapes mirror the planned `orders` / `order_items` tables so the screens keep working when
 * the real thing replaces this file.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { menuById, modifierById, type Channel } from '@/lib/fnb/mock';

export type ItemStatus = 'sent' | 'preparing' | 'ready' | 'served' | 'void';

export interface OrderItem {
  id: string;
  menuItemId: string;
  name: string;
  emoji: string;
  qty: number;
  modifierIds: string[];
  note?: string;
  stationId: string;
  unitPrice: number;
  status: ItemStatus;
  sentAt: number;
  readyAt?: number;
}

export interface Order {
  id: string;
  /** Counter orders get a queue number the customer is called by. */
  queueNo?: number;
  channel: Channel;
  tableId?: string;
  guests?: number;
  createdAt: number;
  items: OrderItem[];
  status: 'open' | 'paid' | 'closed';
}

export interface CartLine {
  menuItemId: string;
  qty: number;
  modifierIds: string[];
  note?: string;
}

export type TableStatus = 'free' | 'seated' | 'waiting' | 'ready' | 'bill';

interface State {
  orders: Order[];
  nextQueue: number;
}

interface Api extends State {
  placeOrder: (lines: CartLine[], channel: Channel, opts?: { tableId?: string; guests?: number }) => Order;
  setItemStatus: (orderId: string, itemId: string, status: ItemStatus) => void;
  /** Every item of a station's tickets in one go — the bump bar's "all done". */
  bumpOrder: (orderId: string, stationId: string, status: ItemStatus) => void;
  payOrder: (orderId: string) => void;
  closeTable: (tableId: string) => void;
  reset: () => void;
  tableStatus: (tableId: string) => TableStatus;
  ordersForTable: (tableId: string) => Order[];
  lineTotal: (line: CartLine) => number;
  orderTotal: (order: Order) => number;
}

const KEY = 'fnb.proto';
const CHANNEL = 'fnb.proto';
const EMPTY: State = { orders: [], nextQueue: 1 };

const Ctx = createContext<Api | null>(null);

const uid = () => Math.random().toString(36).slice(2, 10);

function load(): State {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const v = JSON.parse(raw) as State;
    return Array.isArray(v.orders) ? v : EMPTY;
  } catch {
    return EMPTY;
  }
}

export function itemPrice(menuItemId: string, modifierIds: string[]): number {
  const base = menuById[menuItemId]?.price ?? 0;
  return modifierIds.reduce((s, id) => s + (modifierById[id]?.priceDelta ?? 0), base);
}

export function FnbProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(EMPTY);
  const [hydrated, setHydrated] = useState(false);

  // hydrate after mount: localStorage is not there during SSR
  useEffect(() => {
    setState(load());
    setHydrated(true);
  }, []);

  // other tabs: a storage event covers most browsers, a BroadcastChannel is faster where it exists
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setState(load());
    };
    window.addEventListener('storage', onStorage);
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel(CHANNEL);
      bc.onmessage = () => setState(load());
    } catch {
      bc = null;
    }
    return () => {
      window.removeEventListener('storage', onStorage);
      bc?.close();
    };
  }, []);

  const commit = useCallback((next: State) => {
    setState(next);
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
      const bc = new BroadcastChannel(CHANNEL);
      bc.postMessage('changed');
      bc.close();
    } catch {
      /* private mode: the tab still works on its own */
    }
  }, []);

  const api = useMemo<Api>(() => {
    const update = (fn: (s: State) => State) => commit(fn(load()));

    const placeOrder: Api['placeOrder'] = (lines, channel, opts = {}) => {
      const now = Date.now();
      const s = load();
      const order: Order = {
        id: uid(),
        queueNo: channel === 'counter' || channel === 'takeaway' ? s.nextQueue : undefined,
        channel,
        tableId: opts.tableId,
        guests: opts.guests,
        createdAt: now,
        status: 'open',
        items: lines.map((l) => {
          const m = menuById[l.menuItemId];
          return {
            id: uid(),
            menuItemId: l.menuItemId,
            name: m?.name ?? l.menuItemId,
            emoji: m?.emoji ?? '🍽️',
            qty: l.qty,
            modifierIds: l.modifierIds,
            note: l.note,
            stationId: m?.stationId ?? 'st-hot',
            unitPrice: itemPrice(l.menuItemId, l.modifierIds),
            status: 'sent',
            sentAt: now,
          };
        }),
      };
      commit({ orders: [...s.orders, order], nextQueue: order.queueNo ? s.nextQueue + 1 : s.nextQueue });
      return order;
    };

    const setItemStatus: Api['setItemStatus'] = (orderId, itemId, status) =>
      update((s) => ({
        ...s,
        orders: s.orders.map((o) =>
          o.id !== orderId
            ? o
            : { ...o, items: o.items.map((it) => (it.id !== itemId ? it : { ...it, status, readyAt: status === 'ready' ? Date.now() : it.readyAt })) },
        ),
      }));

    const bumpOrder: Api['bumpOrder'] = (orderId, stationId, status) =>
      update((s) => ({
        ...s,
        orders: s.orders.map((o) =>
          o.id !== orderId
            ? o
            : {
                ...o,
                items: o.items.map((it) =>
                  it.stationId !== stationId || it.status === 'void' || it.status === 'served' ? it : { ...it, status, readyAt: status === 'ready' ? Date.now() : it.readyAt },
                ),
              },
        ),
      }));

    const payOrder: Api['payOrder'] = (orderId) =>
      update((s) => ({ ...s, orders: s.orders.map((o) => (o.id === orderId ? { ...o, status: 'paid' } : o)) }));

    const closeTable: Api['closeTable'] = (tableId) =>
      update((s) => ({ ...s, orders: s.orders.map((o) => (o.tableId === tableId && o.status !== 'closed' ? { ...o, status: 'closed' } : o)) }));

    const reset = () => commit(EMPTY);

    const ordersForTable = (tableId: string) => state.orders.filter((o) => o.tableId === tableId && o.status !== 'closed');

    const tableStatus = (tableId: string): TableStatus => {
      const open = ordersForTable(tableId);
      if (open.length === 0) return 'free';
      if (open.every((o) => o.status === 'paid')) return 'bill';
      const items = open.flatMap((o) => o.items).filter((i) => i.status !== 'void');
      if (items.some((i) => i.status === 'ready')) return 'ready';
      if (items.some((i) => i.status === 'sent' || i.status === 'preparing')) return 'waiting';
      return 'seated';
    };

    const lineTotal = (l: CartLine) => itemPrice(l.menuItemId, l.modifierIds) * l.qty;
    const orderTotal = (o: Order) => o.items.filter((i) => i.status !== 'void').reduce((s, i) => s + i.unitPrice * i.qty, 0);

    return { ...state, placeOrder, setItemStatus, bumpOrder, payOrder, closeTable, reset, tableStatus, ordersForTable, lineTotal, orderTotal };
  }, [state, commit]);

  // render nothing until the stored orders are in, so a screen never flashes empty then fills
  if (!hydrated) return null;
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useFnb(): Api {
  const v = useContext(Ctx);
  if (!v) throw new Error('useFnb outside FnbProvider');
  return v;
}
