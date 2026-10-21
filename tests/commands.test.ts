import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import request from 'supertest';
import {randomUUID} from 'node:crypto';
import {db} from '../server/db';
import {hash,newToken} from '../server/ingestion';
process.env.NODE_ENV='test';process.env.APP_ORIGIN='http://localhost:5173';
const suite=process.env.RUN_DB_TESTS==='1'?describe:describe.skip;
suite('Timer command lifecycle',()=>{
 let orgId:string,deviceId:string,userId:string,token:string,cookie:string,app:any;
 const browser=()=>request(app);
 const create=(type:string,totalDetectedMs?:number)=>browser().post(`/api/devices/${deviceId}/commands`).set('Cookie',cookie).set('Origin',process.env.APP_ORIGIN!).set('X-CSRF-Token','commands-test').send({type,...(totalDetectedMs===undefined?{}:{totalDetectedMs})});
 const poll=()=>browser().get('/api/v1/commands').auth(token,{type:'bearer'});
 const ack=(id:string,status='applied')=>browser().post(`/api/v1/commands/${id}/ack`).auth(token,{type:'bearer'}).send({status,...(status==='rejected'?{error:'Safety check failed'}:{result:{totalDetectedMs:0}})});
 const status=(id:string)=>browser().get(`/api/devices/${deviceId}/commands/${id}`).set('Cookie',cookie);
 beforeAll(async()=>{
  app=(await import('../server/index')).app;
  orgId=(await db.organization.create({data:{name:'Command lifecycle test'}})).id;
  deviceId=(await db.device.create({data:{orgId,name:'Test timer',capabilities:['detection_time']}})).id;
  token=newToken();await db.credential.create({data:{deviceId,tokenHash:hash(token)}});
  userId=(await db.user.create({data:{orgId,email:randomUUID()+'@test.local',name:'Test',role:'admin',passwordHash:'unused'}})).id;
  const session=newToken();cookie='sf_session='+session;
  await db.session.create({data:{id:hash(session),userId,csrf:'commands-test',expiresAt:new Date(Date.now()+3600000)}});
 });
 afterAll(async()=>{
  if(deviceId){await db.deviceCommand.deleteMany({where:{deviceId}});await db.credential.deleteMany({where:{deviceId}});await db.device.delete({where:{id:deviceId}});}
  if(userId){await db.session.deleteMany({where:{userId}});await db.user.delete({where:{id:userId}});}
  if(orgId)await db.organization.delete({where:{id:orgId}});
  await db.$disconnect();
 });
 it.each(['pause','resume','reset','set_total_detected_ms'])('queues, delivers and acknowledges %s',async type=>{
  const queued=await create(type,type==='set_total_detected_ms'?60000:undefined);expect(queued.status).toBe(201);expect(queued.body.status).toBe('pending');
  const delivered=await poll();expect(delivered.status).toBe(200);
  const command=delivered.body.commands.find((c:any)=>c.id===queued.body.id);
  expect(Object.keys(command).sort()).toEqual(['createdAt','expiresAt','id','payload','type']);
  expect(command.payload).toEqual(type==='set_total_detected_ms'?{totalDetectedMs:60000}:{});
  expect((await ack(command.id)).body).toEqual({ok:true,duplicate:false,status:'applied'});
  expect((await status(command.id)).body.status).toBe('applied');
  expect((await poll()).body.commands).toEqual([]);
  expect((await ack(command.id)).body.duplicate).toBe(true);
  expect((await ack(command.id,'rejected')).status).toBe(409);
 });
 it('preserves pending delivery across disconnection and rejects once',async()=>{
  const {body}=await create('reset');
  expect((await poll()).body.commands[0].id).toBe(body.id);
  expect((await poll()).body.commands[0].id).toBe(body.id);
  expect((await ack(body.id,'rejected')).status).toBe(200);
  expect((await status(body.id)).body.error).toBe('Safety check failed');
  expect((await ack(body.id,'rejected')).body.duplicate).toBe(true);
 });
 it('expires undelivered commands and accepts late execution reports',async()=>{
  const {body}=await create('pause');
  await db.deviceCommand.update({where:{id:body.id},data:{expiresAt:new Date(Date.now()-1000)}});
  expect((await status(body.id)).body.status).toBe('expired');
  expect((await poll()).body.commands).toEqual([]);
  expect((await ack(body.id)).body.status).toBe('applied');
  expect((await status(body.id)).body.status).toBe('applied');
 });
 it('rejects invalid payloads, unknown IDs and missing credentials',async()=>{
  expect((await create('set_total_detected_ms')).status).toBe(400);
  expect((await create('set_total_detected_ms',-1)).status).toBe(400);
  expect((await ack(randomUUID())).status).toBe(404);
  expect((await browser().get('/api/v1/commands')).status).toBe(401);
 });
});
