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
 const page=await browser.newPage({viewport:{width:1920,height:1080}}),errors:string[]=[];
 page.on('pageerror',error=>errors.push(error.message));
 const login=await page.request.post(origin+'/api/login',{headers:{Origin:origin},data:{email:process.env.SEED_EMAIL,password:process.env.SEED_PASSWORD}});
 if(!login.ok())throw new Error('Local login failed: HTTP '+login.status());
 await page.addInitScript(({id})=>localStorage.setItem('shopflow:department-layout:v1:'+id,JSON.stringify({density:'comfortable',stationColumns:5,arrangement:'stations-first'})),{id:area.id});
 let theme='dark',improved=false;
 await page.route('**/api/dashboard?*',async route=>{
  const response=await route.fetch(),data=await response.json(),source=data.stations.find((station:any)=>station.areaId===area.id);
  const profiles=[{name:'01 - Green',ratio:.4},{name:'02 - Yellow',ratio:.9},{name:'03 - Orange',ratio:1.1},{name:'04 - Red',ratio:improved ? .4 : 1.5},{name:'05 - No history',ratio:null}];
  const stations=profiles.map((profile,index)=>{
   const station=structuredClone(source),id='health-fixture-'+index;
   const cabinet={id:id+':cabinet',deviceId:id,number:index+1,stationId:id,stationName:profile.name,status:'building',stale:false,durationMs:120000,lastReportedAt:new Date().toISOString(),startedAt:new Date(Date.now()-120000).toISOString(),finishedAt:null,operatorName:'Builder '+(index+1)};
   return {...station,id,name:profile.name,status:'online',people:[{name:cabinet.operatorName}],cabinet:{...station.cabinet,desiredPaceMs:600000,completed:profile.ratio===null?0:24,averageBuildMs:profile.ratio===null?0:profile.ratio*600000,cabinets:[cabinet]}};
  });
  data.stations=stations;
  for(const department of [...data.areas,...data.departments])if(department.id===area.id){department.themeMode=theme;department.cabinetPaceMs=600000;department.stationCount=5;if(department.cabinet)department.cabinet={...department.cabinet,desiredPaceMs:600000,cabinets:stations.flatMap(station=>station.cabinet.cabinets)};}
  await route.fulfill({response,json:data});
 });
 await page.goto(origin+'/?department='+area.id);
 const cards=page.locator('.build-station-card');await expect(cards).toHaveCount(5);
 const hue=(index:number)=>cards.nth(index).evaluate(element=>Number(getComputedStyle(element).getPropertyValue('--health-hue')));
 for(const [index,target] of [120,52,27,4].entries())await expect.poll(()=>hue(index)).toBe(target);
 const backgrounds=await cards.evaluateAll(elements=>elements.map(element=>getComputedStyle(element).backgroundImage));
 expect(new Set(backgrounds).size).toBe(5);
 await expect(cards.nth(4)).not.toHaveClass(/health-tinted/);
 for(let index=0;index<4;index++){
  const colors=await cards.nth(index).evaluate(element=>({border:getComputedStyle(element).borderTopColor,bar:getComputedStyle(element.querySelector('.build-station-speed-track>span')!).backgroundColor,value:getComputedStyle(element.querySelector('.build-station-speed>div>strong')!).color}));
  expect(colors.border).toBe(colors.bar);expect(colors.value).toBe(colors.bar);
 }
 await page.locator('.build-stations').screenshot({path:'.local/station-health-colors-dark.png'});
 improved=true;await page.getByRole('button',{name:'Refresh',exact:true}).click();
 await expect(cards.nth(3)).toHaveAttribute('data-health-ratio','0.4');
 expect(await cards.nth(3).evaluate(element=>getComputedStyle(element).transitionProperty)).toContain('--health-hue');
 await expect.poll(()=>hue(3)).toBe(120);
 await page.emulateMedia({reducedMotion:'reduce'});improved=false;
 await page.getByRole('button',{name:'Refresh',exact:true}).click();await expect.poll(()=>hue(3)).toBe(4);
 expect(await cards.nth(3).evaluate(element=>getComputedStyle(element).animationName)).toBe('none');
 expect(await cards.nth(3).evaluate(element=>getComputedStyle(element).transitionProperty)).toBe('none');
 await page.emulateMedia({reducedMotion:'no-preference'});theme='light';
 await page.getByRole('button',{name:'Refresh',exact:true}).click();await expect(page.locator('.department-view')).toHaveClass(/theme-light/);
 await page.locator('.build-stations').screenshot({path:'.local/station-health-colors-light.png'});
 expect(new Set(await cards.evaluateAll(elements=>elements.map(element=>getComputedStyle(element).backgroundImage))).size).toBe(5);
 expect(errors).toEqual([]);
 console.log('Station health colors passed: red/orange/yellow/green surfaces, matching accents, neutral missing history, smooth health changes, dark/light themes, and reduced motion.');
}finally{await browser.close();}
