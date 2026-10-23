import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
import {it,expect} from 'vitest';
const source=readFileSync('arduino/Biltoki/Biltoki.ino','utf8');
// Execute actual control blocks with GPIO stubs; this is not an ESP32 compilation.
function fixture(){
 const block=source.slice(source.indexOf('  // Resolve a single swipe'),source.indexOf('  // Log the raw hand sensor')).replace('bool isCounting','var isCounting');
 const pins:Record<number,number>={};
 const state=createContext({candidateDetected:true,candidateSince:0,scanArmed:false,swipePending:false,firstSwipeAt:0,buildActive:false,timerPaused:false,snapshotNeeded:false,buzzerActive:false,buzzerStartedAt:0,cabinetId:'id',cabinetStarted:0,cabinetFinished:0,cabinetElapsed:0,SCAN_DEBOUNCE_MS:100,DOUBLE_SWIPE_MS:600,BUZZER_BEEP_MS:350,HIGH:1,LOW:0,LED_PIN:2,BUZZER_PIN:9,Serial:{println:()=>{}},makeRandomId:()=>{},digitalWrite:(pin:number,value:number)=>{pins[pin]=value;},serviceTimerCommand:()=>{}});
 const sample=(now:number,rawDetected:boolean,command?:boolean)=>{Object.assign(state,{now,rawDetected,wasCounting:state.buildActive&&!state.timerPaused,scanToggled:false,serviceTimerCommand:()=>{if(command!==undefined){state.timerPaused=command;state.swipePending=false;}}});runInContext(block,state);};
 const swipe=(at:number)=>{sample(at-201,false);sample(at-101,false);sample(at-100,true);sample(at,true);};
 return {state,pins,sample,swipe};
}
it('starts once, rejects noise and held hands, and beeps for 350ms',()=>{
 const {state,pins,sample,swipe}=fixture();
 sample(1000,true);expect(state.buildActive).toBe(false);
 sample(1001,false);sample(1101,false);sample(1102,true);sample(1150,false);expect(state.buildActive).toBe(false);
 swipe(1500);expect(state.buildActive).toBe(true);expect(pins[2]).toBe(1);expect(pins[9]).toBe(1);
 sample(1849,true);expect(pins[9]).toBe(1);sample(1850,true);expect(pins[9]).toBe(0);
 sample(5000,true);expect(state.swipePending).toBe(false);expect(state.buildActive).toBe(true);
});
it('single swipes pause/resume the same cabinet; double swipes finish from running or paused',()=>{
 for(const paused of [false,true]){
  const {state,pins,sample,swipe}=fixture();swipe(1000);
  swipe(2000);sample(2600,true);expect(state.timerPaused).toBe(false);sample(2601,true);
  expect(state.timerPaused).toBe(true);expect(state.buildActive).toBe(true);expect(pins[2]).toBe(0);expect(pins[9]).toBe(1);
  if(!paused){swipe(3000);sample(3601,true);expect(state.timerPaused).toBe(false);expect(pins[2]).toBe(1);}
  expect(state.cabinetStarted).toBe(1000);
  swipe(4000);swipe(4400);expect(state.buildActive).toBe(false);expect(state.cabinetFinished).toBe(4400);expect(pins[2]).toBe(0);expect(pins[9]).toBe(1);
  sample(4750,true);expect(pins[9]).toBe(0);
  swipe(5000);expect(state.buildActive).toBe(true);expect(state.cabinetStarted).toBe(5000);expect(state.timerPaused).toBe(false);
 }
});
it('accepts a second swipe at the window boundary, treats slower swipes separately, and cancels pending gestures on remote commands',()=>{
 const {state,sample,swipe}=fixture();swipe(1000);swipe(2000);swipe(2600);expect(state.buildActive).toBe(false);
 swipe(3000);swipe(4000);sample(4601,true);expect(state.timerPaused).toBe(true);
 swipe(5000);sample(5100,true,false);sample(5601,true);expect(state.timerPaused).toBe(false);expect(state.buildActive).toBe(true);
});
it('logs each red LED cause on change, repeats active errors, and logs recovery',()=>{
 const begin=source.indexOf('  uint32_t errors = networkErrors.load()');
 const block=source.slice(begin,source.indexOf('  delay(1);',begin)).replace('uint32_t errors','var errors').replace('  static uint32_t lastErrors = 0;','').replace('  static uint64_t lastErrorLog = 0;','');
 const logs:unknown[][]=[];let mask=0;let pin=0;
 const state=createContext({now:100,networkErrors:{load:()=>mask},hardwareError:false,queueError:false,commandError:{load:()=>false},lastErrors:0,lastErrorLog:0,CONFIG_ERROR:1,WIFI_ERROR:2,CLOCK_ERROR:4,HEARTBEAT_ERROR:8,ACK_ERROR:16,POLL_ERROR:32,EVENT_ERROR:64,MALFORMED_COMMAND_ERROR:128,HARDWARE_ERROR:256,QUEUE_ERROR:512,COMMAND_ERROR:1024,ERROR_LED_PIN:7,HIGH:1,LOW:0,digitalWrite:(_:number,value:number)=>{pin=value;},Serial:{printf:(...args:unknown[])=>logs.push(args)}});
 mask=2|64;runInContext(block,state);expect(pin).toBe(1);expect(logs).toHaveLength(1);expect(logs[0][3]).toBe(true);expect(logs[0][8]).toBe(true);
 state.now=200;runInContext(block,state);expect(logs).toHaveLength(1);
 state.now=15100;runInContext(block,state);expect(logs).toHaveLength(2);
 mask=0;state.now=15200;runInContext(block,state);expect(pin).toBe(0);expect(logs[2][1]).toContain('cleared');
});
