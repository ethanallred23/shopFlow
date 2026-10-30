import {ArrowUpRight,CheckCircle2,HardHat,Pause,WifiOff} from 'lucide-react';
import {useEffect,useRef,useState} from 'react';
import type {ReactNode} from 'react';
import {visibleBuildMs} from './live-build-time';

export type FloorCabinet={
 id:string;number:number;status:string;stale:boolean;durationMs:number;lastReportedAt:string;
 stationId?:string;stationName?:string;operatorName?:string|null;
 startedAt?:string|null;
};

const active=(cabinet:FloorCabinet)=>cabinet.status==='building'||cabinet.status==='paused';
const clock=(ms:number)=>{
 const seconds=Math.floor(Math.max(0,ms)/1000);
 return `${Math.floor(seconds/3600)}:${String(Math.floor(seconds/60)%60).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
};

export function ActiveCabinets({cabinets,nowMs,department,onStation,actions}:{cabinets:FloorCabinet[];nowMs:number;department:boolean;onStation?:(id:string)=>void;actions?:ReactNode}){
 const previous=useRef<Map<string,FloorCabinet>|null>(null);
 const [leaving,setLeaving]=useState<FloorCabinet[]>([]);
 useEffect(()=>{
  const next=new Map(cabinets.map(c=>[c.id,{...c}]));
  if(previous.current){
   const completed=[...previous.current.values()].filter(c=>active(c)&&next.get(c.id)?.status==='completed')
    .map(c=>({...next.get(c.id)!,number:c.number,stationId:c.stationId,stationName:c.stationName,operatorName:c.operatorName}));
   if(completed.length)setLeaving(current=>[...current.filter(c=>!completed.some(done=>done.id===c.id)),...completed]);
  }
  previous.current=next;
 },[cabinets]);
 useEffect(()=>{
  if(!leaving.length)return;
  const timer=setTimeout(()=>setLeaving([]),1100);
  return()=>clearTimeout(timer);
 },[leaving]);
 const onFloor=cabinets.filter(active);
 const visible=[...onFloor,...leaving.filter(c=>!onFloor.some(current=>current.id===c.id))].sort((a,b)=>b.number-a.number||a.id.localeCompare(b.id));
 if(!visible.length)return null;
 const building=onFloor.filter(c=>c.status==='building'&&!c.stale).length;
 return <section className="active-cabinets" aria-label="Cabinets on the floor">
  <div className="active-cabinets-heading"><div><span className="build-kicker">ON THE FLOOR</span><h3>{onFloor.length} cabinet{onFloor.length===1?'':'s'} in progress</h3></div><div className="section-heading-actions"><span>{building} building{onFloor.length>building?` · ${onFloor.length-building} paused or last reported`:''}</span>{actions}</div></div>
  <div className="active-cabinets-list">{visible.map(c=>{
   const completed=c.status==='completed',paused=c.status==='paused',stale=c.stale&&!completed;
   const state=completed?'complete':stale?'stale':paused?'paused':'building';
   return <article key={c.id} className={'active-cabinet-card '+state}>
    <span className="active-cabinet-icon" aria-hidden="true">{completed?<CheckCircle2 size={28}/>:stale?<WifiOff size={26}/>:paused?<Pause size={26}/>:<HardHat size={28}/>}</span>
    <div className="active-cabinet-identity"><span className="active-cabinet-label">CABINET #{c.number}</span><strong>{completed?'Complete':stale?'Last reported building':paused?'Paused':'Building now'}</strong><small>{department?(c.stationName||'Workstation unavailable')+(c.operatorName?` · ${c.operatorName}`:' · Operator unassigned'):(c.operatorName||'Operator unassigned')}</small></div>
    <div className="active-cabinet-time"><span>{completed?'FINAL BUILD TIME':'BUILD TIME'}</span><strong>{clock(visibleBuildMs(c,nowMs))}</strong>{stale&&<small>Waiting for device update</small>}{paused&&<small>Timer paused</small>}</div>
    {department&&c.stationId&&onStation&&!completed&&<button type="button" className="active-cabinet-open" onClick={()=>onStation(c.stationId!)} aria-label={`Open ${c.stationName||'workstation'} for cabinet ${c.number}`} title="Open workstation"><ArrowUpRight size={18}/></button>}
   </article>;
  })}</div>
 </section>;
}
