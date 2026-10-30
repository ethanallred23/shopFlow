export type TargetStation={id:string;areaId:string};
export type TargetShift={id:string;workingMs:number};

// Give whole units to stable IDs first so station targets always add up to the
// department goal, including goals that do not divide evenly.
export function splitTarget(total:number,ids:string[]):Map<string,number>{
 const sorted=[...ids].sort();
 const result=new Map<string,number>();
 if(!sorted.length)return result;
 const base=Math.floor(total/sorted.length),extra=total%sorted.length;
 sorted.forEach((id,index)=>result.set(id,base+(index<extra?1:0)));
 return result;
}

// A daily department goal is allocated between configured shifts in proportion
// to scheduled working time, with deterministic rounding.
export function shiftTarget(dailyTarget:number,shifts:TargetShift[],selectedId:string):number{
 const totalWorking=shifts.reduce((sum,shift)=>sum+shift.workingMs,0);
 if(!totalWorking)return dailyTarget;
 const allocations=shifts.map(shift=>{
  const exact=dailyTarget*shift.workingMs/totalWorking;
  return {id:shift.id,value:Math.floor(exact),fraction:exact%1};
 });
 let remaining=dailyTarget-allocations.reduce((sum,shift)=>sum+shift.value,0);
 allocations.sort((a,b)=>b.fraction-a.fraction||a.id.localeCompare(b.id));
 for(const shift of allocations){if(remaining<=0)break;shift.value++;remaining--;}
 return allocations.find(shift=>shift.id===selectedId)?.value??0;
}
