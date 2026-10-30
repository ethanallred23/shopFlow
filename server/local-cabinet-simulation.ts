import {randomUUID} from 'node:crypto';
import bcrypt from 'bcryptjs';
import {db} from './db';
import {hash,ingest,newToken} from './ingestion';
import {cabinetSimulationFrame,type SimulationTiming} from './cabinet-simulation-frame';

const marker='LOCAL-CABINET-SIMULATION';
type DeviceSimulation={deviceId:string;token:string;bootId:string;bootAt:number;liveAt:number;offset:number;
 sequence:number;lastStatus:string;lastSampleAt:number;timing:SimulationTiming};

export async function startLocalCabinetSimulation(refresh:(orgId:string)=>void){
 if(process.env.NODE_ENV!=='development')throw new Error('Local cabinet simulation requires NODE_ENV=development.');
 const database=new URL(process.env.DATABASE_URL??'');
 if(!['localhost','127.0.0.1','[::1]','::1'].includes(database.hostname))throw new Error('Local cabinet simulation requires a database on localhost.');
 const user=await db.user.findUnique({where:{email:(process.env.SEED_EMAIL??'').toLowerCase()},include:{orgIdRef:true}});
 if(!user?.orgIdRef.demo)throw new Error('Run npm.cmd run db:seed first; the seed account must belong to a demo organization.');
 const orgId=user.orgId;
 const shop=await db.shop.findFirstOrThrow({where:{orgId}});
 let area=await db.area.findFirst({where:{orgId,name:'Cabinet simulation'}});
 if(!area)area=await db.area.create({data:{orgId,shopId:shop.id,name:'Cabinet simulation',themeColor:'#287f83',themeMode:'dark',cabinetPaceMs:60000}});
 const paceMs=area.cabinetPaceMs??60000;
 const profiles=[
  {name:'Demo assembly 01',operator:'Alex (simulated)',buildMs:24000,pauseMs:6000,idleMs:5000,offset:3000},
  {name:'Demo assembly 02',operator:'Sam (simulated)',buildMs:36000,pauseMs:8000,idleMs:6000,offset:19000},
  {name:'Demo assembly 03',operator:'Jordan (simulated)',buildMs:50000,pauseMs:10000,idleMs:5000,offset:29000},
  {name:'Demo assembly 04',operator:'Taylor (simulated)',buildMs:Math.round(paceMs*1.5),pauseMs:8000,idleMs:6000,offset:Math.round(paceMs*.3)},
 ];
 const simulations:DeviceSimulation[]=[];
 for(const [index,profile] of profiles.entries()){
  let station=await db.workstation.findFirst({where:{orgId,areaId:area.id,job:marker,name:profile.name}});
  if(!station)station=await db.workstation.create({data:{orgId,areaId:area.id,name:profile.name,job:marker,product:'Simulated cabinet',target:0}});
  let device=await db.device.findFirst({where:{orgId,workstationId:station.id,firmware:marker}});
  if(!device){
   device=await db.device.create({data:{orgId,workstationId:station.id,name:profile.name+' timer (simulated)',firmware:marker,capabilities:['detection_time']}});
   await db.assignment.create({data:{deviceId:device.id,workstationId:station.id}});
  }
  // These accounts identify preview operators; their random passwords are never displayed.
  const email=`cabinet-simulation-${index+1}@example.invalid`;
  let operator=await db.user.findUnique({where:{email}});
  if(!operator)operator=await db.user.create({data:{orgId,areaId:area.id,workstationId:station.id,name:profile.operator,email,passwordHash:await bcrypt.hash(newToken(),10),role:'viewer'}});
  if(operator.orgId!==orgId)throw new Error('A simulation operator already belongs to another organization.');
  if(!await db.operatorAssignment.findFirst({where:{userId:operator.id,workstationId:station.id,endedAt:null}})){
   await db.operatorAssignment.create({data:{orgId,userId:operator.id,workstationId:station.id,operatorName:profile.operator,startedAt:new Date(Date.now()-3600000)}});
  }
  await db.credential.updateMany({where:{deviceId:device.id,revokedAt:null},data:{revokedAt:new Date()}});
  const token=newToken();
  await db.credential.create({data:{deviceId:device.id,tokenHash:hash(token)}});
  const now=Date.now(),historyIntervalMs=Math.max(300000,profile.buildMs+profile.pauseMs+profile.idleMs);
  const bootAt=now-Math.max(1800000,120000+2*historyIntervalMs+profile.buildMs+60000);
  const simulation:DeviceSimulation={deviceId:device.id,token,bootId:randomUUID(),bootAt,liveAt:now,
   offset:profile.offset,sequence:0,lastStatus:'',lastSampleAt:0,timing:profile};
  // Initial history makes the graph and cabinet log useful on the first visit.
  if(!await db.rawEvent.count({where:{deviceId:device.id}})){
   for(let cabinet=0;cabinet<3;cabinet++){
    const started=120000+cabinet*historyIntervalMs,duration=profile.buildMs;
    for(const completed of [false,true]){
     const uptime=started+(completed?duration:0);
     const result=await ingest(token,{schemaVersion:1,eventId:randomUUID(),deviceId:device.id,bootId:simulation.bootId,sequence:simulation.sequence++,uptimeMs:uptime,
      occurredAt:new Date(simulation.bootAt+uptime).toISOString(),delivery:'live',type:'sensor.detection_time_snapshot',
      data:{detected:!completed,totalDetectedMs:cabinet*duration+(completed?duration:0),counterId:simulation.bootId,reason:'transition',
       cabinet:{id:'history-'+cabinet,startedUptimeMs:started,finishedUptimeMs:completed?uptime:null,elapsedMs:completed?duration:0,running:!completed}}});
     if(!result.measurementAccepted)throw new Error('A simulation history snapshot was rejected.');
    }
   }
  }
  simulations.push(simulation);
 }
 let ticking=false,stopped=false;
 const tick=async()=>{
  if(ticking||stopped)return;
  ticking=true;
  try{
   const now=Date.now();let changed=false;
   for(const simulation of simulations){
    const frame=cabinetSimulationFrame(now-simulation.liveAt+simulation.offset,simulation.timing);
    const status=frame.cycle+':'+frame.status;
    if(status===simulation.lastStatus&&now-simulation.lastSampleAt<5000)continue;
    const origin=simulation.liveAt-simulation.offset-simulation.bootAt;
    const result=await ingest(simulation.token,{schemaVersion:1,eventId:randomUUID(),deviceId:simulation.deviceId,bootId:simulation.bootId,
     sequence:simulation.sequence++,uptimeMs:now-simulation.bootAt,occurredAt:new Date(now).toISOString(),delivery:'live',type:'sensor.detection_time_snapshot',
     data:{detected:frame.detected,totalDetectedMs:3*simulation.timing.buildMs+frame.totalMs,counterId:simulation.bootId,
      reason:status===simulation.lastStatus?'periodic':'transition',cabinet:{id:'live-'+frame.cycle,startedUptimeMs:origin+frame.startedMs,
       finishedUptimeMs:frame.finishedMs===null?null:origin+frame.finishedMs,elapsedMs:frame.activeMs,running:frame.running}}});
    if(!result.measurementAccepted)throw new Error('A simulated cabinet snapshot was rejected.');
    await db.device.update({where:{id:simulation.deviceId},data:{lastHeartbeat:new Date(now)}});
    simulation.lastStatus=status;simulation.lastSampleAt=now;changed=true;
   }
   if(changed)refresh(orgId);
  }finally{ticking=false;}
 };
 await tick();
 const interval=setInterval(()=>void tick().catch(()=>console.error('Local cabinet simulation could not update. Check the local database connection.')),1000);
 const address=new URL(process.env.APP_ORIGIN??'http://127.0.0.1:5173');address.searchParams.set('department',area.id);
 console.log(`Local cabinet simulation: ${address.href}`);
 console.log('Four simulated workstations are building, pausing, and completing cabinets, including Taylor at 50% over the desired build time. Set LOCAL_CABINET_SIMULATION=0 and restart to stop.');
 return ()=>{stopped=true;clearInterval(interval);};
}
