import {Prisma,RawEvent} from '@prisma/client';
import {createHash,randomBytes} from 'node:crypto';
import {db} from './db';
import {eventSchema,Envelope,transition} from './domain';
export const RULE_VERSION=1;
export const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
export const newToken=()=>randomBytes(32).toString('base64url');
export class HttpError extends Error {constructor(public status:number,message:string){super(message);}}
export async function authorizeDevice(tx:Prisma.TransactionClient,token:string){
  const cred=await tx.credential.findUnique({where:{tokenHash:hash(token)}});
  if(!cred || cred.revokedAt) throw new HttpError(401,'Invalid device credential');
  await tx.$queryRaw`SELECT id FROM Device WHERE id = ${cred.deviceId} FOR UPDATE`;
  const fresh=await tx.credential.findUnique({where:{id:cred.id}});
  const device=await tx.device.findUniqueOrThrow({where:{id:cred.deviceId}});
  if(fresh?.revokedAt || device.disabled || device.archived) throw new HttpError(401,'Device credential unavailable');
  return device;
}
export async function processRaw(tx:Prisma.TransactionClient,raw:RawEvent,version=RULE_VERSION){
  const key={deviceId:raw.deviceId,ruleVersion:version};
  let state=await tx.processingState.upsert({where:{deviceId_ruleVersion:key},create:key,update:{}});
  if(raw.id<=state.lastRawId)return;
  const bootKey={...key,bootId:raw.bootId};
  const boot=await tx.bootState.findUnique({where:{deviceId_ruleVersion_bootId:bootKey}});
  const retired=!!boot && state.activeBoot!==raw.bootId;
  const e={schemaVersion:raw.schemaVersion,eventId:raw.eventId,deviceId:raw.deviceId,bootId:raw.bootId,sequence:raw.sequence,uptimeMs:Number(raw.uptimeMs),type:raw.type,data:raw.data,occurredAt:raw.occurredAt?.toISOString()??null} as Envelope;
  const result=transition(boot?{sequence:boot.sequence,detected:boot.detected,lastCountUptime:boot.lastCountUptime===null?null:Number(boot.lastCountUptime),lastUptime:Number(boot.lastUptime)}:undefined,e,raw.minIntervalMs,retired);
  if(!retired){
    const values={sequence:result.next.sequence,detected:result.next.detected,lastCountUptime:result.next.lastCountUptime===null?null:BigInt(result.next.lastCountUptime),lastUptime:BigInt(result.next.lastUptime)};
    await tx.bootState.upsert({where:{deviceId_ruleVersion_bootId:bootKey},create:{...bootKey,...values},update:values});
  }
  await tx.measurement.create({data:{rawId:raw.id,orgId:raw.orgId,workstationId:raw.workstationId,ruleVersion:version,count:result.count,durationMs:result.durationMs,notice:result.notice,at:raw.timeQuality==='device_clock'?raw.occurredAt:raw.timeQuality==='receipt_estimate'?raw.receivedAt:null,product:raw.product,job:raw.job}});
  await tx.processingState.update({where:{deviceId_ruleVersion:key},data:{lastRawId:raw.id,activeBoot:retired?state.activeBoot:raw.bootId}});
}
export async function ingest(token:string,input:unknown){
  const e=eventSchema.parse(input);
  return db.$transaction(async tx=>{
    const d=await authorizeDevice(tx,token);
    if(d.id!==e.deviceId)throw new HttpError(403,'deviceId does not match credential');
    const existing=await tx.rawEvent.findUnique({where:{deviceId_eventId:{deviceId:d.id,eventId:e.eventId}}});
    if(existing)return {ok:true,duplicate:true,orgId:d.orgId};
    const caps=d.capabilities as string[];
    if(!caps.includes(e.type==='cycle.completed'?'cycle':'count'))throw new HttpError(422,'Device does not support this event');
    const station=d.workstationId?await tx.workstation.findUnique({where:{id:d.workstationId}}):null;
    const receivedAt=new Date();const occurredAt=e.occurredAt?new Date(e.occurredAt):null;
    if(occurredAt && occurredAt.getTime()>receivedAt.getTime()+300000)throw new HttpError(422,'Device timestamp is too far in the future');
    const raw=await tx.rawEvent.create({data:{orgId:d.orgId,deviceId:d.id,eventId:e.eventId,bootId:e.bootId,sequence:e.sequence,uptimeMs:BigInt(e.uptimeMs),type:e.type,schemaVersion:e.schemaVersion,data:e.data,occurredAt,receivedAt,timeQuality:occurredAt?'device_clock':e.delivery==='live'?'receipt_estimate':'unknown',workstationId:d.workstationId,minIntervalMs:station?.minIntervalMs??500,product:station?.product??'',job:station?.job??''}});
    await processRaw(tx,raw);
    await tx.device.update({where:{id:d.id},data:{lastEvent:receivedAt}});
    return {ok:true,duplicate:false,orgId:d.orgId};
  },{isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted,maxWait:10000,timeout:10000});
}
