import {describe,it,expect} from 'vitest';
import {can,dailySchedule,Envelope,eventSchema,percentile,shiftWindow,State,transition} from '../server/domain';
const event=(sequence:number,detected:boolean,uptimeMs=sequence*1000):Envelope=>({schemaVersion:1,eventId:String(sequence),deviceId:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',bootId:'boot',sequence,uptimeMs,occurredAt:null,delivery:'unknown',type:'sensor.state_changed',data:{detected}});
describe('counting rules',()=>{
 it('uses initial HIGH as baseline, requires LOW and does not count repeated HIGH',()=>{let s:State|undefined;let count=0;for(const [i,x] of [true,true,false,true,true,false,true].entries()){const r=transition(s,event(i,x),500);s=r.next;count+=r.count;}expect(count).toBe(2);});
 it('does not count a duplicate sequence or late LOW',()=>{let s=transition(undefined,event(0,false),500).next;const r=transition(s,event(1,true),500);expect(r.count).toBe(1);expect(transition(r.next,event(1,true),500).count).toBe(0);expect(transition(r.next,event(0,false),500).next.detected).toBe(true);});
 it('starts a reboot with a fresh baseline and excludes a retired boot',()=>{expect(transition(undefined,event(0,true),500).count).toBe(0);expect(transition(undefined,event(0,false),500,true).notice).toContain('out-of-order');});
 it('re-baselines sequence gaps to avoid inventing edges',()=>{const s=transition(undefined,event(0,false),500).next;expect(transition(s,event(3,true),500).count).toBe(0);});
 it('enforces minimum interval and consumes rejected edges',()=>{let s=transition(undefined,event(0,false),500).next;s=transition(s,event(1,true,1000),500).next;s=transition(s,event(2,false,1100),500).next;const r=transition(s,event(3,true,1200),500);expect(r.count).toBe(0);expect(transition(r.next,event(4,true,2000),500).count).toBe(0);});
 it('does not equate measured cycles with counts',()=>{const r=transition(undefined,{...event(0,false),type:'cycle.completed',data:{durationMs:12345}},500);expect(r.durationMs).toBe(12345);expect(r.count).toBe(0);});
 it('validates ranges and rejects unsupported envelopes',()=>{expect(eventSchema.safeParse({...event(0,false),sequence:-1}).success).toBe(false);expect(eventSchema.safeParse({...event(0,false),organizationId:'attacker'}).success).toBe(false);expect(eventSchema.safeParse({...event(0,false),type:'cycle.completed',data:{durationMs:0}}).success).toBe(false);});
});
describe('scheduled time',()=>{
 const shift={startMinute:22*60,endMinute:6*60,breaks:[{start:120,end:150}]};
 it('crosses midnight and excludes breaks',()=>{const w=shiftWindow('2026-10-14','America/Denver',shift,new Date('2026-10-15T06:15:00Z'));expect(w.workingMs).toBe(7.5*3600000);expect(w.elapsedMs).toBe(2*3600000);});
 it('clamps before and after shift',()=>{expect(shiftWindow('2026-10-14','UTC',shift,new Date('2026-10-14T20:00:00Z')).elapsedMs).toBe(0);expect(shiftWindow('2026-10-14','UTC',shift,new Date('2026-10-16T00:00:00Z')).elapsedMs).toBe(7.5*3600000);});
 it('uses actual elapsed time across daylight saving boundaries',()=>{const w=shiftWindow('2026-11-01','America/Denver',{startMinute:0,endMinute:240,breaks:[]});expect(w.workingMs).toBe(5*3600000);});
 it('prorates overnight targets across calendar days',()=>{const w=dailySchedule('2026-10-14','UTC',[{startMinute:1320,endMinute:360,breaks:[]}],new Date('2026-10-14T03:00:00Z'));expect(w.targetFactor).toBe(1);expect(w.expectedFactor).toBe(3/8);});
});
it('role hierarchy and unknown roles fail closed',()=>{expect(can('viewer','supervisor')).toBe(false);expect(can('supervisor','admin')).toBe(false);expect(can('admin','supervisor')).toBe(true);expect(can('bogus','viewer')).toBe(false);});
it('unavailable cycles are null, percentiles use nearest rank',()=>{expect(percentile([],.5)).toBe(null);expect(percentile([10,20,30,40,50],.9)).toBe(50);});
