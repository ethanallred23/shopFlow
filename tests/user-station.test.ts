import {beforeAll,beforeEach,it,expect,vi} from 'vitest';
import request from 'supertest';
const mocks=vi.hoisted(()=>({session:vi.fn(),user:vi.fn(),people:vi.fn(),station:vi.fn(),change:vi.fn()}));
vi.mock('../server/db',()=>({db:{session:{findUnique:mocks.session},user:{findUnique:mocks.user,findMany:mocks.people},workstation:{findFirst:mocks.station}}}));
vi.mock('../server/operators',()=>({changePerson:mocks.change}));
let app:any;
const stationId='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',areaId='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
beforeAll(async()=>{process.env.NODE_ENV='test';process.env.APP_ORIGIN='http://localhost:5173';app=(await import('../server/index')).app;});
beforeEach(()=>{
 vi.resetAllMocks();mocks.session.mockResolvedValue({userId:'admin',csrf:'csrf',expiresAt:new Date(Date.now()+60000)});
 mocks.user.mockResolvedValue({id:'admin',orgId:'org',role:'admin',name:'Admin',email:'admin@example.com'});
 mocks.station.mockResolvedValue({id:stationId,orgId:'org',areaId});mocks.people.mockResolvedValue([]);mocks.change.mockResolvedValue({ok:true});
});
const patch=(id='person')=>request(app).patch('/api/settings/users/'+id).set('Cookie','sf_session=token').set('Origin','http://localhost:5173').set('X-CSRF-Token','csrf');
const assign=(assigned:boolean)=>request(app).put(`/api/workstations/${stationId}/people/person`).set('Cookie','sf_session=token').set('Origin','http://localhost:5173').set('X-CSRF-Token','csrf').send({assigned});
it('routes administrator profile changes through operator history',async()=>{
 expect((await patch().send({areaId:null})).status).toBe(200);
 expect(mocks.change).toHaveBeenCalledWith('org','person',{areaId:null});
});
it('lets supervisors replace an operator and requires the source station on removal',async()=>{
 mocks.user.mockResolvedValue({id:'supervisor',orgId:'org',role:'supervisor'});
 expect((await assign(true)).status).toBe(200);expect(mocks.change).toHaveBeenCalledWith('org','person',{workstationId:stationId},undefined);
 expect((await assign(false)).status).toBe(200);expect(mocks.change).toHaveBeenCalledWith('org','person',{workstationId:null},stationId);
});
it('limits the roster to its department and organization',async()=>{
 const response=await request(app).get(`/api/workstations/${stationId}/people`).set('Cookie','sf_session=token');
 expect(response.status).toBe(200);expect(mocks.people).toHaveBeenCalledWith({where:{orgId:'org',areaId},select:{id:true,name:true,workstationId:true},orderBy:{name:'asc'}});
});
it('blocks cross-organization stations, viewers, and self role changes',async()=>{
 mocks.station.mockResolvedValue(null);expect((await assign(true)).status).toBe(404);expect(mocks.change).not.toHaveBeenCalled();
 mocks.user.mockResolvedValue({id:'viewer',orgId:'org',role:'viewer'});expect((await assign(true)).status).toBe(403);
 mocks.user.mockResolvedValue({id:'admin',orgId:'org',role:'admin'});expect((await patch('admin').send({role:'viewer'})).status).toBe(400);
});
