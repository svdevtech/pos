import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const BASE='http://100.122.174.19:3010';
const th=JSON.parse(readFileSync('i18n/messages/th.json','utf8'));
const L=(p)=>p.split('.').reduce((o,k)=>o?.[k],th);
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:1280,height:900},locale:'th-TH'});
const p=await ctx.newPage();
await p.goto(`${BASE}/login`,{waitUntil:'domcontentloaded'});
await p.getByLabel(L('auth.storeCode')).fill('BBR');
await p.getByLabel(L('auth.username')).fill('owner');
await p.getByLabel(L('auth.password')).first().fill('Owner12345');
await p.getByRole('button',{name:L('auth.signIn'),exact:true}).click();
await p.waitForURL(/\/(dashboard|pos)/,{timeout:45000});
const call = async (path) => p.evaluate(async (pa)=>{
  const s=JSON.parse(localStorage.getItem('pos.session')??'{}');
  const r=await fetch('/api/v1'+pa,{headers:{Authorization:'Bearer '+s.access_token}});
  return {status:r.status, body: await r.json()};
}, path);
const docs = await call('/inventory/conversions?page=1&page_size=5');
for (const d of docs.body.items ?? []) {
  console.log(`${d.doc_no} ${d.from_name} [${d.from_unit}] ${d.from_qty} -> ${d.to_name} [${d.to_unit}] ${d.to_qty}  unit_cost=${d.unit_cost} total=${d.total_cost}`);
}
const rules = await call('/inventory/conversion-rules');
console.log('\nrules:');
for (const r of rules.body ?? []) console.log(` ${r.from_name} -> ${r.to_name} x${r.factor} active=${r.is_active}`);
const prods = await call('/products?q=E2E&page_size=20&archived=all');
console.log('\nE2E products:');
for (const x of prods.body.items ?? []) console.log(` ${x.sku} | ${x.name} | stock=${x.stock_on_hand} | archived=${x.is_archived}`);
await b.close();
