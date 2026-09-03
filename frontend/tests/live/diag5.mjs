import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const BASE=process.env.BASE ?? 'https://t-pos.tdev2022.com';
const th=JSON.parse(readFileSync('i18n/messages/th.json','utf8'));
const L=(p)=>p.split('.').reduce((o,k)=>o?.[k],th);
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:1280,height:900},locale:'th-TH'});
const p=await ctx.newPage();
p.on('console',(m)=>{ if(m.type()==='error') console.log('CONSOLE:', m.text().slice(0,300)); });
p.on('pageerror',(e)=>console.log('PAGEERROR:', String(e).slice(0,300)));
await p.goto(`${BASE}/login`,{waitUntil:'domcontentloaded'});
await p.getByLabel(L('auth.storeCode')).fill('BBR');
await p.getByLabel(L('auth.username')).fill('owner');
await p.getByLabel(L('auth.password')).first().fill('Owner12345');
await p.getByRole('button',{name:L('auth.signIn'),exact:true}).click();
await p.waitForURL(/\/(dashboard|pos)/,{timeout:45000});
for (const path of ['/dashboard','/settings/units','/ai','/reports']) {
  await p.goto(`${BASE}${path}`,{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(4000);
  const txt=(await p.locator('body').innerText()).replace(/\n+/g,' | ').slice(0,200);
  console.log(`\n${path} ->`, txt);
}
await b.close();
