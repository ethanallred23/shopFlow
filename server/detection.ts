import {Prisma,RawEvent,ProcessingState} from '@prisma/client';
import {Envelope} from './domain';
export type DetectionEvent=Extract<Envelope,{type:'sensor.detection_time_snapshot'}>;
export function detectionDelta(previous:{total:number;uptime:number}|null,total:number,uptime:number){
  if(previous && total<previous.total)return {accepted:false,delta:0,notice:'invalid decrease: change counterId when resetting'};
  const delta=total-(previous?.total??0);
  if(delta>uptime-(previous?.uptime??0))return {accepted:false,delta:0,notice:'invalid increase: detected time exceeds elapsed uptime'};
  return {accepted:true,delta,notice:previous?null:'first snapshot: recovered total has no known interval start'};
}
// Called only while ingestion/replay holds the device row lock.
export async function processDetection(tx:Prisma.TransactionClient,raw:RawEvent,state:ProcessingState,e:DetectionEvent){
  const key={deviceId:raw.deviceId,ruleVersion:state.ruleVersion};
  const counterKey={...key,counterId:e.data.counterId};
  const previous=await tx.detectionCounter.findUnique({where:{deviceId_ruleVersion_counterId:counterKey}});
  const active=state.activeCounterId?await tx.detectionCounter.findUnique({where:{deviceId_ruleVersion_counterId:{...key,counterId:state.activeCounterId}}}):null;
  const bootKey={...key,bootId:e.bootId};
  const boot=await tx.bootState.findUnique({where:{deviceId_ruleVersion_bootId:bootKey}});
  let rejection:string|null=null;
  const calibration=e.data.calibration;
  const offset=calibration?.offsetMs??0;
  if(calibration){
    const command=await tx.deviceCommand.findFirst({where:{id:calibration.commandId,deviceId:raw.deviceId,type:'set_total_detected_ms'}});
    const payload=command?.payload as {totalDetectedMs?:number}|undefined;
    if(!command || command.status==='rejected' || payload?.totalDetectedMs!==offset)
      rejection='invalid calibration: no matching authorized set-total command';
    // A command may establish only one counter, and that counter must keep its offset.
    const first=await tx.rawEvent.findFirst({where:{deviceId:raw.deviceId,type:'sensor.detection_time_snapshot',id:{lt:raw.id},data:{path:'$.calibration.commandId',equals:calibration.commandId}},orderBy:{id:'asc'}});
    if(first && ((first.data as any).counterId!==e.data.counterId || first.bootId!==e.bootId))
      rejection='invalid calibration: command reused for another counter';
  }
  if(previous){
    const first=await tx.rawEvent.findFirst({where:{deviceId:raw.deviceId,type:'sensor.detection_time_snapshot',data:{path:'$.counterId',equals:e.data.counterId}},orderBy:{id:'asc'}});
    const original=(first?.data as any)?.calibration;
    if(original?.commandId!==calibration?.commandId || (original?.offsetMs??0)!==offset)
      rejection='invalid calibration: counter offset changed';
  }
  if(rejection){ /* Preserve calibration rejection before ordinary timer checks. */ }
  else
  if(boot && state.activeBoot!==e.bootId)rejection='retired boot: excluded';
  else if(boot && (e.sequence<=boot.sequence || BigInt(e.uptimeMs)<boot.lastUptime))rejection='out-of-order snapshot: excluded';
  else if(previous && (previous.bootId!==e.bootId || state.activeCounterId!==e.data.counterId))rejection='counterId reused or retired: excluded';
  else if(!previous && active?.bootId===e.bootId && BigInt(e.data.totalDetectedMs-offset)>BigInt(e.uptimeMs)-active.uptimeMs)rejection='invalid reset total: exceeds elapsed time since previous counter snapshot';
  else if(!previous && state.activeBoot!==e.bootId && active?.occurredAt && raw.occurredAt && raw.occurredAt<active.occurredAt)rejection='older unseen boot timestamp: excluded';
  const result=rejection?{accepted:false,delta:0,notice:rejection}:detectionDelta(previous?{total:Number(previous.totalDetectedMs),uptime:Number(previous.uptimeMs)}:calibration?{total:offset,uptime:0}:null,e.data.totalDetectedMs,e.uptimeMs);
  const gap=previous && e.sequence>previous.sequence+1;
  const sameAssignment=previous && previous.workstationId===raw.workstationId;
  // Endpoints bound a quantity, not its distribution. A report may include the delta
  // only if BOTH endpoints lie inside its window; never prorate across a boundary.
  const elapsed=previous?e.uptimeMs-Number(previous.uptimeMs):0;
  const clockElapsed=previous?.occurredAt&&raw.occurredAt?raw.occurredAt.getTime()-previous.occurredAt.getTime():null;
  const clockConsistent=clockElapsed!==null && clockElapsed>=0 && Math.abs(clockElapsed-elapsed)<=2000;
  const bounded=result.accepted && sameAssignment && raw.timeQuality==='device_clock' && clockConsistent;
  let notice=!previous&&calibration&&result.accepted?'authorized calibration: offset excluded from measured time':result.notice;
  if(result.accepted && previous && !bounded)notice='recovered time: unknown clock interval or changed assignment';
  else if(result.accepted && gap)notice='sequence gap: cumulative total recovered; interval distribution unknown';
  await tx.detectionMeasurement.create({data:{rawId:raw.id,...key,orgId:raw.orgId,workstationId:sameAssignment?raw.workstationId:null,deltaMs:BigInt(result.delta),accepted:result.accepted,notice,intervalStart:bounded?previous!.occurredAt:null,intervalEnd:bounded?raw.occurredAt:null}});
  if(result.accepted){
    const values={bootId:e.bootId,totalDetectedMs:BigInt(e.data.totalDetectedMs),detected:e.data.detected,sequence:e.sequence,uptimeMs:BigInt(e.uptimeMs),occurredAt:raw.occurredAt,receivedAt:raw.receivedAt,workstationId:raw.workstationId};
    await tx.detectionCounter.upsert({where:{deviceId_ruleVersion_counterId:counterKey},create:{...counterKey,...values},update:values});
    await tx.bootState.upsert({where:{deviceId_ruleVersion_bootId:bootKey},create:{...bootKey,sequence:e.sequence,lastUptime:BigInt(e.uptimeMs),detected:e.data.detected},update:{sequence:e.sequence,lastUptime:BigInt(e.uptimeMs),detected:e.data.detected}});
  }
  await tx.processingState.update({where:{deviceId_ruleVersion:key},data:{lastRawId:raw.id,...(result.accepted?{activeBoot:e.bootId,activeCounterId:e.data.counterId}:{})}});
}
