import {it,expect} from 'vitest';
import {attributeCabinets} from '../server/operator-attribution';
import type {CabinetRecord} from '../server/cabinet-records';
const cabinet=(startedAt:string|null,finishedAt:string|null):CabinetRecord=>({id:'c',deviceId:'d',number:1,startedAt,finishedAt,durationMs:2000,status:'completed',lastReportedAt:'2026-10-29T15:00:00Z',stale:false});
it('attributes historical starts and completions to their original operator periods',()=>{
 const periods=[{userId:'old',operatorName:'First operator',startedAt:new Date('2026-10-29T14:00:00Z'),endedAt:new Date('2026-10-29T14:30:00Z')},{userId:'new',operatorName:'Second operator',startedAt:new Date('2026-10-29T14:30:00Z'),endedAt:null}];
 expect(attributeCabinets([cabinet('2026-10-29T14:10:00Z','2026-10-29T14:30:00Z')],periods)[0]).toMatchObject({operatorId:'old',completedById:'new'});
 expect(attributeCabinets([cabinet(null,'2026-10-29T13:00:00Z')],periods)[0]).toMatchObject({operatorId:null,completedById:null});
});
