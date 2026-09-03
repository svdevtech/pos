import { chromium, devices } from 'playwright';
import { readFileSync } from 'node:fs';
const BASE=process.env.BASE ?? 'https://t-pos.tdev2022.com';
const th=JSON.parse(readFileSync('i18n/messages/th.json','utf8'));
const L=(p)=>p.split('.').reduce((o,k)=>o?.[k],th);
const b=await chromium.launch();
// exactly what the failing run used
const ctx=await b.newContext({...devices['Pixel 7'], defaultBrowserType: undefined, locale:'th-TH'});
const p=await ctx.newPage();
p.on('console',(m)=>{if(m.type()==='error')console.log('PAGEERR:',m.text().slice(0,160));});
await p.goto(`${BASE}/login`,{waitUntil:'domcontentloaded'});
await p.getByLabel(L('auth.storeCode')).fill('BBR');
await p.getByLabel(L('auth.username')).fill('owner');
await p.getByLabel(L('auth.password')).first().fill('Owner12345');
await p.getByRole('button',{name:L('auth.signIn'),exact:true}).click();
await p.waitForURL(/\/(dashboard|pos)/,{timeout:45000});
console.log('after login:', new URL(p.url()).pathname);
await p.goto(`${BASE}/inventory/check`,{waitUntil:'domcontentloaded'});
await p.waitForTimeout(6000);
console.log('url:', new URL(p.url()).pathname);
console.log('check-scan count:', await p.getByTestId('check-scan').count());
console.log('body head:', (await p.locator('body').innerText()).slice(0,220).replace(/\n/g,' | '));
await p.screenshot({path:'C:/Users/User/AppData/Local/Temp/claude/D--workspace-pos/ee802bf6-41d6-47f5-a9a0-4c42c0ef4760/scratchpad/diag-phone.png'});

// member code length probe
const call = async (path, init) => p.evaluate(async ([pa,i])=>{
  const s=JSON.parse(localStorage.getItem('pos.session')??'{}');
  const r=await fetch('/api/v1'+pa,{...i,headers:{'Content-Type':'application/json',Authorization:'Bearer '+s.access_token,...(i?.headers??{})}});
  const t=await r.text(); return {status:r.status, body:t.slice(0,200)};
},[path,init??{}]);
for (const code of ['E2E-20260903123809','E2E-2026090312','E2E-TEST-1','E2E-TEST-1']) {
  console.log('member', code, JSON.stringify(await call('/members',{method:'POST',body:JSON.stringify({member_code:code,name:'ทดสอบ '+code})})).slice(0,220));
}
await b.close();
