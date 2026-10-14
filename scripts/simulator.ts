import 'dotenv/config';
import {randomUUID} from 'node:crypto';
const url=process.env.API_URL??'http://localhost:3001';const token=process.env.DEVICE_TOKEN;const deviceId=process.env.DEVICE_ID;
if(!token||!deviceId)throw new Error('Set DEVICE_TOKEN and DEVICE_ID from the Devices page.');
const sleep=(n:number)=>new Promise(r=>setTimeout(r,n));
let bootId=randomUUID(),sequence=0,start=Date.now();
const mode=process.argv[2]??'normal';
async function post(path:string,body:unknown){for(let attempt=0;attempt<8;attempt++){try{const r=await fetch(url+'/api/v1/'+path,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});if(r.ok)return;if(r.status<500&&r.status!==429)throw new Error('Device request rejected: '+r.status);}catch(e){if(attempt===7)throw e;}await sleep(Math.min(30000,500*2**attempt));}throw new Error('Retry limit reached');}
function event(detected:boolean){return {schemaVersion:1,eventId:randomUUID(),deviceId,bootId,sequence:sequence++,uptimeMs:Date.now()-start,type:'sensor.state_changed',occurredAt:new Date().toISOString(),data:{detected}};}
console.log('Simulator mode:',mode,'(Ctrl+C to stop)');
let iteration=0;
while(true){
 if(mode!=='disconnect')await post('heartbeat',{deviceId,firmware:'shopflow-simulator-1.0'});
 else {console.log('Disconnected: sending nothing');await sleep(120000);continue;}
 if(mode==='restart'&&iteration%5===4){bootId=randomUUID();sequence=0;start=Date.now();await post('events',event(true));}
 await post('events',event(false));await sleep(mode==='slow'?10000:1000);
 const high=event(true);
 if(mode==='buffered'){console.log('Wi-Fi interruption: buffering locally for 10s');await sleep(10000);await post('events',{...high,delivery:'buffered'});}
 else if(mode==='out-of-order'){const newer=event(false);await post('events',newer);await post('events',high);}
 else await post('events',high);
 if(mode==='duplicate')await Promise.all([post('events',high),post('events',high)]);
 if(mode==='repeated')for(let i=0;i<4;i++)await post('events',event(true));
 await post('events',{schemaVersion:1,eventId:randomUUID(),deviceId,bootId,sequence:sequence++,uptimeMs:Date.now()-start,type:'cycle.completed',occurredAt:new Date().toISOString(),data:{durationMs:mode==='slow'?12000:3000}});
 iteration++;await sleep(2000);
}
