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
const dump = async (path,label,extra) => {
  await p.goto(`${BASE}${path}`,{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(3500);
  if (extra) await extra();
  console.log(`\n### ${label} ${path}`);
  console.log('labels:', JSON.stringify(await p.evaluate(()=>Array.from(document.querySelectorAll('label')).map(l=>l.innerText.trim()).filter(Boolean).slice(0,20))));
  console.log('buttons:', JSON.stringify(await p.evaluate(()=>Array.from(document.querySelectorAll('button')).map(x=>x.innerText.trim()).filter(Boolean).slice(0,18))));
  console.log('headings:', JSON.stringify(await p.evaluate(()=>Array.from(document.querySelectorAll('h4,h5,h6')).map(x=>x.innerText.trim()).slice(0,6))));
};
await dump('/ar','ลูกหนี้');
// open first AR row
await dump('/ar','ลูกหนี้ (เปิดแถวแรก)', async ()=>{
  const row = p.getByRole('row').nth(1);
  await row.click().catch(()=>{});
  await p.waitForTimeout(2500);
});
await dump('/expenses','ค่าใช้จ่าย (กดเพิ่ม)', async ()=>{
  await p.getByRole('button',{name:L('expenses.addExpense')}).click();
  await p.waitForTimeout(1500);
});
await dump('/inventory/receipts/new','รับสินค้า (กรอกสินค้า)', async ()=>{
  const pick = p.getByLabel(L('inventory.addLine'));
  await pick.fill('มาม่า');
  await p.waitForTimeout(2500);
  const opts = await p.getByRole('option').count();
  console.log('options:', opts);
  if (opts) { await p.getByRole('option').first().click(); await p.waitForTimeout(1500); }
});
await b.close();
