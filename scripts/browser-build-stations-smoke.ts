import 'dotenv/config';
import {chromium,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {db} from '../server/db';

const origin=process.env.APP_ORIGIN??'http://127.0.0.1:5173';
if(process.env.NODE_ENV!=='development'||!['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname))throw new Error('Use the local development app for this check.');
const user=await db.user.findUniqueOrThrow({where:{email:process.env.SEED_EMAIL??''}});
const area=await db.area.findFirstOrThrow({where:{orgId:user.orgId,name:'Cabinet simulation'}});
await db.$disconnect();
mkdirSync('.local',{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1500,height:1100}});
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 const login=await page.request.post(origin+'/api/login',{headers:{Origin:origin},data:{email:process.env.SEED_EMAIL,password:process.env.SEED_PASSWORD}});
 if(!login.ok())throw new Error('Local login failed: HTTP '+login.status());
 // Browser fixture only: exercise known speed, idle, paused, and offline cases without changing database measurements.
 let phase='building',themeMode='dark';
 await page.route('**/api/dashboard?*',async route=>{
  const response=await route.fetch(),data=await response.json();
  if(new URL(route.request().url()).searchParams.has('workstation')){await route.fulfill({response,json:data});return;}
  const stations=data.stations.filter((s:any)=>s.areaId===area.id).sort((a:any,b:any)=>a.name.localeCompare(b.name,undefined,{numeric:true})).slice(0,3);
  stations.forEach((station:any,index:number)=>{
   const status=index===1?'paused':phase==='completed'?'completed':phase==='paused'?'paused':'building';
   const cabinet={id:station.id+':fixture',deviceId:'fixture-'+index,number:index+1,stationId:station.id,stationName:station.name,startedAt:new Date(Date.now()-270000).toISOString(),finishedAt:status==='completed'?new Date().toISOString():null,
    status,stale:phase==='offline'&&index===0,durationMs:270000,lastReportedAt:new Date().toISOString(),operatorName:station.people[0]?.name};
   station.status=phase==='offline'&&index===0?'offline':'online';
   station.cabinet={...station.cabinet,completed:index===2?0:24,averageBuildMs:index===2?0:index===0?270000:630000,desiredPaceMs:600000,cabinets:index===2?[]:[cabinet]};
  });
  for(const department of [...data.areas,...data.departments])if(department.id===area.id){department.themeMode=themeMode;department.cabinetPaceMs=600000;if(department.cabinet)department.cabinet={...department.cabinet,desiredPaceMs:600000,cabinets:stations.flatMap((s:any)=>s.cabinet.cabinets)};}
  await route.fulfill({response,json:data});
 });
 await page.goto(origin+'/?department='+area.id);
 const cards=page.locator('.build-station-card'),first=cards.nth(0),second=cards.nth(1),third=cards.nth(2);
 await expect(cards).toHaveCount(3);
 await expect(page.getByRole('heading',{name:'Build stations 3'})).toBeVisible();
 await expect(page.locator('.cabinet-heading .pace-status')).toHaveText('Within desired pace');
 await expect(first).toHaveClass(/building.*speed-good/);
 await expect(first.locator('.build-station-speed')).toContainText('4m 30s');
 await expect(first.locator('.build-station-desired')).toContainText('10m');
 await expect(first.locator('.build-station-footer strong')).toHaveText('24');
 await expect(second).toHaveClass(/paused.*speed-slow/);
 await expect(second.locator('.build-station-health')).toHaveText('Slower than desired pace');
 await expect(second.locator('.build-station-speed')).toContainText('10m 30s');
 await expect(third).toHaveClass(/ready.*speed-unknown/);
 await expect(third).toContainText('Ready for next cabinet');
 expect(await first.evaluate(element=>getComputedStyle(element).animationName)).toContain('station-green-flow');
 expect(await second.evaluate(element=>getComputedStyle(element).animationName)).toBe('none');
 await page.locator('.build-stations').screenshot({path:'.local/build-stations-dark.png'});
 phase='paused';await page.getByRole('button',{name:'Refresh',exact:true}).click();
 await expect(first).toHaveClass(/paused/);
 expect(await first.evaluate(element=>getComputedStyle(element).animationName)).toBe('none');
 phase='completed';await page.getByRole('button',{name:'Refresh',exact:true}).click();
 await expect(first.locator('.build-station-completion')).toBeVisible();
 await expect(cards).toHaveCount(3);
 await expect(first.locator('.build-station-completion')).toHaveCount(0,{timeout:4000});
 await expect(first).toHaveClass(/ready/);
 phase='offline';await page.getByRole('button',{name:'Refresh',exact:true}).click();
 await expect(first).toHaveClass(/offline/);
 await expect(first).toContainText('Device offline');
 expect(await first.evaluate(element=>getComputedStyle(element).animationName)).toBe('none');
 phase='building';themeMode='light';await page.getByRole('button',{name:'Refresh',exact:true}).click();
 await expect(page.locator('.department-view')).toHaveClass(/theme-light/);
 await page.locator('.build-stations').screenshot({path:'.local/build-stations-light.png'});
 await page.emulateMedia({reducedMotion:'reduce'});
 expect(await first.evaluate(element=>getComputedStyle(element).animationName)).toBe('none');
 await page.emulateMedia({reducedMotion:'no-preference'});
 await page.getByRole('button',{name:'Hide Build stations',exact:true}).click();
 await expect(page.locator('.build-stations')).toHaveCount(0);
 const menu=page.locator('.department-controls .view-customizer');await menu.locator('summary').click();
 await menu.getByRole('checkbox',{name:'Build stations',exact:true}).check();await menu.locator('summary').press('Escape');
 await expect(cards).toHaveCount(3);
 await page.setViewportSize({width:390,height:844});await page.locator('.build-stations').scrollIntoViewIfNeeded();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.locator('.build-stations').screenshot({path:'.local/build-stations-mobile.png'});
 expect(errors).toEqual([]);
 console.log('Build stations passed: average speed health, persistent idle stations, green build animation, paused/offline states, completion confirmation, reduced motion, light/dark themes, hide/restore, and mobile layout.');
}finally{await browser.close();}
