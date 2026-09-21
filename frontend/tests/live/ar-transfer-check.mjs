/**
 * Checks that a receivable paid by bank transfer shows up where the shop reconciles its bank
 * account: the dashboard's transfer tile, the daily report's repayment and bank columns, and the
 * shift that took it. Drives the real screens; only the before/after readings use the API.
 *
 *   BASE=http://localhost:3010 STORE=BBR MEMBER=130 node tests/live/ar-transfer-check.mjs
 *
 * It takes a real ฿AMOUNT payment against MEMBER's tab, so point it at a dev or demo store.
 */
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE ?? 'http://localhost:3010';
const STORE = process.env.STORE ?? 'BBR';
const USER = process.env.E2E_USER ?? 'owner';
const PASS = process.env.E2E_PASS ?? 'Owner12345';
const MEMBER = process.env.MEMBER ?? '130';
const AMOUNT = Number(process.env.AMOUNT ?? 50);
const SHOTS = resolve(here, 'shots-ar');
mkdirSync(SHOTS, { recursive: true });
const th = JSON.parse(readFileSync(resolve(here, '../../i18n/messages/th.json'), 'utf8'));
const L = (p) => p.split('.').reduce((o, k) => o?.[k], th);
const money = (text) => Number(String(text).replace(/[^\d.-]/g, ''));
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} — ${detail}`);
};

const b = await chromium.launch();
const page = await (await b.newContext({ viewport: { width: 1500, height: 980 }, locale: 'th-TH' })).newPage();
const api = (path, init) =>
  page.evaluate(
    async ([p, i]) => {
      const s = JSON.parse(window.localStorage.getItem('pos.session') ?? '{}');
      const r = await fetch(`/api/v1${p}`, { ...i, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.access_token}` } });
      const t = await r.text();
      return { status: r.status, body: t ? JSON.parse(t) : null };
    },
    [path, init ?? {}],
  );

// sign in
await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
await page.getByLabel(L('auth.storeCode')).fill(STORE);
await page.getByLabel(L('auth.username')).fill(USER);
await page.getByLabel(L('auth.password')).first().fill(PASS);
await page.getByRole('button', { name: L('auth.signIn'), exact: true }).click();
await page.waitForURL(/\/(dashboard|pos)/, { timeout: 60000, waitUntil: 'domcontentloaded' });

// a shift of this user's, so there is one for the payment to belong to
let shift = (await api('/shifts/current')).body?.shift;
if (!shift) shift = (await api('/shifts/open', { method: 'POST', body: JSON.stringify({ terminal: 'POS1', opening_float: '500' }) })).body;

const before = (await api('/reports/dashboard')).body.today;
const beforeTile = dec(before.transfer) + dec(before.ar?.transfer);
function dec(v) {
  return Number(v ?? 0) || 0;
}

// take the payment on the receivables screen, the way the shop does
await page.goto(`${BASE}/ar`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
await page.getByLabel(L('ar.search')).fill(MEMBER);
await page.waitForTimeout(2500);
await page.getByRole('row').filter({ hasText: MEMBER }).first().click();
await page.waitForTimeout(2500);
// the member-level button, which spreads the payment over the oldest bills; a per-bill button
// would refuse anything above that one bill's balance
await page.getByRole('button', { name: L('ar.receivePayment'), exact: true }).first().click();
const dialog = page.getByRole('dialog');
await dialog.waitFor({ timeout: 15000 });
await dialog.getByLabel(L('ar.payAmount')).fill(String(AMOUNT));
await dialog.getByLabel(L('ar.method')).click();
await page.getByRole('option', { name: L('ar.methods.transfer'), exact: true }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: resolve(SHOTS, '1-pay-dialog.png') });
await dialog.getByRole('button', { name: L('ar.receivePayment'), exact: true }).click();
await page.waitForTimeout(3000);

// 1. the dashboard's transfer tile
await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4500);
await page.screenshot({ path: resolve(SHOTS, '2-dashboard.png') });
const tile = page.locator('div', { hasText: L('dashboard.todayTransfer') }).filter({ has: page.locator('h5') }).last();
const tileText = await tile.innerText();
const shown = money(tileText.split('\n').find((l) => /฿/.test(l)) ?? '0');
check('ช่องเงินโอนวันนี้บนแดชบอร์ดเพิ่มขึ้นเท่ายอดที่รับ', Math.abs(shown - (beforeTile + AMOUNT)) < 0.005, `ก่อน ฿${beforeTile.toFixed(2)} → หลัง ฿${shown.toFixed(2)} (รับ ฿${AMOUNT})`);
check('ช่องเงินโอนบอกว่ามีเงินชำระหนี้รวมอยู่', tileText.includes('รวมรับชำระหนี้'), tileText.replace(/\n/g, ' · '));
const after = (await api('/reports/dashboard')).body.today;
check('ยอดขายสุทธิวันนี้ไม่เปลี่ยน (ไม่นับซ้ำ)', dec(after.net) === dec(before.net), `ก่อน ฿${dec(before.net)} · หลัง ฿${dec(after.net)}`);

// 2. the daily report
await page.goto(`${BASE}/reports?tab=daily-sales`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4500);
await page.screenshot({ path: resolve(SHOTS, '3-daily-report.png'), fullPage: true });
const heads = await page.getByRole('columnheader').allInnerTexts();
const need = [L('reports.cols.arTransfer'), L('reports.cols.transferIn')];
check('รายงานรายวันมีคอลัมน์ชำระหนี้เงินโอนและเงินโอนเข้าบัญชีรวม', need.every((n) => heads.includes(n)), need.join(' · '));
const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const report = (await api(`/reports/daily-sales?from=${today}&to=${today}`)).body;
const row = (report.rows ?? []).find((r) => r.date === today);
check('แถววันนี้ในรายงานมียอดชำระหนี้เงินโอน', row && dec(row.ar?.transfer) >= AMOUNT, `ar.transfer = ${row?.ar?.transfer}`);

// 3. the shift
await page.goto(`${BASE}/pos/shift`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4500);
await page.screenshot({ path: resolve(SHOTS, '4-shift.png'), fullPage: true });
const repaid = page.getByTestId('repaid-transfer');
const repaidText = (await repaid.count()) ? await repaid.innerText() : '';
check('หน้ากะแสดงรับชำระหนี้เงินโอนของกะนี้', dec(money(repaidText)) >= AMOUNT, repaidText.replace(/\n/g, ' ') || 'ไม่พบ');

// 4. left alone, the date field is not sent: the server stamps the payment to the second
const mine = (await api(`/ar/payments?from=${today}&to=${today}&page=1&page_size=100`)).body;
const latest = (mine?.items ?? mine ?? []).sort((x, y) => String(y.paid_at).localeCompare(String(x.paid_at)))[0];
const secs = latest ? new Date(latest.paid_at).getUTCSeconds() + (new Date(latest.paid_at).getUTCMilliseconds() > 0 ? 0.5 : 0) : 0;
check('เวลารับชำระมาจากนาฬิกาเซิร์ฟเวอร์ (มีวินาที ไม่ถูกปัดเป็นนาที)', Boolean(latest) && secs !== 0, `paid_at = ${latest?.paid_at}`);

await b.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} ผ่าน / ${failed} ล้มเหลว`);
process.exit(failed ? 1 : 0);
