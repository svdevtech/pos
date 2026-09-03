import { chromium, devices } from 'playwright';
import { readFileSync } from 'node:fs';
const BASE=process.env.BASE ?? 'https://t-pos.tdev2022.com';
const SP='C:/Users/User/AppData/Local/Temp/claude/D--workspace-pos/ee802bf6-41d6-47f5-a9a0-4c42c0ef4760/scratchpad';
const th=JSON.parse(readFileSync('i18n/messages/th.json','utf8'));
const L=(p)=>p.split('.').reduce((o,k)=>o?.[k],th);
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:1400,height:1000},locale:'th-TH'});
const p=await ctx.newPage();
p.on('console',(m)=>{if(m.type()==='error')console.log('PAGEERR:',m.text().slice(0,160));});
await p.goto(`${BASE}/login`,{waitUntil:'domcontentloaded'});
await p.getByLabel(L('auth.storeCode')).fill('BBR');
await p.getByLabel(L('auth.username')).fill('owner');
await p.getByLabel(L('auth.password')).first().fill('Owner12345');
await p.getByRole('button',{name:L('auth.signIn'),exact:true}).click();
await p.waitForURL(/\/(dashboard|pos)/,{timeout:45000});

await p.goto(`${BASE}/ai`,{waitUntil:'domcontentloaded'});
await p.getByTestId('ai-question').waitFor({timeout:30000});
console.log('disabled banner:', await p.getByTestId('ai-disabled').count());
// use one of the suggested chips
await p.getByRole('button',{name:'ยอดขายเดือนนี้เท่าไร'}).click().catch(async()=>{ await p.getByText('ยอดขายเดือนนี้เท่าไร').first().click(); });
await p.waitForTimeout(500);
await p.getByTestId('ai-ask').click();
await p.getByTestId('ai-answer').waitFor({timeout:90000});
const answer = await p.getByTestId('ai-answer').innerText();
console.log('answer text:', answer.replace(/\n+/g,' | ').slice(0,300));
await p.screenshot({path:`${SP}/ai-desktop.png`, fullPage:false});
// history should now list the question
await p.waitForTimeout(1500);
console.log('history rows:', await p.locator('text=ยอดขายเดือนนี้เท่าไร').count());

// phone view
const {defaultBrowserType:_d, ...pixel}=devices['Pixel 7'];
const mob=await b.newContext({...pixel, locale:'th-TH'});
const m=await mob.newPage();
await m.goto(`${BASE}/login`,{waitUntil:'domcontentloaded'});
await m.getByLabel(L('auth.storeCode')).fill('BBR');
await m.getByLabel(L('auth.username')).fill('owner');
await m.getByLabel(L('auth.password')).first().fill('Owner12345');
await m.getByRole('button',{name:L('auth.signIn'),exact:true}).click();
await m.waitForURL(/\/(dashboard|pos)/,{timeout:45000});
await m.goto(`${BASE}/ai`,{waitUntil:'domcontentloaded'});
await m.getByTestId('ai-question').waitFor({timeout:30000});
await m.getByTestId('ai-question').fill('สินค้าขายดี 5 อันดับเดือนนี้');
await m.getByTestId('ai-ask').click();
await m.getByTestId('ai-answer').waitFor({timeout:90000});
console.log('phone answer:', (await m.getByTestId('ai-answer').innerText()).replace(/\n+/g,' | ').slice(0,220));
console.log('h-scroll on phone:', await m.evaluate(()=>document.documentElement.scrollWidth > window.innerWidth + 2));
await m.screenshot({path:`${SP}/ai-phone.png`});
await b.close();
