import {db} from '../server/db.js';

// Read-only diagnostics for a potentially partially applied migration.
try {
 const migration='20261030020000_cabinet_pace_schedule';
 const attempts=await db.$queryRaw<Array<{started_at:Date;finished_at:Date|null;rolled_back_at:Date|null;logs:string|null}>>`
  SELECT started_at, finished_at, rolled_back_at, logs
  FROM _prisma_migrations WHERE migration_name=${migration} ORDER BY started_at DESC
 `;
 const columns=await db.$queryRaw<Array<{tableName:string;columnName:string;columnType:string;collationName:string|null;columnDefault:string|null}>>`
  SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, COLUMN_TYPE AS columnType,
   COLLATION_NAME AS collationName, COLUMN_DEFAULT AS columnDefault
  FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()
   AND ((TABLE_NAME='Area' AND COLUMN_NAME='cabinetPaceMs')
    OR (TABLE_NAME='Shift' AND COLUMN_NAME='id') OR TABLE_NAME='ShiftDaySchedule')
  ORDER BY TABLE_NAME, ORDINAL_POSITION
 `;
 console.log(JSON.stringify({migration,attempts,columns},null,2));
} catch {
 console.error('Could not read migration diagnostics. Check the server DATABASE_URL and database access.');
 process.exitCode=1;
} finally {
 await db.$disconnect();
}
