import type {PrismaClient} from '@prisma/client';

export const paceMigration='20261030020000_cabinet_pace_schedule';
export class PaceRepairError extends Error {}
export type PaceSchema={
 tables:Array<{name:string;engine:string|null}>;
 columns:Array<{tableName:string;name:string;dataType:string;columnType:string;nullable:string;defaultValue:string|null;length:number|bigint|null;collation:string|null}>;
 indexes:Array<{name:string;nonUnique:number|bigint;columnName:string;position:number|bigint}>;
 foreignKeys:Array<{name:string;columnName:string;tableName:string;referencedColumn:string;deleteRule:string;updateRule:string}>;
 createTable:string;
};

export async function inspectPaceSchema(db:PrismaClient):Promise<PaceSchema>{
 const settings=await db.$queryRaw<Array<{lowerCaseTables:number|bigint}>>`SELECT @@lower_case_table_names AS lowerCaseTables`;
 const tableName=(name:string)=>Number(settings[0].lowerCaseTables)>0?['Area','Shift','ShiftDaySchedule'].find(expected=>expected.toLowerCase()===name.toLowerCase())??name:name;
 const [tables,columns,indexes,foreignKeys]=await Promise.all([
  db.$queryRaw<PaceSchema['tables']>`SELECT TABLE_NAME AS name, ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('Area','Shift','ShiftDaySchedule')`,
  db.$queryRaw<PaceSchema['columns']>`SELECT TABLE_NAME AS tableName, COLUMN_NAME AS name, DATA_TYPE AS dataType, COLUMN_TYPE AS columnType, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS defaultValue, CHARACTER_MAXIMUM_LENGTH AS length, COLLATION_NAME AS collation FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND ((TABLE_NAME='Area' AND COLUMN_NAME='cabinetPaceMs') OR (TABLE_NAME='Shift' AND COLUMN_NAME='id') OR TABLE_NAME='ShiftDaySchedule')`,
  db.$queryRaw<PaceSchema['indexes']>`SELECT INDEX_NAME AS name, NON_UNIQUE AS nonUnique, COLUMN_NAME AS columnName, SEQ_IN_INDEX AS position FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ShiftDaySchedule' ORDER BY INDEX_NAME,SEQ_IN_INDEX`,
  db.$queryRaw<PaceSchema['foreignKeys']>`SELECT k.CONSTRAINT_NAME AS name, k.COLUMN_NAME AS columnName, k.REFERENCED_TABLE_NAME AS tableName, k.REFERENCED_COLUMN_NAME AS referencedColumn, r.DELETE_RULE AS deleteRule, r.UPDATE_RULE AS updateRule FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME AND r.TABLE_NAME=k.TABLE_NAME WHERE k.TABLE_SCHEMA=DATABASE() AND k.TABLE_NAME='ShiftDaySchedule' AND k.REFERENCED_TABLE_NAME IS NOT NULL`,
 ]);
 const createTable=tables.some(table=>tableName(table.name)==='ShiftDaySchedule')?(await db.$queryRawUnsafe<Array<{'Create Table':string}>>('SHOW CREATE TABLE `ShiftDaySchedule`'))[0]['Create Table']:'';
 return {tables:tables.map(table=>({...table,name:tableName(table.name)})),columns:columns.map(column=>({...column,tableName:tableName(column.tableName)})),indexes,foreignKeys:foreignKeys.map(key=>({...key,tableName:tableName(key.tableName)})),createTable};
}

export function planPaceRepair(schema:PaceSchema):Array<'add-pace-column'|'create-schedule-table'>{
 const problems:string[]=[];
 for(const name of ['Area','Shift'])if(!schema.tables.some(table=>table.name===name))problems.push(`Required table ${name} is missing; apply the earlier migrations first.`);
 const parent=schema.columns.find(column=>column.tableName==='Shift'&&column.name==='id');
 if(!parent||parent.dataType!=='varchar'||Number(parent.length)!==36||parent.nullable!=='NO'||parent.collation!=='utf8mb4_unicode_ci')problems.push('Shift.id must be VARCHAR(36) with utf8mb4_unicode_ci collation. Its existing definition needs review before creating a matching foreign key.');
 const integer=(column:PaceSchema['columns'][number])=>column.dataType==='int'&&!column.columnType.toLowerCase().includes('unsigned')&&column.nullable==='NO';
 const pace=schema.columns.find(column=>column.tableName==='Area'&&column.name==='cabinetPaceMs');
 if(pace&&(!integer(pace)||String(pace.defaultValue).replace(/^'(.*)'$/,'$1')!=='600000'))problems.push('Existing Area.cabinetPaceMs does not match the migration (signed INT NOT NULL DEFAULT 600000). It will not be overwritten.');
 const exists=schema.tables.some(table=>table.name==='ShiftDaySchedule');
 if(exists){
  if(schema.tables.find(table=>table.name==='ShiftDaySchedule')?.engine?.toLowerCase()!=='innodb')problems.push('ShiftDaySchedule must use InnoDB so its foreign key is enforced.');
  for(const [name,length] of [['id',36],['orgId',36],['shiftId',36],['date',10]] as const){
   const column=schema.columns.find(item=>item.tableName==='ShiftDaySchedule'&&item.name===name);
   if(!column||column.dataType!=='varchar'||Number(column.length)!==length||column.nullable!=='NO'||column.collation!=='utf8mb4_unicode_ci')problems.push(`Existing ShiftDaySchedule.${name} must be VARCHAR(${length}) NOT NULL with utf8mb4_unicode_ci collation.`);
  }
  for(const name of ['startMinute','endMinute']){
   const column=schema.columns.find(item=>item.tableName==='ShiftDaySchedule'&&item.name===name);
   if(!column||!integer(column))problems.push(`Existing ShiftDaySchedule.${name} must be a signed INT NOT NULL.`);
  }
  const breaks=schema.columns.find(column=>column.tableName==='ShiftDaySchedule'&&column.name==='breaks');
  // MariaDB represents JSON as LONGTEXT plus a JSON_VALID check constraint.
  if(!breaks||breaks.nullable!=='NO'||!(breaks.dataType==='json'||(breaks.dataType==='longtext'&&/json_valid\s*\(\s*`?breaks`?\s*\)/i.test(schema.createTable))))problems.push('Existing ShiftDaySchedule.breaks must be JSON NOT NULL.');
  for(const [name,unique,columns] of [['PRIMARY',true,['id']],['ShiftDaySchedule_shiftId_date_key',true,['shiftId','date']],['ShiftDaySchedule_orgId_date_idx',false,['orgId','date']]] as const){
   const index=schema.indexes.filter(item=>item.name===name).sort((a,b)=>Number(a.position)-Number(b.position));
   if(index.length!==columns.length||index.some((item,i)=>item.columnName!==columns[i]||Number(item.nonUnique)!==(unique?0:1)))problems.push(`Required index ${name} is missing or has an unexpected definition.`);
  }
  const foreignKey=schema.foreignKeys.filter(key=>key.name==='ShiftDaySchedule_shiftId_fkey');
  if(foreignKey.length!==1||foreignKey[0].columnName!=='shiftId'||foreignKey[0].tableName!=='Shift'||foreignKey[0].referencedColumn!=='id'||foreignKey[0].deleteRule!=='CASCADE'||foreignKey[0].updateRule!=='CASCADE')problems.push('Required foreign key ShiftDaySchedule.shiftId -> Shift.id with CASCADE rules is missing or has an unexpected definition.');
 }
 if(problems.length)throw new PaceRepairError(problems.join('\n'));
 return [...(!pace?['add-pace-column' as const]:[]),...(!exists?['create-schedule-table' as const]:[])];
}
