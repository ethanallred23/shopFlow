import {DateTime} from 'luxon';
import {db} from './db';
import {HttpError,RULE_VERSION} from './ingestion';
import {dailySchedule,percentile,shiftWindow} from './domain';
import {detectionDashboard} from './detection-dashboard';
import {cabinetProgress} from './cabinet-progress';
import {Prisma} from '@prisma/client';
export async function dashboard(orgId:string,query:Record<string,any>){
  const org=await db.organization.findUniqueOrThrow({where:{id:orgId}});
  const [shops,areas,stations,shifts,devices,people]=await Promise.all([db.shop.findMany({where:{orgId}}),db.area.findMany({where:{orgId}}),db.workstation.findMany({where:{orgId}}),db.shift.findMany({where:{orgId}}),db.device.findMany({where:{orgId,archived:false}}),db.user.findMany({where:{orgId,workstationId:{not:null}},select:{id:true,name:true,workstationId:true}})]);
  const localNow=DateTime.now().setZone(org.timezone);
  const shift=shifts.find(s=>s.id===query.shift)||shifts.find(s=>{const m=localNow.hour*60+localNow.minute;return s.endMinute<=s.startMinute?m>=s.startMinute||m<s.endMinute:m>=s.startMinute&&m<s.endMinute;})||shifts[0];
  const date=query.date || (shift && shift.endMinute<=shift.startMinute && localNow.hour*60+localNow.minute<shift.endMinute?localNow.minus({days:1}):localNow).toISODate();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!DateTime.fromISO(date).isValid)throw new HttpError(400,'Invalid date');
  const daily=query.period==='day'?dailySchedule(date,org.timezone,shifts):null;
  const window=daily?{...daily,workingMs:0,elapsedMs:0}:shift?shiftWindow(date,org.timezone,shift):{start:DateTime.fromISO(date,{zone:org.timezone}).toJSDate(),end:DateTime.fromISO(date,{zone:org.timezone}).plus({days:1}).toJSDate(),workingMs:0,elapsedMs:0};
  const filtered=stations.filter(s=>(!query.area||s.areaId===query.area)&&(!query.shop||areas.find(a=>a.id===s.areaId)?.shopId===query.shop)&&(!query.workstation||s.id===query.workstation));
  const ids=filtered.map(s=>s.id);
  const where={orgId,ruleVersion:RULE_VERSION,workstationId:{in:ids},at:{gte:window.start,lt:window.end},...(query.product?{product:String(query.product)}:{})};
  // SQL aggregation keeps response size independent of event volume.
  const [grouped,cycleRows,hourly,notes,quality,unplaced,recent]=await Promise.all([
  db.measurement.groupBy({by:['workstationId'],where,_sum:{count:true},_count:{_all:true}}),
  db.measurement.findMany({where:{...where,durationMs:{not:null}},select:{workstationId:true,durationMs:true,at:true},orderBy:{at:'desc'},take:10000}),
  db.$queryRaw<{hour:Date;count:bigint}[]>`
    SELECT DATE_FORMAT(at, '%Y-%m-%d %H:00:00') as hour, SUM(count) as count FROM Measurement
    WHERE orgId=${orgId} AND ruleVersion=${RULE_VERSION} AND at >= ${window.start} AND at < ${window.end}
    AND workstationId IN (${Prisma.join(ids.length?ids:['none'])})
    ${query.product?Prisma.sql`AND product=${String(query.product)}`:Prisma.empty}
    GROUP BY hour ORDER BY hour`,
  db.note.findMany({where:{orgId,workstationId:{in:ids},createdAt:{gte:window.start,lt:window.end}},orderBy:{createdAt:'desc'},take:100}),
  db.rawEvent.count({where:{orgId,workstationId:{in:ids},receivedAt:{gte:window.start,lt:window.end},timeQuality:'unknown'}}),
  db.measurement.aggregate({where:{orgId,ruleVersion:RULE_VERSION,workstationId:{in:ids},at:null},_sum:{count:true}}),
  db.measurement.findMany({where:{orgId,ruleVersion:RULE_VERSION,workstationId:{in:ids}},orderBy:{id:'desc'},take:20})]);
  const deviceStatus=(d:typeof devices[number])=>d.disabled?'disabled':!d.lastHeartbeat?'never connected':Date.now()-d.lastHeartbeat.getTime()<90000?'online':'offline';
  const rows=await Promise.all(filtered.map(async s=>{
    const group=grouped.find(g=>g.workstationId===s.id);const ds=devices.filter(d=>d.workstationId===s.id);
    const durations=cycleRows.filter(c=>c.workstationId===s.id).map(c=>c.durationMs!);
    const count=group?group._sum.count??0:null;
    const timers=await detectionDashboard(orgId,ds.filter(d=>(d.capabilities as string[]).includes('detection_time')).map(d=>d.id),s.id,window.start,window.end);
    const timerOnly=timers.length>0&&ds.every(d=>(d.capabilities as string[]).includes('detection_time'));
    const targetValue=daily?Math.round(s.target*daily.targetFactor):s.target;
    const expectedValue=daily?Math.floor(s.target*daily.expectedFactor):window.workingMs?Math.floor(s.target*window.elapsedMs/window.workingMs):0;
    const cabinet=timerOnly?await cabinetProgress(ds.filter(d=>(d.capabilities as string[]).includes('detection_time')).map(d=>d.id),s.id,window.start,window.end,targetValue,window.workingMs,window.elapsedMs):null;
    return {...s,people:people.filter(p=>p.workstationId===s.id).map(({id,name})=>({id,name})),timerOnly,timers:timers.map(t=>({...t,connection:deviceStatus(ds.find(d=>d.id===t.deviceId)!),cabinet})),target:targetValue,count,expected:timerOnly?cabinet?.expected??0:expectedValue,cabinet,median:percentile(durations,.5),p90:percentile(durations,.9),status:ds.some(d=>deviceStatus(d)==='online')?'online':ds.length?'data unavailable':'no device',devices:ds.length};
  }));
  return {org,shops,areas,shifts,date,shiftId:shift?.id,window,stations:rows,devices:devices.map(d=>({...d,status:deviceStatus(d)})),hourly:hourly.map(h=>({hour:DateTime.fromSQL(String(h.hour),{zone:'utc'}).setZone(org.timezone).toFormat('HH:mm'),count:Number(h.count)})),cycles:cycleRows.slice(0,100).reverse().map(c=>({at:c.at,durationMs:c.durationMs})),notes,recent,quality,unplaced:unplaced._sum.count??0,cycleSampleLimited:cycleRows.length===10000};
}
