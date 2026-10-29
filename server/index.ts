import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import pino from 'pino';
import {z} from 'zod';
import {DateTime} from 'luxon';
import {EventEmitter} from 'node:events';
import {resolve} from 'node:path';
import {db} from './db';
import {authorizeDevice,hash,HttpError,ingest,newToken} from './ingestion';
import {asyncRoute,auth,owned,role} from './auth';
import {dashboard} from './dashboard';
import {cabinetProgress} from './cabinet-progress';
import {heartbeatPace} from './heartbeat-pace';
import {expireCommands,acknowledgeCommand} from './commands';
import {changePerson} from './operators';
export const app=express();
const log=pino(); const updates=new EventEmitter();updates.setMaxListeners(1000);
app.disable('x-powered-by');
// Production terminates HTTPS at a same-host reverse proxy. Trust only local
// proxy addresses so an external client cannot supply its own rate-limit IP.
app.set('trust proxy','loopback');
app.use(helmet());app.use(express.json({limit:'16kb'}));
app.set('json replacer',(_key:string,value:unknown)=>typeof value==='bigint'?value.toString():value);
app.use((req,res,next)=>{
  const start=performance.now();
  res.on('finish',()=>log.info({method:req.method,path:req.path,status:res.statusCode,ms:Math.round(performance.now()-start)},'request'));
  res.on('close',()=>{if(!res.writableFinished)log.warn({method:req.method,path:req.path,ms:Math.round(performance.now()-start)},'request disconnected before response');});
  next();
});
app.use('/api',rateLimit({windowMs:60000,limit:600,standardHeaders:'draft-7',legacyHeaders:false}));
const cookie={httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict' as const,path:'/',maxAge:8*3600000};
app.post('/api/login',rateLimit({windowMs:900000,limit:20}),asyncRoute(async(req,res)=>{
  if(req.headers.origin!==process.env.APP_ORIGIN)throw new HttpError(403,'Invalid request origin');
  const {email,password}=z.object({email:z.string().email(),password:z.string().min(1).max(128)}).parse(req.body);
  const user=await db.user.findUnique({where:{email:email.toLowerCase()}});
  if(!user||!await bcrypt.compare(password,user.passwordHash))throw new HttpError(401,'Email or password is incorrect');
  const token=newToken();const csrf=newToken();
  await db.session.create({data:{id:hash(token),userId:user.id,csrf,expiresAt:new Date(Date.now()+cookie.maxAge)}});
  res.cookie('sf_session',token,cookie).json({ok:true});
}));
const bearer=(req:express.Request)=>{const value=req.headers.authorization;if(!value?.startsWith('Bearer ')||value.length>200)throw new HttpError(401,'Device token required');return value.slice(7);};
app.post('/api/v1/events',asyncRoute(async(req,res)=>{const result=await ingest(bearer(req),req.body);if(result.refresh)updates.emit(result.orgId);const {orgId,refresh,...ack}=result;res.json(ack);}));
app.post('/api/v1/heartbeat',asyncRoute(async(req,res)=>{
  const body=z.object({deviceId:z.string().uuid(),firmware:z.string().max(100).optional()}).strict().parse(req.body);
  const started=performance.now();
  const report=(fields:Record<string,unknown>)=>log.info({deviceId:body.deviceId,...fields},'heartbeat timing');
  const result=await db.$transaction(async tx=>{
    const authStarted=performance.now();
    const d=await authorizeDevice(tx,bearer(req));
    report({stage:'authorize',ms:Math.round(performance.now()-authStarted)});
    if(body.deviceId!==d.id)throw new HttpError(403,'Device mismatch');
    const reconnected=!d.lastHeartbeat||Date.now()-d.lastHeartbeat.getTime()>=90000;
    await tx.device.update({where:{id:d.id},data:{lastHeartbeat:new Date(),firmware:body.firmware}});
    return {orgId:d.orgId,workstationId:d.workstationId,reconnected};
  });
  report({stage:'heartbeat_commit',ms:Math.round(performance.now()-started)});
  const paceNeededMs=await heartbeatPace({deviceId:body.deviceId,...result},report);
  if(result.reconnected)updates.emit(result.orgId);
  res.json({ok:true,...(paceNeededMs===undefined?{}:{paceNeededMs})});
  report({stage:'response',ms:Math.round(performance.now()-started),paceAvailable:paceNeededMs!==undefined});
}));
app.get('/api/v1/commands',asyncRoute(async(req,res)=>{
  const commands=await db.$transaction(async tx=>{
    const d=await authorizeDevice(tx,bearer(req));
    await expireCommands(tx,d.id);
    return tx.deviceCommand.findMany({where:{deviceId:d.id,status:'pending',expiresAt:{gt:new Date()}},take:10,select:{id:true,type:true,payload:true,createdAt:true,expiresAt:true}});
  });
  res.json({commands});
}));
app.post('/api/v1/commands/:id/ack',asyncRoute(async(req,res)=>{
  const body=z.object({status:z.enum(['applied','rejected']),result:z.record(z.unknown()).optional(),error:z.string().max(500).optional()}).strict().parse(req.body);
  const updated=await db.$transaction(async tx=>{const d=await authorizeDevice(tx,bearer(req));const result=await acknowledgeCommand(tx,d.id,req.params.id,body);return {orgId:d.orgId,result};});
  updates.emit(updated.orgId);res.json(updated.result);
}));
app.use('/api',auth);
app.get('/api/me',(req,res)=>res.json({user:{id:req.auth!.id,name:req.auth!.name,email:req.auth!.email,role:req.auth!.role},csrf:req.csrf}));
app.post('/api/logout',asyncRoute(async(req,res)=>{await db.session.delete({where:{id:req.sessionId}});res.clearCookie('sf_session',{path:'/'}).json({ok:true});}));
app.get('/api/dashboard',asyncRoute(async(req,res)=>res.json(await dashboard(req.auth!.orgId,req.query))));
app.get('/api/live',asyncRoute(async(req,res)=>{
  res.set({'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});res.flushHeaders();
  const send=()=>res.write('event: refresh\ndata: {}\n\n');send();updates.on(req.auth!.orgId,send);
  const interval=setInterval(async()=>{try{const session=await db.session.findUnique({where:{id:req.sessionId}});const user=await db.user.findUnique({where:{id:req.auth!.id}});if(!session||session.expiresAt<new Date()||user?.orgId!==req.auth!.orgId)res.end();else res.write(': keepalive\n\n');}catch{res.end();}},15000);
  const expiry=setTimeout(()=>res.end(),30*60000);
  req.on('close',()=>{updates.off(req.auth!.orgId,send);clearInterval(interval);clearTimeout(expiry);});
}));
app.post('/api/devices',role('admin'),asyncRoute(async(req,res)=>{
  const data=z.object({name:z.string().min(1).max(100),capabilities:z.array(z.enum(['count','cycle','detection_time'])).min(1).refine(c=>!c.includes('detection_time')||c.length===1,'Detection time must be timer-only')}).parse(req.body);
  const token=newToken();const device=await db.$transaction(async tx=>{const d=await tx.device.create({data:{...data,orgId:req.auth!.orgId}});await tx.credential.create({data:{deviceId:d.id,tokenHash:hash(token)}});return d;});
  res.status(201).json({device,token});
}));
app.patch('/api/devices/:id',role('admin'),asyncRoute(async(req,res)=>{
  const data=z.object({name:z.string().min(1).max(100).optional(),disabled:z.boolean().optional(),archived:z.boolean().optional(),workstationId:z.string().uuid().nullable().optional()}).strict().parse(req.body);
  await owned('device',req.params.id,req.auth!.orgId);
  if(data.workstationId)await owned('workstation',data.workstationId,req.auth!.orgId);
  await db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM Device WHERE id=${req.params.id} FOR UPDATE`;if(data.workstationId!==undefined){await tx.assignment.updateMany({where:{deviceId:req.params.id,endedAt:null},data:{endedAt:new Date()}});await tx.assignment.create({data:{deviceId:req.params.id,workstationId:data.workstationId}});}await tx.device.update({where:{id:req.params.id},data});});
  updates.emit(req.auth!.orgId);res.json({ok:true});
}));
app.post('/api/devices/:id/credentials',role('admin'),asyncRoute(async(req,res)=>{
  const {action}=z.object({action:z.enum(['rotate','revoke'])}).parse(req.body);await owned('device',req.params.id,req.auth!.orgId);const token=action==='rotate'?newToken():null;
  await db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM Device WHERE id=${req.params.id} FOR UPDATE`;await tx.credential.updateMany({where:{deviceId:req.params.id,revokedAt:null},data:{revokedAt:new Date()}});if(token)await tx.credential.create({data:{deviceId:req.params.id,tokenHash:hash(token)}});});res.json({token});
}));
app.post('/api/devices/:id/commands',role('supervisor'),asyncRoute(async(req,res)=>{
  const body=z.object({type:z.enum(['pause','resume','reset','set_total_detected_ms']),totalDetectedMs:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional()}).strict().refine(v=>v.type!=='set_total_detected_ms'||v.totalDetectedMs!==undefined,'totalDetectedMs is required for set_total_detected_ms').parse(req.body);
  const device=await owned('device',req.params.id,req.auth!.orgId);
  if(!(device.capabilities as string[]).includes('detection_time'))throw new HttpError(422,'Device does not support timer controls');
  const command=await db.deviceCommand.create({data:{deviceId:device.id,type:body.type,payload:body.type==='set_total_detected_ms'?{totalDetectedMs:body.totalDetectedMs}: {},createdBy:req.auth!.email,expiresAt:new Date(Date.now()+24*3600000)}});
  res.status(201).json({id:command.id,type:command.type,status:command.status,expiresAt:command.expiresAt});
}));
app.get('/api/devices/:id/commands',role('supervisor'),asyncRoute(async(req,res)=>{await owned('device',req.params.id,req.auth!.orgId);await expireCommands(db,req.params.id);res.json(await db.deviceCommand.findMany({where:{deviceId:req.params.id},orderBy:{createdAt:'desc'},take:50}));}));
app.get('/api/devices/:id/commands/:commandId',role('supervisor'),asyncRoute(async(req,res)=>{await owned('device',req.params.id,req.auth!.orgId);await expireCommands(db,req.params.id);const command=await db.deviceCommand.findFirst({where:{id:req.params.commandId,deviceId:req.params.id}});if(!command)throw new HttpError(404,'Command not found');res.json(command);}));
app.get('/api/devices/:id/events',role('supervisor'),asyncRoute(async(req,res)=>{await owned('device',req.params.id,req.auth!.orgId);const cursor=z.string().regex(/^\d+$/).optional().parse(req.query.cursor);res.json(await db.rawEvent.findMany({where:{deviceId:req.params.id,orgId:req.auth!.orgId,...(cursor?{id:{lt:BigInt(cursor)}}:{})},orderBy:{id:'desc'},take:50}));}));
app.get('/api/devices/:id/assignments',role('supervisor'),asyncRoute(async(req,res)=>{await owned('device',req.params.id,req.auth!.orgId);res.json(await db.assignment.findMany({where:{deviceId:req.params.id},orderBy:{startedAt:'desc'},take:100}));}));
app.patch('/api/workstations/:id',role('supervisor'),asyncRoute(async(req,res)=>{await owned('workstation',req.params.id,req.auth!.orgId);const data=z.object({name:z.string().min(1).max(100).optional(),product:z.string().max(100).optional(),job:z.string().max(100).optional(),target:z.number().int().min(0).max(10000000).optional(),minIntervalMs:z.number().int().min(0).max(3600000).optional()}).strict().parse(req.body);res.json(await db.workstation.update({where:{id:req.params.id},data}));updates.emit(req.auth!.orgId);}));
app.get('/api/workstations/:id/people',role('supervisor'),asyncRoute(async(req,res)=>{
  const station=await owned('workstation',req.params.id,req.auth!.orgId);
  const people=await db.user.findMany({where:{orgId:req.auth!.orgId,areaId:station.areaId},select:{id:true,name:true,workstationId:true},orderBy:{name:'asc'}});
  res.json(people);
}));
app.put('/api/workstations/:id/people/:userId',role('supervisor'),asyncRoute(async(req,res)=>{
  const station=await owned('workstation',req.params.id,req.auth!.orgId);
  const {assigned}=z.object({assigned:z.boolean()}).strict().parse(req.body);
  await changePerson(req.auth!.orgId,req.params.userId,{workstationId:assigned?station.id:null},assigned?undefined:station.id);
  updates.emit(req.auth!.orgId);res.json({ok:true});
}));
app.post('/api/dev/workstations/:id/cabinets/complete',role('admin'),asyncRoute(async(req,res)=>{
  const workstation=await owned('workstation',req.params.id,req.auth!.orgId);
  const org=await db.organization.findUniqueOrThrow({where:{id:req.auth!.orgId},select:{demo:true}});
  if(process.env.NODE_ENV==='production'||!org.demo)throw new HttpError(404,'Developer simulation is only available in demo mode');
  const device=await db.device.findFirst({where:{orgId:req.auth!.orgId,workstationId:workstation.id,archived:false,capabilities:{equals:['detection_time']}}});
  if(!device)throw new HttpError(409,'Assign a timer device to this workstation before simulating a completion');
  const now=Date.now(),buildStarted=new Date(now-10_000),finished=new Date(now);
  const base={orgId:req.auth!.orgId,deviceId:device.id,workstationId:workstation.id,bootId:'developer-simulation',schemaVersion:1,timeQuality:'trusted',minIntervalMs:0,product:'Developer simulation',job:'Developer simulation'};
  await db.rawEvent.createMany({data:[{...base,eventId:`dev-cabinet-${crypto.randomUUID()}-start`,sequence:0,uptimeMs:BigInt(now-10_000),type:'sensor.detection_time_snapshot',data:{detected:true,totalDetectedMs:10_000,counterId:'developer-simulation'},occurredAt:buildStarted},{...base,eventId:`dev-cabinet-${crypto.randomUUID()}-finish`,sequence:1,uptimeMs:BigInt(now),type:'sensor.detection_time_snapshot',data:{detected:false,totalDetectedMs:10_000,counterId:'developer-simulation'},occurredAt:finished}]});
  updates.emit(req.auth!.orgId);res.status(201).json({ok:true,simulated:true});
}));
app.put('/api/dev/workstations/:id/cabinets/progress',role('admin'),asyncRoute(async(req,res)=>{
  const workstation=await owned('workstation',req.params.id,req.auth!.orgId);
  const org=await db.organization.findUniqueOrThrow({where:{id:req.auth!.orgId},select:{demo:true}});
  if(process.env.NODE_ENV==='production'||!org.demo)throw new HttpError(404,'Developer simulation is only available in demo mode');
  const {completed}=z.object({completed:z.number().int().min(0).max(500)}).parse(req.body);
  const device=await db.device.findFirst({where:{orgId:req.auth!.orgId,workstationId:workstation.id,archived:false,capabilities:{equals:['detection_time']}}});
  if(!device)throw new HttpError(409,'Assign a timer device to this workstation before editing test progress');
  const now=Date.now(),base={orgId:req.auth!.orgId,deviceId:device.id,workstationId:workstation.id,bootId:'developer-simulation',schemaVersion:1,timeQuality:'trusted',minIntervalMs:0,product:'Developer simulation',job:'Developer simulation'};
  const events=Array.from({length:completed*2},(_,index)=>{const cabinet=Math.floor(index/2),isStart=index%2===0,at=new Date(now-(completed-cabinet-1)*20_000+(isStart?-10_000:0));return {...base,eventId:`dev-cabinet-${cabinet}-${crypto.randomUUID()}`,sequence:index,uptimeMs:BigInt(Math.max(0,at.getTime())),type:'sensor.detection_time_snapshot',data:{detected:isStart,totalDetectedMs:10_000,counterId:'developer-'+cabinet},occurredAt:at};});
  await db.$transaction(async tx=>{await tx.rawEvent.deleteMany({where:{orgId:req.auth!.orgId,workstationId:workstation.id,eventId:{startsWith:'dev-cabinet-'}}});if(events.length)await tx.rawEvent.createMany({data:events});});
  updates.emit(req.auth!.orgId);res.json({ok:true,completed});
}));
app.post('/api/workstations/:id/notes',role('supervisor'),asyncRoute(async(req,res)=>{await owned('workstation',req.params.id,req.auth!.orgId);const data=z.object({text:z.string().min(1).max(2000),reason:z.enum(['Material shortage','Changeover','Maintenance','Quality check','Other']).nullable(),minutes:z.number().int().min(0).max(1440).nullable()}).parse(req.body);res.json(await db.note.create({data:{...data,orgId:req.auth!.orgId,workstationId:req.params.id,author:req.auth!.name}}));updates.emit(req.auth!.orgId);}));
app.get('/api/reports.csv',asyncRoute(async(req,res)=>{const data=await dashboard(req.auth!.orgId,req.query);const escape=(s:unknown)=>'"'+String(s??'Unavailable').replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';res.set({'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="shopflow-report.csv"'}).send([['Date','Period','Workstation','Product filter','Recorded output','Scheduled target','Expected so far','Median cycle ms','P90 cycle ms','Data status'],...data.stations.map(s=>[data.date,req.query.period==='day'?'Calendar day':data.shifts.find(x=>x.id===data.shiftId)?.name,s.name,req.query.product??'All',s.count,s.target,s.expected,s.median,s.p90,s.status])].map(row=>row.map(escape).join(',')).join('\r\n'));}));
app.get('/api/settings',role('admin'),asyncRoute(async(req,res)=>{const [users,workstations]=await Promise.all([db.user.findMany({where:{orgId:req.auth!.orgId},select:{id:true,email:true,name:true,role:true,areaId:true,workstationId:true}}),db.workstation.findMany({where:{orgId:req.auth!.orgId},select:{id:true,name:true,areaId:true},orderBy:{name:'asc'}})]);res.json({users,workstations});}));
app.patch('/api/settings',role('admin'),asyncRoute(async(req,res)=>{const {timezone}=z.object({timezone:z.string().refine(v=>DateTime.now().setZone(v).isValid,'Invalid timezone')}).parse(req.body);res.json(await db.organization.update({where:{id:req.auth!.orgId},data:{timezone}}));}));
app.post('/api/settings/users',role('admin'),asyncRoute(async(req,res)=>{const data=z.object({name:z.string().min(1).max(100),email:z.string().email(),password:z.string().min(12).max(128),role:z.enum(['admin','supervisor','viewer']),areaId:z.string().uuid().nullable().optional()}).strict().parse(req.body);if(data.areaId)await owned('area',data.areaId,req.auth!.orgId);const {password,...rest}=data;const user=await db.user.create({data:{...rest,email:rest.email.toLowerCase(),orgId:req.auth!.orgId,passwordHash:await bcrypt.hash(password,12)}});res.json({id:user.id});}));
app.patch('/api/settings/users/:id',role('admin'),asyncRoute(async(req,res)=>{
  const data=z.object({role:z.enum(['admin','supervisor','viewer']).optional(),areaId:z.string().uuid().nullable().optional(),workstationId:z.string().uuid().nullable().optional()}).strict().refine(v=>Object.keys(v).length>0,'Provide a change').parse(req.body);
  if(data.role!==undefined&&req.params.id===req.auth!.id)throw new HttpError(400,'Ask another administrator to change your role');
  await changePerson(req.auth!.orgId,req.params.id,data);
  updates.emit(req.auth!.orgId);res.json({ok:true});
}));
app.post('/api/settings/structure',role('admin'),asyncRoute(async(req,res)=>{
 const data=z.object({kind:z.enum(['area','workstation']),name:z.string().trim().min(1).max(100),parentId:z.string().uuid().optional()}).strict().parse(req.body);
 const orgId=req.auth!.orgId;
 if(data.kind==='area'){
  const shop=await db.shop.upsert({where:{orgId},create:{orgId,name:'Quality Craft Wood Works'},update:{name:'Quality Craft Wood Works'}});
  res.json(await db.area.create({data:{orgId,name:data.name,shopId:shop.id}}));
 }else{
  if(!data.parentId)throw new HttpError(400,'Choose a department');
  await owned('area',data.parentId,orgId);
  res.json(await db.workstation.create({data:{orgId,name:data.name,areaId:data.parentId}}));
 }
 updates.emit(orgId);
}));
app.post('/api/settings/shifts',role('admin'),asyncRoute(async(req,res)=>{
  const data=z.object({id:z.string().uuid().optional(),name:z.string().min(1).max(100),startMinute:z.number().int().min(0).max(1439),endMinute:z.number().int().min(0).max(1439),breaks:z.array(z.object({start:z.number().int().min(0),end:z.number().int().min(1)})).max(20)}).parse(req.body);
  const length=(data.endMinute-data.startMinute+1440)%1440||1440;const sorted=[...data.breaks].sort((a,b)=>a.start-b.start);
  if(sorted.some((b,i)=>b.end<=b.start||b.end>length||(i>0&&b.start<sorted[i-1].end)))throw new HttpError(400,'Breaks must be within the shift and cannot overlap');
  const {id,...values}=data;if(id){const result=await db.shift.updateMany({where:{id,orgId:req.auth!.orgId},data:values});if(!result.count)throw new HttpError(404,'Shift not found');res.json({ok:true});}else res.json(await db.shift.create({data:{...values,orgId:req.auth!.orgId}}));
}));
app.use(express.static(resolve('dist')));app.get('*',(_req,res)=>res.sendFile(resolve('dist/index.html')));
app.use((err:any,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{const status=err instanceof z.ZodError?400:err.status??(err.code==='P2002'?409:500);if(status===500)log.error({code:err.code},'Internal request failure');res.status(status).json({error:err instanceof z.ZodError?err.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; '):status===500?'Service unavailable. Check database connection.':err.message});});
if(process.env.NODE_ENV!=='test'){
  const port=Number(process.env.PORT??3001);
  const host=process.env.HOST??'127.0.0.1';
  const server=app.listen(port,host,()=>log.info({host,port},'ShopFlow API listening'));
  server.requestTimeout=15000;server.headersTimeout=10000;server.setTimeout(30000);
}

