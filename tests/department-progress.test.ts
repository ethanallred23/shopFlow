import {it,expect} from 'vitest';
import {departmentProgress} from '../server/department-progress';
import type {CabinetProgress} from '../server/cabinet-progress';
const at=(minute:number)=>new Date(Date.UTC(2026,9,29,14,minute)).toISOString();
const progress=(completed:number,averageBuildMs:number):CabinetProgress=>({target:10,started:completed,completed,active:false,currentBuildMs:0,buildMs:completed*averageBuildMs,nonBuildMs:1000,averageBuildMs,remaining:10-completed,remainingShiftMs:3600000,requiredMsPerCabinet:0,expected:3,onTrack:completed>=3,progressPct:completed*10,timeline:[{at:at(0),actual:0,expected:0},{at:at(10),actual:completed,expected:3}],cabinets:[]});
it('combines independent stations, weights average build time, and keeps one shift clock',()=>{
 const result=departmentProgress([{id:'a',name:'Station A',areaId:'dept',cabinet:progress(4,1000)},{id:'b',name:'Station B',areaId:'dept',cabinet:progress(2,4000)}])!;
 expect(result).toMatchObject({target:20,completed:6,expected:6,averageBuildMs:2000,remainingShiftMs:3600000,remaining:14,nonBuildMs:2000,onTrack:true,progressPct:30});
 expect(result.timeline.at(-1)).toEqual({at:at(10),actual:6,expected:6});
});
it('uses step changes for completions and includes station labels in the combined log',()=>{
 const a=progress(1,1000),b=progress(1,1000);
 a.timeline=[{at:at(0),actual:0,expected:0},{at:at(5),actual:1,expected:1},{at:at(10),actual:1,expected:3}];
 a.cabinets=[{id:'same-device-key-a',number:1,deviceId:'a',startedAt:at(1),finishedAt:at(5),durationMs:1000,status:'completed',lastReportedAt:at(5),stale:false}];
 b.cabinets=[{...a.cabinets[0],id:'same-device-key-b',deviceId:'b',startedAt:at(2),finishedAt:at(10)}];
 const result=departmentProgress([{id:'a',name:'Station A',areaId:'dept',cabinet:a},{id:'b',name:'Station B',areaId:'dept',cabinet:b}])!;
 expect(result.timeline.find(t=>t.at===at(5))?.actual).toBe(1);
 expect(result.cabinets.map(c=>[c.number,c.stationName])).toEqual([[1,'Station A'],[2,'Station B']]);
 expect(departmentProgress([])).toBeNull();
});
