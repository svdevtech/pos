/**
 * Prototype data for the F&B screens.
 *
 * Everything the three prototype screens show comes from here, shaped like the tables in
 * backend/migrations/0013_fnb_menu_recipes.up.sql so the screens survive the switch to the API
 * without a rewrite. Prices are what a Thai café/restaurant charges; recipes are real enough to
 * make the stock deduction believable in a demo.
 */

export type Channel = 'counter' | 'dine_in' | 'takeaway' | 'delivery' | 'self_order';

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
}

export interface Category {
  id: string;
  name: string;
  emoji: string;
}

export interface Zone {
  id: string;
  name: string;
  /** Floor colour, so the 3D plan reads at a glance. */
  color: string;
}

export interface Table {
  id: string;
  zoneId: string;
  name: string;
  seats: number;
  /** Position on the floor in metres; the plan is drawn to scale. */
  x: number;
  y: number;
  shape: 'round' | 'square' | 'long';
  rotation?: number;
}

export const stations: Station[] = [
  { id: 'st-bar', name: 'บาร์เครื่องดื่ม', output: 'kds', color: '#1E88E5' },
  { id: 'st-hot', name: 'ครัวร้อน', output: 'both', color: '#E53935' },
  { id: 'st-dessert', name: 'ของหวาน', output: 'printer', color: '#7C4DFF' },
];

export const categories: Category[] = [
  { id: 'c-coffee', name: 'กาแฟ', emoji: '☕' },
  { id: 'c-tea', name: 'ชา · นม', emoji: '🧋' },
  { id: 'c-rice', name: 'ข้าว', emoji: '🍛' },
  { id: 'c-noodle', name: 'เส้น', emoji: '🍜' },
  { id: 'c-snack', name: 'ของทานเล่น', emoji: '🍟' },
  { id: 'c-dessert', name: 'ของหวาน', emoji: '🍰' },
];

export const modifierGroups: ModifierGroup[] = [
  {
    id: 'mg-size',
    name: 'ขนาด',
    minSelect: 1,
    maxSelect: 1,
    modifiers: [
      { id: 'm-s', name: 'S', priceDelta: 0, isDefault: true },
      { id: 'm-m', name: 'M', priceDelta: 10 },
      { id: 'm-l', name: 'L', priceDelta: 20 },
    ],
  },
  {
    id: 'mg-temp',
    name: 'ร้อน / เย็น',
    minSelect: 1,
    maxSelect: 1,
    modifiers: [
      { id: 'm-hot', name: 'ร้อน', priceDelta: 0 },
      { id: 'm-iced', name: 'เย็น', priceDelta: 5, isDefault: true },
      { id: 'm-frappe', name: 'ปั่น', priceDelta: 10 },
    ],
  },
  {
    id: 'mg-sweet',
    name: 'ความหวาน',
    minSelect: 1,
    maxSelect: 1,
    modifiers: [
      { id: 'm-sw0', name: 'ไม่หวาน', priceDelta: 0 },
      { id: 'm-sw25', name: 'หวานน้อย', priceDelta: 0 },
      { id: 'm-sw50', name: 'หวานปกติ', priceDelta: 0, isDefault: true },
      { id: 'm-sw100', name: 'หวานมาก', priceDelta: 0 },
    ],
  },
  {
    id: 'mg-milk',
    name: 'นม',
    minSelect: 0,
    maxSelect: 1,
    modifiers: [
      { id: 'm-oat', name: 'นมโอ๊ต', priceDelta: 15 },
      { id: 'm-almond', name: 'นมอัลมอนด์', priceDelta: 15 },
    ],
  },
  {
    id: 'mg-extra',
    name: 'เพิ่ม',
    minSelect: 0,
    maxSelect: 3,
    modifiers: [
      { id: 'm-shot', name: 'ช็อตเสริม', priceDelta: 15 },
      { id: 'm-pearl', name: 'ไข่มุก', priceDelta: 10 },
      { id: 'm-whip', name: 'วิปครีม', priceDelta: 10 },
    ],
  },
  {
    id: 'mg-spice',
    name: 'ความเผ็ด',
    minSelect: 1,
    maxSelect: 1,
    modifiers: [
      { id: 'm-sp0', name: 'ไม่เผ็ด', priceDelta: 0 },
      { id: 'm-sp1', name: 'เผ็ดน้อย', priceDelta: 0, isDefault: true },
      { id: 'm-sp2', name: 'เผ็ดมาก', priceDelta: 0 },
    ],
  },
  {
    id: 'mg-egg',
    name: 'ไข่',
    minSelect: 0,
    maxSelect: 1,
    modifiers: [
      { id: 'm-eggf', name: 'ไข่ดาว', priceDelta: 10 },
      { id: 'm-eggo', name: 'ไข่เจียว', priceDelta: 15 },
    ],
  },
];

export const menu: MenuItem[] = [
  { id: 'i-americano', categoryId: 'c-coffee', stationId: 'st-bar', name: 'อเมริกาโน่', price: 45, emoji: '☕', channels: ['counter', 'dine_in', 'takeaway', 'self_order'], modifierGroupIds: ['mg-size', 'mg-temp', 'mg-sweet', 'mg-extra'], prepMinutes: 3, recipe: [{ ingredient: 'เมล็ดกาแฟ', qty: 18, unit: 'g' }] },
  { id: 'i-latte', categoryId: 'c-coffee', stationId: 'st-bar', name: 'ลาเต้', price: 55, emoji: '🥛', channels: ['counter', 'dine_in', 'takeaway', 'self_order'], modifierGroupIds: ['mg-size', 'mg-temp', 'mg-sweet', 'mg-milk', 'mg-extra'], prepMinutes: 4, recipe: [{ ingredient: 'เมล็ดกาแฟ', qty: 18, unit: 'g' }, { ingredient: 'นมสด', qty: 200, unit: 'ml' }] },
  { id: 'i-cappu', categoryId: 'c-coffee', stationId: 'st-bar', name: 'คาปูชิโน่', price: 55, emoji: '☕', channels: ['counter', 'dine_in', 'takeaway', 'self_order'], modifierGroupIds: ['mg-size', 'mg-temp', 'mg-sweet', 'mg-milk', 'mg-extra'], prepMinutes: 4, recipe: [{ ingredient: 'เมล็ดกาแฟ', qty: 18, unit: 'g' }, { ingredient: 'นมสด', qty: 150, unit: 'ml' }] },
  { id: 'i-mocha', categoryId: 'c-coffee', stationId: 'st-bar', name: 'มอคค่า', price: 60, emoji: '🍫', channels: ['counter', 'dine_in', 'takeaway', 'self_order'], modifierGroupIds: ['mg-size', 'mg-temp', 'mg-sweet', 'mg-milk', 'mg-extra'], prepMinutes: 4, recipe: [{ ingredient: 'เมล็ดกาแฟ', qty: 18, unit: 'g' }, { ingredient: 'นมสด', qty: 180, unit: 'ml' }, { ingredient: 'ซอสช็อกโกแลต', qty: 20, unit: 'ml' }] },
  { id: 'i-thaitea', categoryId: 'c-tea', stationId: 'st-bar', name: 'ชาไทย', price: 45, emoji: '🧋', channels: ['counter', 'dine_in', 'takeaway', 'self_order'], modifierGroupIds: ['mg-size', 'mg-temp', 'mg-sweet', 'mg-extra'], prepMinutes: 3, recipe: [{ ingredient: 'ชาไทย', qty: 12, unit: 'g' }, { ingredient: 'นมข้นหวาน', qty: 30, unit: 'ml' }, { ingredient: 'นมสด', qty: 100, unit: 'ml' }] },
  { id: 'i-greentea', categoryId: 'c-tea', stationId: 'st-bar', name: 'ชาเขียวนม', price: 50, emoji: '🍵', channels: ['counter', 'dine_in', 'takeaway', 'self_order'], modifierGroupIds: ['mg-size', 'mg-temp', 'mg-sweet', 'mg-extra'], prepMinutes: 3, recipe: [{ ingredient: 'ผงชาเขียว', qty: 8, unit: 'g' }, { ingredient: 'นมสด', qty: 180, unit: 'ml' }] },
  { id: 'i-cocoa', categoryId: 'c-tea', stationId: 'st-bar', name: 'โกโก้', price: 50, emoji: '🍫', channels: ['counter', 'dine_in', 'takeaway', 'self_order'], modifierGroupIds: ['mg-size', 'mg-temp', 'mg-sweet', 'mg-extra'], prepMinutes: 3, recipe: [{ ingredient: 'ผงโกโก้', qty: 15, unit: 'g' }, { ingredient: 'นมสด', qty: 180, unit: 'ml' }] },
  { id: 'i-lemon', categoryId: 'c-tea', stationId: 'st-bar', name: 'ชามะนาว', price: 40, emoji: '🍋', channels: ['counter', 'dine_in', 'takeaway', 'self_order'], modifierGroupIds: ['mg-size', 'mg-sweet'], prepMinutes: 2, recipe: [{ ingredient: 'ชาดำ', qty: 10, unit: 'g' }, { ingredient: 'มะนาว', qty: 0.5, unit: 'ลูก' }] },
  { id: 'i-kaprao', categoryId: 'c-rice', stationId: 'st-hot', name: 'ข้าวกะเพราหมูสับ', price: 60, emoji: '🍛', channels: ['dine_in', 'takeaway', 'delivery', 'self_order'], modifierGroupIds: ['mg-spice', 'mg-egg'], prepMinutes: 8, recipe: [{ ingredient: 'หมูสับ', qty: 120, unit: 'g' }, { ingredient: 'ใบกะเพรา', qty: 15, unit: 'g' }, { ingredient: 'ข้าวสวย', qty: 250, unit: 'g' }] },
  { id: 'i-friedrice', categoryId: 'c-rice', stationId: 'st-hot', name: 'ข้าวผัดหมู', price: 60, emoji: '🍚', channels: ['dine_in', 'takeaway', 'delivery', 'self_order'], modifierGroupIds: ['mg-egg'], prepMinutes: 8, recipe: [{ ingredient: 'หมูสไลด์', qty: 80, unit: 'g' }, { ingredient: 'ไข่ไก่', qty: 1, unit: 'ฟอง' }, { ingredient: 'ข้าวสวย', qty: 250, unit: 'g' }] },
  { id: 'i-greencurry', categoryId: 'c-rice', stationId: 'st-hot', name: 'ข้าวแกงเขียวหวานไก่', price: 65, emoji: '🍛', channels: ['dine_in', 'takeaway', 'delivery', 'self_order'], modifierGroupIds: ['mg-spice'], prepMinutes: 10, recipe: [{ ingredient: 'ไก่', qty: 120, unit: 'g' }, { ingredient: 'น้ำแกงเขียวหวาน', qty: 200, unit: 'ml' }, { ingredient: 'ข้าวสวย', qty: 250, unit: 'g' }] },
  { id: 'i-padthai', categoryId: 'c-noodle', stationId: 'st-hot', name: 'ผัดไทยกุ้งสด', price: 80, emoji: '🍜', channels: ['dine_in', 'takeaway', 'delivery', 'self_order'], modifierGroupIds: ['mg-egg'], prepMinutes: 10, recipe: [{ ingredient: 'เส้นจันท์', qty: 150, unit: 'g' }, { ingredient: 'กุ้ง', qty: 5, unit: 'ตัว' }] },
  { id: 'i-tomyum', categoryId: 'c-noodle', stationId: 'st-hot', name: 'ก๋วยเตี๋ยวต้มยำ', price: 55, emoji: '🍜', channels: ['dine_in', 'takeaway', 'self_order'], modifierGroupIds: ['mg-spice'], prepMinutes: 7, recipe: [{ ingredient: 'เส้นเล็ก', qty: 120, unit: 'g' }, { ingredient: 'น้ำซุปต้มยำ', qty: 300, unit: 'ml' }, { ingredient: 'หมูสไลด์', qty: 60, unit: 'g' }] },
  { id: 'i-fries', categoryId: 'c-snack', stationId: 'st-hot', name: 'เฟรนช์ฟรายส์', price: 55, emoji: '🍟', channels: ['counter', 'dine_in', 'takeaway', 'delivery', 'self_order'], modifierGroupIds: [], prepMinutes: 6, recipe: [{ ingredient: 'มันฝรั่งแช่แข็ง', qty: 150, unit: 'g' }] },
  { id: 'i-wings', categoryId: 'c-snack', stationId: 'st-hot', name: 'ปีกไก่ทอด', price: 75, emoji: '🍗', channels: ['dine_in', 'takeaway', 'delivery', 'self_order'], modifierGroupIds: ['mg-spice'], prepMinutes: 9, recipe: [{ ingredient: 'ปีกไก่', qty: 6, unit: 'ชิ้น' }] },
  { id: 'i-toast', categoryId: 'c-dessert', stationId: 'st-dessert', name: 'ขนมปังปิ้งนมเนย', price: 45, emoji: '🍞', channels: ['counter', 'dine_in', 'takeaway', 'self_order'], modifierGroupIds: [], prepMinutes: 5, recipe: [{ ingredient: 'ขนมปัง', qty: 2, unit: 'แผ่น' }, { ingredient: 'นมข้นหวาน', qty: 20, unit: 'ml' }] },
  { id: 'i-cake', categoryId: 'c-dessert', stationId: 'st-dessert', name: 'เค้กช็อกโกแลต', price: 85, emoji: '🍰', channels: ['counter', 'dine_in', 'takeaway', 'self_order'], modifierGroupIds: [], prepMinutes: 1, recipe: [{ ingredient: 'เค้กช็อกโกแลต', qty: 1, unit: 'ชิ้น' }] },
  { id: 'i-mango', categoryId: 'c-dessert', stationId: 'st-dessert', name: 'ข้าวเหนียวมะม่วง', price: 90, emoji: '🥭', channels: ['dine_in', 'takeaway', 'self_order'], modifierGroupIds: [], prepMinutes: 4, recipe: [{ ingredient: 'มะม่วง', qty: 0.5, unit: 'ลูก' }, { ingredient: 'ข้าวเหนียวมูน', qty: 150, unit: 'g' }] },
];

export const zones: Zone[] = [
  { id: 'z-in', name: 'ในร้าน', color: '#2b3d55' },
  { id: 'z-out', name: 'ระเบียง', color: '#2f4a3e' },
  { id: 'z-bar', name: 'บาร์', color: '#4a3a2b' },
];

/** A 12 × 8 m room: dining inside, a terrace along the right, bar seats along the top. */
export const tables: Table[] = [
  { id: 't-1', zoneId: 'z-in', name: '1', seats: 2, x: 1.5, y: 2, shape: 'round' },
  { id: 't-2', zoneId: 'z-in', name: '2', seats: 2, x: 3.5, y: 2, shape: 'round' },
  { id: 't-3', zoneId: 'z-in', name: '3', seats: 4, x: 1.5, y: 4.2, shape: 'square' },
  { id: 't-4', zoneId: 'z-in', name: '4', seats: 4, x: 3.5, y: 4.2, shape: 'square' },
  { id: 't-5', zoneId: 'z-in', name: '5', seats: 6, x: 6, y: 3.2, shape: 'long' },
  { id: 't-6', zoneId: 'z-in', name: '6', seats: 4, x: 1.5, y: 6.4, shape: 'square' },
  { id: 't-7', zoneId: 'z-in', name: '7', seats: 4, x: 3.5, y: 6.4, shape: 'square' },
  { id: 't-8', zoneId: 'z-in', name: '8', seats: 6, x: 6, y: 6, shape: 'long' },
  { id: 't-11', zoneId: 'z-out', name: '11', seats: 2, x: 9.8, y: 2, shape: 'round' },
  { id: 't-12', zoneId: 'z-out', name: '12', seats: 2, x: 9.8, y: 4, shape: 'round' },
  { id: 't-13', zoneId: 'z-out', name: '13', seats: 4, x: 9.8, y: 6.2, shape: 'square' },
  { id: 't-b1', zoneId: 'z-bar', name: 'B1', seats: 1, x: 4.5, y: 0.5, shape: 'round' },
  { id: 't-b2', zoneId: 'z-bar', name: 'B2', seats: 1, x: 5.5, y: 0.5, shape: 'round' },
  { id: 't-b3', zoneId: 'z-bar', name: 'B3', seats: 1, x: 6.5, y: 0.5, shape: 'round' },
];

export const FLOOR = { width: 12, depth: 8 };

export const byId = <T extends { id: string }>(list: T[]): Record<string, T> => Object.fromEntries(list.map((x) => [x.id, x]));
export const menuById = byId(menu);
export const stationById = byId(stations);
export const tableById = byId(tables);
export const modifierGroupById = byId(modifierGroups);
export const modifierById: Record<string, Modifier> = Object.fromEntries(modifierGroups.flatMap((g) => g.modifiers.map((m) => [m.id, m])));
