import {ArrowUpRight,CheckCircle2,Clock3,Gauge,HardHat,Pause,WifiOff} from 'lucide-react';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {CSSProperties,ReactNode} from 'react';
import type {FloorCabinet} from './ActiveCabinets';
import {visibleBuildMs} from './live-build-time';
import {buildStationSpeed,stationDuration,stationSpeedLabel,stationHealthHue} from './build-station-speed';
import {defaultDepartmentLayout,stationColumnCount} from './department-layout';
import type {DepartmentLayout} from './department-layout';
import {newStationBuilds} from './station-build-starts';
import './build-stations.css';

type BuildStation={id:string;name:string;status:string;devices:number;timerOnly?:boolean;people?:{name:string}[];
 cabinet?:{desiredPaceMs?:number;averageBuildMs:number;completed:number;cabinets:FloorCabinet[]}|null};
const active=(cabinet:FloorCabinet)=>cabinet.status==='building'||cabinet.status==='paused';
const clock=(ms:number)=>{const seconds=Math.floor(Math.max(0,ms)/1000);return `${Math.floor(seconds/3600)}:${String(Math.floor(seconds/60)%60).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;};

export function BuildStations({stations,cabinets,nowMs,desiredPaceMs,onStation,actions,layout=defaultDepartmentLayout}:{stations:BuildStation[];cabinets:FloorCabinet[];nowMs:number;desiredPaceMs?:number;onStation?:(id:string)=>void;actions?:ReactNode;layout?:DepartmentLayout}){
 const timerStations=stations.filter(s=>s.timerOnly||s.cabinet).sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true})||a.id.localeCompare(b.id));
 const grid=useRef<HTMLDivElement>(null);
 const [gridWidth,setGridWidth]=useState(0);
 const [motionReady,setMotionReady]=useState(false);
 useEffect(()=>{
  let second:number|undefined;
  const first=requestAnimationFrame(()=>{second=requestAnimationFrame(()=>setMotionReady(true));});
  return()=>{cancelAnimationFrame(first);if(second!==undefined)cancelAnimationFrame(second);};
 },[]);
 useLayoutEffect(()=>{
  const element=grid.current;if(!element)return;
  const resize=()=>setGridWidth(element.clientWidth);resize();
  const observer=new ResizeObserver(resize);observer.observe(element);return()=>observer.disconnect();
 },[timerStations.length]);
 const previous=useRef<Map<string,string>|null>(null);
 const [completed,setCompleted]=useState<Map<string,FloorCabinet>>(()=>new Map());
 const [started,setStarted]=useState<Map<string,{cabinet:FloorCabinet;until:number}>>(()=>new Map());
 useEffect(()=>{
  const online=new Set(stations.filter(station=>station.status==='online').map(station=>station.id));
  const starts=newStationBuilds(previous.current,cabinets,online);
  const running=new Set(cabinets.filter(cabinet=>cabinet.stationId&&online.has(cabinet.stationId)&&cabinet.status==='building'&&!cabinet.stale).map(cabinet=>cabinet.id));
  setStarted(current=>{
   if(!starts.length&&[...current.values()].every(notice=>running.has(notice.cabinet.id)))return current;
   const next=new Map([...current].filter(([,notice])=>running.has(notice.cabinet.id)));
   for(const cabinet of starts)next.set(cabinet.stationId!,{cabinet,until:Date.now()+1600});
   return next;
  });
  const transitions=cabinets.filter(c=>c.stationId&&c.status==='completed'&&['building','paused'].includes(previous.current?.get(c.id)??''));
  if(transitions.length)setCompleted(current=>new Map([...current,...transitions.map(c=>[c.stationId!,c] as const)]));
  if(starts.length)setCompleted(current=>new Map([...current].filter(([stationId])=>!starts.some(cabinet=>cabinet.stationId===stationId))));
  previous.current=new Map(cabinets.map(c=>[c.id,c.status]));
 },[cabinets,stations]);
 useEffect(()=>{
  if(!started.size)return;
  const nextExpiry=Math.min(...[...started.values()].map(notice=>notice.until));
  const timer=setTimeout(()=>setStarted(current=>new Map([...current].filter(([,notice])=>notice.until>Date.now()))),Math.max(0,nextExpiry-Date.now()));
  return()=>clearTimeout(timer);
 },[started]);
 useEffect(()=>{if(!completed.size)return;const timer=setTimeout(()=>setCompleted(new Map()),1800);return()=>clearTimeout(timer);},[completed]);
 if(!timerStations.length)return null;
 const data=timerStations.map(station=>{
  const records=cabinets.filter(c=>c.stationId===station.id);
  const current=(records.length?records:station.cabinet?.cabinets??[]).filter(active).sort((a,b)=>b.number-a.number);
  const fresh=current.filter(c=>!c.stale),running=fresh.filter(c=>c.status==='building');
  const online=station.status==='online';
  const state=!online?'offline':running.length?'building':fresh.length?'paused':current.length?'stale':'ready';
  const pace=station.cabinet?.desiredPaceMs??desiredPaceMs;
  const total=station.cabinet?.completed??0;
  const speed=buildStationSpeed(station.cabinet?.averageBuildMs,pace,total);
  return {station,current,pace,total,speed,state};
 });
 const building=data.filter(row=>row.state==='building').length,slower=data.filter(row=>row.speed.status==='slow').length;
 return <section className="build-stations" data-density={layout.density} aria-label="Build stations"><div className="build-stations-heading"><div><span className="build-kicker">ON THE FLOOR</span><h3>Build stations <span>{data.length}</span></h3><p>Average build time compared with the desired pace. Lower time is faster.</p></div><div className="section-heading-actions"><span className="build-stations-count">{building} building{slower?` · ${slower} slower than pace`:''}</span>{actions}</div></div><div ref={grid} className="build-stations-grid" style={{gridTemplateColumns:`repeat(${stationColumnCount(gridWidth,data.length,layout)},minmax(0,1fr))`}}>{data.map(({station,current,pace,total,speed,state},index)=>{
  const finished=completed.get(station.id),starting=started.get(station.id)?.cabinet,currentMs=current.reduce((sum,c)=>sum+visibleBuildMs({...c,stale:c.stale||state==='offline'||state==='stale'},nowMs),0);
  const scale=Math.max(1.25,(speed.ratio??0)*1.15),marker=100/scale,fill=speed.ratio===null?0:Math.min(100,speed.ratio/scale*100);
  const operator=station.people?.[0]?.name||current[0]?.operatorName;
  const hue=stationHealthHue(speed.ratio);
  const stateLabel=state==='building'?'Building now':state==='paused'?'Build paused':state==='offline'?'Device offline':state==='stale'?'Waiting for device update':'Ready for next cabinet';
  return <article key={station.id} className={`build-station-card ${state} speed-${speed.status}${hue!==null?' health-tinted':''}${finished?' just-completed':''}${starting?' just-started':''}`} data-motion-ready={motionReady} data-station-id={station.id} data-health-ratio={speed.ratio??undefined} style={hue===null?undefined:{'--health-hue':hue} as CSSProperties}>
   <span className="build-station-surface" aria-hidden="true"/>
   {starting&&<span key={starting.id} className="build-station-start-burst" aria-hidden="true"/>}
   <div className="build-station-top"><div><span className="build-station-number">BUILD STATION {String(index+1).padStart(2,'0')}</span><h4>{operator||'No operator assigned'}</h4></div>{onStation&&<button className="build-station-open" onClick={()=>onStation(station.id)} aria-label={'Open '+station.name} title="Open workstation"><ArrowUpRight size={18}/></button>}</div>
   <div className={'build-station-health '+speed.status} aria-label={speed.status==='good'?'Within desired pace':speed.status==='slow'?'Slower than desired pace':'Waiting for build history'}><Gauge size={15}/><span className="station-health-full">{speed.status==='good'?'Within desired pace':speed.status==='slow'?'Slower than desired pace':'Waiting for build history'}</span><span className="station-health-short">{speed.status==='good'?'Within pace':speed.status==='slow'?'Slower pace':'No history'}</span></div>
   <div className="build-station-speed"><div><span>AVG. BUILD TIME</span><strong>{total>0?stationDuration(station.cabinet?.averageBuildMs):'\u2014'}</strong></div><div className="build-station-desired"><span>DESIRED PACE</span><strong>{stationDuration(pace)}</strong><small>per cabinet</small></div></div>
   <div className="build-station-speed-track" role="img" aria-label={`Average build time ${total?stationDuration(station.cabinet?.averageBuildMs):'unavailable'}; desired ${stationDuration(pace)} per cabinet`}><span style={{width:fill+'%'}}/><i style={{left:marker+'%'}}/></div>
   <div className="build-station-speed-caption"><span>{stationSpeedLabel(speed)}</span><span>Desired <i/></span></div>
   <div className="build-station-current"><div className="build-station-state">{state==='building'?<HardHat size={19}/>:state==='paused'?<Pause size={18}/>:state==='offline'||state==='stale'?<WifiOff size={18}/>:<Clock3 size={18}/>}<div><strong>{starting?'Cabinet started':stateLabel}</strong><small>{current.length>1?`${current.length} cabinets in progress`:current[0]?`Cabinet #${current[0].number}`:'Station stays visible between builds'}</small></div></div><div className="build-station-current-time"><span>BUILD TIME</span><strong key={starting?.id??'current'}>{current.length?clock(currentMs):'\u2014'}</strong></div></div>
   <div className="build-station-footer"><span><CheckCircle2 size={15}/> Cabinets completed</span><strong>{total}</strong></div>
   {finished&&<div className="build-station-completion" role="status"><CheckCircle2 size={20}/><span>Cabinet #{finished.number} complete</span></div>}
   {starting&&<span className="build-station-start-announcement" role="status">Cabinet #{starting.number} started at {station.name}</span>}
  </article>;
 })}</div></section>;
}
