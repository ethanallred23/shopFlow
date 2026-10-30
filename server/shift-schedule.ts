import type {Schedule} from './domain';

export type ShiftWithId=Schedule&{id:string};
export type ShiftOverride=Schedule&{shiftId:string;date:string};

export function scheduledShift<T extends ShiftWithId>(shift:T,date:string,overrides:ShiftOverride[]):T{
 const selected=overrides.find(o=>o.shiftId===shift.id&&o.date===date);
 return selected?{...shift,startMinute:selected.startMinute,endMinute:selected.endMinute,breaks:selected.breaks}:shift;
}
