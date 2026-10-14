import 'dotenv/config';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';

// Real HTTP verification against a dedicated, clearly labeled demo workstation.
// Credentials remain in memory; output contains only public IDs and test results.
const base='http://127.0.0.1:3001';
const origin=process.env.APP_ORIGIN??'http://localhost:5173';
let cookie='',csrf='',deviceId='';
async function call(path:string,method='GET',body?:unknown,token?:string){
 const headers:Record<string,string>={'Content-Type':'application/json'};
 if(token)headers.Authorization='Bearer '+token;
 else {headers.Origin=origin;if(cookie)headers.Cookie=cookie;if(csrf)headers['X-CSRF-Token']=csrf;}
 const r=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
 const data=await r.json();return {status:r.status,data,cookie:r.headers.get('set-cookie')};
}
async function admin(path:string,method='GET',body?:unknown){const r=await call(path,method,body);assert.ok(r.status<300,`${path}: HTTP ${r.status}`);return r.data;}
const login=await call('/api/login','POST',{email:process.env.SEED_EMAIL,password:process.env.SEED_PASSWORD});assert.equal(login.status,200);
cookie=login.cookie!.split(';')[0];csrf=(await admin('/api/me')).csrf;
const initial=await admin('/api/dashboard');assert.equal(initial.org.demo,true,'Run only in the labeled demo organization.');
const label='CI Arduino API verification '+new Date().toISOString();
let result:any;
try{
 const shop=await admin('/api/settings/structure','POST',{kind:'shop',name:'CI integration test shop'});
 const area=await admin('/api/settings/structure','POST',{kind:'area',name:'Synthetic API verification',parentId:shop.id});
 const station=await admin('/api/settings/structure','POST',{kind:'workstation',name:label,parentId:area.id});
 const registered=await admin('/api/devices','POST',{name:label,capabilities:['count','cycle']});
 deviceId=registered.device.id;const token=registered.token;
 await admin('/api/devices/'+deviceId,'PATCH',{workstationId:station.id});
 const heartbeat=await call('/api/v1/heartbeat','POST',{deviceId,firmware:'api-handoff-test-1'},token);assert.deepEqual(heartbeat.data,{ok:true});assert.equal(heartbeat.status,200);
 const bootId=randomUUID();
 const envelope=(sequence:number,detected:boolean)=>({schemaVersion:1,eventId:`${bootId}-${sequence}`,deviceId,bootId,sequence,uptimeMs:sequence*1000,occurredAt:new Date().toISOString(),delivery:'live',type:'sensor.state_changed',data:{detected}});
 const low=await call('/api/v1/events','POST',envelope(0,false),token);assert.equal(low.status,200);
 const high=envelope(1,true);
 const duplicates=await Promise.all(Array.from({length:4},()=>call('/api/v1/events','POST',high,token)));
 assert.equal(duplicates.filter(x=>x.data.duplicate===false).length,1);assert.ok(duplicates.every(x=>x.status===200));
 for(const [sequence,detected] of [[2,true],[3,false],[4,true]] as const)assert.equal((await call('/api/v1/events','POST',envelope(sequence,detected),token)).status,200);
 const unsupported=await call('/api/v1/events','POST',{...envelope(5,true),type:'sensor.detection_total',data:{totalDetectedMs:5000}},token);assert.equal(unsupported.status,400);
 const extra=await call('/api/v1/events','POST',{...envelope(5,true),data:{detected:true,totalDetectedMs:5000}},token);assert.equal(extra.status,400);
 const missingAuth=await call('/api/v1/heartbeat','POST',{deviceId});assert.equal(missingAuth.status,401);
 const mismatch=await call('/api/v1/heartbeat','POST',{deviceId:randomUUID()},token);assert.equal(mismatch.status,403);
 const dashboard=await admin('/api/dashboard?workstation='+station.id);
 assert.equal(dashboard.stations.length,1);assert.equal(dashboard.stations[0].id,station.id);assert.equal(dashboard.stations[0].count,2);assert.equal(dashboard.stations[0].median,null);assert.equal(dashboard.stations[0].status,'online');
 const raw=await admin('/api/devices/'+deviceId+'/events');assert.equal(raw.length,5);assert.ok(raw.every((e:any)=>e.workstationId===station.id));
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1000}});await context.addCookies([{name:'sf_session',value:cookie.slice('sf_session='.length),url:origin}]);
  const page=await context.newPage();await page.goto(origin);
  await page.getByRole('button',{name:'Workstations',exact:true}).click();await page.locator('.station-card').filter({hasText:label}).click();
  await expect(page.locator('.metric').filter({hasText:'Recorded output'}).locator('.metric-value')).toContainText('2');
  await mkdir('.local',{recursive:true});await page.screenshot({path:'.local/arduino-api-verification.png',fullPage:true});
 }finally{await browser.close();}
 await admin('/api/devices/'+deviceId,'PATCH',{disabled:true});assert.equal((await call('/api/v1/heartbeat','POST',{deviceId},token)).status,401);
 await admin('/api/devices/'+deviceId,'PATCH',{disabled:false});
 const rotated=await admin('/api/devices/'+deviceId+'/credentials','POST',{action:'rotate'});
 assert.equal((await call('/api/v1/heartbeat','POST',{deviceId},token)).status,401);
 assert.equal((await call('/api/v1/heartbeat','POST',{deviceId},rotated.token)).status,200);
 await admin('/api/devices/'+deviceId+'/credentials','POST',{action:'revoke'});
 assert.equal((await call('/api/v1/heartbeat','POST',{deviceId},rotated.token)).status,401);
 result={testedAt:new Date().toISOString(),base,stationId:station.id,stationName:label,deviceId,rawEvents:5,recordedCount:2,cycleMedian:null,concurrentDuplicateRetries:3,unsupportedDurationStatus:unsupported.status,extraDurationFieldStatus:extra.status,heartbeatStatus:heartbeat.status,credentialChecks:'disabled/rotated/revoked: passed',browser:'workstation displayed 2 recorded parts',cleanup:'credential revoked and test device disabled; synthetic history retained'};
 await writeFile('.local/arduino-api-verification.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify(result,null,2));
}finally{
 if(deviceId){await admin('/api/devices/'+deviceId+'/credentials','POST',{action:'revoke'});await admin('/api/devices/'+deviceId,'PATCH',{disabled:true});}
 await admin('/api/logout','POST');
}
