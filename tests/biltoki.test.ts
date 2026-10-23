import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
import {it,expect} from 'vitest';

// Exercise the actual control block with GPIO/command stubs. This is a logic
// simulation, not a substitute for compilation against the ESP32 Arduino core.
it('Biltoki toggles once per hand scan, keeps yellow on while running, and beeps on both edges',()=>{
 const source=readFileSync('arduino/Biltoki/Biltoki.ino','utf8');
 const block=source.slice(source.indexOf('  if (rawDetected != candidateDetected)'),source.indexOf('  // Log the raw hand sensor')).replace('bool isCounting','var isCounting');
 const pins:Record<number,number>={};
 const state=createContext({candidateDetected:true,candidateSince:0,scanArmed:false,buildActive:false,timerPaused:false,snapshotNeeded:false,buzzerActive:false,buzzerStartedAt:0,cabinetId:'id',cabinetStarted:0,cabinetFinished:0,cabinetElapsed:0,SCAN_DEBOUNCE_MS:100,BUZZER_BEEP_MS:150,HIGH:1,LOW:0,LED_PIN:2,BUZZER_PIN:9,makeRandomId:()=>{},digitalWrite:(pin:number,value:number)=>{pins[pin]=value;},serviceTimerCommand:()=>{}});
 const sample=(now:number,rawDetected:boolean,command?:boolean)=>{Object.assign(state,{now,rawDetected,wasCounting:state.buildActive&&!state.timerPaused,scanToggled:false,serviceTimerCommand:()=>{if(command!==undefined)state.timerPaused=command;}});runInContext(block,state);};
 sample(1000,true);expect(state.buildActive).toBe(false);expect(pins[2]).toBe(0);
 sample(1001,false);sample(1101,false);sample(1102,true);sample(1150,false);expect(state.buildActive).toBe(false);
 sample(1200,true);sample(1300,true);expect(state.buildActive).toBe(true);expect(pins[2]).toBe(1);expect(pins[9]).toBe(1);
 sample(1449,true);expect(pins[9]).toBe(1);sample(1450,true);expect(pins[9]).toBe(0);
 sample(5000,true);expect(state.buildActive).toBe(true);
 sample(5001,false);sample(5101,false);expect(pins[2]).toBe(1);
 sample(5102,true);sample(5202,true);expect(state.buildActive).toBe(false);expect(pins[2]).toBe(0);expect(pins[9]).toBe(1);expect(state.cabinetFinished).toBe(5202);
 sample(5352,true);expect(pins[9]).toBe(0);
 sample(5400,false);sample(5500,false);sample(5600,true);sample(5700,true);expect(state.buildActive).toBe(true);expect(state.cabinetStarted).toBe(5700);
 sample(5900,false,true);expect(pins[2]).toBe(0);expect(pins[9]).toBe(1);
 sample(6100,false,false);expect(pins[2]).toBe(1);expect(pins[9]).toBe(1);
});
