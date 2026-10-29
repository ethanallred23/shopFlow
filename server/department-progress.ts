import type {CabinetProgress} from './cabinet-progress';

export type DepartmentStation={id:string;name:string;areaId:string;cabinet:CabinetProgress|null};
export function departmentProgress(stations:DepartmentStation[]):CabinetProgress|null{
 const building=stations.filter(s=>s.cabinet!==null);
 if(!building.length)return null;
 const values=building.map(s=>s.cabinet!);
 const sum=(key:'target'|'started'|'completed'|'expected'|'buildMs'|'nonBuildMs'|'currentBuildMs')=>values.reduce((n,p)=>n+p[key],0);
 const target=sum('target'),completed=sum('completed'),expected=sum('expected'),remaining=Math.max(0,target-completed);
 const remainingShiftMs=Math.max(...values.map(p=>p.remainingShiftMs));
 const cabinets=building.flatMap(s=>s.cabinet!.cabinets.map(c=>({...c,stationId:s.id,stationName:s.name})))
  .sort((a,b)=>Date.parse(a.startedAt??a.lastReportedAt)-Date.parse(b.startedAt??b.lastReportedAt)||a.id.localeCompare(b.id)).map((c,i)=>({...c,number:i+1}));
 const times=[...new Set(values.flatMap(p=>p.timeline.map(t=>t.at)))].sort();
 const timeline=times.map(at=>{
  let actual=0,expected=0;
  for(const p of values){
   const before=p.timeline.filter(t=>t.at<=at).at(-1),after=p.timeline.find(t=>t.at>at);
   actual+=before?.actual??0;
   // Actual output is a step function; interpolate only the planned pace.
   expected+=before?after?before.expected+(after.expected-before.expected)*(Date.parse(at)-Date.parse(before.at))/(Date.parse(after.at)-Date.parse(before.at)):before.expected:0;
  }
  return {at,actual,expected:Math.floor(expected)};
 });
 return {target,completed,expected,started:sum('started'),remaining,remainingShiftMs,
  averageBuildMs:completed?Math.round(values.reduce((n,p)=>n+p.averageBuildMs*p.completed,0)/completed):0,
  requiredMsPerCabinet:remaining?Math.round(remainingShiftMs/remaining):0,
  active:values.some(p=>p.active),currentBuildMs:sum('currentBuildMs'),buildMs:sum('buildMs'),nonBuildMs:sum('nonBuildMs'),
  onTrack:completed>=expected,progressPct:target?Math.min(100,completed/target*100):0,timeline,cabinets};
}
