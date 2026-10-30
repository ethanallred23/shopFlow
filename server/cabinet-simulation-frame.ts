export type SimulationTiming={buildMs:number;pauseMs:number;idleMs:number};

// Use actual elapsed time so preview timers and device snapshots stay consistent.
export function cabinetSimulationFrame(elapsedMs:number,timing:SimulationTiming){
 const cycleMs=timing.buildMs+timing.pauseMs+timing.idleMs;
 const cycle=Math.floor(Math.max(0,elapsedMs)/cycleMs);
 const position=Math.max(0,elapsedMs)%cycleMs;
 const pauseAt=Math.floor(timing.buildMs*.45);
 const finished=position>=timing.buildMs+timing.pauseMs;
 const paused=position>=pauseAt&&position<pauseAt+timing.pauseMs;
 const activeMs=Math.min(timing.buildMs,position<pauseAt?position:position<pauseAt+timing.pauseMs?pauseAt:position-timing.pauseMs);
 return {cycle,startedMs:cycle*cycleMs,finishedMs:finished?cycle*cycleMs+timing.buildMs+timing.pauseMs:null,
  activeMs,totalMs:cycle*timing.buildMs+activeMs,detected:!finished,running:!finished&&!paused,
  status:finished?'completed':paused?'paused':'building'};
}
