import {useEffect,useState} from 'react';
import {Timer,Radio} from 'lucide-react';

export const duration=(ms:number|null)=>ms===null?'—':`${Math.floor(ms/60000).toLocaleString()}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}`;
type Command=(deviceId:string,type:string,totalDetectedMs?:number)=>Promise<void>;

export function DetectionTimers({timers,status,zone,onCommand,canControl=false}:{timers:any[];status:string;zone:string;onCommand?:Command;canControl?:boolean}){
 if(!timers?.length)return null;
 return <section className="panel detection-panel"><h2><Timer size={18}/> Detected time</h2><p>Device-measured accumulation · minutes:seconds · pauses when absent</p>{timers.map(t=><TimerDevice key={t.deviceId} t={t} zone={zone} onCommand={onCommand} canControl={canControl}/>)}</section>;
}

function TimerDevice({t,zone,onCommand,canControl}:{t:any;zone:string;onCommand?:Command;canControl:boolean}){
 const [total,setTotal]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[pollError,setPollError]=useState(''),[command,setCommand]=useState<any>(null);
 const waitingForDevice=busy||command?.status==='pending';
 const base='/api/devices/'+t.deviceId+'/commands';
 useEffect(()=>{
  if(!canControl)return;
  let stopped=false;
  const refresh=async()=>{try{
   const value=await commandRequest(command?.id?base+'/'+command.id:base);
   if(!stopped){setCommand(Array.isArray(value)?value[0]??null:value);setPollError('');}
  }catch(e:any){if(!stopped)setPollError('Cannot verify device execution: '+e.message);}};
  void refresh();const timer=setInterval(refresh,3000);
  return()=>{stopped=true;clearInterval(timer);};
 },[base,canControl,command?.id]);
 const send=async(type:string,value?:number)=>{
  if(busy)return;
  setBusy(true);setError('');
  try{
   if(onCommand){await onCommand(t.deviceId,type,value);return;}
   const me=await commandRequest('/api/me');
   const queued=await commandRequest(base,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':me.csrf},body:JSON.stringify({type,...(value===undefined?{}:{totalDetectedMs:value})})});
   setCommand(queued);if(type==='set_total_detected_ms')setTotal('');
  }catch(e:any){setError(e.message+' Execution is unconfirmed; check command status before retrying.');}
  finally{setBusy(false);}
 };
 return <article className="timer-device"><div className="timer-state"><Radio size={17}/><strong>{t.detected===null?'No snapshot yet':`${t.snapshotFresh?'Current':'Last reported'}: ${t.detected?'Detected':'Absent'}`}</strong><span>{t.snapshotFresh?'Sample and receipt within 30 seconds':'Sensor state is stale or unavailable'}</span></div><p>Device connection: {t.connection}. Connection status does not mean detected or absent.</p><div className="metrics"><div className="metric"><div className="metric-label">Current counter</div><div className="metric-value">{duration(t.currentCounterMs)}</div><p>Resets when the device counter resets</p></div><div className="metric"><div className="metric-label">Recovered device time · all-time</div><div className="metric-value">{duration(t.recoveredTotalMs)}</div><p>Across counters and assignments; never summed snapshots</p></div><div className="metric"><div className="metric-label">Confirmed within selected shift/day</div><div className="metric-value">{duration(t.confirmedShiftMs)}</div><p>Only intervals fully contained in the selected window</p></div><div className="metric"><div className="metric-label">Unallocated device time · all-time</div><div className="metric-value">{duration(t.unallocatedAllTimeMs)}</div><p>First snapshots, unknown clocks or assignment changes</p></div></div><div className={'timer-controls'+(waitingForDevice?' waiting':'')}>{waitingForDevice&&<div className="timer-wait" role="status"><span className="timer-spinner" aria-hidden="true"/><strong>Waiting for the Arduino…</strong><small>The command was accepted by ShopFlow. This stays active until the device acknowledges execution.</small></div>}{!canControl&&<p className="notice amber" role="status">Timer controls require supervisor or administrator access. Ask an administrator to update your role.</p>}{busy&&<p role="status">Sending command…</p>}{error&&<p role="alert" className="form-error">{error}</p>}{pollError&&<p role="alert" className="form-error">{pollError}</p>}{command&&<p role="status">{command.type}: {command.status==='pending'?'Queued — awaiting Arduino acknowledgement':command.status==='applied'?'Applied by Arduino':command.status==='rejected'?'Rejected by Arduino: '+(command.error||'No reason supplied'):command.status==='expired'?'Expired — no acknowledgement received; execution is unconfirmed':command.status}</p>}<strong>Timer controls</strong><p className="hint">Commands wait for the Arduino to poll. Reset and set-total start a new counter; they do not erase history.</p><div><button disabled={waitingForDevice} title={!canControl?'Supervisor or administrator access required':undefined} onClick={()=>send('pause')}>Pause</button><button disabled={waitingForDevice} title={!canControl?'Supervisor or administrator access required':undefined} onClick={()=>send('resume')}>Resume</button><button disabled={waitingForDevice} title={!canControl?'Supervisor or administrator access required':undefined} onClick={()=>send('reset')}>Reset</button><label>Set total (ms)<input disabled={waitingForDevice} type="number" min="0" value={total} onChange={e=>setTotal(e.target.value)} placeholder="e.g. 60000"/><button disabled={waitingForDevice||total===''||!/^[0-9]+$/.test(total)||!Number.isSafeInteger(Number(total))} onClick={()=>send('set_total_detected_ms',Number(total))}>Send</button></label></div></div>{t.boundaryUncertainMs>0&&<div className="notice amber">{duration(t.boundaryUncertainMs)} spans a selected time boundary. The amount inside this shift is unknown and excluded.</div>}<small>Last valid snapshot received: {t.receivedAt?new Date(t.receivedAt).toLocaleString(undefined,{timeZone:zone}):'Never'} · Device {t.deviceId}</small>{t.notices.map((n:any)=><p className={n.accepted?'hint':'form-error'} key={n.id}>{n.notice}</p>)}</article>;
}

async function commandRequest(path:string,options:RequestInit={}){
 const response=await fetch(path,{...options,signal:AbortSignal.timeout(10000)});
 const value=await response.json().catch(()=>null);
 if(!response.ok)throw new Error(value?.error||`Request failed (HTTP ${response.status})`);
 if(!value)throw new Error('Server returned an invalid response');
 return value;
}
