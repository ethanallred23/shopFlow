import {db} from './db';
import {processRaw,RULE_VERSION} from './ingestion';
// Checkpoints and derived rows commit together. Rerunning resumes safely.
export async function rebuild(version=RULE_VERSION){
  for(const d of await db.device.findMany()){
    let more=true;
    while(more){more=await db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM Device WHERE id = ${d.id} FOR UPDATE`;
      const state=await tx.processingState.findUnique({where:{deviceId_ruleVersion:{deviceId:d.id,ruleVersion:version}}});
      const rows=await tx.rawEvent.findMany({where:{deviceId:d.id,id:{gt:state?.lastRawId??0n}},orderBy:{id:'asc'},take:200});
      for(const raw of rows)await processRaw(tx,raw,version);
      return rows.length===200;
    },{timeout:30000});}
  }
}
if(process.argv[1]?.endsWith('rebuild.ts'))rebuild().then(()=>console.log('Replay complete')).finally(()=>db.$disconnect());
