import {describe,expect,it} from 'vitest';
import {visibleBuildMs,visibleCurrentBuildMs} from '../src/live-build-time';

const reported=Date.parse('2026-10-29T15:00:00.000Z');
const running={durationMs:18000,status:'building',stale:false,lastReportedAt:new Date(reported).toISOString()};

describe('live build display',()=>{
 it('advances between snapshots, then uses the next confirmed duration',()=>{
  expect(visibleBuildMs(running,reported+2000)).toBe(20000);
  expect(visibleBuildMs({...running,durationMs:23000,lastReportedAt:new Date(reported+5000).toISOString()},reported+6000)).toBe(24000);
 });
 it('stops for pauses, completed builds, stale data, and after a missing update',()=>{
  expect(visibleBuildMs({...running,status:'paused'},reported+10000)).toBe(18000);
  expect(visibleBuildMs({...running,status:'completed'},reported+10000)).toBe(18000);
  expect(visibleBuildMs({...running,stale:true},reported+10000)).toBe(18000);
  expect(visibleBuildMs(running,reported+60000)).toBe(48000);
 });
 it('adds live time only for active cabinets in a shared department',()=>{
  expect(visibleCurrentBuildMs([running,{...running,durationMs:5000},{...running,status:'completed',durationMs:9000}],reported+2000)).toBe(27000);
 });
});
