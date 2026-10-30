import {describe,expect,it} from 'vitest';
import {shiftTarget,splitTarget} from '../server/department-target';

describe('department goal allocation',()=>{
 it('allocates a daily goal across shifts and evenly across workstations',()=>{
  const shifts=[{id:'day',workingMs:8*60*60*1000},{id:'evening',workingMs:4*60*60*1000}];
  expect(shiftTarget(101,shifts,'day')).toBe(67);
  expect(shiftTarget(101,shifts,'evening')).toBe(34);
  const day=splitTarget(67,['station-c','station-a','station-b']);
  expect([...day.values()].reduce((sum,value)=>sum+value,0)).toBe(67);
  expect(day.get('station-a')).toBe(23);
  expect(day.get('station-b')).toBe(22);
  expect(day.get('station-c')).toBe(22);
 });
});
