export function buildStationSpeed(averageMs:number|null|undefined,desiredMs:number|null|undefined,completed:number){
 if(!completed||!averageMs||averageMs<=0||!desiredMs||desiredMs<=0)return {status:'unknown' as const,ratio:null,differenceMs:null};
 return {status:averageMs<=desiredMs?'good' as const:'slow' as const,ratio:averageMs/desiredMs,differenceMs:averageMs-desiredMs};
}

export function stationDuration(ms:number|null|undefined){
 if(ms==null)return '\u2014';
 const seconds=Math.floor(Math.max(0,ms)/1000),minutes=Math.floor(seconds/60),remaining=seconds%60;
 return minutes?`${minutes}m${remaining?' '+remaining+'s':''}`:`${seconds}s`;
}

export function stationSpeedLabel(speed:ReturnType<typeof buildStationSpeed>){
 if(speed.differenceMs===null)return 'No completed builds yet';
 if(speed.differenceMs===0)return 'Matching desired pace';
 return `${stationDuration(Math.abs(speed.differenceMs))} ${speed.status==='slow'?'over':'under'} desired time`;
}
