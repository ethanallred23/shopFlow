import 'dotenv/config';
import {randomUUID} from 'node:crypto';
import {db} from '../server/db';
import {ingest,newToken,hash} from '../server/ingestion';

const name='Biltoki cabinet timer · Example';
async function main(){
  const org=await db.organization.findFirst({where:{demo:true}});
  if(!org)throw new Error('Run npm.cmd run db:seed first; no demo organization exists.');
  const existing=await db.device.findFirst({where:{orgId:org.id,name}});
  if(existing){console.log('Biltoki example already exists; no data changed.');return;}
  const shop=await db.shop.findFirstOrThrow({where:{orgId:org.id}});
  const area=await db.area.findFirstOrThrow({where:{orgId:org.id,shopId:shop.id}});
  const workstation=await db.workstation.create({data:{orgId:org.id,areaId:area.id,name,product:'Cabinet assembly',job:'BILTOKI-DEMO',target:20,minIntervalMs:500}});
  const device=await db.device.create({data:{orgId:org.id,workstationId:workstation.id,name:'Biltoki cabinet sensor · Example',capabilities:['detection_time'],firmware:'biltoki-example-1.0'}});
  await db.assignment.create({data:{deviceId:device.id,workstationId:workstation.id}});
  const token=newToken();await db.credential.create({data:{deviceId:device.id,tokenHash:hash(token)}});
  const bootId='biltoki-example-boot';const counterId='biltoki-example-counter';const now=Date.now();
  const samples=[
    {minutes:60,uptime:0,total:0,detected:false},
    {minutes:45,uptime:900000,total:0,detected:true},
    {minutes:35,uptime:1500000,total:600000,detected:false},
    {minutes:25,uptime:2100000,total:600000,detected:true},
    {minutes:15,uptime:2700000,total:1200000,detected:false},
    {minutes:5,uptime:3300000,total:1200000,detected:true},
  ];
  for(const [sequence,sample] of samples.entries())await ingest(token,{schemaVersion:1,eventId:`${bootId}-${sequence}`,deviceId:device.id,bootId,sequence,uptimeMs:sample.uptime,occurredAt:new Date(now-sample.minutes*60000).toISOString(),delivery:'live',type:'sensor.detection_time_snapshot',data:{detected:sample.detected,totalDetectedMs:sample.total,counterId}});
  console.log('Biltoki example created: 2 completed cabinets and 1 active cabinet interval.');
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Biltoki example failed');process.exitCode=1;}).finally(()=>db.$disconnect());
