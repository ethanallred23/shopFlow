import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import request from 'supertest';
import {randomUUID} from 'node:crypto';
import {db} from '../server/db';
import {hash,ingest,newToken} from '../server/ingestion';
import {rebuild} from '../server/rebuild';
process.env.NODE_ENV='test';process.env.APP_ORIGIN='http://localhost:5173';
const suite=process.env.RUN_DB_TESTS==='1'?describe:describe.skip;
suite('MySQL transactions and authenticated API',()=>{
 let orgId:string,otherOrg:string,stationId:string,deviceId:string,token:string,viewer:string,admin:string,owner:string,app:any;
 const envelope=(sequence:number,detected:boolean,bootId='first')=>({schemaVersion:1,eventId:randomUUID(),deviceId,bootId,sequence,uptimeMs:sequence*1000,occurredAt:new Date().toISOString(),type:'sensor.state_changed',data:{detected}});
 beforeAll(async()=>{
  app=(await import('../server/index')).app;
  orgId=(await db.organization.create({data:{name:'Integration test'}})).id;otherOrg=(await db.organization.create({data:{name:'Other tenant'}})).id;
  stationId=(await db.workstation.create({data:{orgId,areaId:randomUUID(),name:'Test station'}})).id;
  deviceId=(await db.device.create({data:{orgId,name:'Test sensor',workstationId:stationId,capabilities:['count','cycle']}})).id;
  token=newToken();await db.credential.create({data:{deviceId,tokenHash:hash(token)}});
  for(const role of ['viewer','admin','owner']){const u=await db.user.create({data:{orgId:role==='admin'?otherOrg:orgId,email:randomUUID()+'@test.local',name:role,role:role==='owner'?'admin':role,passwordHash:'unused'}});const st=newToken();await db.session.create({data:{id:hash(st),csrf:'test-csrf',userId:u.id,expiresAt:new Date(Date.now()+3600000)}});if(role==='viewer')viewer=st;else if(role==='owner')owner=st;else admin=st;}
 });
 afterAll(async()=>{
  if(orgId){const users=await db.user.findMany({where:{orgId:{in:[orgId,otherOrg]}}});await db.session.deleteMany({where:{userId:{in:users.map(u=>u.id)}}});await db.user.deleteMany({where:{orgId:{in:[orgId,otherOrg]}}});await db.credential.deleteMany({where:{deviceId}});await db.bootState.deleteMany({where:{deviceId}});await db.processingState.deleteMany({where:{deviceId}});await db.measurement.deleteMany({where:{orgId}});await db.rawEvent.deleteMany({where:{orgId}});await db.device.deleteMany({where:{orgId}});await db.workstation.deleteMany({where:{orgId}});await db.organization.deleteMany({where:{id:{in:[orgId,otherOrg]}}});}await db.$disconnect();
 });
 it('commits concurrent retries once and preserves repeat/out-of-order behavior',async()=>{
  await ingest(token,envelope(0,false));const high=envelope(1,true);const results=await Promise.all(Array.from({length:8},()=>ingest(token,high)));expect(results.filter(r=>!r.duplicate)).toHaveLength(1);
  await ingest(token,envelope(2,true));await ingest(token,envelope(0,false));
  expect((await db.measurement.aggregate({where:{orgId,ruleVersion:1},_sum:{count:true}}))._sum.count).toBe(1);
  await ingest(token,envelope(0,true,'restart'));await ingest(token,envelope(1,false,'restart'));await ingest(token,envelope(2,true,'restart'));await ingest(token,envelope(3,false,'first'));
  expect((await db.measurement.aggregate({where:{orgId,ruleVersion:1},_sum:{count:true}}))._sum.count).toBe(2);
  const original=await db.measurement.count({where:{orgId,ruleVersion:1}});await rebuild();await rebuild();expect(await db.measurement.count({where:{orgId,ruleVersion:1}})).toBe(original);
  // Rebuild a fresh version and resume without duplicates.
  await rebuild(2);await rebuild(2);expect((await db.measurement.aggregate({where:{orgId,ruleVersion:2},_sum:{count:true}}))._sum.count).toBe(2);
 });
 it('isolates organization reads, exports, SSE and role-protected mutations',async()=>{
  expect((await request(app).get('/api/devices/'+deviceId+'/events').set('Cookie','sf_session='+admin)).status).toBe(404);
  const dash=await request(app).get('/api/dashboard').set('Cookie','sf_session='+admin);expect(dash.status).toBe(200);expect(dash.body.stations).toEqual([]);
  const csv=await request(app).get('/api/reports.csv').set('Cookie','sf_session='+admin);expect(csv.text).not.toContain('Test station');
  expect((await request(app).post('/api/devices').set('Cookie','sf_session='+viewer).set('Origin',process.env.APP_ORIGIN!).set('X-CSRF-Token','test-csrf').send({name:'not allowed',capabilities:['count']})).status).toBe(403);
  expect((await request(app).get('/api/live')).status).toBe(401);
  expect((await request(app).post('/api/logout').set('Cookie','sf_session='+viewer).send({})).status).toBe(403);
 });
 it('snapshots assignment, preserves opaque IDs and leaves buffered unknown times unplaced',async()=>{
  const original=await db.rawEvent.findFirstOrThrow({where:{deviceId},orderBy:{id:'asc'}});
  expect((await request(app).patch('/api/devices/'+deviceId).set('Cookie','sf_session='+owner).set('Origin',process.env.APP_ORIGIN!).set('X-CSRF-Token','test-csrf').send({workstationId:null})).status).toBe(200);
  const low={...envelope(0,false,'Unknown'),eventId:'Case-ID',occurredAt:null,delivery:'buffered'};
  const high={...envelope(1,true,'Unknown'),eventId:'case-id',occurredAt:null,delivery:'buffered'};
  await ingest(token,low);await ingest(token,high);
  expect((await db.rawEvent.findUniqueOrThrow({where:{id:original.id}})).workstationId).toBe(stationId);
  const raw=await db.rawEvent.findUniqueOrThrow({where:{deviceId_eventId:{deviceId,eventId:'case-id'}}});expect(raw.workstationId).toBe(null);expect(raw.timeQuality).toBe('unknown');
  const measurement=await db.measurement.findUniqueOrThrow({where:{rawId_ruleVersion:{rawId:raw.id,ruleVersion:1}}});expect(measurement.count).toBe(1);expect(measurement.at).toBe(null);
  expect(await db.assignment.count({where:{deviceId}})).toBe(1);
  await db.assignment.deleteMany({where:{deviceId}});
 });
 it('rejects mismatched device identity, disabled and revoked credentials',async()=>{
  await expect(ingest(token,{...envelope(5,false),deviceId:randomUUID()})).rejects.toMatchObject({status:403});
  await db.device.update({where:{id:deviceId},data:{disabled:true}});await expect(ingest(token,envelope(5,false))).rejects.toMatchObject({status:401});await db.device.update({where:{id:deviceId},data:{disabled:false}});
  await db.credential.updateMany({where:{deviceId},data:{revokedAt:new Date()}});await expect(ingest(token,envelope(5,false))).rejects.toMatchObject({status:401});
 });
});
