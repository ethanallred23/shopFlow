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
 const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors:string[]=[],writes:string[]=[];
 page.on('pageerror',error=>errors.push(error.message));
 const login=await page.request.post(origin+'/api/login',{headers:{Origin:origin},data:{email:process.env.SEED_EMAIL,password:process.env.SEED_PASSWORD}});
 if(!login.ok())throw new Error('Local login failed: '+login.status());
 page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/api/')&&!['GET','HEAD'].includes(request.method()))writes.push(request.method()+' '+new URL(request.url()).pathname);});
 // Production-shaped response in this browser only, with existing live data.
 // The feature must work without demo-account or localhost simulation flags.
 let theme='dark';
 await page.route('**/api/dashboard?*',async route=>{
  const response=await route.fetch(),data=await response.json();
  data.org.demo=false;delete data.localSimulation;
  data.stations.forEach((station:any)=>{station.people=[{name:'Live fixture operator'}];});
  for(const department of [...data.areas,...data.departments])if(department.id===area.id)department.themeMode=theme;
  await route.fulfill({response,json:data});
 });
 await page.addInitScript(({id})=>localStorage.setItem('shopflow:department-view:v1:'+id,JSON.stringify(['metricPlanned'])),{id:area.id});
 await page.clock.install({time:new Date()});
 await page.goto(origin+'/?department='+area.id);
 const first=page.locator('.build-station-card').first();
 await expect(first.locator('h4')).toHaveText('Live fixture operator');
 await expect(page.locator('[data-metric="metricPlanned"]')).toHaveCount(0);
 await page.getByRole('button',{name:'Simulation mode',exact:true}).click();
 await expect(page.getByRole('button',{name:'Exit simulation',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('.department-simulation-notice')).toContainText('Simulation mode: sample data');
 await expect(page.locator('.build-station-card')).toHaveCount(4);
 await expect(first.locator('h4')).toHaveText('Alex (simulated)');
 await expect(page.locator('.build-station-card').last()).toHaveAttribute('data-health-ratio','1.5');
 await expect(page.locator('[data-metric="metricPlanned"]')).toBeVisible();
 await expect(page.locator('.build-station-open')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Set cabinet pace',exact:true})).toHaveCount(0);
 const initial=Number(await first.locator('.build-station-footer strong').textContent());
 await page.clock.runFor(3000);
 await expect(first.locator('.build-station-footer strong')).toHaveText(String(initial+1));
 await expect(first.locator('.build-station-completion')).toBeVisible();
 await page.clock.runFor(4500);
 await expect(first).toHaveClass(/just-started/);
 await expect(first.locator('.build-station-state')).toContainText('Cabinet started');
 await expect(page.locator('.cabinet-history tbody tr').first()).toContainText('Building');
 await page.getByRole('tab',{name:'Graph',exact:true}).click();
 await expect(page.locator('.cabinet-plot svg')).toBeVisible();
 await page.getByTitle('Show cabinet progress full screen',{exact:true}).click();
 await expect(page.locator('.cabinet-progress .simulation-badge')).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>document.fullscreenElement?.classList.contains('cabinet-progress'))).toBe(true);
 await page.locator('.cabinet-progress').screenshot({path:'.local/presentation-simulation-fullscreen.png'});
 await page.getByTitle('Exit full screen',{exact:true}).click();
 await page.getByRole('button',{name:'Exit simulation',exact:true}).click();
 await expect(first.locator('h4')).toHaveText('Live fixture operator');
 await expect(page.locator('.department-simulation-notice')).toHaveCount(0);
 await expect(page.locator('[data-metric="metricPlanned"]')).toHaveCount(0);
 // Current production refreshes and theme changes must not end an active demo.
 await page.getByRole('button',{name:'Simulation mode',exact:true}).click();
 theme='light';await page.getByRole('button',{name:'Refresh',exact:true}).click();
 await expect(page.locator('.department-view')).toHaveClass(/theme-light/);
 await expect(first.locator('h4')).toHaveText('Alex (simulated)');
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'.local/presentation-simulation-mobile.png',fullPage:true});
 await page.reload();
 await expect(page.getByRole('button',{name:'Simulation mode',exact:true})).toHaveAttribute('aria-pressed','false');
 await expect(first.locator('h4')).toHaveText('Live fixture operator');
 expect(writes).toEqual([]);expect(errors).toEqual([]);
 console.log('Presentation simulation passed: production account shape, four stations, automatic completion/start, chart and log, fullscreen label, theme/mobile layout, live-data and preference restoration, reload reset, and no API writes.');
}finally{await browser.close();}
