import {afterEach,beforeEach,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({org:vi.fn(),station:vi.fn(),siblings:vi.fn(),area:vi.fn(),shifts:vi.fn(),progress:vi.fn()}));
vi.mock('../server/db',()=>({db:{organization:{findUniqueOrThrow:mocks.org},workstation:{findUniqueOrThrow:mocks.station,findMany:mocks.siblings},area:{findUniqueOrThrow:mocks.area},shift:{findMany:mocks.shifts}}}));
vi.mock('../server/cabinet-progress',()=>({cabinetProgress:mocks.progress}));
import {heartbeatPace,PACE_BUDGET_MS} from '../server/heartbeat-pace';
const context={deviceId:'device',orgId:'org',workstationId:'station'};
beforeEach(()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-28T16:00:00Z'));
 vi.resetAllMocks();
 mocks.org.mockResolvedValue({timezone:'America/Denver'});
 mocks.station.mockResolvedValue({id:'station',areaId:'department'});
 mocks.siblings.mockResolvedValue([{id:'station'}]);
 mocks.area.mockResolvedValue({dailyTarget:10});
 mocks.shifts.mockResolvedValue([{id:'day',startMinute:480,endMinute:960,breaks:[]}]);
 mocks.progress.mockResolvedValue({requiredMsPerCabinet:12345,cabinets:[]});
});
afterEach(()=>vi.useRealTimers());
it('preserves shift and pace calculations and records configuration/history timing',async()=>{
 const report=vi.fn();
 expect(await heartbeatPace(context,report)).toBe(12345);
 expect(mocks.progress).toHaveBeenCalledWith(['device'],'station',new Date('2026-10-28T14:00:00Z'),new Date('2026-10-28T22:00:00Z'),10,28800000,7200000,false);
 expect(mocks.area).toHaveBeenCalledWith({where:{id:'department'},select:{dailyTarget:true}});
 expect(report.mock.calls.map(c=>c[0].stage)).toEqual(['pace_configuration','pace_history']);
});
it('returns zero without history work outside a shift or without an assignment',async()=>{
 expect(await heartbeatPace({...context,workstationId:null},vi.fn())).toBe(0);
 mocks.shifts.mockResolvedValue([]);
 expect(await heartbeatPace(context,vi.fn())).toBe(0);
 expect(mocks.progress).not.toHaveBeenCalled();
});
it('bounds slow pace work, shares outstanding work across retries, and recovers',async()=>{
 let finish!:(value:unknown)=>void;
 mocks.progress.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 const report=vi.fn();
 const first=heartbeatPace(context,report);
 await vi.advanceTimersByTimeAsync(PACE_BUDGET_MS);
 expect(await first).toBeUndefined();
 const retry=heartbeatPace(context,report);
 await vi.advanceTimersByTimeAsync(PACE_BUDGET_MS);
 expect(await retry).toBeUndefined();
 expect(mocks.progress).toHaveBeenCalledTimes(1);
 finish({requiredMsPerCabinet:900,cabinets:[]});
 await vi.advanceTimersByTimeAsync(0);
 expect(await heartbeatPace(context,report)).toBe(12345);
 expect(mocks.progress).toHaveBeenCalledTimes(2);
});
it('omits unavailable pace on query failure instead of resetting it to zero',async()=>{
 mocks.progress.mockRejectedValueOnce({code:'P2024',message:'private connection detail'});
 const report=vi.fn();
 expect(await heartbeatPace(context,report)).toBeUndefined();
 expect(report).toHaveBeenCalledWith({stage:'pace_failed',code:'P2024'});
 expect(JSON.stringify(report.mock.calls)).not.toContain('private connection detail');
 expect(await heartbeatPace(context,report)).toBe(12345);
});
