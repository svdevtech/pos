import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const BASE=process.env.BASE ?? 'https://t-pos.tdev2022.com';
const th=JSON.parse(readFileSync('i18n/messages/th.json','utf8'));
const L=(p)=>p.split('.').reduce((o,k)=>o?.[k],th);
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:1440,height:950},locale:'th-TH'});
const p=await ctx.newPage();
await p.goto(`${BASE}/login`,{waitUntil:'domcontentloaded'});
await p.getByLabel(L('auth.storeCode')).fill('BBR');
await p.getByLabel(L('auth.username')).fill('owner');
await p.getByLabel(L('auth.password')).first().fill('Owner12345');
await p.getByRole('button',{name:L('auth.signIn'),exact:true}).click();
await p.waitForURL(/\/(dashboard|pos)/,{timeout:45000});

const dump = async (path, label) => {
  await p.goto(`${BASE}${path}`,{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(3500);
  const labels = await p.evaluate(() => Array.from(document.querySelectorAll('label')).map(l=>l.innerText.trim()).filter(Boolean).slice(0,25));
  const buttons = await p.evaluate(() => Array.from(document.querySelectorAll('button')).map(b=>b.innerText.trim()).filter(Boolean).slice(0,20));
  const h = await p.evaluate(() => Array.from(document.querySelectorAll('h1,h2,h4,h5,h6')).map(x=>x.innerText.trim()).slice(0,5));
  console.log(`\n### ${label} ${path}`);
  console.log('headings:', JSON.stringify(h,null,0));
  console.log('labels:', JSON.stringify(labels,null,0));
  console.log('buttons:', JSON.stringify(buttons,null,0));
};
await dump('/products/new','สร้างสินค้า');
await dump('/inventory/receipts/new','รับสินค้า');
await dump('/inventory/adjustments/new','ปรับปรุงสต็อก');
await dump('/expenses','ค่าใช้จ่าย');
await dump('/dashboard','แดชบอร์ด');

// A3: what changes when language switches
await p.getByTestId('lang-en').click(); await p.waitForTimeout(1500);
console.log('\nEN headings:', await p.evaluate(()=>Array.from(document.querySelectorAll('h1,h4,h5')).map(x=>x.innerText.trim()).slice(0,4)));
await p.getByTestId('lang-th').click(); await p.waitForTimeout(1500);
console.log('TH headings:', await p.evaluate(()=>Array.from(document.querySelectorAll('h1,h4,h5')).map(x=>x.innerText.trim()).slice(0,4)));

// I1 member create error + K2 csv route + M2 job list
const call = async (path, init) => p.evaluate(async ([pa,i])=>{
  const s=JSON.parse(localStorage.getItem('pos.session')??'{}');
  const r=await fetch('/api/v1'+pa,{...i,headers:{'Content-Type':'application/json',Authorization:'Bearer '+s.access_token,...(i?.headers??{})}});
  const t=await r.text(); return {status:r.status, body:t.slice(0,300)};
},[path,init??{}]);
console.log('\nmember create:', JSON.stringify(await call('/members',{method:'POST',body:JSON.stringify({member_code:'E2E-TEST-1',name:'ทดสอบ'})})));
console.log('csv variants:');
for (const u of ['/reports/daily-sales.csv?from=2026-09-01&to=2026-09-03','/reports/daily-sales?from=2026-09-01&to=2026-09-03&format=csv','/reports/sales-by-product.csv?from=2026-09-01&to=2026-09-03']) {
  const r = await call(u); console.log(' ', u, r.status, r.body.slice(0,60).replace(/\n/g,' '));
}
console.log('\njobs:', JSON.stringify(await call('/store/data/jobs')).slice(0,400));
console.log('backups:', JSON.stringify(await call('/store/data/backups')).slice(0,300));
await b.close();
