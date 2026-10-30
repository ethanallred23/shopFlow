import 'dotenv/config';
import {chromium,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {db} from '../server/db';

const origin=process.env.APP_ORIGIN??'http://127.0.0.1:5173';
if(process.env.NODE_ENV!=='development'||!['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname))throw new Error('Use the local development app.');
const user=await db.user.findUniqueOrThrow({where:{email:process.env.SEED_EMAIL??''}});
const area=await db.area.findFirstOrThrow({where:{orgId:user.orgId,name:'Cabinet simulation'}});
await db.$disconnect();mkdirSync('.local',{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors:string[]=[];
 page.on('pageerror',error=>errors.push(error.message));
 const login=await page.request.post(origin+'/api/login',{headers:{Origin:origin},data:{email:process.env.SEED_EMAIL,password:process.env.SEED_PASSWORD}});
 if(!login.ok())throw new Error('Local login failed: HTTP '+login.status());
 let phase='ready',cabinetNumber=2,startedAt=Date.now();
 await page.route('**/api/dashboard?*',async route=>{
  const response=await route.fetch(),data=await response.json();
  const stations=data.stations.filter((station:any)=>station.areaId===area.id).sort((a:any,b:any)=>a.name.localeCompare(b.name)).slice(0,2);
  stations.forEach((station:any,index:number)=>{
   const status=index===1?'building':phase==='ready'?'completed':phase;
   const id=station.id+':'+(index===1?'existing':phase==='ready'?'old':cabinetNumber);
   const started=index===1||phase==='ready'?Date.now()-120000:startedAt;
   const cabinet={id,deviceId:station.id,number:phase==='ready'?1:cabinetNumber,stationId:station.id,stationName:station.name,status,stale:false,durationMs:phase==='ready'?60000:0,startedAt:new Date(started).toISOString(),finishedAt:status==='completed'?new Date().toISOString():null,lastReportedAt:new Date().toISOString(),operatorName:'Demo builder'};
   station.status='online';station.cabinet={...station.cabinet,desiredPaceMs:600000,averageBuildMs:270000,completed:24,cabinets:[cabinet]};
  });
  data.stations=stations;
  for(const department of [...data.areas,...data.departments])if(department.id===area.id){department.themeMode='dark';if(department.cabinet)department.cabinet={...department.cabinet,desiredPaceMs:600000,cabinets:stations.flatMap((station:any)=>station.cabinet.cabinets)};}
  await route.fulfill({response,json:data});
 });
 await page.goto(origin+'/?department='+area.id);
 const first=page.locator('.build-station-card').first(),surface=first.locator('.build-station-surface');
 await expect(page.locator('.build-station-card')).toHaveCount(2);
 await expect(first).toHaveClass(/ready/);await expect(page.locator('.just-started')).toHaveCount(0);
 await expect.poll(()=>surface.evaluate(element=>Number(getComputedStyle(element).opacity))).toBe(0);
 await expect.poll(()=>page.locator('.build-station-card').nth(1).locator('.build-station-surface').evaluate(element=>Number(getComputedStyle(element).opacity))).toBe(1);
 const initialHeight=await first.evaluate(element=>element.getBoundingClientRect().height);
 // Record the actual fade frames, starting before the transition is triggered.
 // A plain browser script avoids transpiler helpers inside this recursive frame sampler.
 await page.evaluate(`(() => {
  const element=document.querySelector('.build-station-card');window.__startFade=[];
  const observer=new MutationObserver(()=>{
   if(!element.classList.contains('just-started'))return;observer.disconnect();
   const until=performance.now()+1400;
   const sample=()=>{window.__startFade.push(Number(getComputedStyle(element.querySelector('.build-station-surface')).opacity));if(performance.now()<until)requestAnimationFrame(sample);};sample();
  });observer.observe(element,{attributes:true,attributeFilter:['class']});
 })()`);
 phase='building';startedAt=Date.now();await page.getByRole('button',{name:'Refresh',exact:true}).click();
 await expect(first).toHaveClass(/just-started/);
 await expect(first.locator('.build-station-start-announcement')).toContainText('Cabinet #2 started');
 await expect(first.locator('.build-station-start-burst')).toBeVisible();
 expect(Math.abs(await first.evaluate(element=>element.getBoundingClientRect().height)-initialHeight)).toBeLessThan(2);
 await first.screenshot({path:'.local/station-start-animation.png'});
 await expect.poll(()=>surface.evaluate(element=>Number(getComputedStyle(element).opacity))).toBe(1);
 const samples=await page.evaluate(()=>(window as typeof window&{__startFade:number[]}).__startFade);
 expect(samples.some(value=>value>0&&value<1),JSON.stringify({samples:samples.slice(0,12),errors})).toBe(true);
 await expect(first).not.toHaveClass(/just-started/,{timeout:3500});
 await page.getByRole('button',{name:'Refresh',exact:true}).click();await expect(first).not.toHaveClass(/just-started/);
 phase='paused';await page.getByRole('button',{name:'Refresh',exact:true}).click();
 await expect.poll(()=>surface.evaluate(element=>Number(getComputedStyle(element).opacity))).toBe(0);
 phase='building';await page.getByRole('button',{name:'Refresh',exact:true}).click();
 await expect.poll(()=>surface.evaluate(element=>Number(getComputedStyle(element).opacity))).toBe(1);
 await expect(first).not.toHaveClass(/just-started/);
 phase='completed';await page.getByRole('button',{name:'Refresh',exact:true}).click();
 await expect(first.locator('.build-station-completion')).toBeVisible();
 cabinetNumber=3;phase='building';startedAt=Date.now();await page.getByRole('button',{name:'Refresh',exact:true}).click();
 await expect(first.locator('.build-station-start-announcement')).toContainText('Cabinet #3 started');
 await expect(first.locator('.build-station-completion')).toHaveCount(0);
 await page.emulateMedia({reducedMotion:'reduce'});
 cabinetNumber=4;startedAt=Date.now();await page.getByRole('button',{name:'Refresh',exact:true}).click();
 await expect(first.locator('.build-station-start-announcement')).toContainText('Cabinet #4 started');
 expect(await surface.evaluate(element=>getComputedStyle(element).animationName)).toBe('none');
 expect(await surface.evaluate(element=>getComputedStyle(element).transitionProperty)).toBe('none');
 await expect(first.locator('.build-station-start-burst')).toBeHidden();
 expect(errors).toEqual([]);
 console.log('Cabinet starts passed: pulse and timer reveal on new builds, measured gradient crossfade, no replay on load/snapshot/resume, rapid next-cabinet start, unchanged layout, and reduced motion.');
}finally{await browser.close();}
