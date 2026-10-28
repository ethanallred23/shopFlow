import {beforeAll,beforeEach,it,expect,vi} from 'vitest';
import request from 'supertest';
const mocks=vi.hoisted(()=>({authorize:vi.fn(),update:vi.fn(),pace:vi.fn()}));
vi.mock('../server/db',()=>({db:{$transaction:async(fn:any)=>fn({device:{update:mocks.update}})}}));
vi.mock('../server/ingestion',async importOriginal=>({...await importOriginal<any>(),authorizeDevice:mocks.authorize}));
vi.mock('../server/heartbeat-pace',()=>({heartbeatPace:mocks.pace}));
let app:any;
const deviceId='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
beforeAll(async()=>{process.env.NODE_ENV='test';app=(await import('../server/index')).app;});
beforeEach(()=>{
 vi.resetAllMocks();
 mocks.authorize.mockResolvedValue({id:deviceId,orgId:'org',workstationId:'station'});
 mocks.update.mockResolvedValue({});mocks.pace.mockResolvedValue(12000);
});
const heartbeat=()=>request(app).post('/api/v1/heartbeat').auth('test-token',{type:'bearer'}).send({deviceId,firmware:'test'});
it('commits the heartbeat before calculating pace and returns the existing response contract',async()=>{
 mocks.pace.mockImplementation(async()=>{expect(mocks.update).toHaveBeenCalledOnce();return 12000;});
 const response=await heartbeat();
 expect(response.status).toBe(200);expect(response.body).toEqual({ok:true,paceNeededMs:12000});
 expect(mocks.update).toHaveBeenCalledWith({where:{id:deviceId},data:{lastHeartbeat:expect.any(Date),firmware:'test'}});
});
it('acknowledges liveness without a fabricated pace when the pace budget expires',async()=>{
 mocks.pace.mockResolvedValue(undefined);
 const response=await heartbeat();
 expect(response.status).toBe(200);expect(response.body).toEqual({ok:true});
});
it('still rejects mismatched device IDs before updating liveness or calculating pace',async()=>{
 mocks.authorize.mockResolvedValue({id:'another-device'});
 expect((await heartbeat()).status).toBe(403);
 expect(mocks.update).not.toHaveBeenCalled();expect(mocks.pace).not.toHaveBeenCalled();
});
it('does not disguise database commit failures as successful heartbeats',async()=>{
 mocks.update.mockRejectedValue({code:'P2024'});
 expect((await heartbeat()).status).toBe(500);
 expect(mocks.pace).not.toHaveBeenCalled();
});
