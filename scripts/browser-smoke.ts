import 'dotenv/config';
import {chromium,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1050}});
const failures:string[]=[];page.on('pageerror',e=>failures.push(e.message));
try{
 await page.goto('http://localhost:5173');
 await page.getByLabel('Email address').fill(process.env.SEED_EMAIL!);await page.getByLabel('Password',{exact:true}).fill(process.env.SEED_PASSWORD!);
 await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Production overview'})).toBeVisible();
 await expect(page.getByText('Workstation pulse')).toBeVisible();
 await page.screenshot({path:'.local/overview-desktop.png',fullPage:true});
 await page.getByRole('button',{name:'Devices',exact:true}).click();await page.getByRole('button',{name:'Register device',exact:true}).click();
 await page.getByLabel('Measurement mode').selectOption('production');
 const name='Smoke sensor '+Date.now();await page.getByLabel('Device name').fill(name);await page.getByRole('button',{name:'Save changes',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Save your device credential'})).toBeVisible();
 const codes=await page.locator('.dialog code').allTextContents();const [deviceId,token]=codes;
 await page.getByRole('button',{name:'I have saved the credential'}).click();
 const before=await page.evaluate(async()=>fetch('/api/dashboard').then(r=>r.json()));const station=before.stations[0];
 await page.getByRole('combobox',{name:'Assign '+name}).selectOption(station.id);
 await expect(page.getByText('Saving changes…')).not.toBeVisible();
 const bootId=randomUUID();const start=Date.now();
 for(const [sequence,detected] of [false,true,true].entries()){
  const event={schemaVersion:1,eventId:bootId+'-'+sequence,deviceId,bootId,sequence,uptimeMs:sequence*1000,type:'sensor.state_changed',occurredAt:new Date(start+sequence).toISOString(),data:{detected}};
  for(let retry=0;retry<2;retry++){const response=await fetch('http://localhost:3001/api/v1/events',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(event)});expect(response.status).toBe(200);}
 }
 await page.getByRole('button',{name:'Overview',exact:true}).click();
 await expect.poll(async()=>page.evaluate(async(id)=>{const d=await fetch('/api/dashboard').then(r=>r.json());return d.stations.find((s:any)=>s.id===id).count;},station.id)).toBe((station.count??0)+1);
 await page.getByRole('button',{name:'Reports',exact:true}).click();await expect(page.getByRole('heading',{name:'Shift output report'})).toBeVisible();
 await page.getByLabel('Report period').selectOption('day');await expect(page.getByRole('heading',{name:'Daily output report'})).toBeVisible();
 const dayReport=await page.evaluate(async()=>fetch('/api/dashboard?period=day').then(r=>r.json()));expect(dayReport.stations.length).toBeGreaterThan(0);expect(dayReport.stations[0].target).toBeGreaterThanOrEqual(station.target);
 const download=await page.request.get('http://localhost:5173/api/reports.csv');expect(download.status()).toBe(200);expect(await download.text()).toContain('Recorded output');
 await page.getByRole('button',{name:'Settings',exact:true}).click();await expect(page.getByRole('heading',{name:'People & permissions'})).toBeVisible();
 await page.getByRole('button',{name:'Floor display',exact:true}).click();await expect(page.getByText('Missing data is not zero production.')).toBeVisible();
 await page.screenshot({path:'.local/floor-desktop.png',fullPage:true});
 await page.reload();await expect(page.getByRole('heading',{name:'Production overview'})).toBeVisible();
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'.local/overview-mobile.png',fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.evaluate(async id=>{const me=await fetch('/api/me').then(r=>r.json());await fetch('/api/devices/'+id,{method:'PATCH',headers:{'Content-Type':'application/json','X-CSRF-Token':me.csrf},body:JSON.stringify({archived:true,disabled:true})});},deviceId);
 expect(failures).toEqual([]);
 console.log('Browser smoke passed: login, register, assign, ingestion/retries, live data, report CSV, settings, floor display, mobile layout.');
}finally{await browser.close();}
