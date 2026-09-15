/**
 * The F&B endpoints (backend: internal/transport/http/handlers_fnb.go).
 *
 * Money and quantities arrive as decimal strings, like everywhere else in the API; use `dec()`.
 */

import { api } from '@/lib/api/client';
import type { Money } from '@/lib/pos/types';

export type Channel = 'counter' | 'dine_in' | 'takeaway' | 'delivery' | 'self_order';
export type ItemStatus = 'sent' | 'preparing' | 'ready' | 'served' | 'void';
export type OrderStatus = 'open' | 'paid' | 'closed' | 'void';

export interface Station {
  id: string;
  name: string;
  name_en?: string;
  output: 'kds' | 'printer' | 'both';
  printer_name?: string;
  sort: number;
  is_active: boolean;
}

export interface MenuCategory {
  id: string;
  name: string;
  name_en?: string;
  sort: number;
  is_active: boolean;
}

export interface RecipeLine {
  id?: string;
  ingredient_product_id: string;
  ingredient_name?: string;
  qty: Money;
  unit_id?: string | null;
  unit_name?: string;
  factor_to_stock: Money;
  waste_pct: Money;
  mode: 'add' | 'replace';
  replaces_product_id?: string | null;
}

export interface Recipe {
  id?: string;
  menu_item_id?: string;
  yield_qty: Money;
  note?: string;
  lines: RecipeLine[];
}

export interface MenuItem {
  id: string;
  category_id?: string | null;
  product_id?: string | null;
  station_id?: string | null;
  name: string;
  name_en?: string;
  price: Money;
  image_url?: string;
  channels: Channel[];
  sort: number;
  is_active: boolean;
  modifier_group_ids: string[];
  recipe?: Recipe | null;
}

export interface Modifier {
  id: string;
  group_id: string;
  name: string;
  name_en?: string;
  price_delta: Money;
  is_default: boolean;
  sort: number;
  is_active: boolean;
  lines?: RecipeLine[];
}

export interface ModifierGroup {
  id: string;
  name: string;
  name_en?: string;
  min_select: number;
  max_select: number;
  sort: number;
  is_active: boolean;
  modifiers: Modifier[];
}

export interface MenuView {
  stations: Station[];
  categories: MenuCategory[];
  items: MenuItem[];
  modifier_groups: ModifierGroup[];
  /** When the shop takes ingredients off stock: on_send | on_ready | on_pay. */
  deduct_on: string;
}

export interface OrderItemModifier {
  id: string;
  modifier_id?: string | null;
  name: string;
  price_delta: Money;
}

export interface OrderItem {
  id: string;
  order_id: string;
  menu_item_id?: string | null;
  station_id?: string | null;
  name: string;
  qty: Money;
  unit_price: Money;
  /** What the recipe took off stock, at average cost, once it was made. */
  cost: Money;
  seat?: number;
  course: number;
  note?: string;
  status: ItemStatus;
  deducted: boolean;
  sort: number;
  sent_at: string;
  ready_at?: string | null;
  served_at?: string | null;
  modifiers: OrderItemModifier[];
}

export interface Order {
  id: string;
  order_no: number;
  channel: Channel;
  table_code?: string;
  guests?: number;
  status: OrderStatus;
  service_charge: Money;
  note?: string;
  created_at: string;
  closed_at?: string | null;
  items: OrderItem[];
}

export interface LineInput {
  menu_item_id: string;
  qty: number;
  modifier_ids: string[];
  seat?: number;
  course?: number;
  note?: string;
}

export interface CreateOrderInput {
  channel: Channel;
  table_code?: string;
  guests?: number;
  note?: string;
  lines: LineInput[];
}

export interface TableToken {
  table_code: string;
  token: string;
  is_active: boolean;
}

/** One order event from /fnb/stream: the whole order rides along, nothing to fetch. */
export interface OrderEvent {
  kind: 'created' | 'updated';
  order: Order;
}

export const fnbKeys = {
  menu: ['fnb', 'menu'] as const,
  orders: (open: boolean) => ['fnb', 'orders', open] as const,
  order: (id: string) => ['fnb', 'order', id] as const,
  tables: ['fnb', 'tables'] as const,
};

export const fnbApi = {
  menu: () => api.get<MenuView>('/fnb/menu'),
  createOrder: (input: CreateOrderInput) => api.post<Order>('/fnb/orders', input),
  orders: (open: boolean) => api.get<Order[]>(`/fnb/orders${open ? '?open=1' : ''}`),
  order: (id: string) => api.get<Order>(`/fnb/orders/${id}`),
  setItemStatus: (orderId: string, itemId: string, status: ItemStatus, made = false) =>
    api.post<Order>(`/fnb/orders/${orderId}/items/${itemId}/status`, { status, made }),
  setOrderStatus: (orderId: string, status: OrderStatus) => api.post<Order>(`/fnb/orders/${orderId}/status`, { status }),
  // menu editing (managers)
  saveStation: (s: Partial<Station>) => api.put<Station>('/fnb/menu/stations', s),
  saveCategory: (c: Partial<MenuCategory>) => api.put<MenuCategory>('/fnb/menu/categories', c),
  saveItem: (m: Partial<MenuItem>) => api.put<MenuItem>('/fnb/menu/items', m),
  saveModifierGroup: (g: Partial<ModifierGroup>) => api.put<ModifierGroup>('/fnb/menu/modifier-groups', g),
  /** Every table's QR token; `ensure` names tables that should get one if they have none yet. */
  tables: (ensure: string[] = []) => api.get<TableToken[]>(`/fnb/tables${ensure.length ? `?ensure=${encodeURIComponent(ensure.join(','))}` : ''}`),
  rotateTable: (code: string) => api.post<TableToken>(`/fnb/tables/${encodeURIComponent(code)}/rotate`, {}),
};

/**
 * Listens to /fnb/stream. EventSource cannot carry the Authorization header, so this reads the
 * stream through fetch and parses the frames itself. Reconnects with a short backoff; the caller
 * learns whether it is connected so it can poll less while it is.
 */
export function subscribeOrders(
  token: string,
  onEvent: (ev: OrderEvent) => void,
  onState?: (connected: boolean) => void,
  url = '/api/v1/fnb/stream',
): () => void {
  let stopped = false;
  let ctrl: AbortController | null = null;
  const run = async () => {
    let delay = 1000;
    while (!stopped) {
      ctrl = new AbortController();
      try {
        const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' } : { Accept: 'text/event-stream' }, signal: ctrl.signal });
        if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
        onState?.(true);
        delay = 1000;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf('\n\n')) !== -1) {
            const frame = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const data = frame
              .split('\n')
              .filter((l) => l.startsWith('data:'))
              .map((l) => l.slice(5).trim())
              .join('\n');
            if (!data) continue;
            try {
              onEvent(JSON.parse(data) as OrderEvent);
            } catch {
              /* a malformed frame is not worth dropping the connection over */
            }
          }
        }
      } catch {
        /* fall through to reconnect */
      }
      onState?.(false);
      if (stopped) break;
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 15_000);
    }
  };
  void run();
  return () => {
    stopped = true;
    ctrl?.abort();
  };
}
