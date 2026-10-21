import {expect,it,describe,beforeEach,afterEach} from 'vitest';
import {randomUUID} from 'node:crypto';
import {detectionDelta} from '../server/detection';
import {eventSchema} from '../server/domain';
import {db} from '../server/db';
import {ingest,hash,newToken} from '../server/ingestion';
import {rebuild} from '../server/rebuild';
import {detectionDashboard} from '../server/detection-dashboard';

it('computes differences, never sums snapshots; zero and first snapshot are valid',()=>{
 expect(detectionDelta(null,1200,5000)).toMatchObject({accepted:true,delta:1200});
 expect(detectionDelta({total:1200,uptime:5000},1200,6000)).toMatchObject({accepted:true,delta:0});
 expect(detectionDelta({total:1200,uptime:5000},2200,6000)).toMatchObject({accepted:true,delta:1000});
 expect(detectionDelta({total:1200,uptime:5000},1000,6000).accepted).toBe(false);
 expect(detectionDelta({total:1200,uptime:5000},3000,6000).accepted).toBe(false);
});
it('validates the versioned timer snapshot strictly',()=>{
 const value={schemaVersion:1,eventId:'e',deviceId:randomUUID(),bootId:'b',sequence:0,uptimeMs:5000,occurredAt:null,type:'sensor.detection_time_snapshot',data:{detected:false,totalDetectedMs:1000,counterId:'c'}};
 expect(eventSchema.safeParse(value).success).toBe(true);
 for(const bad of [{...value,schemaVersion:2},{...value,data:{...value.data,totalDetectedMs:-1}},{...value,data:{...value.data,totalDetectedMs:5001}},{...value,data:{...value.data,counterId:''}},{...value,data:{...value.data,totalDetectedMs:1.5}},{...value,data:{...value.data,extra:1}}])expect(eventSchema.safeParse(bad).success).toBe(false);
});
const suite=process.env.RUN_DB_TESTS==='1'?describe:describe.skip;
suite('timer transactions in MySQL',()=>{
 let orgId:string,deviceId:string,workstationId:string,token:string;
 const start=new Date('2026-10-14T10:00:00.000Z').getTime();
 const snapshot=(sequence:number,totalDetectedMs:number,uptimeMs=5000+sequence*1000,extra:Record<string,unknown>={})=>({schemaVersion:1,eventId:randomUUID(),deviceId,bootId:'boot-a',sequence,uptimeMs,occurredAt:new Date(start+uptimeMs).toISOString(),delivery:'buffered',type:'sensor.detection_time_snapshot',data:{detected:true,totalDetectedMs,counterId:'counter-a'},...extra});
 const total=async(version=1)=>(await db.detectionMeasurement.aggregate({where:{orgId,ruleVersion:version,accepted:true},_sum:{deltaMs:true}}))._sum.deltaMs;
 beforeEach(async()=>{orgId=(await db.organization.create({data:{name:'Timer test'}})).id;workstationId=(await db.workstation.create({data:{orgId,areaId:(await db.area.create({data:{orgId,name:'Test area',shopId:(await db.shop.create({data:{orgId,name:'Test shop'}})).id}})).id,name:'Timer station'}})).id;deviceId=(await db.device.create({data:{orgId,workstationId,name:'Timer only',capabilities:['detection_time']}})).id;token=newToken();await db.credential.create({data:{deviceId,tokenHash:hash(token)}});});
 afterEach(async()=>{await db.deviceCommand.deleteMany({where:{deviceId}});await db.detectionMeasurement.deleteMany({where:{orgId}});await db.detectionCounter.deleteMany({where:{deviceId}});await db.bootState.deleteMany({where:{deviceId}});await db.processingState.deleteMany({where:{deviceId}});await db.measurement.deleteMany({where:{orgId}});await db.rawEvent.deleteMany({where:{orgId}});await db.credential.deleteMany({where:{deviceId}});await db.device.delete({where:{id:deviceId}});await db.workstation.delete({where:{id:workstationId}});await db.area.deleteMany({where:{orgId}});await db.shop.deleteMany({where:{orgId}});await db.organization.delete({where:{id:orgId}});});
 it('recovers the first total and gaps, deduplicates concurrent retries, and produces no parts/cycles',async()=>{
  const first=snapshot(0,1000);const responses=await Promise.all(Array.from({length:8},()=>ingest(token,first)));expect(responses.filter(r=>!r.duplicate)).toHaveLength(1);
  const next=snapshot(10,9000);expect(await ingest(token,next)).toMatchObject({measurementAccepted:true});expect(await total()).toBe(9000n);
  expect(await db.rawEvent.count({where:{orgId}})).toBe(2);expect(await db.measurement.count({where:{orgId}})).toBe(0);
  await expect(ingest(token,{...snapshot(11,0),type:'sensor.state_changed',data:{detected:true}})).rejects.toMatchObject({status:422});
  await expect(ingest(token,{...snapshot(11,0),type:'cycle.completed',data:{durationMs:1000}})).rejects.toMatchObject({status:422});
 });
 it('accepts authorized calibration without counting the offset, rejects forged/reused offsets',async()=>{
  await ingest(token,snapshot(0,1000,5000));
  const command=await db.deviceCommand.create({data:{deviceId,type:'set_total_detected_ms',payload:{totalDetectedMs:60000},createdBy:'test',expiresAt:new Date(Date.now()+86400000)}});
  const calibrated=(seq:number,total:number,uptime:number,counterId='calibrated',offsetMs=60000)=>({...snapshot(seq,total,uptime),data:{detected:true,totalDetectedMs:total,counterId,calibration:{commandId:command.id,offsetMs}}});
  expect((await ingest(token,calibrated(1,60000,5000))).measurementAccepted).toBe(true);
  expect(await total()).toBe(1000n);
  expect((await ingest(token,calibrated(2,61000,6000))).measurementAccepted).toBe(true);
  expect(await total()).toBe(2000n);
  expect((await ingest(token,calibrated(3,61000,7000,'reused'))).measurementAccepted).toBe(false);
  expect((await ingest(token,calibrated(4,61000,8000,'calibrated',59000))).measurementAccepted).toBe(false);
  // Ordinary impossible resets remain rejected even with a preceding calibration.
  expect((await ingest(token,{...snapshot(5,2000,6000),data:{detected:true,totalDetectedMs:2000,counterId:'invalid-reset'}})).measurementAccepted).toBe(false);
 });
 it('flags decreases, rejects late snapshots and impossible increases without rolling back',async()=>{
  await ingest(token,snapshot(0,1000));await ingest(token,snapshot(5,5000));
  const bad=snapshot(6,4000);expect(await ingest(token,bad)).toMatchObject({measurementAccepted:false});expect(await ingest(token,bad)).toMatchObject({duplicate:true,measurementAccepted:false});
  expect(await ingest(token,snapshot(3,3000))).toMatchObject({measurementAccepted:false});
  expect(await ingest(token,snapshot(6,7000))).toMatchObject({measurementAccepted:false});
  await ingest(token,snapshot(7,6000));expect(await total()).toBe(6000n);
  expect((await db.detectionCounter.findFirstOrThrow({where:{deviceId}})).totalDetectedMs).toBe(6000n);
 });
 it('starts a new reset counter and excludes retired counters/boots and counter reuse',async()=>{
  await ingest(token,snapshot(0,1000));await ingest(token,snapshot(1,2000));
  await ingest(token,snapshot(2,200,7000,{data:{detected:false,totalDetectedMs:200,counterId:'counter-b'}}));expect(await total()).toBe(2200n);
  expect(await ingest(token,snapshot(3,2500))).toMatchObject({measurementAccepted:false});
  await ingest(token,snapshot(0,300,1000,{bootId:'boot-b',occurredAt:new Date(start+20000).toISOString(),data:{detected:true,totalDetectedMs:300,counterId:'counter-c'}}));expect(await total()).toBe(2500n);
  expect(await ingest(token,snapshot(10,3000))).toMatchObject({measurementAccepted:false});
  expect(await ingest(token,snapshot(0,100,1000,{bootId:'boot-c',occurredAt:new Date(start+30000).toISOString()}))).toMatchObject({measurementAccepted:false});
 });
 it('serializes distinct concurrent snapshots and replay is idempotent',async()=>{
  await ingest(token,snapshot(0,1000));
  await Promise.all(Array.from({length:8},(_,i)=>ingest(token,snapshot(i+1,1000+(i+1)*1000))));
  expect(await total()).toBe(9000n);await rebuild();await rebuild();expect(await total()).toBe(9000n);
  await rebuild(2);await rebuild(2);expect(await total(2)).toBe(9000n);
 });
 it('separates recoverable totals, first/unknown intervals and shift-boundary uncertainty',async()=>{
  await ingest(token,snapshot(0,1000));await ingest(token,snapshot(5,5000));
  const report=await detectionDashboard(orgId,[deviceId],workstationId,new Date(start+7000),new Date(start+20000));
  expect(report[0]).toMatchObject({recoveredTotalMs:5000,confirmedShiftMs:0,unallocatedAllTimeMs:1000,boundaryUncertainMs:4000});
  expect(report[0].snapshotFresh).toBe(false); // A fresh receipt of old buffered data is not live sensor state.
  const whole=await detectionDashboard(orgId,[deviceId],workstationId,new Date(start),new Date(start+20000));expect(whole[0].confirmedShiftMs).toBe(4000);
  await ingest(token,snapshot(6,5500,11000,{occurredAt:null}));expect(await total()).toBe(5500n);
  const unknown=await detectionDashboard(orgId,[deviceId],workstationId,new Date(start),new Date(start+20000));expect(unknown[0].unallocatedAllTimeMs).toBe(1500);
 });
 it('does not assign pre-move accumulation to the new workstation',async()=>{
  await ingest(token,snapshot(0,1000));await db.device.update({where:{id:deviceId},data:{workstationId:null}});await ingest(token,snapshot(5,5000));
  const last=await db.detectionMeasurement.findFirstOrThrow({where:{deviceId},orderBy:{id:'desc'}});expect(last.deltaMs).toBe(4000n);expect(last.workstationId).toBe(null);expect(last.intervalStart).toBe(null);
 });
 it('recovers monotonic device time despite wall-clock correction, without inventing shift timing',async()=>{
  await ingest(token,snapshot(0,1000));
  expect(await ingest(token,snapshot(5,5000,10000,{occurredAt:new Date(start).toISOString()}))).toMatchObject({measurementAccepted:true});
  expect(await total()).toBe(5000n);
  const last=await db.detectionMeasurement.findFirstOrThrow({where:{deviceId},orderBy:{id:'desc'}});expect(last.intervalStart).toBe(null);expect(last.notice).toContain('unknown clock');
 });
 it('rejects an impossible same-boot reset total',async()=>{
  await ingest(token,snapshot(0,1000));
  expect(await ingest(token,snapshot(1,5000,6000,{data:{detected:true,totalDetectedMs:5000,counterId:'new-counter'}}))).toMatchObject({measurementAccepted:false});
  expect(await total()).toBe(1000n);
 });
});
