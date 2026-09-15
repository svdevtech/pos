/**
 * Screen-side shapes of the F&B data: what the counter, kitchen and floor screens render, mapped
 * from the API by lib/fnb/store.tsx. Numbers here are plain numbers (the API sends decimals as
 * strings) and a few display-only fields (emoji, colour, prep time) are derived on the way in.
 */

export type Channel = 'counter' | 'dine_in' | 'takeaway' | 'delivery' | 'self_order';

export type TableStatus = 'free' | 'seated' | 'waiting' | 'ready' | 'bill';

export interface Station {
  id: string;
  name: string;
  /** How the station is told about a dish: a screen, a printer, or both. */
  output: 'kds' | 'printer' | 'both';
  color: string;
}

export interface Modifier {
  id: string;
  name: string;
  priceDelta: number;
  isDefault?: boolean;
}

export interface ModifierGroup {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  modifiers: Modifier[];
}

export interface RecipeLine {
  ingredient: string;
  qty: number;
  unit: string;
}

export interface MenuItem {
  id: string;
  categoryId: string;
  stationId: string;
  name: string;
  price: number;
  /** An emoji stands in for the photo until the shop uploads one. */
  emoji: string;
  channels: Channel[];
  modifierGroupIds: string[];
  recipe?: RecipeLine[];
  /** Kitchen time in minutes, used by the KDS to colour a ticket that is running late. */
  prepMinutes: number;
  /** Set while a promotion runs: the list price `price` replaced, and the promotion's name. */
  listPrice?: number;
  promoName?: string;
}

export interface Category {
  id: string;
  name: string;
  emoji: string;
}

export interface Zone {
  id: string;
  name: string;
  /** Floor colour, so the plan reads at a glance. */
  color: string;
}

export interface Table {
  id: string;
  zoneId: string;
  /** The table's code — what staff call it and what an order and a QR token carry. */
  name: string;
  seats: number;
  /** Position on the floor in metres; the plan is drawn to scale. */
  x: number;
  y: number;
  shape: 'round' | 'square' | 'long';
  rotation?: number;
}

export const byId = <T extends { id: string }>(list: T[]): Record<string, T> => Object.fromEntries(list.map((x) => [x.id, x]));
