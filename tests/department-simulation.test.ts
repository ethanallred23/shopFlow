import {expect,it} from 'vitest';
import {departmentSimulation} from '../src/department-simulation';

const start=Date.parse('2026-10-30T21:00:00Z');
it('provides four sample stations with consistent health, totals, log, and outlook',()=>{
 const sample=departmentSimulation(start,start);
 expect(sample.stations).toHaveLength(4);
 expect(sample.stations.map(station=>station.cabinet.averageBuildMs)).toEqual([24000,36000,50000,90000]);
 expect(sample.stations.every(station=>station.cabinet.desiredPaceMs===60000)).toBe(true);
 expect(sample.progress.completed).toBe(sample.stations.reduce((sum,station)=>sum+station.cabinet.completed,0));
 expect(sample.progress.cabinets.filter(cabinet=>cabinet.status==='completed')).toHaveLength(sample.progress.completed);
 expect(sample.progress.cabinets.map(cabinet=>cabinet.number)).toEqual(sample.progress.cabinets.map((_,index)=>index+1));
 expect(sample.progress.timeline.at(-1)).toMatchObject({expected:sample.progress.target,projected:sample.progress.projectedTotal});
 expect(sample.progress.timeline.at(-1)).not.toHaveProperty('actual');
 expect(sample.progress.cabinets.every(cabinet=>cabinet.id.startsWith('presentation-'))).toBe(true);
});
it('finishes the active cabinet once and starts the next with a new stable identity',()=>{
 const before=departmentSimulation(start,start).stations[0].cabinet;
 const active=before.cabinets.at(-1)!;
 expect(active.status).toBe('building');
 const done=departmentSimulation(start,start+2500).stations[0].cabinet;
 expect(done.completed).toBe(before.completed+1);
 expect(done.cabinets.find(cabinet=>cabinet.id===active.id)).toMatchObject({status:'completed',durationMs:24000});
 const next=departmentSimulation(start,start+7500).stations[0].cabinet;
 expect(next.completed).toBe(done.completed);
 expect(next.cabinets.at(-1)).toMatchObject({status:'building'});
 expect(next.cabinets.at(-1)!.id).not.toBe(active.id);
 expect(departmentSimulation(start,start+8500).stations[0].cabinet.cabinets.at(-1)!.id).toBe(next.cabinets.at(-1)!.id);
});
it('holds measured time during pauses and resumes without counting paused time',()=>{
 const paused=departmentSimulation(start,start+18000).stations[0].cabinet.cabinets.at(-1)!;
 const later=departmentSimulation(start,start+21000).stations[0].cabinet.cabinets.at(-1)!;
 expect(paused.status).toBe('paused');expect(later.status).toBe('paused');
 expect(paused.durationMs).toBe(later.durationMs);
 const resumed=departmentSimulation(start,start+24000).stations[0].cabinet.cabinets.at(-1)!;
 expect(resumed.id).toBe(paused.id);expect(resumed.status).toBe('building');
 expect(resumed.durationMs-paused.durationMs).toBe(200);
});
