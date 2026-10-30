import {afterEach,beforeEach,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({org:vi.fn(),station:vi.fn(),area:vi.fn(),shifts:vi.fn(),overrides:vi.fn()}));
vi.mock('../server/db',()=>({db:{organization:{findUniqueOrThrow:mocks.org},workstation:{findUniqueOrThrow:mocks.station},area:{findUniqueOrThrow:mocks.area},shift:{findMany:mocks.shifts},shiftDaySchedule:{findMany:mocks.overrides}}}));
import {heartbeatPace,PACE_BUDGET_MS} from '../server/heartbeat-pace';
const context={deviceId:'device',orgId:'org',workstationId:'station'};
beforeEach(()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-28T16:00:00Z'));
 vi.resetAllMocks();
 mocks.org.mockResolvedValue({timezone:'America/Denver'});
 mocks.station.mockResolvedValue({id:'station',areaId:'department'});
 mocks.area.mockResolvedValue({cabinetPaceMs:600000});
 mocks.shifts.mockResolvedValue([{id:'day',startMinute:480,endMinute:960,breaks:[]}]);
 mocks.overrides.mockResolvedValue([]);
});
afterEach(()=>vi.useRealTimers());
it('returns the department pace during the configured shift',async()=>{
 const report=vi.fn();
 expect(await heartbeatPace(context,report)).toBe(600000);
 expect(mocks.area).toHaveBeenCalledWith({where:{id:'department'},select:{cabinetPaceMs:true}});
 expect(report.mock.calls.map(c=>c[0].stage)).toEqual(['pace_configuration']);
});
it('honors a one-day shift override',async()=>{
 mocks.overrides.mockResolvedValue([{shiftId:'day',date:'2026-10-28',startMinute:660,endMinute:1080,breaks:[]}]);
 expect(await heartbeatPace(context,vi.fn())).toBe(0);
 vi.setSystemTime(new Date('2026-10-28T17:00:00Z'));
 expect(await heartbeatPace(context,vi.fn())).toBe(600000);
});
it('returns zero outside a shift or without an assignment',async()=>{
 expect(await heartbeatPace({...context,workstationId:null},vi.fn())).toBe(0);
 mocks.shifts.mockResolvedValue([]);
 expect(await heartbeatPace(context,vi.fn())).toBe(0);
 expect(mocks.area).not.toHaveBeenCalled();
});
it('bounds slow configuration work and shares outstanding work across retries',async()=>{
 let finish!:(value:unknown)=>void;
 mocks.area.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 const report=vi.fn();
 const first=heartbeatPace(context,report);
 await vi.advanceTimersByTimeAsync(PACE_BUDGET_MS);
 expect(await first).toBeUndefined();
 const retry=heartbeatPace(context,report);
 await vi.advanceTimersByTimeAsync(PACE_BUDGET_MS);
 expect(await retry).toBeUndefined();
 expect(mocks.area).toHaveBeenCalledTimes(1);
 finish({cabinetPaceMs:600000});
 await vi.advanceTimersByTimeAsync(0);
 expect(await heartbeatPace(context,report)).toBe(600000);
 expect(mocks.area).toHaveBeenCalledTimes(2);
});
it('omits unavailable pace on query failure instead of resetting it to zero',async()=>{
 mocks.area.mockRejectedValueOnce({code:'P2024',message:'private connection detail'});
 const report=vi.fn();
 expect(await heartbeatPace(context,report)).toBeUndefined();
 expect(report).toHaveBeenCalledWith({stage:'pace_failed',code:'P2024'});
 expect(JSON.stringify(report.mock.calls)).not.toContain('private connection detail');
 expect(await heartbeatPace(context,report)).toBe(600000);
});
