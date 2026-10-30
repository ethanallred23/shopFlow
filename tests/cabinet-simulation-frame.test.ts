import {expect,it} from 'vitest';
import {cabinetSimulationFrame as frame} from '../server/cabinet-simulation-frame';

const timing={buildMs:20000,pauseMs:6000,idleMs:4000};
it('freezes the timer while paused and preserves it on resume',()=>{
 expect(frame(8000,timing)).toMatchObject({status:'building',activeMs:8000,running:true,detected:true});
 expect(frame(10000,timing)).toMatchObject({status:'paused',activeMs:9000,running:false,detected:true});
 expect(frame(14000,timing)).toMatchObject({status:'paused',activeMs:9000});
 expect(frame(16000,timing)).toMatchObject({status:'building',activeMs:10000,running:true});
});
it('completes one cabinet before starting a new one without decreasing cumulative work',()=>{
 expect(frame(26000,timing)).toMatchObject({cycle:0,status:'completed',activeMs:20000,totalMs:20000,finishedMs:26000,running:false,detected:false});
 expect(frame(29999,timing)).toMatchObject({status:'completed',activeMs:20000,totalMs:20000});
 expect(frame(30000,timing)).toMatchObject({cycle:1,status:'building',activeMs:0,totalMs:20000,startedMs:30000,finishedMs:null});
 expect(frame(34000,timing)).toMatchObject({activeMs:4000,totalMs:24000});
});
