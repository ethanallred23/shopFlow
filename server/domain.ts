import {z} from 'zod';
import {DateTime} from 'luxon';
const base = z.object({schemaVersion:z.literal(1),eventId:z.string().min(1).max(100),deviceId:z.string().uuid(),bootId:z.string().min(1).max(100),sequence:z.number().int().min(0).max(2147483647),uptimeMs:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),occurredAt:z.string().datetime().nullable(),delivery:z.enum(['live','buffered','unknown']).default('unknown')}).strict();
export const eventSchema=z.discriminatedUnion('type',[
  base.extend({type:z.literal('sensor.state_changed'),data:z.object({detected:z.boolean()}).strict()}),
  base.extend({type:z.literal('cycle.completed'),data:z.object({durationMs:z.number().int().min(1).max(86400000)}).strict()})
]);
export type Envelope=z.infer<typeof eventSchema>;
export interface State {sequence:number;detected:boolean|null;lastCountUptime:number|null;lastUptime:number}
export function transition(state:State|undefined,e:Envelope,minInterval:number,retired=false){
  let next:State=state?{...state}:{sequence:-1,detected:null,lastCountUptime:null,lastUptime:0};
  if(retired || e.sequence<=next.sequence || e.uptimeMs<next.lastUptime) return {next,count:0,durationMs:null,notice:'out-of-order: excluded'};
  const gap=next.sequence>=0 && e.sequence>next.sequence+1;
  if(gap) next.detected=null;
  let count=0; let notice:string|null=gap?'sequence gap: state re-baselined':null;
  if(e.type==='sensor.state_changed'){
    if(next.detected===false && e.data.detected){
      if(next.lastCountUptime===null || e.uptimeMs-next.lastCountUptime>=minInterval){count=1;next.lastCountUptime=e.uptimeMs;}
      else notice='transition below minimum interval';
    }
    if(next.detected===null && !gap) notice='baseline: no part counted';
    next.detected=e.data.detected;
  }
  next.sequence=e.sequence;next.lastUptime=e.uptimeMs;
  return {next,count,durationMs:e.type==='cycle.completed'?e.data.durationMs:null,notice};
}
export interface Schedule {startMinute:number;endMinute:number;breaks:unknown}
export function shiftWindow(date:string,zone:string,s:Schedule,now=new Date()){
  const day=DateTime.fromISO(date,{zone}).startOf('day');
  const start=day.set({hour:Math.floor(s.startMinute/60),minute:s.startMinute%60});
  const endDay=s.endMinute<=s.startMinute?day.plus({days:1}):day;
  const end=endDay.set({hour:Math.floor(s.endMinute/60),minute:s.endMinute%60});
  const pauses=(s.breaks as {start:number;end:number}[]).map(b=>({start:start.plus({minutes:b.start}).toMillis(),end:Math.min(end.toMillis(),start.plus({minutes:b.end}).toMillis())}));
  const working=(until:number)=>Math.max(0,Math.min(until,end.toMillis())-start.toMillis()-pauses.reduce((n,b)=>n+Math.max(0,Math.min(until,b.end)-Math.max(start.toMillis(),b.start)),0));
  return {start:start.toJSDate(),end:end.toJSDate(),workingMs:working(end.toMillis()),elapsedMs:working(now.getTime())};
}
export function percentile(xs:number[],p:number){if(!xs.length)return null;const a=[...xs].sort((a,b)=>a-b);return a[Math.max(0,Math.ceil(a.length*p)-1)];}
export function dailySchedule(date:string,zone:string,shifts:Schedule[],now=new Date()){
  const day=DateTime.fromISO(date,{zone}).startOf('day');const start=day.toJSDate(),end=day.plus({days:1}).toJSDate();
  let targetFactor=0,expectedFactor=0;
  for(const dayOffset of [-1,0])for(const shift of shifts){
    const w=shiftWindow(day.plus({days:dayOffset}).toISODate()!,zone,shift,now);
    const workingUntil=(until:Date)=>shiftWindow(day.plus({days:dayOffset}).toISODate()!,zone,shift,until).elapsedMs;
    if(w.workingMs){
      targetFactor+=(workingUntil(end)-workingUntil(start))/w.workingMs;
      expectedFactor+=(workingUntil(new Date(Math.max(start.getTime(),Math.min(end.getTime(),now.getTime()))))-workingUntil(start))/w.workingMs;
    }
  }
  return {start,end,targetFactor,expectedFactor};
}
export function can(role:string,required:'viewer'|'supervisor'|'admin'){return ['viewer','supervisor','admin'].indexOf(role)>=['viewer','supervisor','admin'].indexOf(required);}
