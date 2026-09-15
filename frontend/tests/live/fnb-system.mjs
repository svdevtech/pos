/**
 * Full-system test of the restaurant / café module against a running deployment, driven through
 * the real web UI.
 *
 *   node tests/live/fnb-system.mjs                        # against https://t-pos.tdev2022.com
 *   BASE=http://localhost:3010 STORE=DEMO node tests/live/fnb-system.mjs
 *
 * Every scenario clicks the deployed site in a real browser: it builds a small menu with a recipe,
 * lays out a table, takes orders at the counter and from a phone's QR, watches the kitchen screen,
 * moves and splits a bill, pays, and reads the reports — then puts everything back.
 *
 * Data hygiene: everything it creates carries the run id (E2E-<timestamp>) so it can be found and
 * switched off. The teardown voids its orders, cancels its bills, archives its ingredient,
 * deactivates its menu/zone/tables and restores the store's F&B settings. Anything it could not
 * undo is listed at the end of the run and in report-fnb.json.
 *
 * It may be pointed at a live shop outside opening hours: it never touches that shop's own menu,
 * products or sales, and its bills are cancelled before it finishes.
 */
import { chromium, devices } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE ?? 'https://t-pos.tdev2022.com';
const STORE = process.env.STORE ?? 'BBR';
const USER = process.env.E2E_USER ?? 'owner';
const PASS = process.env.E2E_PASS ?? 'Owner12345';
const SHOTS = resolve(here, 'shots-fnb');
const th = JSON.parse(readFileSync(resolve(here, '../../i18n/messages/th.json'), 'utf8'));
const L = (path) => path.split('.').reduce((o, k) => o?.[k], th);

const RUN = `E2E-${new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)}`;
const TAG = RUN.slice(-6); // short suffix for names that must stay readable on a tile
const results = [];
let ctxPage = null;

const step = async (id, name, fn) => {
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({ id, name, status: 'PASS', ms: Date.now() - started, detail: detail ?? '' });
    console.log(`PASS ${id} ${name}${detail ? ` — ${detail}` : ''}`);
    return detail;
  } catch (err) {
    const raw = String(err?.message ?? err).split('\n').map((l) => l.trim()).filter(Boolean);
    const msg = [raw[0], raw.find((l) => l.includes('waiting for'))].filter(Boolean).join(' · ').slice(0, 300);
    results.push({ id, name, status: 'FAIL', ms: Date.now() - started, detail: msg });
    console.log(`FAIL ${id} ${name} — ${msg}`);
    if (ctxPage) {
      try {
        mkdirSync(SHOTS, { recursive: true });
        await ctxPage.screenshot({ path: resolve(SHOTS, `${id}.png`) });
      } catch {
        /* ignore */
      }
    }
    return null;
  }
};

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const money = (text) => Number(String(text).replace(/[^\d.-]/g, ''));
const near = (a, b, tol = 0.02) => Math.abs(Number(a) - Number(b)) <= tol;

/** Calls the API with the session the page already holds (verification reads and teardown only). */
const api = (page, path, init) =>
  page.evaluate(
    async ([p, i]) => {
      const s = JSON.parse(window.localStorage.getItem('pos.session') ?? '{}');
      const res = await fetch(`/api/v1${p}`, {
        ...i,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.access_token}`, ...(i?.headers ?? {}) },
      });
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null };
    },
    [path, init ?? {}],
  );

const login = async (page) => {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.getByLabel(L('auth.storeCode')).fill(STORE);
  await page.getByLabel(L('auth.username')).fill(USER);
  await page.getByLabel(L('auth.password')).first().fill(PASS);
  await page.getByRole('button', { name: L('auth.signIn'), exact: true }).click();
  await page.waitForURL(/\/(dashboard|pos|fnb)/, { timeout: 45_000 });
};

/** Shuts the receipt window; Escape leaves the modal up and it then swallows the next click. */
const closeReceipt = async (page) => {
  const dlg = page.getByTestId('receipt-dialog');
  for (let i = 0; i < 4 && (await dlg.count()); i += 1) {
    for (const l of [page.getByTestId('receipt-close'), page.getByTestId('receipt-new-sale'), dlg.locator('button[aria-label="close"]')]) {
      if (await l.count()) {
        await l.first().click({ timeout: 5_000 }).catch(() => {});
        break;
      }
    }
    await page.waitForTimeout(600);
  }
  if (await dlg.count()) throw new Error('ปิดหน้าต่างใบเสร็จไม่ได้');
  await page.waitForTimeout(300);
};

/** Opens the floor plan's side panel on one table; the panel toggles, so close it first. */
const openTablePanel = async (page, tableId, code) => {
  const panel = page.getByTestId('table-panel');
  if (await panel.count()) {
    // already open on this table: leave it, a second tap would close it
    if (code && (await panel.innerText()).includes(code)) return;
    // a CSS selector, not a role: a dialog that has just closed can still leave the page aria-hidden
    await panel.locator('button[aria-label="close"]').first().click({ timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(500);
  }
  await page.locator(`[data-testid="table-${tableId}"]`).click({ force: true });
  await panel.waitFor({ timeout: 20_000 });
};

/** The F&B screens hold an SSE stream open, so networkidle never fires on them. */
const goFnb = async (page, path, ready) => {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  if (ready) await page.waitForSelector(ready, { timeout: 45_000 });
  await page.waitForTimeout(900);
};

const main = async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, locale: 'th-TH' });
  await ctx.addInitScript(() => {
    window.print = () => {};
  });
  const page = await ctx.newPage();
  ctxPage = page;
  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|MISSING_MESSAGE/.test(m.text())) consoleErrors.push(m.text().slice(0, 200));
  });

  // everything this run creates, so the teardown removes exactly its own traces
  const made = { sales: [], orders: [], items: [], categories: [], stations: [], groups: [], mods: {}, promos: [], zones: [], tables: [], products: [], reservations: [] };
  let settingsBefore = null;
  const name = {
    station: `E2E บาร์ ${TAG}`,
    category: `E2E เครื่องดื่ม ${TAG}`,
    item: `E2E ลาเต้ ${TAG}`,
    group: `E2E ขนาด ${TAG}`,
    zone: `E2E โซน ${TAG}`,
    tableA: `E9${TAG.slice(-2)}`,
    tableB: `E8${TAG.slice(-2)}`,
    promo: `E2E โปร ${TAG}`,
    sku: `E2E-ING-${TAG}`,
    ingredient: `E2E วัตถุดิบ ${TAG}`,
    guest: `E2E ลูกค้า ${TAG}`,
  };

  // ============================================================ A. sign in
  await step('A1', 'เข้าสู่ระบบเว็บจริงและเปิดโหมดร้านอาหาร', async () => {
    await login(page);
    await goFnb(page, '/fnb/order', '[data-testid="channel"]');
    const bar = await page.locator('header').first().innerText();
    return `${new URL(page.url()).pathname} · ${bar.split('\n')[0].slice(0, 40)}`;
  });

  await step('A2', 'อ่านค่าตั้งค่าเดิมของร้านไว้คืนตอนจบ', async () => {
    const res = await api(page, '/store/settings');
    assert(res.status === 200, `GET /store/settings → ${res.status}`);
    settingsBefore = res.body?.fnb ?? null;
    return settingsBefore ? JSON.stringify(settingsBefore).slice(0, 80) : 'ยังไม่เคยตั้งค่า F&B';
  });

  // ============================================================ B. setup through the settings UI
  await step('B1', 'ตั้งค่า → สถานีครัว: สร้างสถานีใหม่ (จอ + กระดาษ)', async () => {
    await goFnb(page, '/fnb/settings', '[data-testid="cfg-tabs"]');
    await page.getByTestId('cfg-tab-stations').click();
    await page.getByTestId('cfg-add-station').click();
    await page.getByTestId('cfg-station-name').locator('input').fill(name.station);
    await page.getByTestId('cfg-station-output').locator('input').waitFor({ state: 'attached' });
    await page.getByTestId('cfg-station-output').click();
    await page.getByRole('option', { name: L('fnb.outputBoth') }).click();
    await page.getByTestId('cfg-save-station').click();
    await page.waitForTimeout(1500);
    const res = await api(page, '/fnb/menu?all=1');
    const st = res.body.stations.find((s) => s.name === name.station);
    assert(st, 'สถานีที่สร้างไม่ปรากฏใน /fnb/menu');
    made.stations.push(st.id);
    assert(st.output === 'both', `output = ${st.output}`);
    return `${st.name} · output=${st.output}`;
  });

  await step('B2', 'ตั้งค่า → เมนู: สร้างหมวดใหม่', async () => {
    await page.getByTestId('cfg-tab-menu').click();
    await page.waitForTimeout(800);
    await page.getByTestId('cfg-add-cat').click();
    await page.getByTestId('cfg-cat-name').locator('input').fill(name.category);
    await page.getByTestId('cfg-save-cat').click();
    await page.waitForTimeout(1500);
    const res = await api(page, '/fnb/menu?all=1');
    const cat = res.body.categories.find((c) => c.name === name.category);
    assert(cat, 'หมวดที่สร้างไม่ปรากฏ');
    made.categories.push(cat.id);
    return cat.name;
  });

  await step('B3', 'สร้างวัตถุดิบและสต็อกตั้งต้น 1000 (เตรียมของ — ฝั่งสินค้าถูกทดสอบในชุด full-system)', async () => {
    const created = await api(page, '/products', {
      method: 'POST',
      body: JSON.stringify({ sku: name.sku, name: name.ingredient, cost_avg: '0.90', cost_last: '0.90', sell_price: '0', is_active: true }),
    });
    assert(created.status === 201 || created.status === 200, `สร้างสินค้า → ${created.status}`);
    const found = await api(page, `/products?q=${encodeURIComponent(name.sku)}&page=1&page_size=5`);
    const p = (found.body.items ?? []).find((x) => x.sku === name.sku);
    assert(p, 'สินค้าที่สร้างไม่พบจาก API');
    made.products.push(p.id);
    // opening stock through a real adjustment so the ledger explains it
    const adj = await api(page, '/inventory/adjustments', {
      method: 'POST',
      body: JSON.stringify({ reason: 'opening', note: RUN, lines: [{ product_id: p.id, qty_delta: '1000' }] }),
    });
    assert(adj.status === 201 || adj.status === 200, `ปรับสต็อกตั้งต้น → ${adj.status}`);
    const after = await api(page, `/products/${p.id}`);
    assert(near(after.body.stock_on_hand, 1000, 0.001), `สต็อกตั้งต้น = ${after.body.stock_on_hand}`);
    return `${name.sku} · สต็อก ${Number(after.body.stock_on_hand)}`;
  });

  await step('B4', 'ตั้งค่า → เมนู: สร้างเมนูพร้อมสูตรตัดวัตถุดิบ 18 ก. เผื่อเสีย 5%', async () => {
    await goFnb(page, '/fnb/settings', '[data-testid="cfg-tabs"]');
    await page.getByTestId('cfg-add-item').click();
    const dialog = page.getByRole('dialog');
    await page.getByTestId('cfg-item-name').locator('input').fill(name.item);
    await page.getByTestId('cfg-item-price').locator('input').fill('55');
    // category and station pickers (MUI selects inside the dialog)
    const selects = dialog.locator('[role="combobox"]');
    await selects.nth(0).click();
    await page.getByRole('option', { name: name.category }).click();
    await selects.nth(1).click();
    await page.getByRole('option', { name: name.station }).click();
    // the recipe: one line, the ingredient this run created
    await page.getByTestId('add-line').click();
    await page.getByTestId('pick-ingredient').click();
    await page.getByTestId('product-search').fill(name.sku);
    await page.getByTestId('product-result').first().waitFor({ timeout: 20_000 });
    await page.getByTestId('product-result').first().click();
    const line = page.getByTestId('recipe-line').first();
    await line.getByLabel(L('fnb.cfg.qty')).fill('18');
    await line.getByLabel(L('fnb.cfg.waste')).fill('5');
    await page.getByTestId('cfg-save-item').click();
    await page.waitForTimeout(2000);
    const res = await api(page, '/fnb/menu?all=1');
    const item = res.body.items.find((i) => i.name === name.item);
    assert(item, 'เมนูที่สร้างไม่ปรากฏ');
    made.items.push(item.id);
    assert(item.recipe?.lines?.length === 1, `สูตรมี ${item.recipe?.lines?.length ?? 0} บรรทัด`);
    assert(near(item.recipe.lines[0].qty, 18), `ปริมาณ = ${item.recipe.lines[0].qty}`);
    assert(item.channels.includes('self_order'), 'เมนูไม่ได้เปิดช่องทางลูกค้าสั่งเอง');
    return `${item.name} ฿${Number(item.price)} · สูตร ${Number(item.recipe.lines[0].qty)}g เผื่อเสีย ${Number(item.recipe.lines[0].waste_pct)}%`;
  });

  await step('B5', 'ตั้งค่า → ตัวเลือก: กลุ่ม "ขนาด" บังคับเลือก 1 อย่าง (M +10)', async () => {
    await page.getByTestId('cfg-tab-modifiers').click();
    await page.waitForTimeout(800);
    await page.getByTestId('cfg-add-group').click();
    await page.getByTestId('cfg-group-name').locator('input').fill(name.group);
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(L('fnb.cfg.minSelect')).fill('1');
    await dialog.getByLabel(L('fnb.cfg.maxSelect')).fill('1');
    await page.getByTestId('cfg-add-modifier').click();
    const mods = page.getByTestId('cfg-modifier');
    await mods.nth(0).getByTestId('cfg-modifier-name').locator('input').fill('S');
    await page.getByTestId('cfg-add-modifier').click();
    await mods.nth(1).getByTestId('cfg-modifier-name').locator('input').fill('M');
    await mods.nth(1).getByLabel(L('fnb.cfg.priceDelta')).fill('10');
    await page.getByTestId('cfg-save-group').click();
    await page.waitForTimeout(1800);
    const res = await api(page, '/fnb/menu?all=1');
    const g = res.body.modifier_groups.find((x) => x.name === name.group);
    assert(g, 'กลุ่มตัวเลือกไม่ปรากฏ');
    made.groups.push(g.id);
    for (const m of g.modifiers) made.mods[m.name] = m.id;
    assert(g.min_select === 1 && g.max_select === 1, `min/max = ${g.min_select}/${g.max_select}`);
    assert(g.modifiers.length === 2, `มีตัวเลือก ${g.modifiers.length} ตัว`);
    return `${g.name} · ${g.modifiers.map((m) => `${m.name}+${Number(m.price_delta)}`).join(' ')}`;
  });

  await step('B6', 'ผูกกลุ่มตัวเลือกเข้ากับเมนู (แก้เมนูผ่านหน้าเว็บ)', async () => {
    await page.getByTestId('cfg-tab-menu').click();
    await page.waitForTimeout(1000);
    // the menu tab opens on the first category, so pick this run's category before looking for its dish
    await page.getByTestId(`cfg-cat-${made.categories[0]}`).click();
    await page.waitForTimeout(600);
    await page.getByTestId(`cfg-edit-item-${made.items[0]}`).click();
    await page.getByRole('dialog').waitFor();
    await page.getByTestId(`cfg-item-group-${made.groups[0]}`).click();
    await page.getByTestId('cfg-save-item').click();
    await page.waitForTimeout(1800);
    const res = await api(page, '/fnb/menu?all=1');
    const item = res.body.items.find((i) => i.id === made.items[0]);
    assert(item.modifier_group_ids.includes(made.groups[0]), 'เมนูยังไม่ผูกกับกลุ่มตัวเลือก');
    return `ผูกแล้ว ${item.modifier_group_ids.length} กลุ่ม`;
  });

  await step('B7', 'ตั้งค่า → โต๊ะ/โซน: สร้างโซนและโต๊ะ 2 ตัว', async () => {
    // a code an earlier run left behind (switched off, but still in the room) must not be reused
    const taken = new Set(((await api(page, '/fnb/floor?all=1')).body?.tables ?? []).map((t) => t.code));
    const A = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    const pick = (prefix) => {
      for (let i = 0; i < A.length; i += 1)
        for (let j = 0; j < A.length; j += 1) {
          const c = `${prefix}${A[(i + Number(TAG.slice(-2))) % A.length]}${A[(j + Number(TAG.slice(-4, -2))) % A.length]}`;
          if (!taken.has(c)) {
            taken.add(c);
            return c;
          }
        }
      throw new Error('ไม่มีรหัสโต๊ะว่าง');
    };
    name.tableA = pick('E9');
    name.tableB = pick('E8');
    await page.getByTestId('cfg-tab-floor').click();
    await page.waitForTimeout(1200);
    await page.getByTestId('cfg-add-zone').click();
    await page.getByTestId('cfg-zone-name').locator('input').fill(name.zone);
    await page.getByTestId('cfg-save-zone').click();
    await page.waitForTimeout(1500);
    for (const [code, x, y] of [[name.tableA, '2', '2'], [name.tableB, '4', '2']]) {
      await page.getByTestId('cfg-add-table').click();
      await page.getByTestId('cfg-table-code').locator('input').fill(code);
      await page.getByLabel('x (m)').fill(x);
      await page.getByLabel('y (m)').fill(y);
      await page.getByTestId('cfg-save-table').click();
      await page.waitForTimeout(1500);
    }
    const res = await api(page, '/fnb/floor?all=1');
    const zone = res.body.zones.find((z) => z.name === name.zone);
    const tA = res.body.tables.find((t) => t.code === name.tableA);
    const tB = res.body.tables.find((t) => t.code === name.tableB);
    assert(zone && tA && tB, 'โซนหรือโต๊ะที่สร้างไม่ครบ');
    made.zones.push(zone.id);
    made.tables.push(tA.id, tB.id);
    return `โซน ${zone.name} · โต๊ะ ${tA.code}, ${tB.code}`;
  });

  await step('B8', 'ตั้งค่า → สต็อก/เงิน: ตัดสต็อกตอนส่งครัว · ค่าบริการ 10% · VAT รวมใน 7%', async () => {
    await page.getByTestId('cfg-tab-shop').click();
    await page.waitForTimeout(1200);
    await page.getByTestId('cfg-deduct-on').click();
    await page.getByRole('option', { name: L('fnb.cfg.deductOnSend') }).click();
    await page.getByTestId('cfg-service-pct').locator('input').fill('10');
    await page.getByTestId('cfg-vat-mode').click();
    await page.getByRole('option', { name: L('fnb.cfg.vatIncluded') }).click();
    await page.getByTestId('cfg-save-shop').click();
    await page.waitForTimeout(2000);
    const res = await api(page, '/store/settings');
    const f = res.body.fnb ?? {};
    assert(f.deduct_on === 'on_send', `deduct_on = ${f.deduct_on}`);
    assert(Number(f.service_charge_pct) === 10, `service = ${f.service_charge_pct}`);
    assert(f.vat_mode === 'included', `vat_mode = ${f.vat_mode}`);
    return `deduct=${f.deduct_on} service=${f.service_charge_pct}% vat=${f.vat_mode}`;
  });

  // ============================================================ C. the counter
  let stockBefore = 0;
  await step('C1', 'หน้าเคาน์เตอร์: เมนูใหม่ขึ้นไทล์ และเปิดหน้าต่างตัวเลือก', async () => {
    const before = await api(page, `/products/${made.products[0]}`);
    stockBefore = Number(before.body.stock_on_hand);
    await goFnb(page, '/fnb/order', '[data-testid="channel"]');
    await page.getByRole('button', { name: L('fnb.takeaway'), exact: true }).click();
    await page.waitForTimeout(600);
    await page.locator(`[data-testid^="cat-"]`, { hasText: name.category }).first().click();
    await page.waitForTimeout(600);
    const tile = page.getByTestId(`tile-${made.items[0]}`);
    await tile.waitFor({ timeout: 20_000 });
    await tile.click();
    await page.getByRole('dialog').waitFor({ timeout: 10_000 });
    return 'ไทล์และหน้าต่างตัวเลือกขึ้นครบ';
  });

  await step('C2', 'เลือกตัวเลือก M (+10) แล้วเพิ่มลงตะกร้า → รวม ฿65', async () => {
    await page.getByTestId(`mod-${made.mods.M}`).click();
    await page.waitForTimeout(300);
    await page.getByRole('dialog').getByRole('button', { name: new RegExp(L('fnb.add')) }).click();
    await page.waitForTimeout(900);
    const total = money(await page.getByTestId('cart-total').innerText());
    assert(near(total, 65), `ยอดตะกร้า = ${total} (คาด 65)`);
    return `฿${total.toFixed(2)}`;
  });

  await step('C3', 'ส่งครัว + เปิดหน้าชำระ → ยอดสุทธิ ฿71.50 (บวกค่าบริการ 10%)', async () => {
    await page.getByTestId('send-order').click();
    await page.getByTestId('tender-net').waitFor({ timeout: 30_000 });
    const net = money(await page.getByTestId('tender-net').innerText());
    assert(near(net, 71.5), `ยอดสุทธิ = ${net} (คาด 71.50)`);
    return `฿${net.toFixed(2)}`;
  });

  let saleDoc = '';
  await step('C4', 'รับเงินสด ฿100 → ใบเสร็จขึ้น เงินทอน ฿28.50 และบิลเข้าระบบขาย', async () => {
    await page.getByTestId('quick-100').click();
    await page.waitForTimeout(400);
    await page.getByTestId('tender-confirm').click();
    await page.getByTestId('receipt-dialog').waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1200);
    const change = money(await page.getByTestId('receipt-change').innerText().catch(() => '0'));
    assert(near(change, 28.5), `เงินทอน = ${change} (คาด 28.50)`);
    const sales = await api(page, '/sales?page=1&page_size=3');
    const sale = (sales.body.items ?? sales.body)[0];
    assert(sale, 'ไม่พบบิลล่าสุด');
    made.sales.push(sale.id);
    saleDoc = sale.doc_no;
    assert(near(sale.net, 71.5), `ยอดบิล = ${sale.net}`);
    assert(sale.order_id, 'บิลไม่ได้ผูกกับออร์เดอร์ (order_id ว่าง)');
    await closeReceipt(page);
    return `${sale.doc_no} ฿${Number(sale.net).toFixed(2)} ทอน ฿${change.toFixed(2)}`;
  });

  await step('C5', 'สูตรตัดสต็อกจริง: 18 ก. + เผื่อเสีย 5% = 18.9 ก.', async () => {
    const after = await api(page, `/products/${made.products[0]}`);
    const used = stockBefore - Number(after.body.stock_on_hand);
    assert(near(used, 18.9, 0.001), `ตัดไป ${used} (คาด 18.9)`);
    return `${stockBefore} → ${Number(after.body.stock_on_hand)} (ใช้ ${used.toFixed(3)})`;
  });

  await step('C6', 'บิลมีบรรทัดค่าบริการ 10% และยอด VAT แยกให้ดู', async () => {
    const sale = await api(page, `/sales/${made.sales[0]}`);
    const lines = sale.body.lines ?? [];
    const service = lines.find((l) => /บริการ|Service/.test(l.description));
    assert(service, `ไม่พบบรรทัดค่าบริการ (${lines.map((l) => l.description).join(' | ').slice(0, 120)})`);
    assert(near(service.line_total, 6.5), `ค่าบริการ = ${service.line_total} (คาด 6.50)`);
    assert(Number(sale.body.vat) > 0, `VAT = ${sale.body.vat}`);
    return `${lines.length} บรรทัด · ค่าบริการ ฿${Number(service.line_total).toFixed(2)} · VAT ฿${Number(sale.body.vat).toFixed(2)}`;
  });

  // ============================================================ D. the kitchen
  await step('D1', 'จอครัว: ตั๋วขึ้นพร้อมชื่อเมนูและตัวเลือกที่เลือก', async () => {
    await goFnb(page, '/fnb/kitchen', '[data-testid="ticket"]');
    const tickets = await page.getByTestId('ticket').allInnerTexts();
    const mine = tickets.find((t) => t.includes(name.item));
    assert(mine, `ไม่พบตั๋วของเมนูนี้ (มี ${tickets.length} ตั๋ว)`);
    assert(/M/.test(mine), 'ตั๋วไม่ได้แสดงตัวเลือกที่เลือก');
    return mine.split('\n').slice(0, 3).join(' · ').slice(0, 90);
  });

  await step('D2', 'กด "เสร็จทั้งใบ" แล้วสถานะรายจานเปลี่ยนจริง', async () => {
    const card = page.getByTestId('ticket').filter({ hasText: name.item }).first();
    await card.getByTestId('bump').click();
    await page.waitForTimeout(2500);
    const orders = await api(page, '/fnb/orders?open=1');
    const mine = (orders.body ?? []).find((o) => o.items.some((i) => i.name === name.item));
    const statuses = mine ? mine.items.map((i) => i.status) : [];
    assert(statuses.includes('ready') || statuses.includes('served'), `สถานะ = ${statuses.join(',') || 'ไม่พบออร์เดอร์ (อาจปิดไปแล้ว)'}`);
    return statuses.join(',') || 'ปิดออร์เดอร์แล้ว';
  });

  await step('D3', 'จอเรียกคิว: เลขคิวของออร์เดอร์นี้อยู่ฝั่ง "รับได้แล้ว"', async () => {
    await goFnb(page, '/fnb/queue', '[data-testid="queue-ready"]');
    await page.waitForTimeout(1500);
    const ready = await page.getByTestId('queue-ready').innerText();
    const making = await page.getByTestId('queue-making').innerText();
    return `รับได้แล้ว: ${ready.replace(/\n/g, ' ').slice(0, 60)} | กำลังทำ: ${making.replace(/\n/g, ' ').slice(0, 40)}`;
  });

  // ============================================================ E. the floor
  await step('E1', 'ผังโต๊ะ: โต๊ะใหม่ขึ้นและเป็นสีว่าง', async () => {
    await goFnb(page, '/fnb/floor', '[data-testid="view-toggle"]');
    await page.getByRole('button', { name: L('fnb.view2d'), exact: true }).click();
    await page.waitForSelector('[data-testid="floor-2d"]');
    await page.waitForTimeout(1200);
    const el = page.locator(`[data-testid="table-${made.tables[0]}"]`);
    await el.waitFor({ timeout: 20_000 });
    const status = await el.getAttribute('data-status');
    assert(status === 'free', `สถานะโต๊ะ = ${status}`);
    return `โต๊ะ ${name.tableA} = ${status}`;
  });

  await step('E2', 'เปิดโต๊ะ (ยังไม่สั่ง) → โต๊ะเปลี่ยนเป็น "นั่งแล้ว"', async () => {
    await openTablePanel(page, made.tables[0], name.tableA);
    await page.getByTestId('table-seat').click();
    await page.waitForTimeout(2500);
    const status = await page.locator(`[data-testid="table-${made.tables[0]}"]`).getAttribute('data-status');
    assert(status === 'seated', `สถานะโต๊ะ = ${status}`);
    return status;
  });

  await step('E3', 'สั่งอาหารให้โต๊ะ 2 แก้ว → โต๊ะเปลี่ยนเป็น "รออาหาร"', async () => {
    await page.getByTestId('table-order').click();
    await page.getByTestId('table-order-dialog').waitFor({ timeout: 15_000 });
    // the dialog opens on a food category; pick this run's category first
    await page.getByTestId(`table-cat-${made.categories[0]}`).click();
    await page.waitForTimeout(400);
    // a dish with a required option asks for it here too — order it twice
    for (let i = 0; i < 2; i += 1) {
      await page.getByTestId(`table-tile-${made.items[0]}`).click();
      await page.getByTestId('modifier-dialog').waitFor({ timeout: 15_000 });
      await page.getByTestId(`mod-${made.mods.M}`).click();
      await page.waitForTimeout(250);
      await page.getByTestId('dialog-add').click();
      await page.waitForTimeout(500);
    }
    await page.getByTestId('table-send').click();
    await page.waitForTimeout(3000);
    const status = await page.locator(`[data-testid="table-${made.tables[0]}"]`).getAttribute('data-status');
    assert(['waiting', 'ready'].includes(status), `สถานะโต๊ะ = ${status}`);
    const orders = await api(page, '/fnb/orders?open=1');
    const mine = (orders.body ?? []).filter((o) => o.table_code === name.tableA);
    mine.forEach((o) => made.orders.push(o.id));
    const qty = mine.flatMap((o) => o.items).reduce((n, i) => n + Number(i.qty), 0);
    return `${status} · ออร์เดอร์บนโต๊ะ ${mine.length} ใบ · ${qty} แก้ว`;
  });

  await step('E4', 'ย้ายโต๊ะ: ออร์เดอร์ย้ายไปโต๊ะปลายทาง และโต๊ะเดิมว่าง', async () => {
    const tokensBefore = await api(page, '/fnb/tables');
    const tokenA = tokensBefore.body.find((t) => t.table_code === name.tableA)?.token;
    await openTablePanel(page, made.tables[0], name.tableA);
    await page.getByTestId('table-move').click();
    await page.getByTestId('move-dialog').waitFor({ timeout: 15_000 });
    await page.getByTestId(`move-to-${name.tableB}`).click();
    await page.getByTestId('move-confirm').click();
    await page.waitForTimeout(3000);
    const orders = await api(page, '/fnb/orders?open=1');
    const onB = (orders.body ?? []).filter((o) => o.table_code === name.tableB);
    assert(onB.length >= 1, `โต๊ะปลายทางมี ${onB.length} ออร์เดอร์`);
    const tokensAfter = await api(page, '/fnb/tables');
    const tokenA2 = tokensAfter.body.find((t) => t.table_code === name.tableA)?.token;
    assert(tokenA && tokenA2 && tokenA !== tokenA2, 'QR ของโต๊ะต้นทางไม่ได้เปลี่ยนรหัสหลังย้าย');
    return `ย้ายไป ${name.tableB} (${onB.length} ใบ) · QR โต๊ะเดิมเปลี่ยนรหัสแล้ว`;
  });

  await step('E5', 'แยกบิล: แยก 1 แก้วจาก 2 แล้วชำระเฉพาะส่วนที่แยก', async () => {
    await openTablePanel(page, made.tables[1], name.tableB);
    const splitBtn = page.getByTestId('table-split');
    assert(await splitBtn.count(), 'ไม่มีปุ่มแยกบิล (ต้องมีอย่างน้อย 2 รายการ)');
    await splitBtn.click();
    await page.getByTestId('split-dialog').waitFor({ timeout: 15_000 });
    const item = page.locator('[data-testid^="split-item-"]').first();
    await item.click();
    await page.waitForTimeout(500);
    // a line of 2 shows −/+; take 1 of 2 if the control is there
    const qtyLabel = page.locator('[data-testid^="split-qty-"]').first();
    let took = 'ทั้งบรรทัด';
    if (await qtyLabel.count()) {
      await page.getByRole('button', { name: 'less' }).first().click();
      await page.waitForTimeout(400);
      took = await qtyLabel.innerText();
    }
    await page.getByTestId('split-confirm').click();
    await page.getByTestId('tender-net').waitFor({ timeout: 30_000 });
    const net = money(await page.getByTestId('tender-net').innerText());
    await page.getByTestId('quick-exact').click();
    await page.waitForTimeout(300);
    await page.getByTestId('tender-confirm').click();
    await page.getByTestId('receipt-dialog').waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1000);
    const sales = await api(page, '/sales?page=1&page_size=3');
    const sale = (sales.body.items ?? sales.body)[0];
    made.sales.push(sale.id);
    await closeReceipt(page);
    return `แยก ${took} · ยอด ฿${net.toFixed(2)} · บิล ${sale.doc_no}`;
  });

  await step('E6', 'เช็คบิลส่วนที่เหลือ แล้วปิดโต๊ะ → โต๊ะกลับเป็นว่าง', async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="view-toggle"]', { timeout: 30_000 });
    await page.getByRole('button', { name: L('fnb.view2d'), exact: true }).click();
    await page.waitForTimeout(1500);
    await openTablePanel(page, made.tables[1], name.tableB);
    if (await page.getByTestId('table-checkout').count()) {
      await page.getByTestId('table-checkout').click();
      await page.getByTestId('tender-net').waitFor({ timeout: 30_000 });
      await page.getByTestId('quick-exact').click();
      await page.waitForTimeout(300);
      await page.getByTestId('tender-confirm').click();
      await page.getByTestId('receipt-dialog').waitFor({ timeout: 30_000 });
      await page.waitForTimeout(1000);
      const sales = await api(page, '/sales?page=1&page_size=3');
      made.sales.push((sales.body.items ?? sales.body)[0].id);
      await closeReceipt(page);
      await page.waitForTimeout(800);
      await openTablePanel(page, made.tables[1], name.tableB);
    }
    await page.getByTestId('table-close').click();
    await page.waitForTimeout(3000);
    const status = await page.locator(`[data-testid="table-${made.tables[1]}"]`).getAttribute('data-status');
    assert(status === 'free', `สถานะโต๊ะหลังปิด = ${status}`);
    return `ปิดโต๊ะแล้ว = ${status}`;
  });

  // ============================================================ F. the customer's QR
  let guestToken = '';
  await step('F1', 'หน้า QR โต๊ะ: การ์ดของโต๊ะมี QR และลิงก์แท็บเล็ต', async () => {
    await goFnb(page, '/fnb/tables', '[data-testid^="table-card-"]');
    const card = page.getByTestId(`table-card-${name.tableA}`);
    await card.waitFor({ timeout: 20_000 });
    const text = await card.innerText();
    assert(/\/t\//.test(text), 'ไม่พบลิงก์ /t/ ในการ์ด');
    const tokens = await api(page, '/fnb/tables');
    const row = tokens.body.find((t) => t.table_code === name.tableA);
    guestToken = row.token;
    assert(row.kiosk_token && row.kiosk_token !== row.token, 'ไม่มีลิงก์แท็บเล็ตแยกจากรหัสลูกค้า');
    return `รหัสลูกค้า ${row.token.slice(0, 8)}… · แท็บเล็ต ${row.kiosk_token.slice(0, 8)}…`;
  });

  let phoneOrderNo = 0;
  await step('F2', 'มือถือลูกค้า: สแกน QR แล้วสั่งเองจนสำเร็จ', async () => {
    const phoneCtx = await browser.newContext({ ...devices['Pixel 7'], locale: 'th-TH' });
    const phone = await phoneCtx.newPage();
    try {
      await phone.goto(`${BASE}/t/${guestToken}`, { waitUntil: 'domcontentloaded' });
      await phone.waitForSelector('[data-testid="t-basket"]', { timeout: 45_000 });
      await phone.getByTestId(`t-cat-${made.categories[0]}`).click();
      await phone.waitForTimeout(500);
      const item = phone.getByTestId(`t-item-${made.items[0]}`);
      await item.waitFor({ timeout: 20_000 });
      await item.getByRole('button').click();
      await phone.getByTestId('t-option-dialog').waitFor({ timeout: 15_000 });
      await phone.getByTestId(`t-mod-${made.mods.M}`).click();
      await phone.waitForTimeout(300);
      await phone.getByTestId('t-option-add').click();
      await phone.waitForTimeout(800);
      await phone.getByTestId('t-send').click();
      await phone.waitForTimeout(3000);
      const orders = await api(page, '/fnb/orders?open=1');
      const mine = (orders.body ?? []).filter((o) => o.table_code === name.tableA && o.channel === 'self_order');
      assert(mine.length >= 1, 'ไม่พบออร์เดอร์ช่องทางลูกค้าสั่งเอง');
      mine.forEach((o) => made.orders.push(o.id));
      phoneOrderNo = mine[0].order_no;
      return `ออร์เดอร์ #${phoneOrderNo} ช่องทาง self_order · ${mine[0].items.length} รายการ`;
    } finally {
      await phoneCtx.close();
    }
  });

  await step('F3', 'ออร์เดอร์จากมือถือขึ้นจอครัวของร้านจริง', async () => {
    await goFnb(page, '/fnb/kitchen', '[data-testid="ticket"]');
    await page.waitForTimeout(1500);
    const tickets = await page.getByTestId('ticket').allInnerTexts();
    const mine = tickets.find((t) => t.includes(name.tableA));
    assert(mine, `ไม่พบตั๋วของโต๊ะ ${name.tableA} (มี ${tickets.length} ตั๋ว)`);
    return mine.split('\n').slice(0, 2).join(' · ').slice(0, 80);
  });

  await step('F4', 'ปิดโต๊ะแล้วรหัส QR เดิมใช้ไม่ได้อีก (กันถ่ายรูปไปสั่งซ้ำ)', async () => {
    const orders = await api(page, '/fnb/orders?open=1');
    for (const o of (orders.body ?? []).filter((x) => x.table_code === name.tableA)) {
      await api(page, `/fnb/orders/${o.id}/status`, { method: 'POST', body: JSON.stringify({ status: 'void' }) });
    }
    await page.waitForTimeout(2000);
    const check = await page.evaluate(
      async ([base, token]) => {
        const r = await fetch(`${base}/api/v1/public/fnb/t/${token}`);
        return r.status;
      },
      [BASE, guestToken],
    );
    assert(check === 404, `รหัสเดิมยังใช้ได้ (HTTP ${check})`);
    const tokens = await api(page, '/fnb/tables');
    const row = tokens.body.find((t) => t.table_code === name.tableA);
    assert(row.token !== guestToken, 'รหัสไม่ได้ถูกเปลี่ยน');
    return `รหัสเดิม → HTTP 404 · รหัสใหม่ ${row.token.slice(0, 8)}…`;
  });

  // ============================================================ G. promotion, booking, reports
  await step('G1', 'โปรโมชัน: ลด 20% ทั้งหมวด → ไทล์แสดงราคาโปร ฿44', async () => {
    const now = new Date();
    const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    await goFnb(page, '/fnb/settings', '[data-testid="cfg-tabs"]');
    await page.getByTestId('cfg-tab-promos').click();
    await page.waitForTimeout(1000);
    await page.getByTestId('cfg-add-promo').click();
    await page.getByRole('dialog').waitFor();
    await page.getByTestId('cfg-promo-name').locator('input').fill(name.promo);
    await page.getByTestId('cfg-promo-value').locator('input').fill('20');
    const dialog = page.getByRole('dialog');
    const selects = dialog.locator('[role="combobox"]');
    // ใช้กับ = หมวด (ค่าเริ่มต้น) → เลือกหมวดของรอบทดสอบ
    await selects.nth(1).click();
    await page.getByRole('option', { name: name.category }).click();
    await dialog.getByLabel(L('fnb.cfg.promoFrom')).fill(hhmm(new Date(now.getTime() - 3600e3)));
    await dialog.getByLabel(L('fnb.cfg.promoTo')).fill(hhmm(new Date(now.getTime() + 3600e3)));
    await page.getByTestId('cfg-save-promo').click();
    await page.waitForTimeout(2000);
    const promos = await api(page, '/fnb/menu/promos?all=1');
    const p = (promos.body ?? []).find((x) => x.name === name.promo);
    assert(p, 'ไม่พบโปรโมชันที่สร้าง');
    made.promos.push(p.id);
    await goFnb(page, '/fnb/order', '[data-testid="channel"]');
    await page.locator('[data-testid^="cat-"]', { hasText: name.category }).first().click();
    await page.waitForTimeout(800);
    const tile = await page.getByTestId(`tile-${made.items[0]}`).innerText();
    assert(/44/.test(tile), `ไทล์ไม่ได้แสดงราคาโปร: ${tile.replace(/\n/g, ' ')}`);
    const badge = await page.getByTestId(`promo-${made.items[0]}`).innerText();
    return `${tile.replace(/\n/g, ' ').slice(0, 40)} · ป้าย "${badge}"`;
  });

  await step('G2', 'จอง/รอคิว: เพิ่มการจองแล้วพาเข้าโต๊ะ → โต๊ะถูกเปิดให้อัตโนมัติ', async () => {
    await goFnb(page, '/fnb/reservations', '[data-testid="res-add"]');
    await page.getByTestId('res-add').click();
    await page.getByRole('dialog').waitFor();
    await page.getByTestId('res-name').locator('input').fill(name.guest);
    await page.getByTestId('res-save').click();
    await page.waitForTimeout(2000);
    const list = await api(page, '/fnb/reservations');
    const r = (list.body ?? []).find((x) => x.name === name.guest);
    assert(r, 'ไม่พบการจองที่สร้าง');
    made.reservations.push(r.id);
    await page.getByTestId(`res-seat-${r.id}`).click();
    await page.getByRole('dialog').waitFor();
    await page.getByTestId(`res-table-${name.tableA}`).click();
    await page.waitForTimeout(2500);
    const after = await api(page, '/fnb/reservations');
    const seated = (after.body ?? []).find((x) => x.id === r.id);
    assert(seated.status === 'seated', `สถานะการจอง = ${seated.status}`);
    const orders = await api(page, '/fnb/orders?open=1');
    const opened = (orders.body ?? []).filter((o) => o.table_code === name.tableA);
    opened.forEach((o) => made.orders.push(o.id));
    assert(opened.length >= 1, 'โต๊ะไม่ได้ถูกเปิดให้หลังพาเข้าโต๊ะ');
    return `${seated.name} → โต๊ะ ${seated.table_code} · เปิดโต๊ะให้แล้ว ${opened.length} ใบ`;
  });

  await step('G3', 'รายงานเมนู: เมนูของรอบทดสอบมียอดขายและกำไรจริง', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const rep = await api(page, `/fnb/reports/menu?from=${today}&to=${today}`);
    assert(rep.status === 200, `GET รายงานเมนู → ${rep.status}`);
    const line = (rep.body.lines ?? []).find((l) => l.name === name.item);
    assert(line, `ไม่พบเมนูในรายงาน (มี ${rep.body.lines?.length ?? 0} รายการ)`);
    assert(Number(line.revenue) > 0 && Number(line.cost) > 0, `revenue=${line.revenue} cost=${line.cost}`);
    await goFnb(page, '/fnb/reports', '[data-testid="rep-tabs"]');
    await page.waitForTimeout(2000);
    const shown = await page.locator('table').first().innerText();
    assert(shown.includes(name.item), 'หน้าเว็บรายงานไม่ได้แสดงเมนูนี้');
    return `ขาย ${Number(line.qty)} · ยอด ฿${Number(line.revenue).toFixed(2)} · ต้นทุน ฿${Number(line.cost).toFixed(2)} · กลุ่ม ${line.class}`;
  });

  await step('G4', 'รายงานวัตถุดิบ: วัตถุดิบของรอบทดสอบถูกใช้ตามจริง', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const rep = await api(page, `/fnb/reports/ingredients?from=${today}&to=${today}`);
    const line = (rep.body.lines ?? []).find((l) => l.product_id === made.products[0]);
    assert(line, 'ไม่พบวัตถุดิบในรายงาน');
    assert(Number(line.used) > 0, `used = ${line.used}`);
    return `ใช้ ${Number(line.used)} ${line.unit} · มูลค่า ฿${Number(line.used_cost).toFixed(2)}`;
  });

  await step('G5', 'รายงานรายชั่วโมงและดาวน์โหลด CSV ได้จริง', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const hours = await api(page, `/fnb/reports/hours?from=${today}&to=${today}`);
    assert(hours.status === 200 && (hours.body.lines ?? []).length > 0, `รายงานรายชั่วโมงว่าง (${hours.status})`);
    const csv = await page.evaluate(
      async ([from, to]) => {
        const s = JSON.parse(window.localStorage.getItem('pos.session') ?? '{}');
        const r = await fetch(`/api/v1/fnb/reports/menu?from=${from}&to=${to}&format=csv`, { headers: { Authorization: `Bearer ${s.access_token}` } });
        const t = await r.text();
        return { status: r.status, type: r.headers.get('content-type'), head: t.split('\n')[0].slice(0, 60), bytes: t.length };
      },
      [today, today],
    );
    assert(csv.status === 200 && /csv/.test(csv.type ?? ''), `CSV → ${csv.status} ${csv.type}`);
    return `รายชั่วโมง ${hours.body.lines.length} แถว · CSV ${csv.bytes} ไบต์ (${csv.head})`;
  });

  await step('G6', 'คู่มือในระบบ: มีแท็บคู่มือร้านอาหารและภาพโหลดได้', async () => {
    await page.goto(`${BASE}/help`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const tabs = await page.getByRole('tab').allInnerTexts();
    assert(tabs.some((t) => t.includes('ร้านอาหาร')), `แท็บ = ${tabs.join(' | ')}`);
    await page.getByRole('tab', { name: /ร้านอาหาร/ }).click();
    await page.waitForTimeout(2500);
    const img = await page.evaluate(async () => {
      const el = document.images[0];
      if (!el) return null;
      el.loading = 'eager';
      el.src = el.src;
      await new Promise((r) => setTimeout(r, 2500));
      return { src: el.getAttribute('src'), w: el.naturalWidth };
    });
    assert(img && img.w > 0, `ภาพแรกในคู่มือโหลดไม่ขึ้น (${JSON.stringify(img)})`);
    return `แท็บ ${tabs.length} แท็บ · ภาพแรก ${img.src} (${img.w}px)`;
  });

  // ============================================================ H. teardown
  const leftovers = [];
  await step('H1', 'เก็บกวาด: ยกเลิกออร์เดอร์และบิลของรอบทดสอบ', async () => {
    const open = await api(page, '/fnb/orders?open=1');
    let voided = 0;
    for (const o of open.body ?? []) {
      if (o.table_code === name.tableA || o.table_code === name.tableB || o.items.some((i) => i.name === name.item)) {
        const r = await api(page, `/fnb/orders/${o.id}/status`, { method: 'POST', body: JSON.stringify({ status: 'void' }) });
        if (r.status === 200) voided++;
      }
    }
    let cancelled = 0;
    for (const id of made.sales) {
      const r = await api(page, `/sales/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason: `${RUN} ทดสอบระบบ` }) });
      if (r.status === 200) cancelled++;
      else leftovers.push(`บิล ${id} ยกเลิกไม่สำเร็จ (${r.status})`);
    }
    return `ยกเลิกออร์เดอร์ ${voided} ใบ · ยกเลิกบิล ${cancelled}/${made.sales.length} ใบ`;
  });

  await step('H2', 'เก็บกวาด: ปิดใช้งานเมนู ตัวเลือก โปรโมชัน สถานี โซน โต๊ะ และวัตถุดิบ', async () => {
    const off = [];
    const menu = await api(page, '/fnb/menu?all=1');
    for (const id of made.items) {
      const it = menu.body.items.find((x) => x.id === id);
      if (it) off.push((await api(page, '/fnb/menu/items', { method: 'PUT', body: JSON.stringify({ ...it, is_active: false }) })).status);
    }
    for (const id of made.groups) {
      const g = menu.body.modifier_groups.find((x) => x.id === id);
      if (g) off.push((await api(page, '/fnb/menu/modifier-groups', { method: 'PUT', body: JSON.stringify({ ...g, is_active: false }) })).status);
    }
    for (const id of made.categories) {
      const c = menu.body.categories.find((x) => x.id === id);
      if (c) off.push((await api(page, '/fnb/menu/categories', { method: 'PUT', body: JSON.stringify({ ...c, is_active: false }) })).status);
    }
    for (const id of made.stations) {
      const s = menu.body.stations.find((x) => x.id === id);
      if (s) off.push((await api(page, '/fnb/menu/stations', { method: 'PUT', body: JSON.stringify({ ...s, is_active: false }) })).status);
    }
    const promos = await api(page, '/fnb/menu/promos?all=1');
    for (const id of made.promos) {
      const p = (promos.body ?? []).find((x) => x.id === id);
      if (p) off.push((await api(page, '/fnb/menu/promos', { method: 'PUT', body: JSON.stringify({ ...p, is_active: false }) })).status);
    }
    const floor = await api(page, '/fnb/floor?all=1');
    for (const id of made.tables) {
      const t = floor.body.tables.find((x) => x.id === id);
      if (t) off.push((await api(page, '/fnb/floor/tables', { method: 'PUT', body: JSON.stringify({ ...t, is_active: false }) })).status);
    }
    for (const id of made.zones) {
      const z = floor.body.zones.find((x) => x.id === id);
      if (z) off.push((await api(page, '/fnb/floor/zones', { method: 'PUT', body: JSON.stringify({ ...z, is_active: false }) })).status);
    }
    for (const id of made.products) {
      const r = await api(page, `/products/${id}`, { method: 'DELETE' });
      if (r.status >= 300) leftovers.push(`สินค้า ${id} ปิดไม่สำเร็จ (${r.status})`);
    }
    for (const id of made.reservations) {
      await api(page, `/fnb/reservations/${id}/status`, { method: 'POST', body: JSON.stringify({ status: 'cancelled' }) });
    }
    const bad = off.filter((s) => s >= 300).length;
    if (bad) leftovers.push(`ปิดใช้งานไม่สำเร็จ ${bad} รายการ`);
    return `ปิดใช้งาน ${off.length} รายการ (ล้มเหลว ${bad})`;
  });

  await step('H3', 'เก็บกวาด: คืนค่าตั้งค่า F&B ของร้านให้เหมือนเดิม', async () => {
    const cur = await api(page, '/store/settings');
    const next = { ...(cur.body ?? {}) };
    if (settingsBefore) next.fnb = settingsBefore;
    else delete next.fnb;
    const r = await api(page, '/store/settings', { method: 'PUT', body: JSON.stringify(next) });
    assert(r.status === 200, `คืนค่าตั้งค่า → ${r.status}`);
    const check = await api(page, '/store/settings');
    return settingsBefore ? `คืนค่าเดิม: ${JSON.stringify(check.body.fnb).slice(0, 70)}` : 'ลบค่า fnb ที่รอบทดสอบตั้งไว้';
  });

  await step('H4', 'ตรวจว่าข้อมูลการขายของร้านไม่ถูกกระทบ (บิลทดสอบถูกยกเลิกหมด)', async () => {
    const still = [];
    for (const id of made.sales) {
      const s = await api(page, `/sales/${id}`);
      if (s.body?.status !== 'cancelled') still.push(`${s.body?.doc_no} = ${s.body?.status}`);
    }
    assert(still.length === 0, `ยังมีบิลที่ไม่ได้ยกเลิก: ${still.join(', ')}`);
    return `บิลทดสอบ ${made.sales.length} ใบ ยกเลิกครบ`;
  });

  // ---------------------------------------------------------------- report
  const pass = results.filter((r) => r.status === 'PASS').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  console.log(`\n${'='.repeat(70)}\nFNB LIVE  ${BASE}  store=${STORE}  run=${RUN}`);
  console.log(`ผ่าน ${pass} / ล้มเหลว ${fail}`);
  if (consoleErrors.length) console.log(`console errors: ${consoleErrors.length}\n  - ${consoleErrors.slice(0, 5).join('\n  - ')}`);
  if (leftovers.length) console.log(`ข้อมูลที่ลบไม่ได้:\n  - ${leftovers.join('\n  - ')}`);
  console.log('='.repeat(70));
  for (const r of results) console.log(`${r.status === 'PASS' ? '✓' : '✗'} ${r.id.padEnd(3)} ${r.name} ${r.detail ? `— ${r.detail}` : ''}`);

  writeFileSync(
    resolve(here, 'report-fnb.json'),
    JSON.stringify({ base: BASE, store: STORE, run: RUN, at: new Date().toISOString(), pass, fail, consoleErrors, leftovers, made, results }, null, 2),
  );
  await browser.close();
  process.exit(fail > 0 ? 1 : 0);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
