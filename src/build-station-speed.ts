export function buildStationSpeed(averageMs:number|null|undefined,desiredMs:number|null|undefined,completed:number){
 if(!completed||!averageMs||averageMs<=0||!desiredMs||desiredMs<=0)return {status:'unknown' as const,ratio:null,differenceMs:null};
 return {status:averageMs<=desiredMs?'good' as const:'slow' as const,ratio:averageMs/desiredMs,differenceMs:averageMs-desiredMs};
}

// Start at true green (120deg), so faster builds never drift toward mint/teal.
// Blend by average / desired time: spare time is green, near pace is yellow,
// 10% over is orange, and 40% over is red. Missing history stays neutral.
export function stationHealthHue(ratio:number|null){
 if(ratio===null||!Number.isFinite(ratio)||ratio<0)return null;
 const stops=[{ratio:.5,hue:120},{ratio:.9,hue:52},{ratio:1.1,hue:27},{ratio:1.4,hue:4}];
 if(ratio<=stops[0].ratio)return stops[0].hue;
 for(let index=1;index<stops.length;index++){
  const before=stops[index-1],after=stops[index];
  if(ratio<=after.ratio)return Math.round((before.hue+(after.hue-before.hue)*(ratio-before.ratio)/(after.ratio-before.ratio))*10)/10;
 }
 return stops.at(-1)!.hue;
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
