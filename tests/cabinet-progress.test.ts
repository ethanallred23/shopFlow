import {it,expect,vi} from 'vitest';
const {findMany}=vi.hoisted(()=>({findMany:vi.fn()}));
vi.mock('../server/db',()=>({db:{rawEvent:{findMany},operatorAssignment:{findMany:vi.fn().mockResolvedValue([])}}}));
import {cabinetProgress} from '../server/cabinet-progress';
it('queries accepted snapshots and counts a short finished cabinet separately from an immediate start',async()=>{
 const base=Date.parse('2026-10-23T14:00:00Z');
 const row=(id:number,uptime:number,cabinetId:string,begin:number,finish:number|null,elapsed:number)=>({id:BigInt(id),deviceId:'d',bootId:'b',uptimeMs:BigInt(uptime),occurredAt:new Date(base+uptime),receivedAt:new Date(base+uptime),data:{detected:finish===null,cabinet:{id:cabinetId,startedUptimeMs:begin,finishedUptimeMs:finish,elapsedMs:elapsed,running:finish===null}}});
 findMany.mockResolvedValueOnce([row(1,100,'one',100,null,0),row(2,1000,'one',100,1000,900),row(3,1100,'two',1100,null,0)]).mockResolvedValueOnce([]);
 const result=await cabinetProgress(['d'],'station',new Date(base),new Date(base+3600000),10,3600000,2000);
 expect(result).toMatchObject({started:2,completed:1,active:true,currentBuildMs:0,averageBuildMs:900,remaining:9});
 expect(findMany.mock.calls[0][0].where.DetectionMeasurement_rawIdRows).toEqual({some:{ruleVersion:1,accepted:true}});
 expect(result.cabinets).toHaveLength(2);
 expect(findMany).toHaveBeenCalledTimes(2);
 expect(findMany.mock.calls[0][0].where).not.toHaveProperty('OR');
 expect(findMany.mock.calls[1][0].where).toMatchObject({occurredAt:null,receivedAt:{gte:expect.any(Date),lt:expect.any(Date)}});
});
