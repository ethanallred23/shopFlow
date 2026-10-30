import {cabinetSimulationFrame} from '../server/cabinet-simulation-frame';
import {departmentProgress} from '../server/department-progress';
import type {CabinetProgress} from '../server/cabinet-progress';
import type {CabinetRecord} from '../server/cabinet-records';

const paceMs=60000,shiftMs=8*60*60*1000,historyMs=15*60*1000;
const profiles=[
 {operator:'Alex',buildMs:24000,pauseMs:6000,idleMs:5000,offset:3000},
 {operator:'Sam',buildMs:36000,pauseMs:8000,idleMs:6000,offset:19000},
 {operator:'Jordan',buildMs:50000,pauseMs:10000,idleMs:5000,offset:29000},
 {operator:'Taylor',buildMs:90000,pauseMs:8000,idleMs:6000,offset:18000},
];

// Presentation data only: no API calls, credentials, or device events. Stable IDs
// let the regular station UI animate starts/completions as the sample clock moves.
export function departmentSimulation(sessionStartedAt:number,nowMs:number){
 const startMs=sessionStartedAt-historyMs,endMs=startMs+shiftMs;
 const now=Math.max(sessionStartedAt,Math.min(nowMs,endMs)),elapsedMs=now-startMs;
 const iso=(ms:number)=>new Date(ms).toISOString();
 const stations=profiles.map((profile,index)=>{
  const id=`presentation-${sessionStartedAt}-station-${index+1}`,name=`Demo build station ${index+1}`;
  const operatorId=id+'-operator',operatorName=profile.operator+' (simulated)';
  const origin=startMs-profile.offset,cycleMs=profile.buildMs+profile.pauseMs+profile.idleMs;
  const frame=cabinetSimulationFrame(now-origin,profile);
  const cabinets:CabinetRecord[]=[];
  for(let cycle=0;cycle<=frame.cycle;cycle++){
   const finished=cycle<frame.cycle||frame.status==='completed';
   const startedAt=origin+cycle*cycleMs,finishedAt=finished?startedAt+profile.buildMs+profile.pauseMs:null;
   cabinets.push({id:id+'-cabinet-'+cycle,deviceId:id+'-device',stationId:id,stationName:name,number:cycle+1,
    startedAt:iso(startedAt),finishedAt:finishedAt===null?null:iso(finishedAt),
    durationMs:finished?profile.buildMs:frame.activeMs,status:finished?'completed':frame.status==='paused'?'paused':'building',
    lastReportedAt:iso(finishedAt??now),stale:false,operatorId,operatorName,
    completedById:finished?operatorId:null,completedByName:finished?operatorName:null});
  }
  const finished=cabinets.filter(cabinet=>cabinet.status==='completed'),completed=finished.length;
  const target=Math.floor(shiftMs/paceMs),expected=Math.floor(elapsedMs/paceMs);
  const projectedTotal=Math.floor(completed*shiftMs/elapsedMs),remaining=Math.max(0,target-completed);
  const times=[...new Set([startMs,now,endMs,...finished.map(cabinet=>Date.parse(cabinet.finishedAt!))])].sort((a,b)=>a-b);
  const progress:CabinetProgress={
   target,started:cabinets.length,completed,expected,remaining,remainingShiftMs:endMs-now,
   averageBuildMs:completed?profile.buildMs:0,requiredMsPerCabinet:paceMs,desiredPaceMs:paceMs,
   active:frame.status!=='completed',currentBuildMs:frame.status==='completed'?0:frame.activeMs,
   buildMs:Math.min(elapsedMs,frame.totalMs),nonBuildMs:Math.max(0,elapsedMs-frame.totalMs),
   onTrack:completed>=expected,progressPct:Math.min(100,completed/target*100),projectedTotal,shiftEndAt:iso(endMs),cabinets,
   timeline:times.map(at=>({at:iso(at),expected:Math.floor((at-startMs)/paceMs),
    ...(at<=now?{actual:finished.filter(cabinet=>Date.parse(cabinet.finishedAt!)<=at).length}:{}),
    ...(at===now?{projected:completed}:at===endMs?{projected:projectedTotal}:{})})),
  };
  return {id,name,areaId:'presentation',timerOnly:true,status:'online',devices:1,people:[{id:operatorId,name:operatorName}],
   target,expected,count:completed,cabinet:progress};
 });
 return {paceMs,stations,progress:departmentProgress(stations)!};
}
