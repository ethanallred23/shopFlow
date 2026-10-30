import {DateTime} from 'luxon';
import {db} from './db';

type Context={deviceId:string;orgId:string;workstationId:string|null};
type Report=(fields:Record<string,unknown>)=>void;
export const PACE_BUDGET_MS=1500;
const inFlight=new Map<string,Promise<number|undefined>>();

async function calculate(context:Context,report:Report){
  const started=performance.now();
  const [station,shifts,org]=await Promise.all([
    db.workstation.findUniqueOrThrow({where:{id:context.workstationId!}}),
    db.shift.findMany({where:{orgId:context.orgId}}),
    db.organization.findUniqueOrThrow({where:{id:context.orgId},select:{timezone:true}})
  ]);
  const localNow=DateTime.now().setZone(org.timezone);
  const shift=shifts.find(s=>{const m=localNow.hour*60+localNow.minute;return s.endMinute<=s.startMinute?m>=s.startMinute||m<s.endMinute:m>=s.startMinute&&m<s.endMinute;});
  if(!shift)return 0;
  const area=await db.area.findUniqueOrThrow({where:{id:station.areaId},select:{cabinetPaceMs:true}});
  report({stage:'pace_configuration',ms:Math.round(performance.now()-started)});
  return area.cabinetPaceMs;
}

// Pace is optional telemetry, not a prerequisite for recording liveness. A slow
// configuration lookup is shared by retries (never multiplied by each timed-out request).
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
