/**
 * Removes what the full-system run left behind on a test deployment: E2E sales are cancelled,
 * E2E expenses deleted, E2E members deactivated, E2E units switched off, E2E products archived.
 *   BASE=... node tests/live/cleanup.mjs
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const BASE=process.env.BASE ?? 'https://t-pos.tdev2022.com';
const th=JSON.parse(readFileSync('i18n/messages/th.json','utf8'));
const L=(p)=>p.split('.').reduce((o,k)=>o?.[k],th);
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:1280,height:900},locale:'th-TH'});
const p=await ctx.newPage();
await p.goto(`${BASE}/login`,{waitUntil:'domcontentloaded'});
await p.getByLabel(L('auth.storeCode')).fill('BBR');
await p.getByLabel(L('auth.username')).fill('owner');
await p.getByLabel(L('auth.password')).first().fill(process.env.E2E_PASS ?? 'Owner12345');
await p.getByRole('button',{name:L('auth.signIn'),exact:true}).click();
await p.waitForURL(/\/(dashboard|pos)/,{timeout:45000});
const call = (path, init) => p.evaluate(async ([pa,i])=>{
  const s=JSON.parse(localStorage.getItem('pos.session')??'{}');
  const r=await fetch('/api/v1'+pa,{...i,headers:{'Content-Type':'application/json',Authorization:'Bearer '+s.access_token,...(i?.headers??{})}});
  const t=await r.text(); return {status:r.status, body: t?JSON.parse(t):null};
},[path,init??{}]);

const today=new Date().toISOString().slice(0,10);
// 1. cancel sales made by the runs (today, with a member whose code starts with E2E, or cash test bills)
const sales = await call(`/sales?from=${today}&to=${today}&page_size=100`);
let cancelled=0;
for (const s of sales.body?.items ?? []) {
  if (s.status !== 'completed') continue;
  const isTest = String(s.member_code ?? '').startsWith('E2E') || Number(s.net) === 660;
  if (!isTest) continue;
  const r = await call(`/sales/${s.id}/cancel`, {method:'POST', body: JSON.stringify({reason:'ยกเลิกข้อมูลทดสอบ E2E'})});
  if (r.status < 300) cancelled++;
}
console.log('sales cancelled:', cancelled);

// 2. expenses of exactly 55 today (the runner's amount)
const exp = await call(`/expenses?from=${today}&to=${today}&page_size=100`);
let expDeleted=0;
for (const e of exp.body?.items ?? []) {
  if (Number(e.amount) !== 55) continue;
  const r = await call(`/expenses/${e.id}`, {method:'DELETE'});
  if (r.status < 300) expDeleted++;
}
console.log('expenses deleted:', expDeleted);

// 3. members created by the runs
const mem = await call('/members?q=E2E&page_size=100');
let memOff=0;
for (const m of mem.body?.items ?? []) {
  if (!String(m.member_code).startsWith('E2E')) continue;
  const r = await call(`/members/${m.id}/status`, {method:'POST', body: JSON.stringify({status:'inactive'})});
  if (r.status < 300) memOff++;
}
console.log('members deactivated:', memOff);

// 3b. settle receivables the runs left open (a partly paid credit bill cannot be cancelled)
const ar = await call('/ar/accounts?q=E2E&page_size=50');
let settled=0;
for (const a of ar.body?.items ?? []) {
  if (Number(a.balance) <= 0) continue;
  const bills = await call(`/ar/members/${a.member_id}/bills`);
  for (const bill of bills.body?.items ?? bills.body?.bills ?? []) {
    if (Number(bill.ar_balance ?? 0) <= 0) continue;
    const r = await call('/ar/payments', {method:'POST', body: JSON.stringify({member_id:a.member_id, sale_id:bill.id, amount:String(bill.ar_balance), method:'cash', note:'ปิดยอดข้อมูลทดสอบ E2E'})});
    if (r.status < 300) settled++;
  }
}
console.log('receivables settled:', settled);

// 4. units and products
const units = await call('/units');
let unitOff=0;
for (const u of units.body ?? []) {
  if (!u.name.startsWith('E2E') || !u.is_active) continue;
  const r = await call(`/units/${u.id}`, {method:'PATCH', body: JSON.stringify({is_active:false})});
  if (r.status < 300) unitOff++;
}
console.log('units switched off:', unitOff);

const prods = await call('/products?q=E2E&page_size=100');
let arch=0;
for (const x of prods.body?.items ?? []) {
  if (!x.sku.startsWith('E2E') || x.is_archived) continue;
  const r = await call(`/products/${x.id}`, {method:'DELETE'});
  if (r.status < 300) arch++;
}
console.log('products archived:', arch);

// 5. conversion rules pointing at E2E products
const rules = await call('/inventory/conversion-rules');
let ruleOff=0;
for (const r of rules.body ?? []) {
  if (!(String(r.from_name).includes('E2E') || String(r.to_name).includes('E2E')) || !r.is_active) continue;
  const res = await call(`/inventory/conversion-rules/${r.id}`, {method:'PATCH', body: JSON.stringify({is_active:false})});
  if (res.status < 300) ruleOff++;
}
console.log('conversion rules switched off:', ruleOff);
await b.close();
