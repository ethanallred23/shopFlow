import {ArrowUpRight,Clock3,Factory,FlaskConical,Settings,TrendingUp,TrendingDown,UsersRound} from 'lucide-react';
import {useEffect,useState} from 'react';
import type {CSSProperties} from 'react';
import {CabinetProgress} from './CabinetProgress';
import {buildStationSpeed,stationSpeedLabel} from './build-station-speed';
import {OperatorActivity} from './OperatorActivity';
import {HideSectionButton,ViewCustomizer,useDepartmentViewPreferences} from './DepartmentViewPreferences';
import {departmentSimulation} from './department-simulation';
import './department-simulation.css';

type DepartmentViewProps={department:any;stations:any[];zone:string;onStation?:(id:string)=>void;onConfigure?:()=>void;onPace?:()=>void;onSchedule?:()=>void};

export function DepartmentView(props:DepartmentViewProps){
 const [session,setSession]=useState<{departmentId:string;startedAt:number}|null>(null);
 const [nowMs,setNowMs]=useState(()=>Date.now());
 const simulating=session?.departmentId===props.department.id;
 useEffect(()=>{
  if(!simulating)return;
  const timer=setInterval(()=>setNowMs(Date.now()),1000);
  return()=>clearInterval(timer);
 },[simulating]);
 // Changing departments ends the preview; sample mode never follows a real station link.
 useEffect(()=>setSession(null),[props.department.id]);
 const sample=simulating&&session?departmentSimulation(session.startedAt,nowMs):null;
 const toggle=()=>{const now=Date.now();setNowMs(now);setSession(simulating?null:{departmentId:props.department.id,startedAt:now});};
 return <DepartmentFloor {...props} key={props.department.id+':'+simulating}
  department={sample?{...props.department,cabinetPaceMs:sample.paceMs,cabinet:sample.progress}:props.department}
  stations={sample?.stations??props.stations} simulating={simulating} onToggleSimulation={toggle}
  onStation={simulating?undefined:props.onStation} onConfigure={simulating?undefined:props.onConfigure}
  onPace={simulating?undefined:props.onPace} onSchedule={simulating?undefined:props.onSchedule}/>;
}

function DepartmentFloor({department,stations,zone,onStation,onConfigure,onPace,onSchedule,simulating,onToggleSimulation}:DepartmentViewProps&{simulating:boolean;onToggleSimulation:()=>void}){
 const preferences=useDepartmentViewPreferences(department.id+(simulating?':presentation':''));
 const [detailsOpen,setDetailsOpen]=useState(preferences.layout.density==='comfortable');
 useEffect(()=>setDetailsOpen(preferences.layout.density==='comfortable'),[preferences.layout.density]);
 const comparison=(s:any)=>{
  if(s.timerOnly){
   const speed=buildStationSpeed(s.cabinet?.averageBuildMs,s.cabinet?.desiredPaceMs??department.cabinetPaceMs,s.cabinet?.completed??0);
   return {label:speed.status==='good'?'Within desired pace':speed.status==='slow'?'Slower than desired pace':'No build history',className:speed.status==='good'?'ahead':speed.status==='slow'?'behind':'unknown',difference:null,detail:stationSpeedLabel(speed)};
  }
  const recorded=s.timerOnly?s.cabinet?.completed:s.count;
  if(recorded==null)return {label:'No measurements',className:'unknown',difference:null,detail:undefined};
  if(!s.target)return {label:'No target',className:'unknown',difference:null,detail:undefined};
  const difference=recorded-(s.timerOnly?s.cabinet?.expected??0:s.expected);
  return {label:difference>0?'Ahead of desired pace':difference<0?'Behind desired pace':'At desired pace',className:difference>0?'ahead':difference<0?'behind':'on-time',difference,detail:undefined};
 };
 const ahead=stations.filter(s=>comparison(s).className==='ahead').length,behind=stations.filter(s=>comparison(s).className==='behind').length;
 return <div data-density={preferences.layout.density} className={'department-view layout-'+preferences.layout.density+' theme-'+(department.themeMode==='dark'?'dark':'light')} style={{'--department-color':department.themeColor||'#287f83'} as CSSProperties}>
  <div className="department-intro"><div><span className="department-eyebrow"><Factory size={15}/> QUALITY CRAFT WOOD WORKS</span><h2>{department.name}</h2><p>Desired pace: <strong>{Math.round((department.cabinetPaceMs??600000)/60000)} min per cabinet, per workstation</strong> · {stations.length} workstations</p><a className="department-share" href={'?department='+encodeURIComponent(department.id)}>Shared department page</a><div className="department-controls">{onPace&&<button className="department-configure" onClick={onPace}><Clock3 size={15}/> Set cabinet pace</button>}{onSchedule&&<button className="department-configure" onClick={onSchedule}><Clock3 size={15}/> Day & breaks</button>}{onConfigure&&<button className="department-configure" onClick={onConfigure}><Settings size={15}/> Appearance</button>}<button type="button" className="department-configure simulation-toggle" aria-pressed={simulating} onClick={onToggleSimulation}><FlaskConical size={15}/>{simulating?'Exit simulation':'Simulation mode'}</button><ViewCustomizer preferences={preferences}/></div></div><div className="department-pulse"><span><TrendingUp size={17}/><b>{ahead}</b> within pace</span><span className={behind?'needs-attention':''}><TrendingDown size={17}/><b>{behind}</b> slower</span><span><UsersRound size={17}/><b>{stations.filter(s=>s.people?.length).length}</b> staffed</span></div></div>
  {simulating&&<div className="department-simulation-notice" role="status"><FlaskConical size={20}/><div><strong>Simulation mode: sample data</strong><p>Four sample stations build, pause, and complete cabinets automatically. This preview runs only in your browser. Exit simulation to return to live production.</p></div></div>}
  {preferences.isVisible('cabinetProgress')&&(department.cabinet?<CabinetProgress key={department.id} progress={department.cabinet} simulation={simulating} viewPreferences={preferences} zone={zone} department themeMode={department.themeMode==='dark'?'dark':'light'} stations={stations} onStation={onStation} title={`${department.name} cabinet progress`}/>:<div className="panel"><h2>Department production</h2><p>Assign timer devices to workstations to see the combined cabinet progress here.</p></div>)}
  {(preferences.isVisible('stationTable')||preferences.isVisible('operatorActivity'))&&<details className="department-detail-sections" open={detailsOpen} onToggle={event=>setDetailsOpen(event.currentTarget.open)}><summary>Workstation & operator details</summary>
  {preferences.isVisible('stationTable')&&<section className="panel"><div className="panel-heading"><div><h2>Workstation pace</h2><p>Completed cabinets compared with the desired minutes per cabinet during working time.</p></div><HideSectionButton preferences={preferences} section="stationTable"/></div><div className="table-wrap"><table><thead><tr><th>Workstation / device</th><th>Operator</th><th>Completed output</th><th>At desired pace</th><th>Expected now</th><th>Pace</th><th>Build state</th></tr></thead><tbody>{stations.map(s=>{
   const pace=comparison(s),current=s.cabinet?.cabinets?.filter((c:any)=>c.status==='building'||c.status==='paused')??[];
   return <tr key={s.id}><td>{onStation?<button className="text-button" onClick={()=>onStation(s.id)}>{s.name}<ArrowUpRight size={14}/></button>:<strong>{s.name}</strong>}<small>{s.devices} device{s.devices===1?'':'s'} / {s.status}</small></td><td>{s.people?.[0]?.name||<strong className="operator-missing">No user assigned</strong>}</td><td><strong>{s.timerOnly?s.cabinet?.completed??0:s.count??'-'}</strong> {s.timerOnly?'cabinets':'parts'}</td><td>{s.target}</td><td>{s.timerOnly?s.cabinet?.expected??0:s.expected}</td><td><span className={'pace-status '+pace.className}>{pace.label}{pace.difference!==null&&pace.difference!==0?` (${pace.difference>0?'+':''}${pace.difference})`:''}</span>{pace.detail&&<small>{pace.detail}</small>}</td><td>{current.length?current.some((c:any)=>!c.stale&&c.status==='building')?'Building':current.every((c:any)=>c.stale)?'Last reported active':'Paused':'Waiting'}</td></tr>;
  })}</tbody></table></div>{!stations.length&&<p>No workstations in this department yet. Add one in Settings.</p>}</section>}
  {preferences.isVisible('operatorActivity')&&<OperatorActivity cabinets={department.cabinet?.cabinets??[]} actions={<HideSectionButton preferences={preferences} section="operatorActivity"/>}/>}
  </details>}
 </div>;
}
