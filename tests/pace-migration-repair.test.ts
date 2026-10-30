import {expect,it} from 'vitest';
import {planPaceRepair,type PaceSchema} from '../scripts/pace-migration-repair';

function base():PaceSchema{
 return {tables:[{name:'Area',engine:'InnoDB'},{name:'Shift',engine:'InnoDB'}],columns:[{tableName:'Shift',name:'id',dataType:'varchar',columnType:'varchar(36)',nullable:'NO',defaultValue:null,length:36,collation:'utf8mb4_unicode_ci'}],indexes:[],foreignKeys:[],createTable:''};
}
function paceColumn():PaceSchema['columns'][number]{return {tableName:'Area',name:'cabinetPaceMs',dataType:'int',columnType:'int',nullable:'NO',defaultValue:'600000',length:null,collation:null};}
function complete():PaceSchema{
 const schema=base();schema.tables.push({name:'ShiftDaySchedule',engine:'InnoDB'});schema.columns.push(paceColumn());
 for(const [name,length] of [['id',36],['orgId',36],['shiftId',36],['date',10]] as const)schema.columns.push({tableName:'ShiftDaySchedule',name,dataType:'varchar',columnType:`varchar(${length})`,nullable:'NO',defaultValue:null,length,collation:'utf8mb4_unicode_ci'});
 for(const name of ['startMinute','endMinute'])schema.columns.push({tableName:'ShiftDaySchedule',name,dataType:'int',columnType:'int',nullable:'NO',defaultValue:null,length:null,collation:null});
 schema.columns.push({tableName:'ShiftDaySchedule',name:'breaks',dataType:'json',columnType:'json',nullable:'NO',defaultValue:null,length:null,collation:null});
 for(const [name,nonUnique,columns] of [['PRIMARY',0,['id']],['ShiftDaySchedule_shiftId_date_key',0,['shiftId','date']],['ShiftDaySchedule_orgId_date_idx',1,['orgId','date']]] as const)columns.forEach((columnName,index)=>schema.indexes.push({name,nonUnique,columnName,position:index+1}));
 schema.foreignKeys.push({name:'ShiftDaySchedule_shiftId_fkey',columnName:'shiftId',tableName:'Shift',referencedColumn:'id',deleteRule:'CASCADE',updateRule:'CASCADE'});
 return schema;
}
it('finishes a partial migration without recreating the existing pace column',()=>{
 const schema=base();schema.columns.push(paceColumn());
 expect(planPaceRepair(schema)).toEqual(['create-schedule-table']);
 expect(planPaceRepair(base())).toEqual(['add-pace-column','create-schedule-table']);
 expect(planPaceRepair(complete())).toEqual([]);
});
it('refuses to overwrite an incompatible pace column or create a mismatched foreign key',()=>{
 const schema=base();schema.columns.push({...paceColumn(),defaultValue:'0'});
 expect(()=>planPaceRepair(schema)).toThrow('will not be overwritten');
 const parent=base();parent.columns[0].collation='utf8mb4_general_ci';
 expect(()=>planPaceRepair(parent)).toThrow('existing definition needs review');
});
it('does not approve an existing table unless indexes and the cascading foreign key match',()=>{
 const missingForeignKey=complete();missingForeignKey.foreignKeys=[];
 expect(()=>planPaceRepair(missingForeignKey)).toThrow('Required foreign key');
 const badIndex=complete();badIndex.indexes.find(index=>index.name==='ShiftDaySchedule_shiftId_date_key')!.nonUnique=1;
 expect(()=>planPaceRepair(badIndex)).toThrow('Required index');
});
it('accepts MariaDB JSON storage only when its validation check is present',()=>{
 const schema=complete();schema.columns.find(column=>column.name==='breaks')!.dataType='longtext';
 expect(()=>planPaceRepair(schema)).toThrow('JSON NOT NULL');
 schema.createTable='CHECK (json_valid(`breaks`))';
 expect(planPaceRepair(schema)).toEqual([]);
});
