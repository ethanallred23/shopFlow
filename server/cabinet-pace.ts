export function paceTarget(workingMs:number,paceMs:number):number{
 return paceMs>0?Math.floor(Math.max(0,workingMs)/paceMs):0;
}

export function paceProjection(completed:number,workingMs:number,elapsedMs:number):number|null{
 if(completed<=0||elapsedMs<=0)return null;
 return Math.max(completed,Math.round(completed*workingMs/elapsedMs));
}

export function expectedAtPace(workingElapsedMs:number,paceMs:number):number{
 return paceTarget(workingElapsedMs,paceMs);
}
