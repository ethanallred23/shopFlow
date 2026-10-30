import {describe,expect,it} from 'vitest';
import {dailySchedule,shiftWindow} from '../server/domain';
import {paceProjection,paceTarget,expectedAtPace} from '../server/cabinet-pace';
import {scheduledShift} from '../server/shift-schedule';

describe('desired cabinet pace',()=>{
 it('converts working time to a cabinet count and projects output from actual output',()=>{
  expect(paceTarget(7*60*60*1000,10*60*1000)).toBe(42);
  expect(expectedAtPace(2*60*60*1000,10*60*1000)).toBe(12);
  expect(paceProjection(8,7*60*60*1000,2*60*60*1000)).toBe(28);
  expect(paceProjection(0,7*60*60*1000,2*60*60*1000)).toBe(0);
  expect(paceProjection(0,7*60*60*1000,0)).toBeNull();
 });
 it('excludes a lunch break from expected pace and the end-of-day total',()=>{
  const shift={id:'day',startMinute:480,endMinute:960,breaks:[{start:240,end:300,label:'Lunch'}]};
  const window=shiftWindow('2026-10-28','America/Denver',shift,new Date('2026-10-28T19:30:00Z'));
  expect(window.workingMs).toBe(7*60*60*1000);
  expect(window.elapsedMs).toBe(4.5*60*60*1000);
  expect(expectedAtPace(window.elapsedMs,10*60*1000)).toBe(27);
  expect(window.workingAt(new Date('2026-10-28T18:30:00Z'))).toBe(4*60*60*1000);
 });
 it('uses a one-day override without changing the daily shift',()=>{
  const base={id:'day',startMinute:480,endMinute:960,breaks:[]};
  const overrides=[{shiftId:'day',date:'2026-10-28',startMinute:540,endMinute:900,breaks:[{start:180,end:210}]}];
  expect(scheduledShift(base,'2026-10-28',overrides).startMinute).toBe(540);
  expect(scheduledShift(base,'2026-10-29',overrides)).toBe(base);
  const day=dailySchedule('2026-10-28','America/Denver',[base],new Date('2026-10-28T19:00:00Z'),(date,shift)=>scheduledShift({...shift,id:'day'},date,overrides));
  expect(day.workingMs).toBe(5.5*60*60*1000);
  expect(day.elapsedMs).toBe(3.5*60*60*1000);
 });
});
