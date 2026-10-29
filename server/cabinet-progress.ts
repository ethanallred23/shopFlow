import {db} from './db';
import {RULE_VERSION} from './ingestion';
import {cabinetRecords, CabinetRecord} from './cabinet-records';
import {attributeCabinets} from './operator-attribution';

export type CabinetProgress={
  target:number;started:number;completed:number;active:boolean;currentBuildMs:number;buildMs:number;nonBuildMs:number;
  averageBuildMs:number;remaining:number;remainingShiftMs:number;requiredMsPerCabinet:number;expected:number;onTrack:boolean;progressPct:number;
  timeline:Array<{at:string;actual:number;expected:number}>;cabinets:CabinetRecord[];
};

export async function cabinetProgress(deviceIds:string[]|null,workstationId:string,start:Date,end:Date,target:number,workingMs:number,elapsedMs:number,includeOperators=true):Promise<CabinetProgress>{
  const until=new Date(Math.min(Date.now(),end.getTime()));
  const before=new Date(start.getTime()-24*60*60*1000);
  // Separate disjoint clock branches so each can use its time-range index instead
  // of scanning a device's entire history for an OR across two timestamp columns.
  const where={...(deviceIds===null?{}:{deviceId:{in:deviceIds}}),workstationId,type:'sensor.detection_time_snapshot',
    DetectionMeasurement_rawIdRows:{some:{ruleVersion:RULE_VERSION,accepted:true}}};
  const select={id:true,deviceId:true,bootId:true,uptimeMs:true,occurredAt:true,receivedAt:true,data:true} as const;
  const rows=(deviceIds===null||deviceIds.length>0)&&until>start?(await Promise.all([
    db.rawEvent.findMany({where:{...where,occurredAt:{gte:before,lt:until}},select}),
    db.rawEvent.findMany({where:{...where,occurredAt:null,receivedAt:{gte:before,lt:until}},select})
  ])).flat().sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0):[];
  const records=cabinetRecords(rows,start,end);
  const earliest=new Date(Math.min(start.getTime(),...records.filter(c=>c.startedAt).map(c=>Date.parse(c.startedAt!))));
  const periods=includeOperators&&records.length?await db.operatorAssignment.findMany({where:{workstationId,startedAt:{lt:until},OR:[{endedAt:null},{endedAt:{gte:earliest}}]},orderBy:{startedAt:'desc'}}):[];
  const cabinets=attributeCabinets(records,periods);
  const finished=cabinets.filter(c=>c.status==='completed'&&c.finishedAt&&Date.parse(c.finishedAt)>=start.getTime()&&Date.parse(c.finishedAt)<end.getTime());
  const inProgress=cabinets.filter(c=>c.status==='building'||c.status==='paused');
  const completed=finished.length;
  // Do not extrapolate from wall time: paused/offline devices must not accrue phantom work.
  const buildMs=Math.min(Math.max(0,elapsedMs),cabinets.filter(c=>c.startedAt&&Date.parse(c.startedAt)>=start.getTime()).reduce((sum,c)=>sum+c.durationMs,0));
  const remaining=Math.max(0,target-completed),remainingShiftMs=Math.max(0,workingMs-elapsedMs);
  const expectedAt=(elapsed:number)=>workingMs?Math.min(target,Math.floor(target*elapsed/workingMs)):0;
  const expected=expectedAt(elapsedMs);
  const timeline=[{at:start.toISOString(),actual:0,expected:0},...finished.sort((a,b)=>a.finishedAt!.localeCompare(b.finishedAt!)).map((c,i)=>({at:c.finishedAt!,actual:i+1,expected:expectedAt(Math.max(0,Date.parse(c.finishedAt!)-start.getTime()))}))];
  if(until>=start)timeline.push({at:until.toISOString(),actual:completed,expected});
  return {target,started:cabinets.length,completed,active:inProgress.length>0,currentBuildMs:inProgress.reduce((sum,c)=>sum+c.durationMs,0),buildMs,nonBuildMs:Math.max(0,elapsedMs-buildMs),averageBuildMs:completed?Math.round(finished.reduce((sum,c)=>sum+c.durationMs,0)/completed):0,remaining,remainingShiftMs,requiredMsPerCabinet:remaining?Math.round(remainingShiftMs/remaining):0,expected,onTrack:completed>=expected,progressPct:target?Math.min(100,completed/target*100):0,timeline,cabinets};
}
