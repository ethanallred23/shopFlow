import {Area,CartesianGrid,Line,ComposedChart,ResponsiveContainer,Tooltip,XAxis,YAxis} from 'recharts';
import {ArrowUpRight,BarChart3,Gauge,LayoutDashboard,Maximize2,Minimize2,PackageCheck,Timer,TrendingUp} from 'lucide-react';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import './cabinet.css';
import {visibleBuildMs} from './live-build-time';
import {ActiveCabinets} from './ActiveCabinets';
import {BuildStations} from './BuildStations';
import {buildStationSpeed,stationDuration,stationSpeedLabel} from './build-station-speed';
import {HideSectionButton,ViewCustomizer} from './DepartmentViewPreferences';
import type {DepartmentSection,DepartmentViewPreferences} from './DepartmentViewPreferences';
import type {ReactNode} from 'react';
import {defaultDepartmentLayout,overviewArrangement} from './department-layout';

const duration=(ms:number|null)=>{if(ms===null)return '—';const totalMinutes=Math.floor(ms/60000),hours=Math.floor(totalMinutes/60),minutes=totalMinutes%60;return hours?`${hours}h ${String(minutes).padStart(2,'0')}m`:`${minutes}m`;};
const buildDuration=(ms:number)=>{const seconds=Math.floor(ms/1000);return `${Math.floor(seconds/3600)}:${String(Math.floor(seconds/60)%60).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;};
const chartTime=(value:string)=>new Date(value).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});

export function CompletionNotice({cabinets}:{cabinets:any[]}){
 const previous=useRef<Map<string,string>|null>(null);
 const [celebration,setCelebration]=useState<any>(null);
 useEffect(()=>{
  if(previous.current){
   const completed=cabinets.find(c=>c.status==='completed'&&(['building','paused'].includes(previous.current!.get(c.id)??'')||(!previous.current!.has(c.id)&&c.finishedAt&&Date.now()-Date.parse(c.finishedAt)<30000&&Date.now()>=Date.parse(c.finishedAt))));
   if(completed)setCelebration(completed);
  }
  previous.current=new Map(cabinets.map(c=>[c.id,c.status]));
 },[cabinets]);
 useEffect(()=>{if(!celebration)return;const timer=setTimeout(()=>setCelebration(null),4500);return()=>clearTimeout(timer);},[celebration]);
 return celebration&&<div className="cabinet-celebration" role="status" aria-live="polite"><div className="celebration-card"><span className="celebration-spark spark-one"/><span className="celebration-spark spark-two"/><span className="celebration-icon"><PackageCheck size={36}/></span><span className="build-kicker">ANOTHER ONE COMPLETE</span><strong>Cabinet #{celebration.number} finished!</strong><small>{celebration.stationName||'Nice work, team.'}</small><button onClick={()=>setCelebration(null)} aria-label="Dismiss completion">×</button></div></div>;
}

export function CabinetProgress({progress,compact=false,devMode=false,onSimulate,zone,department=false,themeMode='light',simulation=false,title,stations=[],onStation,viewPreferences}:{progress:any;zone?:string;compact?:boolean;devMode?:boolean;department?:boolean;themeMode?:'light'|'dark';simulation?:boolean;title?:string;stations?:any[];onStation?:(id:string)=>void;onSimulate?:(completed:number)=>Promise<void>;viewPreferences?:DepartmentViewPreferences}){
 const frame=useRef<HTMLElement>(null);
 const [overviewWidth,setOverviewWidth]=useState(0);
 const layout=viewPreferences?.layout??{...defaultDepartmentLayout,density:'comfortable' as const};
 useLayoutEffect(()=>{
  const element=frame.current;if(!element)return;
  const resize=()=>setOverviewWidth(element.clientWidth);resize();
  const observer=new ResizeObserver(resize);observer.observe(element);return()=>observer.disconnect();
 },[!!progress]);
 const [fullscreen,setFullscreen]=useState(false);
 const [nowMs,setNowMs]=useState(()=>Date.now());
 const [view,setView]=useState<'summary'|'graph'>('summary');const [simulating,setSimulating]=useState(false);const [editTest,setEditTest]=useState(false);const [testCompleted,setTestCompleted]=useState(String(progress?.completed??0));const [testError,setTestError]=useState('');const [testNotice,setTestNotice]=useState('');
 useEffect(()=>{const sync=()=>setFullscreen(document.fullscreenElement===frame.current);document.addEventListener('fullscreenchange',sync);return()=>document.removeEventListener('fullscreenchange',sync);},[]);
 useEffect(()=>{if(!progress?.cabinets?.some((c:any)=>c.status==='building'&&!c.stale))return;setNowMs(Date.now());const timer=setInterval(()=>setNowMs(Date.now()),1000);return()=>clearInterval(timer);},[progress]);
 const visible=(section:DepartmentSection)=>viewPreferences?.isVisible(section)??true;
 if(!progress)return null;
 const recentCabinets=[...(progress.cabinets??[])].sort((a:any,b:any)=>{
  return b.number-a.number||a.id.localeCompare(b.id);
 });
 const speedStations=stations.filter(s=>s.timerOnly||s.cabinet);
 const stationSpeed=(station:any)=>buildStationSpeed(station.cabinet?.averageBuildMs,station.cabinet?.desiredPaceMs??progress.desiredPaceMs,station.cabinet?.completed??0);
 const buildingStationCount=speedStations.filter(s=>s.status==='online'&&s.cabinet?.cabinets?.some((c:any)=>c.status==='building'&&!c.stale)).length;
 const behindStations=speedStations.filter(s=>stationSpeed(s).status==='slow').length;
 const aheadStations=speedStations.filter(s=>stationSpeed(s).status==='good').length;
 const paceMode=progress.desiredPaceMs!=null;
 const measuredSpeed=buildStationSpeed(progress.averageBuildMs,progress.desiredPaceMs,progress.completed);
 const status=paceMode?(measuredSpeed.status==='unknown'?'unknown':measuredSpeed.status==='slow'?'behind':measuredSpeed.differenceMs===0?'on-time':'ahead'):progress.completed>progress.expected?'ahead':progress.completed===progress.expected?'on-time':'behind';
 const pace=progress.desiredPaceMs?duration(progress.desiredPaceMs):progress.requiredMsPerCabinet?duration(progress.requiredMsPerCabinet):'—';
 const statusText=paceMode?stationSpeedLabel(measuredSpeed):status==='ahead'?`${progress.completed-progress.expected} cabinet${progress.completed-progress.expected===1?'':'s'} ahead of desired pace`:status==='on-time'?'At desired pace':`${progress.expected-progress.completed} cabinet${progress.expected-progress.completed===1?'':'s'} behind desired pace`;
 const toggle=async()=>{if(document.fullscreenElement===frame.current)await document.exitFullscreen();else await frame.current?.requestFullscreen();};
 const openStation=async(id:string)=>{if(document.fullscreenElement){try{await document.exitFullscreen();}catch{}}onStation?.(id);};
 const color=status==='unknown'?'#839b9f':themeMode==='dark'?(status==='behind'?'#ff786d':'#8fe0ae'):(status==='behind'?'#c63832':'#16865e');
 const timeline=(progress.timeline??[]).map((point:any)=>({...point,time:new Date(point.at).getTime()}));
 const metricItems:Array<{id:DepartmentSection;label:string;icon:ReactNode;value:ReactNode;foot?:string}>=[
  {id:'metricCompleted',label:'Completed',icon:<PackageCheck size={15}/>,value:progress.completed},
  ...(paceMode?[
   {id:'metricPlanned' as const,label:'At desired pace today',icon:<TrendingUp size={15}/>,value:progress.target},
   {id:'metricProjection' as const,label:'On course for',icon:<Gauge size={15}/>,value:progress.projectedTotal??'\u2014',foot:'by shift end'},
   {id:'metricPace' as const,label:'Desired pace',icon:<Timer size={15}/>,value:pace,foot:'/ cabinet'},
  ]:[
   {id:'metricPlanned' as const,label:'Remaining',icon:<TrendingUp size={15}/>,value:progress.remaining},
   {id:'metricPace' as const,label:'Pace needed',icon:<Gauge size={15}/>,value:pace,foot:'/ cabinet'},
  ]),
  {id:'metricAverage',label:'Avg. build time',icon:<Timer size={15}/>,value:progress.completed?stationDuration(progress.averageBuildMs):'\u2014',foot:'/ cabinet'},
  {id:'metricShiftRemaining',label:'Shift remaining',icon:<Timer size={15}/>,value:duration(progress.remainingShiftMs)},
 ];
 const visibleMetrics=metricItems.filter(item=>visible(item.id));
 const metrics=visible('metrics')&&visibleMetrics.length>0&&<div className={'cabinet-metrics'+(paceMode?' pace-metrics':'')+(viewPreferences?' customizable-metrics':'')}>{visibleMetrics.map(item=><div key={item.id} data-metric={item.id} className={item.id==='metricCompleted'?'metric-completed':undefined}><HideSectionButton preferences={viewPreferences} section={item.id} label={item.label}/><span>{item.icon}{item.label}</span><strong>{item.value}{item.foot&&<small>{item.foot}</small>}</strong></div>)}</div>;
 const progressBar=visible('paceProgress')&&<div className="cabinet-pace-section">{viewPreferences&&<div className="section-visibility-heading"><span>Pace progress</span><HideSectionButton preferences={viewPreferences} section="paceProgress"/></div>}<div className="cabinet-progress-track" aria-label={`${progress.completed} cabinets completed; ${progress.target} possible at desired pace`}><span className={status==='behind'?'behind':'on-track'} style={{width:`${progress.progressPct}%`}}/><i className="cabinet-target-marker" style={{left:`${progress.target?Math.min(100,progress.expected/progress.target*100):0}%`}}><b>{paceMode?'Desired pace now':'Expected now'}</b></i></div><div className="cabinet-foot"><span>{statusText}</span><span>{paceMode?`Desired pace ${pace} per cabinet`:`${duration(progress.nonBuildMs)} ${department?'station time not building across all stations':'available shift time not building'}`}</span></div></div>;
 const graph=<div className="cabinet-chart" aria-label="Cabinet completion pace chart"><div className="cabinet-chart-heading"><div><h3>Output outlook</h3><p>Completed cabinets, the desired pace, and the projected total by shift end.</p></div><div className="section-heading-actions"><div className="cabinet-chart-legend"><span><i className="chart-swatch actual"/>Actual</span><span><i className="chart-swatch expected"/>Desired pace</span>{paceMode&&<span><i className="chart-swatch projected"/>On course for</span>}</div><HideSectionButton preferences={viewPreferences} section="outputGraph"/></div></div>{!department&&metrics}<div className="cabinet-graph-status"><strong>{paceMode&&progress.projectedTotal!=null?`On course for ${progress.projectedTotal} by shift end` :statusText}</strong><span>{department?`${buildingStationCount} build station${buildingStationCount===1?'':'s'} currently building.`:progress.active?'A cabinet is currently being built.':'Waiting for the next cabinet.'}</span></div><div className="cabinet-plot"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={timeline} margin={{top:12,right:12,left:-12,bottom:4}}><defs><linearGradient id="cabinetActualFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.3}/><stop offset="100%" stopColor={color} stopOpacity={0.02}/></linearGradient></defs><CartesianGrid stroke="#e5eded" vertical={false}/><XAxis dataKey="time" type="number" domain={['dataMin','dataMax']} tickFormatter={(value)=>chartTime(new Date(value).toISOString())} tick={{fontSize:11,fill:'#71868b'}} tickLine={false} axisLine={{stroke:'#dbe6e6'}}/><YAxis allowDecimals={false} domain={[0,Math.max(progress.target,progress.projectedTotal??0,1)]} tick={{fontSize:11,fill:'#71868b'}} tickLine={false} axisLine={false}/><Tooltip labelFormatter={(value)=>chartTime(new Date(Number(value)).toISOString())} formatter={(value,name)=>[value,name==='actual'?'Completed':name]} contentStyle={{border:'1px solid #dbe6e6',borderRadius:8,boxShadow:'0 8px 24px rgba(22,55,61,.12)'}}/><Area tooltipType="none" type="monotone" dataKey="actual" fill="url(#cabinetActualFill)" stroke="none" activeDot={false}/><Line type="monotone" dataKey="actual" name="actual" stroke={color} strokeWidth={3} dot={false} activeDot={{r:5}}/><Line type="monotone" dataKey="expected" name="desired pace" stroke="#587987" strokeWidth={2} strokeDasharray="7 5" dot={false}/>{paceMode&&<Line type="monotone" dataKey="projected" name="on course for" stroke="#238f86" strokeWidth={3} strokeDasharray="4 5" dot={false}/>}</ComposedChart></ResponsiveContainer></div><div className="cabinet-graph-footer">{paceMode?('Desired pace '+pace+' per cabinet'):(duration(progress.nonBuildMs)+' available shift time not building')} <span>•</span> {progress.completed} completed · {progress.target} at desired pace</div></div>;
 const stationSummary=department&&visible('stationCards')&&speedStations.length>0&&<section className="station-pace-board" aria-label="Station speed summary"><div className="station-pace-heading"><div><h3>Station speed summary</h3><p>Average measured build time compared with the desired time per cabinet.</p></div><div className="station-pace-counts"><strong className="behind">{behindStations} slower</strong><strong className="ahead">{aheadStations} within pace</strong><HideSectionButton preferences={viewPreferences} section="stationCards"/></div></div><div className="station-pace-list">{speedStations.map((station:any)=>{
    const speed=stationSpeed(station),pace=station.cabinet?.desiredPaceMs??progress.desiredPaceMs;
    const state=speed.status==='good'?'ahead':speed.status==='slow'?'behind':'unknown';
    return <button type="button" className={'station-pace-row '+state} disabled={!onStation} key={station.id} onClick={()=>void openStation(station.id)} title={onStation?`Open ${station.name} analytics`:undefined}><span className="station-pace-identity"><strong>{station.name}{onStation&&<ArrowUpRight size={16} aria-hidden="true"/>}</strong><small>{station.people?.[0]?.name||'No user assigned'} / {station.cabinet?.completed??0} cabinets completed</small></span><span className="station-pace-numbers"><strong>{station.cabinet?.completed?stationDuration(station.cabinet.averageBuildMs):'\u2014'}<small>avg / cabinet</small></strong><span>Desired {stationDuration(pace)}</span></span><span className={'pace-status '+state}>{stationSpeedLabel(speed)}</span></button>;
   })}</div></section>;
 const liveStations=visible('activeCabinets')&&(department?<BuildStations layout={layout} stations={stations} cabinets={progress.cabinets??[]} nowMs={nowMs} desiredPaceMs={progress.desiredPaceMs} onStation={onStation?openStation:undefined} actions={<HideSectionButton preferences={viewPreferences} section="activeCabinets"/>}/>:<ActiveCabinets cabinets={progress.cabinets??[]} nowMs={nowMs} department={false} onStation={onStation?openStation:undefined}/>);
 const summary=<>{metrics}{progressBar}</>;
 return <section ref={frame} data-density={layout.density} className={'cabinet-progress department-density-'+layout.density+' mood-'+status+(department?' department-theme':'')+(compact?' compact':'')}>
  {!compact&&<div className="cabinet-heading"><div><h2><PackageCheck size={19}/> {title||'Cabinet progress'}</h2><p>{department?'Combined cabinet output across this department. Speed is based on average measured build time; the graph shows the output outlook.':'Follow each cabinet from start to completion.'}</p></div><div className="cabinet-heading-actions">{simulation&&<span className="simulation-badge">Simulation: sample data</span>}<span className={'pace-status '+status}>{paceMode?(measuredSpeed.status==='unknown'?'No build history':measuredSpeed.status==='slow'?'Slower than desired pace':'Within desired pace'):status==='ahead'?'Ahead of desired pace':status==='on-time'?'At desired pace':'Behind desired pace'}</span><HideSectionButton preferences={viewPreferences} section="cabinetProgress"/>{fullscreen&&viewPreferences&&<ViewCustomizer preferences={viewPreferences}/>}<button className="panel-fullscreen" onClick={toggle} title={fullscreen?'Exit full screen':'Show cabinet progress full screen'}>{fullscreen?<Minimize2 size={16}/>:<Maximize2 size={16}/>}</button></div></div>}
  {department?<div className="cabinet-overview" data-primary-overview data-arrangement={overviewArrangement(overviewWidth,speedStations.length,layout)}>
   <div className="overview-stations">{liveStations}</div>
   <div className="overview-numbers">{metrics}</div>
   <div className="overview-pace">{progressBar}</div>
  </div>:liveStations}
  {!department&&<CompletionNotice cabinets={progress.cabinets??[]}/>}
  {visible('outputGraph')&&<div className="cabinet-view-toggle" role="tablist" aria-label="Cabinet progress view"><button className={view==='summary'?'active':''} onClick={()=>setView('summary')} role="tab" aria-selected={view==='summary'}><LayoutDashboard size={15}/> Summary</button><button className={view==='graph'?'active':''} onClick={()=>setView('graph')} role="tab" aria-selected={view==='graph'}><BarChart3 size={15}/> Graph</button></div>}
  {devMode&&onSimulate&&<div className="cabinet-dev-controls"><button className="cabinet-dev-toggle" onClick={()=>{setTestCompleted(String(progress.completed));setTestError('');setTestNotice('');setEditTest(!editTest)}}>{editTest?'Close test controls':'Developer testing'}</button>{editTest&&<form className="cabinet-dev-form" onSubmit={async e=>{e.preventDefault();setSimulating(true);setTestError('');setTestNotice('');try{await onSimulate(Number(testCompleted));setTestNotice(`Test progress set to ${testCompleted} completed cabinets.`);}catch(error:any){setTestError(error.message||'Could not update test progress.');}finally{setSimulating(false);}}}><label>Simulated cabinets completed<input disabled={simulating} type="number" min="0" max={progress.target} value={testCompleted} onChange={e=>setTestCompleted(e.target.value)}/></label><span>Set the count to expected now ({progress.expected}) to preview on-pace colors.</span><button className="cabinet-dev-apply" type="submit" disabled={simulating||testCompleted===''||Number(testCompleted)>progress.target}>{simulating?'Updating…':'Apply test progress'}</button>{simulating&&<span role="status">Saving test events…</span>}{testNotice&&<span className="cabinet-test-success" role="status">{testNotice}</span>}{testError&&<span className="cabinet-test-error" role="alert">{testError}</span>}</form>}</div>}
  {department?(view==='graph'&&visible('outputGraph')?graph:null):view==='graph'&&visible('outputGraph')?graph:summary}
  {stationSummary}
  {visible('cabinetLog')&&<div className="cabinet-history">
   <div className="cabinet-history-heading"><h3>Cabinet log <small>{progress.started??0} started · {progress.completed} completed</small></h3><HideSectionButton preferences={viewPreferences} section="cabinetLog"/></div>
   <p>Numbers are for the selected shift/day. Build time is measured by the device and excludes pauses.</p>
   {!(progress.cabinets?.length)?<p>No cabinets started in this period.</p>:<div className="cabinet-table-scroll"><table><thead><tr><th>Cabinet</th>{department&&<th>Workstation</th>}<th>Operator at start</th><th>Completed by</th><th>Started</th><th>Finished</th><th>Build time</th><th>Status</th></tr></thead><tbody>{recentCabinets.map((cabinet:any)=><tr key={cabinet.id}><th scope="row" title={cabinet.id}>#{cabinet.number}</th>{department&&<td>{cabinet.stationName}</td>}<td>{cabinet.operatorName||'Unassigned / unknown'}</td><td><strong className={'cabinet-finisher'+(cabinet.status==='completed'&&!cabinet.completedByName?' is-unassigned':'')}>{cabinet.status==='completed'?(cabinet.completedByName||'Unassigned / unknown'):'—'}</strong></td><td>{cabinet.startedAt?new Date(cabinet.startedAt).toLocaleString([],{timeZone:zone,month:'short',day:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit'}):'Time unavailable'}</td><td>{cabinet.finishedAt?new Date(cabinet.finishedAt).toLocaleString([],{timeZone:zone,month:'short',day:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit'}):'?'}</td><td>{buildDuration(visibleBuildMs(cabinet,nowMs))}</td><td>{cabinet.status==='completed'?'Completed':cabinet.status==='interrupted'?'Interrupted':`${cabinet.stale?'Last reported: ':''}${cabinet.status==='paused'?'Paused':'Building'}`}</td></tr>)}</tbody></table></div>}
  </div>}
 </section>;
}

