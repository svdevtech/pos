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
for (const q of ['E2E-20260903131459-UNIT','E2E-20260903131459','E2E','เบียร์ทดสอบ','8850987101298','ไม่มีสินค้านี้แน่นอน']) {
  const r = await call(`/products?q=${encodeURIComponent(q)}&page_size=5&active=true`);
  const items = (r.body.items ?? []).map(x=>x.sku);
  console.log(`q=${q.padEnd(26)} total=${r.body.total} first5=${JSON.stringify(items)}`);
}
console.log('\n--- archived filter ---');
for (const q of ['E2E-20260903131459-UNIT']) {
  for (const extra of ['', '&archived=all']) {
    const r = await call(`/products?q=${encodeURIComponent(q)}&page_size=5${extra}`);
    console.log(`q=${q}${extra} total=${r.body.total} skus=${JSON.stringify((r.body.items??[]).map(x=>x.sku))}`);
  }
}
await b.close();
