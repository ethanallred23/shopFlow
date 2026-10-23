import {describe,it,expect} from 'vitest';
import {cabinetRecords,CabinetSample} from '../server/cabinet-records';
import {eventSchema} from '../server/domain';
const origin=Date.parse('2026-10-23T14:00:00Z');
const start=new Date(origin),end=new Date(origin+3600000);
const sample=(sequence:number,uptime:number,id='a',finished:number|null=null,elapsed=0,running=finished===null):CabinetSample=>({
 id:BigInt(sequence),deviceId:'device',bootId:'boot',uptimeMs:BigInt(uptime),occurredAt:new Date(origin+uptime),receivedAt:new Date(origin+uptime),
 data:{detected:finished===null,totalDetectedMs:elapsed,counterId:'counter',cabinet:{id,startedUptimeMs:id==='a'?100:2000,finishedUptimeMs:finished,elapsedMs:elapsed,running}}
});
describe('cabinet records',()=>{
 it('creates an immediate numbered record and updates it without duplicating periodic/idle snapshots',()=>{
  const first=cabinetRecords([sample(1,100)],start,end,new Date(origin+100));
  expect(first).toHaveLength(1);expect(first[0]).toMatchObject({number:1,status:'building',durationMs:0,startedAt:new Date(origin+100).toISOString()});
  const result=cabinetRecords([sample(1,100),sample(2,500,'a',null,400),sample(3,1000,'a',1000,900),sample(4,1500,'a',1000,900),sample(5,2000,'b')],start,end,new Date(origin+2000));
  expect(result).toHaveLength(2);expect(result[0]).toMatchObject({number:1,status:'completed',durationMs:900,finishedAt:new Date(origin+1000).toISOString()});
  expect(result[1]).toMatchObject({number:2,status:'building'});
 });
 it('uses device duration through pauses and counter resets, and never extrapolates offline time',()=>{
  const paused=sample(2,1000,'a',null,400,false);paused.data.counterId='reset';paused.data.totalDetectedMs=0;
  const result=cabinetRecords([sample(1,100),paused],start,end,new Date(origin+60000));
  expect(result[0]).toMatchObject({status:'paused',durationMs:400,stale:true});
 });
 it('recovers a complete cabinet from its repeated metadata even if the start snapshot is missing',()=>{
  expect(cabinetRecords([sample(4,1500,'a',1000,900)],start,end)[0]).toMatchObject({status:'completed',durationMs:900,startedAt:new Date(origin+100).toISOString()});
 });
 it('marks an unfinished build interrupted on reboot instead of completing it',()=>{
  const boot=sample(2,0);boot.bootId='new-boot';boot.occurredAt=new Date(origin+1000);boot.data={detected:false,totalDetectedMs:0,counterId:'new'};
  expect(cabinetRecords([sample(1,100),boot],start,end)[0].status).toBe('interrupted');
 });
 it('preserves actual start timestamps across a selected shift boundary and excludes older completions',()=>{
  const rows=[sample(1,100),sample(2,1000,'a',1000,900)];
  expect(cabinetRecords(rows,new Date(origin+500),end)[0].startedAt).toBe(new Date(origin+100).toISOString());
  expect(cabinetRecords(rows,new Date(origin+1100),end)).toHaveLength(0);
 });
 it('retains an unknown start clock honestly',()=>{
  const row=sample(1,100);row.occurredAt=null;
  expect(cabinetRecords([row],start,end)[0]).toMatchObject({startedAt:null,stale:true});
 });
 it('retains historical firmware records',()=>{
  const a=sample(1,100),b=sample(2,6100,'a',6100,6000);delete a.data.cabinet;delete b.data.cabinet;
  expect(cabinetRecords([a,b],start,end)[0]).toMatchObject({status:'completed',durationMs:6000});
 });
});
it('validates cabinet metadata while allowing older firmware',()=>{
 const row=sample(1,1000,'a',1000,900);
 const event={schemaVersion:1,eventId:'e',deviceId:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',bootId:'boot',sequence:1,uptimeMs:1000,occurredAt:row.occurredAt!.toISOString(),type:'sensor.detection_time_snapshot',data:row.data};
 expect(eventSchema.safeParse(event).success).toBe(true);
 for(const changes of [{elapsedMs:901},{startedUptimeMs:1001},{finishedUptimeMs:1001},{running:true},{finishedUptimeMs:null}]){
  expect(eventSchema.safeParse({...event,data:{...row.data,cabinet:{...row.data.cabinet,...changes}}}).success).toBe(false);
 }
 const {cabinet,...legacy}=row.data;expect(eventSchema.safeParse({...event,data:legacy}).success).toBe(true);
});

it('fills missing cabinet wall times when NTP becomes available after completion',()=>{
 const unknown=sample(1,1000,'a',1000,900);unknown.occurredAt=null;
 const known=sample(2,1500,'a',1000,900);
 expect(cabinetRecords([unknown,known],start,end)[0]).toMatchObject({startedAt:new Date(origin+100).toISOString(),finishedAt:new Date(origin+1000).toISOString()});
});
