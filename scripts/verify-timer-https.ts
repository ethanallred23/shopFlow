import 'dotenv/config';
import https from 'node:https';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID,X509Certificate} from 'node:crypto';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
const base='https://192.168.10.36';
const ca=await readFile('certs/shopflow-root-ca.pem');
const root=new X509Certificate(ca);
function deviceRequest(path:string,payload:unknown,token?:string,trust=true):Promise<{status:number;body:any;authorized:boolean;san:string|undefined}>{
 return new Promise((resolve,reject)=>{
  const body=JSON.stringify(payload);
  const req=https.request(base+path,{method:'POST',ca:trust?ca:undefined,rejectUnauthorized:true,headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body),...(token?{Authorization:'Bearer '+token}:{})}},res=>{
   let data='';const socket=res.socket as import('node:tls').TLSSocket;
   const authorized=socket.authorized;const san=socket.getPeerCertificate().subjectaltname;
   res.on('data',chunk=>data+=chunk);res.on('end',()=>{try{resolve({status:res.statusCode!,body:JSON.parse(data),authorized,san});}catch{reject(new Error('Non-JSON API response'));}});
  });req.setTimeout(15000,()=>req.destroy(new Error('HTTPS timeout')));req.on('error',reject);req.end(body);
 });
}
let cookie='',csrf='';
async function admin(path:string,method='GET',body?:unknown){
 const r=await fetch('http://127.0.0.1:3001'+path,{method,headers:{'Content-Type':'application/json',Origin:process.env.APP_ORIGIN!,Cookie:cookie,'X-CSRF-Token':csrf},body:body===undefined?undefined:JSON.stringify(body)});
 assert.ok(r.ok,`${path}: ${r.status}`);if(path==='/api/login')cookie=r.headers.get('set-cookie')!.split(';')[0];return r.json();
}
await admin('/api/login','POST',{email:process.env.SEED_EMAIL,password:process.env.SEED_PASSWORD});csrf=(await admin('/api/me')).csrf;
assert.equal((await admin('/api/dashboard')).org.demo,true,'This verification creates synthetic demo records only.');
const label='HTTPS timer verification '+new Date().toISOString();let id='';
try{
 const shop=await admin('/api/settings/structure','POST',{kind:'shop',name:'Timer HTTPS verification'});
 const area=await admin('/api/settings/structure','POST',{kind:'area',name:'Synthetic timer test',parentId:shop.id});
 const station=await admin('/api/settings/structure','POST',{kind:'workstation',name:label,parentId:area.id});
 const device=await admin('/api/devices','POST',{name:label,capabilities:['detection_time']});id=device.device.id;const token=device.token;
 await admin('/api/devices/'+id,'PATCH',{workstationId:station.id});
 await assert.rejects(deviceRequest('/api/v1/heartbeat',{deviceId:id},undefined,false));
 const noToken=await deviceRequest('/api/v1/heartbeat',{deviceId:id});assert.equal(noToken.status,401);
 const hb=await deviceRequest('/api/v1/heartbeat',{deviceId:id,firmware:'timer-https-test-1'},token);assert.equal(hb.status,200);assert.equal(hb.authorized,true);assert.ok(hb.san?.includes('192.168.10.36'));
 const boot=randomUUID(),counter=randomUUID(),start=Date.now()-30000;
 const snapshot=(seq:number,total:number,uptime:number)=>({schemaVersion:1,eventId:randomUUID(),deviceId:id,bootId:boot,sequence:seq,uptimeMs:uptime,occurredAt:new Date(start+uptime).toISOString(),delivery:'buffered',type:'sensor.detection_time_snapshot',data:{detected:true,totalDetectedMs:total,counterId:counter}});
 const first=snapshot(0,2000,5000);const retries=await Promise.all(Array.from({length:4},()=>deviceRequest('/api/v1/events',first,token)));assert.equal(retries.filter(r=>!r.body.duplicate).length,1);
 const gap=await deviceRequest('/api/v1/events',snapshot(10,11000,15000),token);assert.equal(gap.body.measurementAccepted,true);
 assert.equal((await deviceRequest('/api/v1/events',snapshot(9,10000,14000),token)).body.measurementAccepted,false);
 assert.equal((await deviceRequest('/api/v1/events',snapshot(11,10000,16000),token)).body.measurementAccepted,false);
 await deviceRequest('/api/v1/events',snapshot(12,12000,17000),token);
 const reset={...snapshot(0,1500,3000),bootId:randomUUID(),occurredAt:new Date(start+20000).toISOString(),data:{detected:false,totalDetectedMs:1500,counterId:randomUUID()}};
 assert.equal((await deviceRequest('/api/v1/events',reset,token)).body.measurementAccepted,true);
 const parts=await deviceRequest('/api/v1/events',{...snapshot(20,0,25000),type:'sensor.state_changed',data:{detected:true}},token);assert.equal(parts.status,422);
 const dashboard=await admin('/api/dashboard?workstation='+station.id);const s=dashboard.stations[0];
 assert.equal(s.count,null);assert.equal(s.median,null);assert.equal(s.timerOnly,true);assert.equal(s.timers[0].recoveredTotalMs,13500);assert.equal(s.timers[0].currentCounterMs,1500);assert.equal(s.timers[0].unallocatedAllTimeMs,3500);assert.equal(s.timers[0].connection,'online');assert.equal(s.timers[0].detected,false);
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1050}});await context.addCookies([{name:'sf_session',value:cookie.slice('sf_session='.length),url:process.env.APP_ORIGIN!}]);
  const page=await context.newPage();await page.goto(process.env.APP_ORIGIN!);await page.getByRole('button',{name:'Workstations',exact:true}).click();await page.locator('.station-card').filter({hasText:label}).click();
  await expect(page.getByRole('heading',{name:'Detected time',exact:true})).toBeVisible();await expect(page.getByText('Current: Absent',{exact:true})).toBeVisible();await expect(page.locator('.metric').filter({hasText:'Recovered device time'}).locator('.metric-value')).toHaveText('0:13');await expect(page.getByText('Median cycle',{exact:true})).toHaveCount(0);
  await page.screenshot({path:'.local/timer-https-workstation.png',fullPage:true});
 }finally{await browser.close();}
 const report={testedAt:new Date().toISOString(),baseUrl:base+':443',testOrigin:'same Windows computer using its LAN IP; second-device access not tested',tlsAuthorized:hb.authorized,serverSAN:hb.san,rootFingerprint256:root.fingerprint256,untrustedCaRejected:true,missingTokenStatus:noToken.status,heartbeatStatus:hb.status,timerOnlyPartsRejected:parts.status,deviceId:id,workstationId:station.id,workstationName:label,currentCounterMs:1500,recoveredTotalMs:13500,unallocatedAllTimeMs:3500,confirmedShiftMs:s.timers[0].confirmedShiftMs,partCount:s.count,cycleMedian:s.median,duplicateRetries:3,oldAndDecreasingRejected:true,browser:'timer/state visible; production metrics hidden',cleanup:'test credential revoked and device disabled'};
 await writeFile('.local/timer-https-verification.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{
 if(id){await admin('/api/devices/'+id+'/credentials','POST',{action:'revoke'});await admin('/api/devices/'+id,'PATCH',{disabled:true});}
 await admin('/api/logout','POST');
}
