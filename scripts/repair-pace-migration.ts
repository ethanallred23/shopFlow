import 'dotenv/config';
import {PrismaClient} from '@prisma/client';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {inspectPaceSchema,paceMigration,PaceRepairError,planPaceRepair} from './pace-migration-repair';

const checkOnly=process.argv.includes('--check');
let db:PrismaClient|undefined;
try{
 if(process.argv.slice(2).some(argument=>argument!=='--check'))throw new PaceRepairError('Supported usage: npm run db:repair:pace, or npm run db:repair:pace -- --check for a read-only check.');
 const url=new URL(process.env.DATABASE_URL??'');
 // A single connection keeps the advisory lock for the entire repair.
 url.searchParams.set('connection_limit','1');
 db=new PrismaClient({datasources:{db:{url:url.toString()}}});
 console.log(`Checking ${url.hostname}:${url.port||3306}${url.pathname} for ${paceMigration}.`);
 const lock=await db.$queryRaw<Array<{acquired:number|bigint|null}>>`SELECT GET_LOCK('shopflow_repair_cabinet_pace',0) AS acquired`;
 if(Number(lock[0]?.acquired)!==1)throw new PaceRepairError('Another cabinet pace repair is running. Retry after it finishes.');
 const attempts=await db.$queryRaw<Array<{migration_name:string;finished_at:Date|null;rolled_back_at:Date|null;logs:string|null}>>`SELECT migration_name,finished_at,rolled_back_at,logs FROM _prisma_migrations WHERE migration_name=${paceMigration} ORDER BY started_at DESC`;
 const failed=await db.$queryRaw<Array<{migration_name:string}>>`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL`;
 if(failed.some(row=>row.migration_name!==paceMigration))throw new PaceRepairError('Another migration has failed. This command only repairs '+paceMigration+'. Run prisma migrate status to inspect the other failure.');
 const schema=await inspectPaceSchema(db);
 const steps=planPaceRepair(schema);
 if(!failed.some(row=>row.migration_name===paceMigration)){
  if(attempts.some(row=>row.finished_at)&&!steps.length)console.log('This migration is already applied and its required schema is valid. No changes made.');
  else throw new PaceRepairError('This migration is not currently recorded as failed. Use npm run db:migrate to apply pending migrations. No changes made.');
 }else{
  const original=attempts.find(row=>!row.finished_at&&!row.rolled_back_at)?.logs;
  if(original)console.log('Original failure:\n'+original.replace(/mysql:\/\/[^\s]+/gi,'[database URL omitted]').slice(0,4000));
  console.log(steps.length?'Missing steps: '+steps.join(', '):'Both schema changes already exist; their definitions have been verified.');
  if(checkOnly)console.log('Check complete. No schema or migration history changed. Run npm run db:repair:pace to finish the repair.');
  else{
   const migration=readFileSync(new URL(`../prisma/migrations/${paceMigration}/migration.sql`,import.meta.url),'utf8').split(';').map(sql=>sql.trim()).filter(Boolean);
   if(migration.length!==2||!/^ALTER TABLE `Area` ADD COLUMN `cabinetPaceMs`/i.test(migration[0])||!/^CREATE TABLE `ShiftDaySchedule`/i.test(migration[1])||!/COLLATE utf8mb4_unicode_ci$/i.test(migration[1]))throw new PaceRepairError('The migration file has an unexpected definition. Inspect it before applying a repair.');
   for(const step of steps){
    console.log('Applying '+step+' (existing columns and tables are preserved).');
    await db.$executeRawUnsafe(migration[step==='add-pace-column'?0:1]);
   }
   if(planPaceRepair(await inspectPaceSchema(db)).length)throw new PaceRepairError('Schema verification failed. The migration is still marked failed.');
   console.log('Required columns, indexes, and foreign key verified. Resolving migration history.');
   const require=createRequire(import.meta.url);
   const result=spawnSync(process.execPath,[require.resolve('prisma/build/index.js'),'migrate','resolve','--applied',paceMigration,'--schema',fileURLToPath(new URL('../prisma/schema.prisma',import.meta.url))],{stdio:'inherit',env:process.env});
   if(result.error||result.status!==0)throw new PaceRepairError('Schema is repaired, but Prisma could not resolve the migration history. Rerun this command; completed schema steps will be skipped.');
   const unresolved=await db.$queryRaw<Array<{migration_name:string}>>`SELECT migration_name FROM _prisma_migrations WHERE migration_name=${paceMigration} AND finished_at IS NULL AND rolled_back_at IS NULL`;
   if(unresolved.length)throw new PaceRepairError('Prisma still reports an unresolved failure. Run npm run db:repair:pace -- --check to inspect the state.');
   console.log('Cabinet pace migration repaired. Continue with npm run db:migrate.');
  }
 }
}catch(error){
 const code=error&&typeof error==='object'&&'code' in error?String(error.code):'unknown';
 console.error(error instanceof PaceRepairError?error.message:`Repair stopped because a database or file operation failed (${code}). No failed migration was marked applied without schema verification. Run npx tsx scripts/check-pace-migration.ts to inspect the original database error.`);
 process.exitCode=1;
}finally{await db?.$disconnect();}
