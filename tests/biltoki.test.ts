import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
import {it,expect} from 'vitest';

const source=readFileSync('arduino/Biltoki/Biltoki.ino','utf8');
// Execute the actual button transition body with queue/IO stubs. This is not
// an ESP32 compilation or a physical button debounce test.
function fixture(){
 const begin=source.indexOf('void localAction(uint8_t action, uint64_t now) {');
 const end=source.indexOf('\nvoid setup()',begin);
 if(begin<0||end<0)throw new Error('Biltoki localAction block not found');
 const block=source.slice(begin,end).replace('void localAction(uint8_t action, uint64_t now)','function localAction(action, now)');
 const snapshots:Array<[boolean,number,boolean]>=[],beeps:number[]=[],slots:number[]=[];
 let capacity=true;
 const state=createContext({buildActive:false,timerPaused:false,cabinetId:'',cabinetStarted:0,cabinetFinished:0,cabinetElapsed:0,lastSnapshot:0,hardwareError:false,
  actionCapacity:(needed:number)=>{slots.push(needed);return capacity;},makeRandomId:()=>{},startBeeps:(n:number)=>beeps.push(n),
  queueSnapshot:(...args:[boolean,number,boolean])=>{snapshots.push(args);return true;},Serial:{println:()=>{}}});
 runInContext(block,state);
 const action=(kind:number,at:number)=>runInContext(`localAction(${kind},${at})`,state);
 return {state,snapshots,beeps,slots,action,deny:()=>{capacity=false;}};
}

it('keeps each button boundary in order with its own measured snapshot',()=>{
 const f=fixture();
 f.action(0,1000);expect(f.state.buildActive).toBe(true);expect(f.state.cabinetStarted).toBe(1000);
 f.action(1,2000);expect(f.state.timerPaused).toBe(true);
 f.action(0,3000);expect(f.state.timerPaused).toBe(false);
 f.action(2,4000);expect(f.state.buildActive).toBe(false);expect(f.state.cabinetFinished).toBe(4000);
 expect(f.snapshots).toEqual([[true,1000,true],[true,2000,true],[true,3000,true],[false,4000,true]]);
 expect(f.beeps).toEqual([1,2,1,3]);
 expect(f.slots).toEqual([2,2,2,1]);
});

it('refuses a new action when the offline snapshot queue has no capacity',()=>{
 const f=fixture();f.deny();f.action(0,1000);
 expect(f.state.buildActive).toBe(false);expect(f.snapshots).toHaveLength(0);
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
