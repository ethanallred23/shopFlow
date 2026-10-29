import {beforeAll,beforeEach,it,expect,vi} from 'vitest';
import request from 'supertest';

const mocks=vi.hoisted(()=>({session:vi.fn(),user:vi.fn(),station:vi.fn(),update:vi.fn()}));
vi.mock('../server/db',()=>({db:{session:{findUnique:mocks.session},user:{findUnique:mocks.user,updateMany:mocks.update},workstation:{findFirst:mocks.station}}}));
let app:any;
const stationId='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
beforeAll(async()=>{process.env.NODE_ENV='test';process.env.APP_ORIGIN='http://localhost:5173';app=(await import('../server/index')).app;});
beforeEach(()=>{
 vi.resetAllMocks();
 mocks.session.mockResolvedValue({userId:'admin',csrf:'csrf',expiresAt:new Date(Date.now()+60000)});
 mocks.user.mockResolvedValue({id:'admin',orgId:'org',role:'admin',name:'Admin',email:'admin@example.com'});
 mocks.station.mockResolvedValue({id:stationId,orgId:'org'});
 mocks.update.mockResolvedValue({count:1});
});
const patch=(id='person')=>request(app).patch('/api/settings/users/'+id).set('Cookie','sf_session=token').set('Origin','http://localhost:5173').set('X-CSRF-Token','csrf');
it('assigns and unassigns users in the administrator organization',async()=>{
 expect((await patch().send({workstationId:stationId})).status).toBe(200);
 expect(mocks.station).toHaveBeenCalledWith({where:{id:stationId,orgId:'org'}});
 expect(mocks.update).toHaveBeenCalledWith({where:{id:'person',orgId:'org'},data:{workstationId:stationId}});
 expect((await patch('admin').send({workstationId:null})).status).toBe(200);
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
