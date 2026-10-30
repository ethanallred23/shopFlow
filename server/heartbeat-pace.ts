import {DateTime} from 'luxon';
import {db} from './db';
import {shiftWindow} from './domain';
import {cabinetProgress} from './cabinet-progress';
import {shiftTarget,splitTarget} from './department-target';

type Context={deviceId:string;orgId:string;workstationId:string|null};
type Report=(fields:Record<string,unknown>)=>void;
export const PACE_BUDGET_MS=1500;
const inFlight=new Map<string,Promise<number|undefined>>();

async function calculate(context:Context,report:Report){
  const started=performance.now();
  const [org,station,shifts]=await Promise.all([
    db.organization.findUniqueOrThrow({where:{id:context.orgId},select:{timezone:true}}),
    db.workstation.findUniqueOrThrow({where:{id:context.workstationId!}}),
    db.shift.findMany({where:{orgId:context.orgId}})
  ]);
  report({stage:'pace_configuration',ms:Math.round(performance.now()-started)});
  const localNow=DateTime.now().setZone(org.timezone);
  const shift=shifts.find(s=>{const m=localNow.hour*60+localNow.minute;return s.endMinute<=s.startMinute?m>=s.startMinute||m<s.endMinute:m>=s.startMinute&&m<s.endMinute;});
  if(!shift)return 0;
  const date=shift.endMinute<=shift.startMinute&&localNow.hour*60+localNow.minute<shift.endMinute?localNow.minus({days:1}).toISODate()!:localNow.toISODate()!;
  const window=shiftWindow(date,org.timezone,shift);
  const [area,siblings]=await Promise.all([
    db.area.findUniqueOrThrow({where:{id:station.areaId},select:{dailyTarget:true}}),
    db.workstation.findMany({where:{areaId:station.areaId},select:{id:true}})
  ]);
  const weights=shifts.map(s=>({id:s.id,workingMs:shiftWindow(date,org.timezone,s).workingMs}));
  const goal=shiftTarget(area.dailyTarget,weights,shift.id);
  const target=splitTarget(goal,siblings.map(s=>s.id)).get(station.id)??0;
  const queryStarted=performance.now();
  const progress=await cabinetProgress([context.deviceId],station.id,window.start,window.end,target,window.workingMs,window.elapsedMs,false);
  report({stage:'pace_history',ms:Math.round(performance.now()-queryStarted),cabinets:progress.cabinets.length});
  return progress.requiredMsPerCabinet;
}

// Pace is optional telemetry, not a prerequisite for recording liveness. A slow
// calculation is shared by retries (never multiplied by each timed-out request).
// Omit an unavailable pace: firmware retains its last value, rather than treating
// a database failure as a new zero target. No cached value crosses an assignment.
export async function heartbeatPace(context:Context,report:Report):Promise<number|undefined>{
  if(!context.workstationId)return 0;
  const key=JSON.stringify([context.orgId,context.deviceId,context.workstationId]);
  let work=inFlight.get(key);
  if(!work){
    work=calculate(context,report).catch(error=>{
      report({stage:'pace_failed',code:typeof error?.code==='string'?error.code:'unknown'});
      return undefined;
    }).finally(()=>inFlight.delete(key));
    inFlight.set(key,work);
  }
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{
    return await Promise.race([work,new Promise<undefined>(resolve=>{
      timer=setTimeout(()=>{report({stage:'pace_budget_exceeded',ms:PACE_BUDGET_MS});resolve(undefined);},PACE_BUDGET_MS);
    })]);
  }finally{clearTimeout(timer);}
}
