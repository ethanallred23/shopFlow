import {expect,it} from 'vitest';
import type {FloorCabinet} from '../src/ActiveCabinets';
import {newStationBuilds} from '../src/station-build-starts';

const now=Date.parse('2026-10-30T22:30:00Z'),online=new Set(['station']);
const cabinet=(change:Partial<FloorCabinet>={}):FloorCabinet=>({id:'new',stationId:'station',number:2,status:'building',stale:false,durationMs:0,startedAt:new Date(now).toISOString(),lastReportedAt:new Date(now).toISOString(),...change});
it('celebrates a newly started cabinet once, not initial loads or periodic updates',()=>{
 expect(newStationBuilds(null,[cabinet()],online,now)).toEqual([]);
 expect(newStationBuilds(new Map([['old','completed']]),[cabinet()],online,now)).toHaveLength(1);
 expect(newStationBuilds(new Map([['new','building']]),[cabinet({durationMs:5000})],online,now+5000)).toEqual([]);
});
it('does not treat a pause, resume, connection recovery, or delayed history as a start',()=>{
 expect(newStationBuilds(new Map([['new','paused']]),[cabinet()],online,now)).toEqual([]);
 expect(newStationBuilds(new Map(),[cabinet({status:'paused'})],online,now)).toEqual([]);
 expect(newStationBuilds(new Map(),[cabinet({stale:true})],online,now)).toEqual([]);
 expect(newStationBuilds(new Map(),[cabinet()],new Set(),now)).toEqual([]);
 expect(newStationBuilds(new Map(),[cabinet({startedAt:new Date(now-120000).toISOString()})],online,now)).toEqual([]);
});
