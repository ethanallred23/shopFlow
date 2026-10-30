import {ArrowUpRight,Clock3,Factory,Settings,TrendingUp,TrendingDown,UsersRound} from 'lucide-react';
import type {CSSProperties} from 'react';
import {CabinetProgress} from './CabinetProgress';
import {buildStationSpeed,stationSpeedLabel} from './build-station-speed';
import {OperatorActivity} from './OperatorActivity';
import {HideSectionButton,ViewCustomizer,useDepartmentViewPreferences} from './DepartmentViewPreferences';

export function DepartmentView({department,stations,zone,onStation,onConfigure,onPace,onSchedule}:{department:any;stations:any[];zone:string;onStation:(id:string)=>void;onConfigure?:()=>void;onPace?:()=>void;onSchedule?:()=>void}){
 const preferences=useDepartmentViewPreferences(department.id);
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
 return <div className={'department-view theme-'+(department.themeMode==='dark'?'dark':'light')} style={{'--department-color':department.themeColor||'#287f83'} as CSSProperties}>
  <div className="department-intro"><div><span className="department-eyebrow"><Factory size={15}/> QUALITY CRAFT WOOD WORKS</span><h2>{department.name}</h2><p>Desired pace: <strong>{Math.round((department.cabinetPaceMs??600000)/60000)} min per cabinet, per workstation</strong> · {stations.length} workstations</p><a className="department-share" href={'?department='+encodeURIComponent(department.id)}>Shared department page</a><div className="department-controls">{onPace&&<button className="department-configure" onClick={onPace}><Clock3 size={15}/> Set cabinet pace</button>}{onSchedule&&<button className="department-configure" onClick={onSchedule}><Clock3 size={15}/> Day & breaks</button>}{onConfigure&&<button className="department-configure" onClick={onConfigure}><Settings size={15}/> Appearance</button>}<ViewCustomizer preferences={preferences}/></div></div><div className="department-pulse"><span><TrendingUp size={17}/><b>{ahead}</b> within pace</span><span className={behind?'needs-attention':''}><TrendingDown size={17}/><b>{behind}</b> slower</span><span><UsersRound size={17}/><b>{stations.filter(s=>s.people?.length).length}</b> staffed</span></div></div>
  {preferences.isVisible('cabinetProgress')&&(department.cabinet?<CabinetProgress key={department.id} progress={department.cabinet} viewPreferences={preferences} zone={zone} department themeMode={department.themeMode==='dark'?'dark':'light'} stations={stations} onStation={onStation} title={`${department.name} cabinet progress`}/>:<div className="panel"><h2>Department production</h2><p>Assign timer devices to workstations to see the combined cabinet progress here.</p></div>)}
  {preferences.isVisible('stationTable')&&<section className="panel"><div className="panel-heading"><div><h2>Workstation pace</h2><p>Completed cabinets compared with the desired minutes per cabinet during working time.</p></div><HideSectionButton preferences={preferences} section="stationTable"/></div><div className="table-wrap"><table><thead><tr><th>Workstation / device</th><th>Operator</th><th>Completed output</th><th>At desired pace</th><th>Expected now</th><th>Pace</th><th>Build state</th></tr></thead><tbody>{stations.map(s=>{
   const pace=comparison(s),current=s.cabinet?.cabinets?.filter((c:any)=>c.status==='building'||c.status==='paused')??[];
   return <tr key={s.id}><td><button className="text-button" onClick={()=>onStation(s.id)}>{s.name}<ArrowUpRight size={14}/></button><small>{s.devices} device{s.devices===1?'':'s'} / {s.status}</small></td><td>{s.people?.[0]?.name||<strong className="operator-missing">No user assigned</strong>}</td><td><strong>{s.timerOnly?s.cabinet?.completed??0:s.count??'-'}</strong> {s.timerOnly?'cabinets':'parts'}</td><td>{s.target}</td><td>{s.timerOnly?s.cabinet?.expected??0:s.expected}</td><td><span className={'pace-status '+pace.className}>{pace.label}{pace.difference!==null&&pace.difference!==0?` (${pace.difference>0?'+':''}${pace.difference})`:''}</span>{pace.detail&&<small>{pace.detail}</small>}</td><td>{current.length?current.some((c:any)=>!c.stale&&c.status==='building')?'Building':current.every((c:any)=>c.stale)?'Last reported active':'Paused':'Waiting'}</td></tr>;
  })}</tbody></table></div>{!stations.length&&<p>No workstations in this department yet. Add one in Settings.</p>}</section>}
  {preferences.isVisible('operatorActivity')&&<OperatorActivity cabinets={department.cabinet?.cabinets??[]} actions={<HideSectionButton preferences={preferences} section="operatorActivity"/>}/>}
 </div>;
}
