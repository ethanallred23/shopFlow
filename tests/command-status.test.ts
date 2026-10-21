import {describe,it,expect,vi} from 'vitest';
import {acknowledgeCommand,expireCommands} from '../server/commands';
const transaction=(status:string|null)=>({deviceCommand:{findFirst:vi.fn().mockResolvedValue(status?{id:'command',status}:null),update:vi.fn().mockResolvedValue({}),updateMany:vi.fn().mockResolvedValue({count:1})}});
describe('command status transitions',()=>{
 it.each(['pending','expired'])('records delayed execution from %s',async status=>{
  const tx=transaction(status);expect(await acknowledgeCommand(tx as any,'device','command',{status:'applied'})).toEqual({ok:true,duplicate:false,status:'applied'});
  expect(tx.deviceCommand.update).toHaveBeenCalledOnce();
 });
 it.each(['applied','rejected'] as const)('never overwrites duplicate %s results',async status=>{
  const tx=transaction(status);expect((await acknowledgeCommand(tx as any,'device','command',{status})).duplicate).toBe(true);expect(tx.deviceCommand.update).not.toHaveBeenCalled();
  await expect(acknowledgeCommand(tx as any,'device','command',{status:status==='applied'?'rejected':'applied'})).rejects.toMatchObject({status:409});
 });
 it('rejects unknown or another device command',async()=>{await expect(acknowledgeCommand(transaction(null) as any,'device','other',{status:'applied'})).rejects.toMatchObject({status:404});});
 it('expires only overdue pending commands',async()=>{
  const tx=transaction('pending');await expireCommands(tx as any,'device');
  expect(tx.deviceCommand.updateMany).toHaveBeenCalledWith({where:{deviceId:'device',status:'pending',expiresAt:{lte:expect.any(Date)}},data:{status:'expired'}});
 });
});
