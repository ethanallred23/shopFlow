import {db} from './db';

const QUALIFY_MS=5000;

export type CabinetProgress={
  target:number;completed:number;active:boolean;currentBuildMs:number;buildMs:number;nonBuildMs:number;
  averageBuildMs:number;remaining:number;remainingShiftMs:number;requiredMsPerCabinet:number;expected:number;onTrack:boolean;progressPct:number;timeline:Array<{at:string;actual:number;expected:number}>;
};

export async function cabinetProgress(deviceIds:string[],workstationId:string,start:Date,end:Date,target:number,workingMs:number,elapsedMs:number):Promise<CabinetProgress>{
  const empty:CabinetProgress={target,completed:0,active:false,currentBuildMs:0,buildMs:0,nonBuildMs:Math.max(0,elapsedMs),averageBuildMs:0,remaining:Math.max(0,target),remainingShiftMs:Math.max(0,workingMs-elapsedMs),requiredMsPerCabinet:0,expected:0,onTrack:true,progressPct:0,timeline:[]};
  if(!deviceIds.length||end<=start)return empty;
  const before=new Date(start.getTime()-24*60*60*1000);
  const rows=await db.rawEvent.findMany({where:{deviceId:{in:deviceIds},workstationId,type:'sensor.detection_time_snapshot',occurredAt:{gte:before,lte:end}},select:{deviceId:true,occurredAt:true,data:true},orderBy:{occurredAt:'asc'}});
  let completed=0,buildMs=0,completedBuildMs=0,currentBuildMs=0,active=false;
  const timeline:Array<{at:string;actual:number;expected:number}>=[{at:start.toISOString(),actual:0,expected:0}];
  const activeStarts=new Map<string,Date>();
  for(const row of rows){
    if(!row.occurredAt)continue;
    const detected=(row.data as any)?.detected===true;
    const previous=activeStarts.get(row.deviceId);
    if(detected){
      if(!previous)activeStarts.set(row.deviceId,new Date(Math.max(row.occurredAt.getTime(),start.getTime())));
      continue;
    }
    if(!previous)continue;
    const finish=row.occurredAt;
    const duration=Math.max(0,finish.getTime()-previous.getTime());
    if(duration>=QUALIFY_MS){
      const countedFinish=finish>=start&&finish<=end;
      if(countedFinish){completed++;buildMs+=duration;completedBuildMs+=duration;const elapsed=Math.max(0,finish.getTime()-start.getTime());timeline.push({at:finish.toISOString(),actual:completed,expected:workingMs?Math.min(target,Math.floor(target*elapsed/workingMs)):0});}
      else if(finish>start)buildMs+=duration;
    }
    activeStarts.delete(row.deviceId);
  }
  const until=Math.min(Date.now(),end.getTime());
  for(const started of activeStarts.values()){
    const duration=Math.max(0,until-started.getTime());
    if(duration>=QUALIFY_MS){active=true;currentBuildMs+=duration;buildMs+=duration;}
  }
  const safeBuild=Math.min(Math.max(0,buildMs),Math.max(0,elapsedMs));
  const nonBuildMs=Math.max(0,elapsedMs-safeBuild);
  const remaining=Math.max(0,target-completed);
  const remainingMs=Math.max(0,workingMs-elapsedMs);
  const requiredMsPerCabinet=remaining?Math.round(remainingMs/remaining):0;
  const expected=workingMs?Math.min(target,Math.floor(target*elapsedMs/workingMs)):0;
  const onTrack=completed>=expected;
  const chartAt=new Date(until);const chartElapsed=Math.max(0,until-start.getTime());timeline.push({at:chartAt.toISOString(),actual:completed,expected:workingMs?Math.min(target,Math.floor(target*chartElapsed/workingMs)):0});
  return {target,completed,active,currentBuildMs,buildMs:safeBuild,nonBuildMs,averageBuildMs:completed?Math.round(completedBuildMs/completed):0,remaining,remainingShiftMs:remainingMs,requiredMsPerCabinet,expected,onTrack,progressPct:target?Math.min(100,completed/target*100):0,timeline};
}
