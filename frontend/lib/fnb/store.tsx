'use client';

/**
 * Order and menu state for the F&B screens, backed by the API.
 *
 * The three screens — counter, kitchen, floor — share one context: the menu (read once, kept
 * fresh every few minutes) and today's open orders. Changes arrive over the /fnb/stream
 * server-sent events, which is what makes a drink rung up at the counter appear on the bar's
 * screen at once and turn its table orange on the floor; a 15 s poll behind it covers a dropped
 * connection, and drops to 3 s while the stream is down. Every write goes through the API and
 * refreshes the list right away, so the tab that acted never waits for either.
 *
 * Tables and zones are still the prototype's fixture (lib/fnb/mock.ts) until the floor plan
 * lands in phase 1; an order remembers its table by the table's code.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getAccessToken } from '@/lib/auth/session';
import { fnbApi, fnbKeys, subscribeOrders, type Channel, type ItemStatus, type MenuView, type Order as ApiOrder, type OrderItem as ApiItem } from '@/lib/fnb/api';
import { tables, type Category, type MenuItem, type ModifierGroup, type Modifier, type Station, type Table } from '@/lib/fnb/mock';
import { dec } from '@/lib/pos/types';

export type { Channel, ItemStatus };

export interface OrderItem {
  id: string;
  menuItemId: string;
  name: string;
  emoji: string;
  qty: number;
  modifierIds: string[];
  modifierNames: string[];
  note?: string;
  stationId: string;
  unitPrice: number;
  status: ItemStatus;
  sentAt: number;
  readyAt?: number;
  /** What the recipe took off stock, at average cost — the API fills it in when the dish is made. */
  cost: number;
}

export interface Order {
  id: string;
  /** The number the kitchen and the queue screen call out. */
  queueNo: number;
  channel: Channel;
  tableId?: string;
  guests?: number;
  createdAt: number;
  items: OrderItem[];
  status: 'open' | 'paid' | 'closed' | 'void';
}

export interface CartLine {
  menuItemId: string;
  qty: number;
  modifierIds: string[];
  note?: string;
}

export type TableStatus = 'free' | 'seated' | 'waiting' | 'ready' | 'bill';

interface Menu {
  categories: Category[];
  items: MenuItem[];
  modifierGroups: ModifierGroup[];
  stations: Station[];
  menuById: Record<string, MenuItem>;
  modifierGroupById: Record<string, ModifierGroup>;
  modifierById: Record<string, Modifier>;
  stationById: Record<string, Station>;
  /** on_send | on_ready | on_pay — when the shop takes ingredients off stock. */
  deductOn: string;
}

interface Api {
  menu: Menu;
  menuLoading: boolean;
  /** True while the event stream is connected (the screens can show a live dot). */
  live: boolean;
  orders: Order[];
  nextQueue: number;
  placeOrder: (lines: CartLine[], channel: Channel, opts?: { tableId?: string; guests?: number }) => Promise<Order>;
  setItemStatus: (orderId: string, itemId: string, status: ItemStatus) => Promise<void>;
  /** Every item of a station's tickets in one go — the bump bar's "all done". */
  bumpOrder: (orderId: string, stationId: string, status: ItemStatus) => Promise<void>;
  payOrder: (orderId: string) => Promise<void>;
  closeTable: (tableId: string) => Promise<void>;
  tableStatus: (tableId: string) => TableStatus;
  ordersForTable: (tableId: string) => Order[];
  lineTotal: (line: CartLine) => number;
  orderTotal: (order: Order) => number;
}

const Ctx = createContext<Api | null>(null);

// ---------------------------------------------------------------------------
// API → screen shapes
// ---------------------------------------------------------------------------

/** An emoji stands in for the photo until the shop uploads one; picked by category name. */
const EMOJI: Array<[RegExp, string]> = [
  [/กาแฟ|coffee/i, '☕'],
  [/ชา|tea|นม/i, '🧋'],
  [/ข้าว|rice/i, '🍛'],
  [/เส้น|noodle/i, '🍜'],
  [/ทานเล่น|snack/i, '🍟'],
  [/หวาน|dessert|cake/i, '🍰'],
];
const emojiFor = (categoryName: string, itemName: string): string => {
  const specific: Array<[RegExp, string]> = [
    [/ลาเต้|latte/i, '🥛'],
    [/มอคค่า|โกโก้|ช็อก/i, '🍫'],
    [/มะนาว|lemon/i, '🍋'],
    [/เขียว|matcha/i, '🍵'],
    [/ผัด(?!ไทย)/i, '🍚'],
    [/ไก่ทอด|ปีก/i, '🍗'],
    [/ปัง|toast/i, '🍞'],
    [/มะม่วง|mango/i, '🥭'],
  ];
  for (const [re, e] of specific) if (re.test(itemName)) return e;
  for (const [re, e] of EMOJI) if (re.test(categoryName)) return e;
  return '🍽️';
};

/** Kitchen budget by station; the KDS colours a ticket that outlives it. */
const prepMinutesFor = (stationName: string): number => (/บาร์|bar|drink/i.test(stationName) ? 4 : /หวาน|dessert/i.test(stationName) ? 5 : 9);

const STATION_COLORS = ['#1E88E5', '#E53935', '#7C4DFF', '#43A047', '#FB8C00'];

function toMenu(view: MenuView | undefined): Menu {
  const stations: Station[] = (view?.stations ?? []).map((s, i) => ({ id: s.id, name: s.name, output: s.output, color: STATION_COLORS[i % STATION_COLORS.length] }));
  const stationById = Object.fromEntries(stations.map((s) => [s.id, s]));
  const categories: Category[] = (view?.categories ?? []).filter((c) => c.is_active).map((c) => ({ id: c.id, name: c.name, emoji: emojiFor(c.name, '') }));
  const catName = Object.fromEntries(categories.map((c) => [c.id, c.name]));
  const modifierGroups: ModifierGroup[] = (view?.modifier_groups ?? [])
    .filter((g) => g.is_active)
    .map((g) => ({
      id: g.id,
      name: g.name,
      minSelect: g.min_select,
      maxSelect: g.max_select,
      modifiers: g.modifiers.filter((m) => m.is_active).map((m) => ({ id: m.id, name: m.name, priceDelta: dec(m.price_delta), isDefault: m.is_default })),
    }));
  const items: MenuItem[] = (view?.items ?? [])
    .filter((m) => m.is_active)
    .map((m) => ({
      id: m.id,
      categoryId: m.category_id ?? '',
      stationId: m.station_id ?? '',
      name: m.name,
      price: dec(m.price),
      emoji: emojiFor(catName[m.category_id ?? ''] ?? '', m.name),
      channels: m.channels,
      modifierGroupIds: m.modifier_group_ids ?? [],
      prepMinutes: prepMinutesFor(stationById[m.station_id ?? '']?.name ?? ''),
      recipe: m.recipe?.lines?.map((l) => ({ ingredient: l.ingredient_name ?? '', qty: dec(l.qty), unit: l.unit_name ?? '' })),
    }));
  return {
    categories,
    items,
    modifierGroups,
    stations,
    menuById: Object.fromEntries(items.map((x) => [x.id, x])),
    modifierGroupById: Object.fromEntries(modifierGroups.map((x) => [x.id, x])),
    modifierById: Object.fromEntries(modifierGroups.flatMap((g) => g.modifiers.map((m) => [m.id, m]))),
    stationById,
    deductOn: view?.deduct_on ?? 'on_send',
  };
}

const tableByCode: Record<string, Table> = Object.fromEntries(tables.map((t) => [t.name, t]));

function toItem(it: ApiItem, menu: Menu): OrderItem {
  const m = it.menu_item_id ? menu.menuById[it.menu_item_id] : undefined;
  return {
    id: it.id,
    menuItemId: it.menu_item_id ?? '',
    name: it.name,
    emoji: m?.emoji ?? '🍽️',
    qty: dec(it.qty),
    modifierIds: it.modifiers.map((x) => x.modifier_id ?? '').filter(Boolean),
    modifierNames: it.modifiers.map((x) => x.name),
    note: it.note || undefined,
    stationId: it.station_id ?? '',
    unitPrice: dec(it.unit_price) + it.modifiers.reduce((s, x) => s + dec(x.price_delta), 0),
    status: it.status,
    sentAt: Date.parse(it.sent_at),
    readyAt: it.ready_at ? Date.parse(it.ready_at) : undefined,
    cost: dec(it.cost),
  };
}

function toOrder(o: ApiOrder, menu: Menu): Order {
  return {
    id: o.id,
    queueNo: o.order_no,
    channel: o.channel,
    tableId: o.table_code ? tableByCode[o.table_code]?.id : undefined,
    guests: o.guests,
    createdAt: Date.parse(o.created_at),
    items: (o.items ?? []).map((it) => toItem(it, menu)),
    status: o.status,
  };
}

// ---------------------------------------------------------------------------

export function FnbProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [live, setLive] = useState(false);
  const menuQ = useQuery({ queryKey: fnbKeys.menu, queryFn: fnbApi.menu, staleTime: 5 * 60_000 });
  const ordersQ = useQuery({ queryKey: fnbKeys.orders(true), queryFn: () => fnbApi.orders(true), refetchInterval: live ? 15_000 : 3_000, staleTime: 1_000 });

  // the stream: an event carries the whole order, so it is merged straight into the list
  useEffect(() => {
    const token = getAccessToken() ?? '';
    return subscribeOrders(
      token,
      (ev) => {
        const order = ev.order;
        if (ev.kind === 'table' || !order) {
          // a table got a new customer code: the QR page redraws it
          void qc.invalidateQueries({ queryKey: fnbKeys.tables });
          return;
        }
        qc.setQueryData<ApiOrder[]>(fnbKeys.orders(true), (cur) => {
          const list = cur ?? [];
          const i = list.findIndex((o) => o.id === order.id);
          const keep = order.status === 'open' || order.status === 'paid';
          if (i === -1) return keep ? [...list, order] : list;
          const next = [...list];
          if (keep) next[i] = order;
          else next.splice(i, 1);
          return next;
        });
      },
      setLive,
    );
  }, [qc]);

  const menu = useMemo(() => toMenu(menuQ.data), [menuQ.data]);
  const orders = useMemo(() => (ordersQ.data ?? []).map((o) => toOrder(o, menu)), [ordersQ.data, menu]);
  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: fnbKeys.orders(true) }), [qc]);

  const create = useMutation({
    mutationFn: (v: { lines: CartLine[]; channel: Channel; tableId?: string; guests?: number }) =>
      fnbApi.createOrder({
        channel: v.channel,
        table_code: v.tableId ? tables.find((t) => t.id === v.tableId)?.name : undefined,
        guests: v.guests,
        lines: v.lines.map((l) => ({ menu_item_id: l.menuItemId, qty: l.qty, modifier_ids: l.modifierIds, note: l.note })),
      }),
    onSuccess: () => void refresh(),
  });
  const itemStatus = useMutation({
    mutationFn: (v: { orderId: string; itemId: string; status: ItemStatus }) => fnbApi.setItemStatus(v.orderId, v.itemId, v.status),
    onSuccess: () => void refresh(),
  });
  const orderStatus = useMutation({
    mutationFn: (v: { orderId: string; status: 'paid' | 'closed' | 'void' }) => fnbApi.setOrderStatus(v.orderId, v.status),
    onSuccess: () => void refresh(),
  });

  const api = useMemo<Api>(() => {
    const lineTotal = (l: CartLine) => {
      const base = menu.menuById[l.menuItemId]?.price ?? 0;
      return l.modifierIds.reduce((s, id) => s + (menu.modifierById[id]?.priceDelta ?? 0), base) * l.qty;
    };
    const orderTotal = (o: Order) => o.items.filter((i) => i.status !== 'void').reduce((s, i) => s + i.unitPrice * i.qty, 0);
    const ordersForTable = (tableId: string) => orders.filter((o) => o.tableId === tableId && o.status !== 'closed' && o.status !== 'void');
    const tableStatus = (tableId: string): TableStatus => {
      const open = ordersForTable(tableId);
      if (open.length === 0) return 'free';
      if (open.every((o) => o.status === 'paid')) return 'bill';
      const items = open.flatMap((o) => o.items).filter((i) => i.status !== 'void');
      if (items.some((i) => i.status === 'ready')) return 'ready';
      if (items.some((i) => i.status === 'sent' || i.status === 'preparing')) return 'waiting';
      return 'seated';
    };
    const todayMax = orders.reduce((m, o) => Math.max(m, o.queueNo), 0);
    return {
      menu,
      menuLoading: menuQ.isPending,
      live,
      orders,
      nextQueue: todayMax + 1,
      placeOrder: async (lines, channel, opts = {}) => toOrder(await create.mutateAsync({ lines, channel, ...opts }), menu),
      setItemStatus: async (orderId, itemId, status) => {
        await itemStatus.mutateAsync({ orderId, itemId, status });
      },
      bumpOrder: async (orderId, stationId, status) => {
        const o = orders.find((x) => x.id === orderId);
        const todo = (o?.items ?? []).filter((i) => i.stationId === stationId && i.status !== 'void' && i.status !== 'served' && i.status !== status);
        for (const it of todo) await fnbApi.setItemStatus(orderId, it.id, status);
        await refresh();
      },
      payOrder: async (orderId) => {
        await orderStatus.mutateAsync({ orderId, status: 'paid' });
      },
      closeTable: async (tableId) => {
        for (const o of ordersForTable(tableId)) await fnbApi.setOrderStatus(o.id, 'closed');
        await refresh();
      },
      tableStatus,
      ordersForTable,
      lineTotal,
      orderTotal,
    };
  }, [menu, menuQ.isPending, live, orders, create, itemStatus, orderStatus, refresh]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useFnb(): Api {
  const v = useContext(Ctx);
  if (!v) throw new Error('useFnb outside FnbProvider');
  return v;
}
