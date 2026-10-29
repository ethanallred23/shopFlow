import {beforeEach,it,expect,vi} from 'vitest';
const {tx}=vi.hoisted(()=>({tx:{$queryRaw:vi.fn(),user:{findFirst:vi.fn(),update:vi.fn(),updateMany:vi.fn()},area:{findFirst:vi.fn()},workstation:{findFirst:vi.fn()},operatorAssignment:{updateMany:vi.fn(),create:vi.fn()}}}));
vi.mock('../server/db',()=>({db:{$transaction:async(fn:any)=>fn(tx)}}));
import {changePerson} from '../server/operators';
beforeEach(()=>{vi.resetAllMocks();tx.user.findFirst.mockResolvedValue({id:'person',orgId:'org',name:'Ethan',areaId:'assembly',workstationId:'old'});tx.workstation.findFirst.mockResolvedValue({id:'new',areaId:'assembly'});tx.area.findFirst.mockResolvedValue({id:'another'});});
it('replaces the target operator atomically and preserves old assignments as closed history',async()=>{
 await changePerson('org','person',{workstationId:'new'});
 expect(tx.$queryRaw).toHaveBeenCalledOnce();
 expect(tx.operatorAssignment.updateMany).toHaveBeenCalledWith({where:{orgId:'org',userId:'person',endedAt:null},data:{endedAt:expect.any(Date)}});
 expect(tx.operatorAssignment.updateMany).toHaveBeenCalledWith({where:{orgId:'org',workstationId:'new',endedAt:null},data:{endedAt:expect.any(Date)}});
 expect(tx.user.updateMany).toHaveBeenCalledWith({where:{orgId:'org',workstationId:'new',id:{not:'person'}},data:{workstationId:null}});
 expect(tx.user.updateMany.mock.invocationCallOrder[0]).toBeLessThan(tx.user.update.mock.invocationCallOrder[0]);
 expect(tx.operatorAssignment.create).toHaveBeenCalledWith({data:{orgId:'org',workstationId:'new',userId:'person',operatorName:'Ethan',startedAt:expect.any(Date)}});
});
it('clears the old station when changing department, and avoids duplicate history on an unchanged station',async()=>{
 await changePerson('org','person',{areaId:'another'});
 expect(tx.user.update).toHaveBeenCalledWith({where:{id:'person'},data:{areaId:'another',workstationId:null}});
 expect(tx.operatorAssignment.create).not.toHaveBeenCalled();
 vi.clearAllMocks();await changePerson('org','person',{workstationId:'old'});
 expect(tx.operatorAssignment.create).not.toHaveBeenCalled();expect(tx.operatorAssignment.updateMany).not.toHaveBeenCalled();
});
it('rejects another department, another organization user, and a stale unassignment',async()=>{
 tx.workstation.findFirst.mockResolvedValue({id:'new',areaId:'other'});
 await expect(changePerson('org','person',{workstationId:'new'})).rejects.toMatchObject({status:400});
 await expect(changePerson('org','person',{workstationId:null},'different')).rejects.toMatchObject({status:409});
 tx.user.findFirst.mockResolvedValue(null);await expect(changePerson('org','foreign',{workstationId:null})).rejects.toMatchObject({status:404});
 expect(tx.user.update).not.toHaveBeenCalled();
});
