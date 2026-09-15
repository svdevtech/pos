/**
 * Puts the prototype's café menu into a store through the real API — ingredient products,
 * stations, categories, option groups with their own recipe lines, and items with recipes.
 *
 *   BASE=http://localhost:3010 STORE=DEMO USER=owner PASS=Owner12345 node scripts/fnb-seed-demo.mjs
 *
 * Re-runnable: everything is matched by name and updated in place.
 */
const BASE = process.env.BASE ?? 'http://localhost:3010';
const STORE = process.env.STORE ?? 'DEMO';
const USER = process.env.POS_USER ?? 'owner';
const PASS = process.env.POS_PASS ?? 'Owner12345';

const login = await fetch(`${BASE}/api/v1/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ store_code: STORE, username: USER, password: PASS }),
});
if (!login.ok) throw new Error(`login ${login.status}: ${await login.text()}`);
const { access_token } = await login.json();
const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${access_token}` };
const call = async (method, path, body) => {
  const r = await fetch(`${BASE}/api/v1${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status}: ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
};

// ---- ingredients (products), matched by SKU ----------------------------------------------
const existing = (await call('GET', '/products?page=1&page_size=500&q=ING-')).items ?? [];
const bySku = Object.fromEntries(existing.map((p) => [p.sku, p]));
const ingredient = async (sku, name, cost, stock) => {
  if (bySku[sku]) return bySku[sku].id;
  const p = await call('POST', '/products', { sku, name, cost_avg: String(cost), cost_last: String(cost), sell_price: '0', is_active: true });
  // opening stock through an adjustment so the movement ledger explains where it came from
  await call('POST', '/inventory/adjustments', { reason: 'opening', note: 'seed', lines: [{ product_id: p.id, qty_delta: String(stock) }] }).catch((e) => console.warn('adjustment skipped:', String(e).slice(0, 120)));
  return p.id;
};
const ING = {
  beans: await ingredient('ING-BEANS', 'เมล็ดกาแฟ (g)', 0.9, 5000),
  milk: await ingredient('ING-MILK', 'นมสด (L)', 52, 40),
  oat: await ingredient('ING-OAT', 'นมโอ๊ต (L)', 95, 10),
  condensed: await ingredient('ING-CONDENSED', 'นมข้นหวาน (ml)', 0.12, 4000),
  thaitea: await ingredient('ING-THAITEA', 'ชาไทย (g)', 0.35, 2000),
  matcha: await ingredient('ING-MATCHA', 'ผงชาเขียว (g)', 1.8, 800),
  cocoa: await ingredient('ING-COCOA', 'ผงโกโก้ (g)', 0.6, 1500),
  choc: await ingredient('ING-CHOC', 'ซอสช็อกโกแลต (ml)', 0.3, 2000),
  pork: await ingredient('ING-PORK', 'หมูสับ (g)', 0.18, 8000),
  porkslice: await ingredient('ING-PORKSLICE', 'หมูสไลด์ (g)', 0.2, 6000),
  basil: await ingredient('ING-BASIL', 'ใบกะเพรา (g)', 0.15, 1500),
  rice: await ingredient('ING-RICE', 'ข้าวสวย (g)', 0.03, 30000),
  egg: await ingredient('ING-EGG', 'ไข่ไก่ (ฟอง)', 5, 300),
  chicken: await ingredient('ING-CHICKEN', 'ไก่ (g)', 0.14, 8000),
  greencurry: await ingredient('ING-GREENCURRY', 'น้ำแกงเขียวหวาน (ml)', 0.09, 8000),
  padthai: await ingredient('ING-PADTHAI', 'เส้นจันท์ (g)', 0.06, 8000),
  shrimp: await ingredient('ING-SHRIMP', 'กุ้ง (ตัว)', 9, 400),
  noodle: await ingredient('ING-NOODLE', 'เส้นเล็ก (g)', 0.05, 8000),
  tomyum: await ingredient('ING-TOMYUM', 'น้ำซุปต้มยำ (ml)', 0.05, 20000),
  fries: await ingredient('ING-FRIES', 'มันฝรั่งแช่แข็ง (g)', 0.12, 10000),
  wings: await ingredient('ING-WINGS', 'ปีกไก่ (ชิ้น)', 6, 500),
  bread: await ingredient('ING-BREAD', 'ขนมปัง (แผ่น)', 3, 400),
  cake: await ingredient('ING-CAKE', 'เค้กช็อกโกแลต (ชิ้น)', 35, 40),
  mango: await ingredient('ING-MANGO', 'มะม่วง (ลูก)', 25, 60),
  sticky: await ingredient('ING-STICKY', 'ข้าวเหนียวมูน (g)', 0.08, 6000),
  lemon: await ingredient('ING-LEMON', 'มะนาว (ลูก)', 4, 200),
  blacktea: await ingredient('ING-BLACKTEA', 'ชาดำ (g)', 0.4, 1500),
  pearl: await ingredient('ING-PEARL', 'ไข่มุก (g)', 0.1, 3000),
  whip: await ingredient('ING-WHIP', 'วิปครีม (g)', 0.25, 2000),
};
const L = (id, qty, factor = 1, waste = 0, mode = 'add', replaces = null) => ({
  ingredient_product_id: id, qty: String(qty), factor_to_stock: String(factor), waste_pct: String(waste), mode, replaces_product_id: replaces,
});

// ---- menu ------------------------------------------------------------------------------
const menu = await call('GET', '/fnb/menu?all=1');
const byName = (list) => Object.fromEntries(list.map((x) => [x.name, x]));
const S = byName(menu.stations);
const C = byName(menu.categories);
const G = byName(menu.modifier_groups);
const I = byName(menu.items);

const station = async (name, output, sort) => (await call('PUT', '/fnb/menu/stations', { id: S[name]?.id, name, output, sort, is_active: true })).id;
const st = { bar: await station('บาร์เครื่องดื่ม', 'kds', 1), hot: await station('ครัวร้อน', 'both', 2), dessert: await station('ของหวาน', 'printer', 3) };

const category = async (name, sort) => (await call('PUT', '/fnb/menu/categories', { id: C[name]?.id, name, sort, is_active: true })).id;
const cat = {
  coffee: await category('กาแฟ', 1), tea: await category('ชา · นม', 2), rice: await category('ข้าว', 3),
  noodle: await category('เส้น', 4), snack: await category('ของทานเล่น', 5), dessert: await category('ของหวาน', 6),
};

const group = async (name, min, max, sort, mods) => {
  const old = G[name];
  const oldMods = old ? Object.fromEntries(old.modifiers.map((m) => [m.name, m])) : {};
  const g = await call('PUT', '/fnb/menu/modifier-groups', {
    id: old?.id, name, min_select: min, max_select: max, sort, is_active: true,
    modifiers: mods.map((m, i) => ({ id: oldMods[m.name]?.id, name: m.name, price_delta: String(m.delta ?? 0), is_default: Boolean(m.def), sort: i, is_active: true, lines: m.lines ?? [] })),
  });
  return g.id;
};
const grp = {
  size: await group('ขนาด', 1, 1, 1, [{ name: 'S', def: true }, { name: 'M', delta: 10 }, { name: 'L', delta: 20 }]),
  temp: await group('ร้อน / เย็น', 1, 1, 2, [{ name: 'ร้อน' }, { name: 'เย็น', delta: 5, def: true }, { name: 'ปั่น', delta: 10 }]),
  sweet: await group('ความหวาน', 1, 1, 3, [{ name: 'ไม่หวาน' }, { name: 'หวานน้อย' }, { name: 'หวานปกติ', def: true }, { name: 'หวานมาก' }]),
  milk: await group('นม', 0, 1, 4, [
    { name: 'นมโอ๊ต', delta: 15, lines: [L(ING.oat, 200, 0.001, 0, 'replace', ING.milk)] },
    { name: 'นมอัลมอนด์', delta: 15, lines: [L(ING.oat, 200, 0.001, 0, 'replace', ING.milk)] },
  ]),
  extra: await group('เพิ่ม', 0, 3, 5, [
    { name: 'ช็อตเสริม', delta: 15, lines: [L(ING.beans, 18, 1, 5)] },
    { name: 'ไข่มุก', delta: 10, lines: [L(ING.pearl, 40)] },
    { name: 'วิปครีม', delta: 10, lines: [L(ING.whip, 20)] },
  ]),
  spice: await group('ความเผ็ด', 1, 1, 6, [{ name: 'ไม่เผ็ด' }, { name: 'เผ็ดน้อย', def: true }, { name: 'เผ็ดมาก' }]),
  egg: await group('ไข่', 0, 1, 7, [{ name: 'ไข่ดาว', delta: 10, lines: [L(ING.egg, 1)] }, { name: 'ไข่เจียว', delta: 15, lines: [L(ING.egg, 2)] }]),
};

const ALL = ['counter', 'dine_in', 'takeaway', 'delivery', 'self_order'];
const CUP = ['counter', 'dine_in', 'takeaway', 'self_order'];
const PLATE = ['dine_in', 'takeaway', 'delivery', 'self_order'];
const drink = [grp.size, grp.temp, grp.sweet, grp.milk, grp.extra];
const items = [
  ['อเมริกาโน่', cat.coffee, st.bar, 45, [grp.size, grp.temp, grp.sweet, grp.extra], [L(ING.beans, 18, 1, 5)], CUP],
  ['ลาเต้', cat.coffee, st.bar, 55, drink, [L(ING.beans, 18, 1, 5), L(ING.milk, 200, 0.001)], CUP],
  ['คาปูชิโน่', cat.coffee, st.bar, 55, drink, [L(ING.beans, 18, 1, 5), L(ING.milk, 150, 0.001)], CUP],
  ['มอคค่า', cat.coffee, st.bar, 60, drink, [L(ING.beans, 18, 1, 5), L(ING.milk, 180, 0.001), L(ING.choc, 20)], CUP],
  ['ชาไทย', cat.tea, st.bar, 45, [grp.size, grp.temp, grp.sweet, grp.extra], [L(ING.thaitea, 12), L(ING.condensed, 30), L(ING.milk, 100, 0.001)], CUP],
  ['ชาเขียวนม', cat.tea, st.bar, 50, [grp.size, grp.temp, grp.sweet, grp.extra], [L(ING.matcha, 8), L(ING.milk, 180, 0.001)], CUP],
  ['โกโก้', cat.tea, st.bar, 50, [grp.size, grp.temp, grp.sweet, grp.extra], [L(ING.cocoa, 15), L(ING.milk, 180, 0.001)], CUP],
  ['ชามะนาว', cat.tea, st.bar, 40, [grp.size, grp.sweet], [L(ING.blacktea, 10), L(ING.lemon, 0.5)], CUP],
  ['ข้าวกะเพราหมูสับ', cat.rice, st.hot, 60, [grp.spice, grp.egg], [L(ING.pork, 120), L(ING.basil, 15), L(ING.rice, 250)], PLATE],
  ['ข้าวผัดหมู', cat.rice, st.hot, 60, [grp.egg], [L(ING.porkslice, 80), L(ING.egg, 1), L(ING.rice, 250)], PLATE],
  ['ข้าวแกงเขียวหวานไก่', cat.rice, st.hot, 65, [grp.spice], [L(ING.chicken, 120), L(ING.greencurry, 200), L(ING.rice, 250)], PLATE],
  ['ผัดไทยกุ้งสด', cat.noodle, st.hot, 80, [grp.egg], [L(ING.padthai, 150), L(ING.shrimp, 5)], PLATE],
  ['ก๋วยเตี๋ยวต้มยำ', cat.noodle, st.hot, 55, [grp.spice], [L(ING.noodle, 120), L(ING.tomyum, 300), L(ING.porkslice, 60)], ['dine_in', 'takeaway', 'self_order']],
  ['เฟรนช์ฟรายส์', cat.snack, st.hot, 55, [], [L(ING.fries, 150)], ALL],
  ['ปีกไก่ทอด', cat.snack, st.hot, 75, [grp.spice], [L(ING.wings, 6)], PLATE],
  ['ขนมปังปิ้งนมเนย', cat.dessert, st.dessert, 45, [], [L(ING.bread, 2), L(ING.condensed, 20)], CUP],
  ['เค้กช็อกโกแลต', cat.dessert, st.dessert, 85, [], [L(ING.cake, 1)], CUP],
  ['ข้าวเหนียวมะม่วง', cat.dessert, st.dessert, 90, [], [L(ING.mango, 0.5), L(ING.sticky, 150)], ['dine_in', 'takeaway', 'self_order']],
];
let n = 0;
for (const [name, category_id, station_id, price, groups, lines, channels] of items) {
  await call('PUT', '/fnb/menu/items', {
    id: I[name]?.id, name, category_id, station_id, price: String(price), channels, sort: n++, is_active: true,
    modifier_group_ids: groups, recipe: { yield_qty: '1', lines },
  });
}
// ---- the room ----------------------------------------------------------------------------
const room = await call('GET', '/fnb/floor?all=1');
const Z = Object.fromEntries((room.zones ?? []).map((z) => [z.name, z]));
const zone = async (name, color, sort) => (await call('PUT', '/fnb/floor/zones', { id: Z[name]?.id, name, color, sort, is_active: true })).id;
const zIn = await zone('ในร้าน', '#2b3d55', 0);
const zOut = await zone('ระเบียง', '#2f4a3e', 1);
const zBar = await zone('บาร์', '#4a3a2b', 2);
const T = Object.fromEntries((room.tables ?? []).map((t) => [t.code, t]));
const TABLES = [
  ['1', zIn, 2, 1.5, 2, 'round'], ['2', zIn, 2, 3.5, 2, 'round'], ['3', zIn, 4, 1.5, 4.2, 'square'], ['4', zIn, 4, 3.5, 4.2, 'square'],
  ['5', zIn, 6, 6, 3.2, 'long'], ['6', zIn, 4, 1.5, 6.4, 'square'], ['7', zIn, 4, 3.5, 6.4, 'square'], ['8', zIn, 6, 6, 6, 'long'],
  ['11', zOut, 2, 9.8, 2, 'round'], ['12', zOut, 2, 9.8, 4, 'round'], ['13', zOut, 4, 9.8, 6.2, 'square'],
  ['B1', zBar, 1, 4.5, 0.5, 'round'], ['B2', zBar, 1, 5.5, 0.5, 'round'], ['B3', zBar, 1, 6.5, 0.5, 'round'],
];
let ts = 0;
for (const [code, zone_id, seats, x, y, shape] of TABLES) {
  await call('PUT', '/fnb/floor/tables', { id: T[code]?.id, code, zone_id, seats, x: String(x), y: String(y), shape, rotation: 0, sort: ts++, is_active: true });
}
const roomAfter = await call('GET', '/fnb/floor');
console.log(`room: ${roomAfter.zones.length} zones, ${roomAfter.tables.length} tables`);

const after = await call('GET', '/fnb/menu');
console.log(`seeded ${STORE}: ${after.stations.length} stations, ${after.categories.length} categories, ${after.modifier_groups.length} option groups, ${after.items.length} items, ${after.items.filter((i) => i.recipe?.lines?.length).length} with recipes, deduct_on=${after.deduct_on}`);
