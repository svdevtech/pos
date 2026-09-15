/**
 * Fills a demo store with believable shop data for a presentation, copied from a real store
 * through the API — categories, units, suppliers, a spread of products with their barcodes and
 * stock, members with share capital, and a week of sales so the dashboard and the reports have
 * something to show.
 *
 *   BASE=https://t-pos.tdev2022.com FROM=BBR FROM_USER=owner FROM_PASS=Owner12345 \
 *   STORE=DEMOPOS POS_USER=demo POS_PASS=Demo@2569pos node scripts/pos-seed-demo.mjs
 *
 * Nothing is written to the source store: it is only read. Re-runnable — products are matched by
 * SKU, members by code, and the trading week is only added when the store has no bills yet.
 */
const BASE = process.env.BASE ?? 'https://t-pos.tdev2022.com';
const FROM = process.env.FROM ?? 'BBR';
const FROM_USER = process.env.FROM_USER ?? 'owner';
const FROM_PASS = process.env.FROM_PASS ?? 'Owner12345';
const STORE = process.env.STORE ?? 'DEMOPOS';
const USER = process.env.POS_USER ?? 'demo';
const PASS = process.env.POS_PASS ?? 'Demo@2569pos';
const WANT = Number(process.env.PRODUCTS ?? 400);
const MEMBERS = Number(process.env.MEMBERS ?? 24);
const DAYS = Number(process.env.DAYS ?? 7);
const BILLS = Number(process.env.BILLS ?? 90);

const session = async (store, username, password) => {
  const r = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ store_code: store, username, password }),
  });
  if (!r.ok) throw new Error(`login ${store} ${r.status}: ${await r.text()}`);
  const { access_token } = await r.json();
  return async (method, path, body) => {
    const res = await fetch(`${BASE}/api/v1${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access_token}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  };
};

const src = await session(FROM, FROM_USER, FROM_PASS);
const dst = await session(STORE, USER, PASS);

// ---- lookups ---------------------------------------------------------------------------------
const srcCats = await src('GET', '/categories');
const srcUnits = await src('GET', '/units');
const dstCats = new Map((await dst('GET', '/categories')).map((c) => [c.name, c.id]));
const dstUnits = new Map((await dst('GET', '/units')).map((u) => [u.name, u.id]));
for (const c of srcCats) if (!dstCats.has(c.name)) dstCats.set(c.name, (await dst('POST', '/categories', { name: c.name })).id);
for (const u of srcUnits) if (!dstUnits.has(u.name)) dstUnits.set(u.name, (await dst('POST', '/units', { name: u.name })).id);
console.log(`lookups: ${dstCats.size} categories, ${dstUnits.size} units`);

// the suppliers endpoint answers with a bare array, not a page
const asList = (v) => (Array.isArray(v) ? v : (v?.items ?? []));
const srcSup = asList(await src('GET', '/suppliers?page=1&page_size=100'));
const dstSupNames = new Set(asList(await dst('GET', '/suppliers?page=1&page_size=200')).map((s) => s.name));
let sup = 0;
for (const s of srcSup.slice(0, 20)) {
  if (dstSupNames.has(s.name)) continue;
  await dst('POST', '/suppliers', { name: s.name, phone: s.phone ?? '', address: s.address ?? '' });
  sup += 1;
}
console.log(`suppliers: +${sup}`);

// ---- products: a spread over the categories, only ones that can actually be sold ---------------
const pool = [];
for (let page = 1; page <= 14 && pool.length < WANT * 6; page += 1) {
  const res = await src('GET', `/products?page=${page}&page_size=200&active=true`);
  const items = res.items ?? [];
  if (items.length === 0) break;
  pool.push(...items.filter((p) => Number(p.sell_price) > 0 && p.name && p.primary_barcode));
}
const byCat = new Map();
for (const p of pool) {
  const k = p.category_name ?? '-';
  if (!byCat.has(k)) byCat.set(k, []);
  byCat.get(k).push(p);
}
// round-robin over the categories, so the demo till has something in every aisle
const picked = [];
const queues = [...byCat.values()].map((a) => a.slice());
while (picked.length < WANT && queues.some((q) => q.length)) {
  for (const q of queues) {
    if (picked.length >= WANT) break;
    const p = q.shift();
    if (p) picked.push(p);
  }
}
const skus = new Set();
for (let page = 1; page <= 10; page += 1) {
  const res = await dst('GET', `/products?page=${page}&page_size=200&archived=all`);
  const items = res.items ?? [];
  if (items.length === 0) break;
  for (const p of items) skus.add(p.sku);
}
let added = 0;
for (const p of picked) {
  if (skus.has(p.sku)) continue;
  const stock = Math.max(6, Math.round(Number(p.stock_on_hand) || 0) || 24);
  try {
    await dst('POST', '/products', {
      sku: p.sku,
      name: p.name,
      category_id: dstCats.get(p.category_name) ?? null,
      unit_id: dstUnits.get(p.unit_name) ?? null,
      cost_last: String(p.cost_last ?? '0'),
      cost_avg: String(p.cost_avg ?? p.cost_last ?? '0'),
      sell_price: String(p.sell_price),
      min_level1: '3',
      barcodes: p.primary_barcode ? [p.primary_barcode] : [],
      opening_stock: String(stock),
      is_active: true,
    });
    added += 1;
  } catch (e) {
    if (!/CONFLICT|DUPLICATE/i.test(String(e.message))) throw e;
  }
}
const all = [];
for (let page = 1; page <= 10; page += 1) {
  const res = await dst('GET', `/products?page=${page}&page_size=200`);
  const items = res.items ?? [];
  if (items.length === 0) break;
  all.push(...items);
}
console.log(`products: +${added} (store now holds ${all.length})`);

// ---- members ----------------------------------------------------------------------------------
const srcMembers = ((await src('GET', '/members?page=1&page_size=200')).items ?? []).filter((m) => !m.is_walkin && m.name);
const dstMemberCodes = new Set(((await dst('GET', '/members?page=1&page_size=200')).items ?? []).map((m) => m.member_code));
let addedMembers = 0;
for (const m of srcMembers.slice(0, MEMBERS)) {
  if (dstMemberCodes.has(m.member_code)) continue;
  await dst('POST', '/members', {
    member_code: m.member_code,
    name: m.name,
    address: m.address ?? '',
    phone: m.phone ?? '',
    opening_share: String(m.share_capital ?? '0'),
  });
  addedMembers += 1;
}
const allMembers = (await dst('GET', '/members?page=1&page_size=200')).items ?? [];
console.log(`members: +${addedMembers} (store now holds ${allMembers.length})`);

// ---- a week of trading, so every report and chart has something in it ---------------------------
const since = new Date(Date.now() - DAYS * 86400e3).toISOString().slice(0, 10);
const already = await dst('GET', `/sales?from=${since}&page=1&page_size=1`);
if ((already.total ?? 0) > 0) {
  console.log(`sales: ${already.total} bills already in the last ${DAYS} days, left alone`);
} else {
  const sellable = all.filter((p) => Number(p.sell_price) > 0 && Number(p.stock_on_hand) > 2);
  let posted = 0;
  for (let i = 0; i < BILLS; i += 1) {
    const day = Math.floor((i / BILLS) * DAYS);
    const at = new Date(Date.now() - (DAYS - 1 - day) * 86400e3);
    at.setHours(8 + Math.floor(Math.random() * 11), Math.floor(Math.random() * 60), 0, 0);
    const lines = [];
    const n = 1 + Math.floor(Math.random() * 4);
    for (let j = 0; j < n; j += 1) {
      const p = sellable[Math.floor(Math.random() * sellable.length)];
      if (!p || lines.some((l) => l.product_id === p.id)) continue;
      lines.push({ product_id: p.id, qty: String(1 + Math.floor(Math.random() * 3)), discount: '0' });
    }
    if (lines.length === 0) continue;
    const quote = await dst('POST', '/sales/quote', { lines, payments: [], bill_discount: '0', bill_discount_pct: '0' });
    const net = Number(quote.totals?.net ?? quote.net ?? 0);
    if (!net) continue;
    // one bill in six goes on a member's account, the rest are cash
    const member = i % 6 === 0 && allMembers.length ? allMembers[i % allMembers.length] : null;
    const payments = member ? [{ method: 'credit', amount: net.toFixed(2) }] : [{ method: 'cash', amount: (Math.ceil(net / 20) * 20).toFixed(2) }];
    await dst('POST', '/sales', {
      lines,
      payments,
      bill_discount: '0',
      bill_discount_pct: '0',
      member_id: member?.id,
      sold_at: at.toISOString(),
      terminal: 'DEMO-1',
    });
    posted += 1;
  }
  console.log(`sales: +${posted} bills over the last ${DAYS} days`);
}

const report = await dst('GET', `/reports/daily-sales?from=${since}&to=${new Date().toISOString().slice(0, 10)}`);
const bills = (report.rows ?? []).reduce((n, r) => n + Number(r.bills ?? 0), 0);
const net = (report.rows ?? []).reduce((n, r) => n + Number(r.net ?? 0), 0);
console.log(`seeded ${STORE}: ${all.length} products, ${allMembers.length} members, ${bills} bills / ฿${net.toFixed(2)} in the last ${DAYS} days`);
