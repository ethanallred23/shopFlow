import {chromium,expect} from '@playwright/test';
import {departmentProgress} from '../server/department-progress';
import type {CabinetProgress} from '../server/cabinet-progress';
import {mkdirSync} from 'node:fs';

// Isolated browser fixture: no real accounts, devices, or production data are changed.
const start=new Date(Date.now()-3600000),finish=new Date(Date.now()+3600000);
const operator={id:'operator-a',name:'Ethan Allred',workstationId:'station-a' as string|null};
const other={id:'operator-b',name:'Bob Builder',workstationId:null as string|null};
const build=(deviceId:string,completed:number):CabinetProgress=>({target:10,started:completed+1,completed,active:true,currentBuildMs:120000,buildMs:completed*120000,nonBuildMs:1000,averageBuildMs:120000,remaining:10-completed,remainingShiftMs:3600000,requiredMsPerCabinet:360000,expected:5,onTrack:completed>=5,progressPct:completed*10,timeline:[{at:start.toISOString(),actual:0,expected:0},{at:new Date().toISOString(),actual:completed,expected:5}],cabinets:[{id:deviceId+'-cabinet',deviceId,number:1,startedAt:new Date(Date.now()-120000).toISOString(),finishedAt:null,durationMs:120000,status:'building',lastReportedAt:new Date().toISOString(),stale:false,operatorId:operator.id,operatorName:operator.name,completedById:null,completedByName:null}]});
const stations=['station-a','station-b'].map((id,i)=>({id,areaId:'department',name:i?'Station B':'Station A',target:10,product:'Cabinet',job:'Job',minIntervalMs:500,timerOnly:true,count:null,expected:5,median:null,p90:null,status:'online',devices:1,people:i?[]:[{id:operator.id,name:operator.name}],cabinet:build('device-'+i,i?3:9),timers:[] as any[]}));
const roster=[operator,other];
function dashboard(){
 for(const [i,s] of stations.entries()){
  s.people=roster.filter(p=>p.workstationId===s.id).map(({id,name})=>({id,name}));
  s.timers=[{deviceId:'device-'+i,connection:'online',detected:true,snapshotFresh:true,currentCounterMs:120000,recoveredTotalMs:120000,confirmedShiftMs:120000,unallocatedAllTimeMs:0,boundaryUncertainMs:0,receivedAt:new Date().toISOString(),notices:[],cabinet:s.cabinet}];
 }
 return {org:{timezone:'America/Denver',demo:false},shops:[{id:'shop',name:'Quality Craft Wood Works'}],areas:[{id:'department',shopId:'shop',name:'Assembly'}],departments:[{id:'department',name:'Assembly',stationCount:2,cabinet:departmentProgress(stations)}],workstations:stations,shifts:[{id:'shift',name:'Day shift',startMinute:360,endMinute:900,breaks:[]}],date:'2026-10-29',shiftId:'shift',window:{start,end:finish},stations,devices:stations.map((s,i)=>({id:'device-'+i,name:'Biltoki '+i,status:'online',workstationId:s.id,capabilities:['detection_time']})),hourly:[],cycles:[],notes:[],recent:[],quality:0,unplaced:0};
}
mkdirSync('.local',{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1500,height:1100}}),errors:string[]=[];
page.on('pageerror',e=>errors.push(e.message));
await page.route('**/api/**',async route=>{
 const url=new URL(route.request().url()),path=url.pathname;
 if(path==='/api/live'){await route.fulfill({contentType:'text/event-stream',body:': fixture\n\n'});return;}
 let value:any={ok:true};
 if(path==='/api/me')value={user:{id:'admin',name:'Admin',role:'admin'},csrf:'fixture'};
 else if(path==='/api/dashboard')value=dashboard();
 else if(path.endsWith('/people'))value=roster;
 else if(path.includes('/people/')){
  const stationId=path.split('/')[3],personId=path.split('/').at(-1),person=roster.find(p=>p.id===personId)!;
  if(route.request().postDataJSON().assigned){for(const p of roster)if(p.workstationId===stationId)p.workstationId=null;person.workstationId=stationId;}else person.workstationId=null;
 }else if(path.includes('/commands'))value=[];
 else if(path==='/api/settings')value={users:[],workstations:stations};
 await route.fulfill({json:value});
});
try{
 await page.goto('http://127.0.0.1:5176/?department=department');
 await expect(page.getByRole('heading',{name:'Assembly cabinet progress'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Workstation pace'})).toBeVisible();
 await expect(page.getByText('12',{exact:true})).toBeVisible();
 await page.screenshot({path:'.local/department-shared-desktop.png',fullPage:true});
 await page.getByRole('button',{name:'Station B',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Workstation operator'})).toBeVisible();
 await expect(page.locator('.station-people-warning')).toContainText('No user assigned');
 await page.getByLabel('Choose a department operator').selectOption(other.id);
 await page.getByRole('button',{name:'Assign operator',exact:true}).click();
 await expect(page.locator('.assigned-person')).toHaveCount(1);
 await expect(page.locator('.assigned-person')).toContainText('Bob Builder');
 await page.getByLabel('Choose a department operator').selectOption(operator.id);
 await page.getByRole('button',{name:'Replace operator',exact:true}).click();
 await expect(page.locator('.assigned-person')).toHaveCount(1);
 await expect(page.locator('.assigned-person')).toContainText('Ethan Allred');
 await page.getByRole('button',{name:'Departments',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Assembly cabinet progress'})).toBeVisible();
 const cabinet=stations[1].cabinet.cabinets[0];cabinet.status='completed';cabinet.finishedAt=new Date().toISOString();cabinet.completedById=operator.id;cabinet.completedByName=operator.name;
 stations[1].cabinet.completed++;stations[1].cabinet.active=false;
 await page.getByRole('button',{name:'Refresh',exact:true}).click();
 await expect(page.locator('.cabinet-celebration')).toBeVisible();
 await page.screenshot({path:'.local/department-completion.png',fullPage:true});
 await page.getByRole('button',{name:'Dismiss completion'}).click();
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:'.local/department-shared-mobile.png',fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(errors).toEqual([]);
 console.log('Department browser smoke passed: shared totals, station pace, one operator replacement, red unassigned warning, completion animation, and mobile layout.');
}finally{await browser.close();}
