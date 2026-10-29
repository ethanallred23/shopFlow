import type {CabinetRecord} from './cabinet-records';

export type OperatorPeriod={userId:string;operatorName:string;startedAt:Date;endedAt:Date|null};
export function attributeCabinets(cabinets:CabinetRecord[],periods:OperatorPeriod[]){
 const at=(value:string|null)=>value?periods.find(p=>p.startedAt.getTime()<=Date.parse(value)&&(p.endedAt===null||p.endedAt.getTime()>Date.parse(value))):undefined;
 return cabinets.map(c=>{
  const starter=at(c.startedAt),finisher=c.status==='completed'?at(c.finishedAt):undefined;
  return {...c,operatorId:starter?.userId??null,operatorName:starter?.operatorName??null,completedById:finisher?.userId??null,completedByName:finisher?.operatorName??null};
 });
}
