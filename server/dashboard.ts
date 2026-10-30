import {DateTime} from 'luxon';
import {db} from './db';
import {HttpError,RULE_VERSION} from './ingestion';
import {dailySchedule,percentile,shiftWindow} from './domain';
import {detectionDashboard} from './detection-dashboard';
import {cabinetProgress} from './cabinet-progress';
import {Prisma} from '@prisma/client';
import {departmentProgress} from './department-progress';
import {shiftTarget,splitTarget} from './department-target';
import {paceTarget} from './cabinet-pace';
import {scheduledShift} from './shift-schedule';
export async function dashboard(orgId:string,query:Record<string,any>){
  const org=await db.organization.findUniqueOrThrow({where:{id:orgId}});
  const [shops,areas,stations,shifts,devices,people]=await Promise.all([db.shop.findMany({where:{orgId}}),db.area.findMany({where:{orgId}}),db.workstation.findMany({where:{orgId}}),db.shift.findMany({where:{orgId}}),db.device.findMany({where:{orgId,archived:false}}),db.user.findMany({where:{orgId,workstationId:{not:null}},select:{id:true,name:true,workstationId:true}})]);
  const localNow=DateTime.now().setZone(org.timezone);
  const today=localNow.toISODate()!;
  const requestedDate=query.date||today;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)||!DateTime.fromISO(requestedDate).isValid)throw new HttpError(400,'Invalid date');
  const previousRequestedDate=DateTime.fromISO(requestedDate).minus({days:1}).toISODate()!;
  const overrides=await db.shiftDaySchedule.findMany({where:{orgId,date:{in:[requestedDate,previousRequestedDate]}}});
  const current=query.shift?null:[requestedDate,previousRequestedDate].flatMap(day=>shifts.map(shift=>({shift,day}))).find(({shift,day})=>{
    const window=shiftWindow(day,org.timezone,scheduledShift(shift,day,overrides));
    return new Date()>=window.start&&new Date()<window.end;
  });
  const shift=shifts.find(s=>s.id===query.shift)||current?.shift||shifts[0];
  const date=query.date||current?.day||today;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!DateTime.fromISO(date).isValid)throw new HttpError(400,'Invalid date');
  const previousDate=DateTime.fromISO(date).minus({days:1}).toISODate()!;
  if(previousDate!==previousRequestedDate){
    overrides.push(...await db.shiftDaySchedule.findMany({where:{orgId,date:previousDate}}));
  }
  const effective=(day:string,s:typeof shifts[number])=>scheduledShift(s,day,overrides);
  const effectiveShifts=shifts.map(s=>effective(date,s));
  const daily=query.period==='day'?dailySchedule(date,org.timezone,shifts,new Date(),(day,s)=>effective(day,s as typeof shifts[number])):null;
  const window=daily?daily:shift?shiftWindow(date,org.timezone,effective(date,shift)):{start:DateTime.fromISO(date,{zone:org.timezone}).toJSDate(),end:DateTime.fromISO(date,{zone:org.timezone}).plus({days:1}).toJSDate(),workingMs:0,elapsedMs:0,workingAt:(_at:Date)=>0,breakPoints:[] as Date[]};
  const shiftWeights=effectiveShifts.map(s=>({id:s.id,workingMs:shiftWindow(date,org.timezone,s).workingMs}));
  const stationTargets=new Map<string,number>();
  for(const area of areas){
    const goal=daily||!shift?area.dailyTarget:shiftTarget(area.dailyTarget,shiftWeights,shift.id);
    for(const [id,value] of splitTarget(goal,stations.filter(s=>s.areaId===area.id).map(s=>s.id)))stationTargets.set(id,value);
  }
  const filtered=stations.filter(s=>(!query.area||s.areaId===query.area)&&(!query.shop||areas.find(a=>a.id===s.areaId)?.shopId===query.shop)&&(!query.workstation||s.id===query.workstation));
  const ids=filtered.map(s=>s.id);
  const timerHistory=await db.rawEvent.groupBy({by:['workstationId'],where:{orgId,workstationId:{in:ids},type:'sensor.detection_time_snapshot'}});
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
    const timerOnly=(timers.length>0||timerHistory.some(h=>h.workstationId===s.id))&&ds.every(d=>(d.capabilities as string[]).includes('detection_time'));
    const area=areas.find(a=>a.id===s.areaId)!;
    const targetValue=timerOnly?paceTarget(window.workingMs,area.cabinetPaceMs):stationTargets.get(s.id)??0;
    const expectedValue=window.workingMs?Math.floor(targetValue*window.elapsedMs/window.workingMs):0;
    const cabinet=timerOnly?await cabinetProgress(null,s.id,window.start,window.end,targetValue,window.workingMs,window.elapsedMs,true,{paceMs:area.cabinetPaceMs,workingAt:window.workingAt,breakPoints:window.breakPoints}):null;
    return {...s,people:people.filter(p=>p.workstationId===s.id).map(({id,name})=>({id,name})),timerOnly,timers:timers.map(t=>({...t,connection:deviceStatus(ds.find(d=>d.id===t.deviceId)!),cabinet})),target:targetValue,count,expected:timerOnly?cabinet?.expected??0:expectedValue,cabinet,median:percentile(durations,.5),p90:percentile(durations,.9),status:ds.some(d=>deviceStatus(d)==='online')?'online':ds.length?'data unavailable':'no device',devices:ds.length};
  }));
  const departments=areas.filter(a=>!query.shop||a.shopId===query.shop).map(a=>({...a,cabinet:departmentProgress(rows.filter(s=>s.areaId===a.id)),stationCount:rows.filter(s=>s.areaId===a.id).length}));
  const simulationStation=process.env.NODE_ENV==='development'&&process.env.LOCAL_CABINET_SIMULATION==='1'&&org.demo?stations.find(s=>s.job==='LOCAL-CABINET-SIMULATION'):undefined;
  const localSimulation=simulationStation?{departmentId:simulationStation.areaId,running:devices.some(d=>d.firmware==='LOCAL-CABINET-SIMULATION'&&deviceStatus(d)==='online')}:undefined;
  return {org,...(localSimulation?{localSimulation}:{}),shops,areas,departments,workstations:stations.map(({id,name,areaId})=>({id,name,areaId})),shifts:effectiveShifts,baseShifts:shifts,shiftOverrides:overrides.filter(o=>o.date===date),date,shiftId:shift?.id,window,stations:rows,devices:devices.map(d=>({...d,status:deviceStatus(d)})),hourly:hourly.map(h=>({hour:DateTime.fromSQL(String(h.hour),{zone:'utc'}).setZone(org.timezone).toFormat('HH:mm'),count:Number(h.count)})),cycles:cycleRows.slice(0,100).reverse().map(c=>({at:c.at,durationMs:c.durationMs})),notes,recent,quality,unplaced:unplaced._sum.count??0,cycleSampleLimited:cycleRows.length===10000};
}
