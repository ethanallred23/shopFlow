import 'dotenv/config';
import bcrypt from 'bcryptjs';
import {DateTime} from 'luxon';
import {db} from '../server/db';
import {hash,ingest,newToken} from '../server/ingestion';
async function seed(){
 const email=process.env.SEED_EMAIL;const password=process.env.SEED_PASSWORD;
 if(!email||!password||password.length<12)throw new Error('Set SEED_EMAIL and SEED_PASSWORD (at least 12 characters).');
 if(await db.user.findUnique({where:{email}})){console.log('Seed account already exists; no data changed.');return;}
 const org=await db.organization.create({data:{name:'Northline · Demo',demo:true}});
 await db.user.create({data:{orgId:org.id,email,name:'Shop administrator',passwordHash:await bcrypt.hash(password,12),role:'admin'}});
 const shop=await db.shop.create({data:{orgId:org.id,name:'Northline demonstration shop'}});
 const assembly=await db.area.create({data:{orgId:org.id,shopId:shop.id,name:'Assembly'}});
 const finishing=await db.area.create({data:{orgId:org.id,shopId:shop.id,name:'Finishing'}});
 await db.shift.create({data:{orgId:org.id,name:'Day shift',startMinute:360,endMinute:840,breaks:[{start:120,end:135},{start:240,end:270}]}});
 await db.shift.create({data:{orgId:org.id,name:'Evening shift',startMinute:840,endMinute:1320,breaks:[{start:180,end:210}]}});
 await db.shift.create({data:{orgId:org.id,name:'Night shift',startMinute:1320,endMinute:360,breaks:[{start:180,end:210}]}});
 const now=DateTime.now().setZone(org.timezone);
 for(const [i,name] of ['Assembly 01','Assembly 02','Final inspection'].entries()){
  const s=await db.workstation.create({data:{orgId:org.id,areaId:i===2?finishing.id:assembly.id,name,product:i===2?'Housing B':'Housing A',job:'DEMO-'+(100+i),target:i===1?240:400,minIntervalMs:500}});
  const d=await db.device.create({data:{orgId:org.id,name:'Demo sensor '+(i+1),workstationId:s.id,capabilities:['count','cycle'],firmware:'simulator-1.0',lastHeartbeat:i===2?null:new Date()}});
  await db.assignment.create({data:{deviceId:d.id,workstationId:s.id}});
  const token=newToken();await db.credential.create({data:{deviceId:d.id,tokenHash:hash(token)}});
  if(i<2){
   const bootId='seed-boot';let sequence=0;
   for(let p=0;p<100-i*40;p++){
    const occurred=now.minus({minutes:(100-i*40-p)*2});
    for(const detected of [false,true]){
     await ingest(token,{schemaVersion:1,eventId:`seed-${sequence}`,deviceId:d.id,bootId,sequence:sequence++,uptimeMs:p*120000+(detected?2000:0),type:'sensor.state_changed',occurredAt:occurred.plus({seconds:detected?2:0}).toUTC().toISO(),data:{detected}});
    }
    await ingest(token,{schemaVersion:1,eventId:`seed-${sequence}`,deviceId:d.id,bootId,sequence:sequence++,uptimeMs:p*120000+3000,type:'cycle.completed',occurredAt:occurred.plus({seconds:3}).toUTC().toISO(),data:{durationMs:45000+(p%9)*1200+i*18000}});
   }
  }
  await db.credential.updateMany({where:{deviceId:d.id},data:{revokedAt:new Date()}});
  if(i===1)await db.note.create({data:{orgId:org.id,workstationId:s.id,author:'Demo team',text:'Demonstration note: replenished the next batch of housings.',reason:'Material shortage',minutes:12}});
 }
 console.log('Demo shop seeded through the production ingestion path. Sign in using SEED_EMAIL and SEED_PASSWORD. Register a fresh device to obtain a usable credential.');
}
seed().finally(()=>db.$disconnect());
