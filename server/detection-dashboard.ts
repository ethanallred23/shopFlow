import {db} from './db';
import {RULE_VERSION} from './ingestion';
export async function detectionDashboard(orgId:string,deviceIds:string[],workstationId:string,start:Date,end:Date){
  if(!deviceIds.length)return [];
  const result=[];
  for(const deviceId of deviceIds){
    const key={deviceId,ruleVersion:RULE_VERSION};
    const state=await db.processingState.findUnique({where:{deviceId_ruleVersion:key}});
    const current=state?.activeCounterId?await db.detectionCounter.findUnique({where:{deviceId_ruleVersion_counterId:{...key,counterId:state.activeCounterId}}}):null;
    const base={orgId,...key,accepted:true};
    const [total,shift,unallocated,boundary,recent]=await Promise.all([
      db.detectionMeasurement.aggregate({where:base,_sum:{deltaMs:true}}),
      db.detectionMeasurement.aggregate({where:{...base,workstationId,intervalStart:{gte:start},intervalEnd:{lte:end}},_sum:{deltaMs:true}}),
      db.detectionMeasurement.aggregate({where:{...base,OR:[{intervalStart:null},{workstationId:null}]},_sum:{deltaMs:true}}),
      db.detectionMeasurement.aggregate({where:{...base,workstationId,intervalStart:{lt:end},intervalEnd:{gt:start},OR:[{intervalStart:{lt:start}},{intervalEnd:{gt:end}}]},_sum:{deltaMs:true}}),
      db.detectionMeasurement.findMany({where:{orgId,...key,notice:{not:null}},orderBy:{id:'desc'},take:5})
    ]);
    const snapshotFresh=!!current?.occurredAt && Date.now()-current.receivedAt.getTime()<30000 && Math.abs(Date.now()-current.occurredAt.getTime())<30000;
    result.push({deviceId,counterId:current?.counterId??null,currentCounterMs:current?Number(current.totalDetectedMs):null,recoveredTotalMs:current?Number(total._sum.deltaMs??0):null,confirmedShiftMs:current?Number(shift._sum.deltaMs??0):null,unallocatedAllTimeMs:Number(unallocated._sum.deltaMs??0),boundaryUncertainMs:Number(boundary._sum.deltaMs??0),detected:current?.detected??null,snapshotAt:current?.occurredAt??null,receivedAt:current?.receivedAt??null,snapshotFresh,notices:recent.map(x=>({id:x.id,notice:x.notice,accepted:x.accepted}))});
  }
  return result;
}
