import {beforeAll,beforeEach,it,expect,vi} from 'vitest';
import request from 'supertest';

const mocks=vi.hoisted(()=>({session:vi.fn(),user:vi.fn(),person:vi.fn(),people:vi.fn(),station:vi.fn(),area:vi.fn(),update:vi.fn()}));
vi.mock('../server/db',()=>({db:{session:{findUnique:mocks.session},user:{findUnique:mocks.user,findFirst:mocks.person,findMany:mocks.people,updateMany:mocks.update},workstation:{findFirst:mocks.station},area:{findFirst:mocks.area}}}));
let app:any;
const stationId='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const areaId='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
beforeAll(async()=>{process.env.NODE_ENV='test';process.env.APP_ORIGIN='http://localhost:5173';app=(await import('../server/index')).app;});
beforeEach(()=>{
 vi.resetAllMocks();
 mocks.session.mockResolvedValue({userId:'admin',csrf:'csrf',expiresAt:new Date(Date.now()+60000)});
 mocks.user.mockResolvedValue({id:'admin',orgId:'org',role:'admin',name:'Admin',email:'admin@example.com'});
 mocks.station.mockResolvedValue({id:stationId,orgId:'org',areaId});
 mocks.person.mockResolvedValue({areaId,workstationId:null});
 mocks.area.mockResolvedValue({id:areaId,orgId:'org'});
 mocks.people.mockResolvedValue([]);
 mocks.update.mockResolvedValue({count:1});
});
const patch=(id='person')=>request(app).patch('/api/settings/users/'+id).set('Cookie','sf_session=token').set('Origin','http://localhost:5173').set('X-CSRF-Token','csrf');
it('assigns and unassigns users in the administrator organization',async()=>{
 expect((await patch().send({workstationId:stationId})).status).toBe(200);
 expect(mocks.station).toHaveBeenCalledWith({where:{id:stationId,orgId:'org'}});
 expect(mocks.update).toHaveBeenCalledWith({where:{id:'person',orgId:'org',areaId,workstationId:null},data:{workstationId:stationId}});
 expect((await patch('admin').send({workstationId:null})).status).toBe(200);
});
it('moves a user to another department and clears their former workstation',async()=>{
 const newArea='cccccccc-cccc-4ccc-cccc-cccccccccccc';
 mocks.person.mockResolvedValue({areaId,workstationId:stationId});
 expect((await patch().send({areaId:newArea})).status).toBe(200);
 expect(mocks.update).toHaveBeenCalledWith({where:{id:'person',orgId:'org',areaId,workstationId:stationId},data:{areaId:newArea,workstationId:null}});
});
it('rejects a workstation outside the user department',async()=>{
 mocks.station.mockResolvedValue({id:stationId,orgId:'org',areaId:'other'});
 expect((await patch().send({workstationId:stationId})).status).toBe(400);
 expect(mocks.update).not.toHaveBeenCalled();
});
it('lets supervisors assign only department users and unassign only from that station',async()=>{
 mocks.user.mockResolvedValue({id:'supervisor',orgId:'org',role:'supervisor',name:'Supervisor',email:'supervisor@example.com'});
 const assign=(assigned:boolean)=>request(app).put(`/api/workstations/${stationId}/people/person`).set('Cookie','sf_session=token').set('Origin','http://localhost:5173').set('X-CSRF-Token','csrf').send({assigned});
 expect((await assign(true)).status).toBe(200);
 expect(mocks.update).toHaveBeenCalledWith({where:{id:'person',orgId:'org',areaId},data:{workstationId:stationId}});
 expect((await assign(false)).status).toBe(200);
 expect(mocks.update).toHaveBeenCalledWith({where:{id:'person',orgId:'org',areaId,workstationId:stationId},data:{workstationId:null}});
 mocks.update.mockResolvedValue({count:0});
 expect((await assign(true)).status).toBe(409);
});
it('limits the workstation roster to its department and organization',async()=>{
 mocks.user.mockResolvedValue({id:'supervisor',orgId:'org',role:'supervisor',name:'Supervisor',email:'supervisor@example.com'});
 const response=await request(app).get(`/api/workstations/${stationId}/people`).set('Cookie','sf_session=token');
 expect(response.status).toBe(200);
 expect(mocks.people).toHaveBeenCalledWith({where:{orgId:'org',areaId},select:{id:true,name:true,workstationId:true},orderBy:{name:'asc'}});
});
it('rejects another organization station and users without admin access',async()=>{
 mocks.station.mockResolvedValue(null);
 expect((await patch().send({workstationId:stationId})).status).toBe(404);
 expect(mocks.update).not.toHaveBeenCalled();
 mocks.user.mockResolvedValue({id:'viewer',orgId:'org',role:'viewer',name:'Viewer',email:'viewer@example.com'});
 expect((await patch().send({workstationId:null})).status).toBe(403);
});
it('continues to prevent administrators changing their own role',async()=>{
 expect((await patch('admin').send({role:'viewer'})).status).toBe(400);
 expect(mocks.update).not.toHaveBeenCalled();
});
