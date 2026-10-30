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
 const page=await browser.newPage({viewport:{width:1366,height:768}}),errors:string[]=[];
 page.on('pageerror',error=>errors.push(error.message));
 const login=await page.request.post(origin+'/api/login',{headers:{Origin:origin},data:{email:process.env.SEED_EMAIL,password:process.env.SEED_PASSWORD}});
 if(!login.ok())throw new Error('Local login failed: HTTP '+login.status());
 let count=2;
 await page.route('**/api/dashboard?*',async route=>{
  const response=await route.fetch(),data=await response.json();
  const samples=data.stations.filter((station:any)=>station.areaId===area.id);
  const stations=Array.from({length:count},(_,index)=>{
   const original=structuredClone(samples[index%samples.length]);
   const id=original.id+'-layout-'+index;
   const cabinet={id:id+':cabinet',deviceId:'fixture-'+index,number:index+1,stationId:id,stationName:'Biltoki cabinet timer - Example '+(index+1),status:index===1?'paused':'building',stale:false,durationMs:270000,lastReportedAt:new Date().toISOString(),startedAt:new Date(Date.now()-270000).toISOString(),finishedAt:null,operatorName:'Builder '+(index+1)};
   return {...original,id,name:cabinet.stationName,status:'online',people:[{id:'builder-'+index,name:cabinet.operatorName}],cabinet:{...original.cabinet,completed:24,averageBuildMs:index===1?630000:270000,desiredPaceMs:600000,cabinets:[cabinet]}};
  });
  data.stations=stations;
  for(const department of [...data.areas,...data.departments])if(department.id===area.id){department.themeMode='dark';department.stationCount=count;if(department.cabinet)department.cabinet={...department.cabinet,desiredPaceMs:600000,cabinets:stations.flatMap(station=>station.cabinet.cabinets)};}
  await route.fulfill({response,json:data});
 });
 await page.goto(origin+'/?department='+area.id);
 const overview=page.locator('[data-primary-overview]'),menu=page.locator('.department-controls>.view-customizer');
 const openMenu=async()=>{if(!await menu.evaluate(element=>(element as HTMLDetailsElement).open))await menu.locator('summary').click();};
 const closeMenu=async()=>{await menu.locator('summary').press('Escape');};
 const bounds=()=>overview.evaluate(element=>{
  const rect=element.getBoundingClientRect();return {bottom:Math.round(rect.bottom),top:Math.round(rect.top),height:Math.round(rect.height),viewport:innerHeight};
 });
 const fits=async(label:string)=>{
  await page.evaluate(()=>{window.scrollTo(0,0);document.fullscreenElement?.scrollTo(0,0);});
  console.log(label+' sections',await overview.evaluate(element=>[...element.children].map(child=>({name:child.className,height:Math.round(child.getBoundingClientRect().height),width:Math.round(child.getBoundingClientRect().width),columns:child.querySelector('.cabinet-metrics')?getComputedStyle(child.querySelector('.cabinet-metrics')!).gridTemplateColumns:undefined}))));
  if((await bounds()).bottom>768)await page.screenshot({path:'.local/department-fit-measure.png'});
  await expect.poll(async()=>{const rect=await bounds();return rect.bottom<=rect.viewport-6&&rect.top>=0;},{message:label+' '+JSON.stringify(await bounds())}).toBe(true);
  await expect(overview.locator('[data-metric]')).toHaveCount(6);
  await expect(overview.locator('.build-station-card')).toHaveCount(count);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  console.log(label,await bounds());
 };
 await fits('Laptop: two stations');
 await page.screenshot({path:'.local/department-fit-laptop.png'});
 count=3;await page.getByRole('button',{name:'Refresh',exact:true}).click();
 await expect(page.locator('.build-station-card')).toHaveCount(3);
 await fits('Laptop: three stations');
 await openMenu();await menu.getByLabel('Overview arrangement').selectOption('numbers-first');await closeMenu();
 expect(await page.locator('.overview-numbers').evaluate(element=>element.getBoundingClientRect().top)).toBeLessThan(await page.locator('.overview-stations').evaluate(element=>element.getBoundingClientRect().top));
 await openMenu();await menu.getByLabel('Stations per row').selectOption('2');await menu.getByLabel('Page density').selectOption('compact');await closeMenu();
 await page.reload();await openMenu();
 await expect(menu.getByLabel('Stations per row')).toHaveValue('2');await expect(menu.getByLabel('Page density')).toHaveValue('compact');await expect(menu.getByLabel('Overview arrangement')).toHaveValue('numbers-first');
 await menu.getByLabel('Page density').selectOption('comfortable');await closeMenu();
 const comfortableHeight=await page.locator('.build-station-card').first().evaluate(element=>element.getBoundingClientRect().height);
 await expect(page.locator('.department-detail-sections')).toHaveAttribute('open','');
 await openMenu();
 await menu.getByRole('button',{name:'Reset layout',exact:true}).click();await closeMenu();
 expect(await page.locator('.build-station-card').first().evaluate(element=>element.getBoundingClientRect().height)).toBeLessThan(comfortableHeight);
 await page.getByTitle('Show cabinet progress full screen',{exact:true}).click();
 await expect(page.locator('.cabinet-progress:fullscreen')).toBeVisible();
 count=6;
 // The fixture is refreshed through the page's authenticated request after leaving fullscreen briefly.
 await page.getByTitle('Exit full screen',{exact:true}).click();await page.getByRole('button',{name:'Refresh',exact:true}).click();await expect(page.locator('.build-station-card')).toHaveCount(6);
 await page.getByTitle('Show cabinet progress full screen',{exact:true}).click();
 await fits('Fullscreen: six stations at 1366x768');
 await page.setViewportSize({width:1920,height:1080});await fits('Fullscreen: six stations at 1920x1080');
 await page.screenshot({path:'.local/department-fit-fullscreen.png'});
 await page.getByRole('tab',{name:'Graph',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Output outlook'})).toBeVisible();
 await expect(overview.locator('[data-metric]')).toHaveCount(6);
 expect(await page.locator('.cabinet-chart').evaluate(element=>element.getBoundingClientRect().top)).toBeGreaterThan(await overview.evaluate(element=>element.getBoundingClientRect().bottom));
 await page.getByTitle('Exit full screen',{exact:true}).click();
 await page.setViewportSize({width:390,height:844});await openMenu();await menu.getByLabel('Stations per row').selectOption('6');await closeMenu();
 await expect.poll(async()=>page.locator('.build-stations-grid').evaluate(element=>getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.locator('.build-stations').screenshot({path:'.local/department-fit-mobile.png'});
 expect(errors).toEqual([]);
 console.log('Department layout passed: primary information fits desktop/fullscreen, saved density/columns/order, graph stays below overview, and mobile stays readable.');
}finally{await browser.close();}
