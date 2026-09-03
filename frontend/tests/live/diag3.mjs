import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const BASE=process.env.BASE ?? 'https://t-pos.tdev2022.com';
const th=JSON.parse(readFileSync('i18n/messages/th.json','utf8'));
const L=(p)=>p.split('.').reduce((o,k)=>o?.[k],th);
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:1280,height:900},locale:'th-TH'});
const p=await ctx.newPage();
const bad=[];
p.on('response',(r)=>{ if(r.status()>=400) bad.push(`${r.status()} ${r.url().replace(BASE,'')}`); });
await p.goto(`${BASE}/login`,{waitUntil:'domcontentloaded'});
await p.getByLabel(L('auth.storeCode')).fill('BBR');
await p.getByLabel(L('auth.username')).fill('owner');
await p.getByLabel(L('auth.password')).first().fill('Owner12345');
await p.getByRole('button',{name:L('auth.signIn'),exact:true}).click();
await p.waitForURL(/\/(dashboard|pos)/,{timeout:45000});
for (const path of ['/dashboard','/pos','/products','/inventory','/inventory/check','/inventory/conversions','/members','/ar','/expenses','/reports','/dividends','/settings','/settings/units','/settings/data','/help','/suppliers','/promotions','/ai']) {
  bad.length = 0;
  await p.goto(`${BASE}${path}`,{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(3000);
  const errs = await p.evaluate(()=>window.__errs ?? []);
  console.log(path.padEnd(24), bad.length ? bad.slice(0,3).join(' , ') : 'ok');
}
const call = async (path, init) => p.evaluate(async ([pa,i])=>{
  const s=JSON.parse(localStorage.getItem('pos.session')??'{}');
  const r=await fetch('/api/v1'+pa,{...i,headers:{'Content-Type':'application/json',Authorization:'Bearer '+s.access_token,...(i?.headers??{})}});
  const t=await r.text(); return {status:r.status, body:t.slice(0,220)};
},[path,init??{}]);
console.log('\nmember with share_capital:', JSON.stringify(await call('/members',{method:'POST',body:JSON.stringify({member_code:'E2E-SHARE-'+Date.now(),name:'ทดสอบหุ้น',share_capital:'0'})})));
console.log('member without:', JSON.stringify(await call('/members',{method:'POST',body:JSON.stringify({member_code:'E2E-NOSHARE-'+Date.now(),name:'ทดสอบ'})})));
await b.close();
