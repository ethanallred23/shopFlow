import {Eye,EyeOff,LayoutDashboard,RotateCcw} from 'lucide-react';
import {useState} from 'react';
import {defaultDepartmentLayout,parseDepartmentLayout} from './department-layout';
import type {DepartmentLayout} from './department-layout';
import './department-view-preferences.css';
import './department-layout.css';

const sections=[
 ['cabinetProgress','Cabinet progress'],['activeCabinets','Build stations'],['metrics','Summary metrics'],
 ['paceProgress','Pace progress bar'],['outputGraph','Output graph'],['stationCards','Station speed summary'],
 ['cabinetLog','Cabinet log'],['stationTable','Workstation details table'],['operatorActivity','Operator activity'],
] as const;
const metrics=[
 ['metricCompleted','Completed'],['metricPlanned','At desired pace today'],['metricProjection','On course for'],
 ['metricPace','Desired pace'],['metricAverage','Average build time'],['metricShiftRemaining','Shift remaining'],
] as const;
export type DepartmentSection=typeof sections[number][0]|typeof metrics[number][0];
const valid=new Set<string>([...sections,...metrics].map(([id])=>id));
function readHidden(key:string):DepartmentSection[]{
 try{
  const value=JSON.parse(localStorage.getItem(key)??'[]');
  return Array.isArray(value)?value.filter((id:unknown):id is DepartmentSection=>typeof id==='string'&&valid.has(id)):[];
 }catch{return [];}
}
export function useDepartmentViewPreferences(departmentId:string){
 const key='shopflow:department-view:v1:'+departmentId;
 const layoutKey='shopflow:department-layout:v1:'+departmentId;
 const readLayout=()=>{try{return parseDepartmentLayout(JSON.parse(localStorage.getItem(layoutKey)??'null'));}catch{return {...defaultDepartmentLayout};}};
 const [stored,setStored]=useState(()=>({key,hidden:readHidden(key)}));
 const [storedLayout,setStoredLayout]=useState(()=>({key:layoutKey,value:readLayout()}));
 const hidden=stored.key===key?stored.hidden:readHidden(key);
 const layout=storedLayout.key===layoutKey?storedLayout.value:readLayout();
 const update=(next:DepartmentSection[])=>{
  setStored({key,hidden:next});
  try{localStorage.setItem(key,JSON.stringify(next));}catch{/* Customization still works when browser storage is unavailable. */}
 };
 const setLayout=(change:Partial<DepartmentLayout>)=>{
  const value=parseDepartmentLayout({...layout,...change});setStoredLayout({key:layoutKey,value});
  try{localStorage.setItem(layoutKey,JSON.stringify(value));}catch{/* Keep layout changes usable without storage. */}
 };
 return {hidden,layout,setLayout,resetLayout:()=>setLayout(defaultDepartmentLayout),isVisible:(id:DepartmentSection)=>!hidden.includes(id),hide:(id:DepartmentSection)=>update([...new Set([...hidden,id])]),
  toggle:(id:DepartmentSection)=>update(hidden.includes(id)?hidden.filter(item=>item!==id):[...hidden,id]),showAll:()=>update([])};
}
export type DepartmentViewPreferences=ReturnType<typeof useDepartmentViewPreferences>;

export function HideSectionButton({preferences,section,label}:{preferences?:DepartmentViewPreferences;section:DepartmentSection;label?:string}){
 if(!preferences)return null;
 const name=label??[...sections,...metrics].find(([id])=>id===section)?.[1]??section;
 return <button type="button" className="section-hide-button" aria-label={'Hide '+name} title={'Hide '+name} onClick={event=>{
  const panel=event.currentTarget.closest('.cabinet-progress'),page=event.currentTarget.closest('.department-view');
  preferences.hide(section);
  (panel?.querySelector<HTMLElement>('.view-customizer>summary')??page?.querySelector<HTMLElement>('.view-customizer>summary'))?.focus();
 }}><Eye size={16}/></button>;
}

export function ViewCustomizer({preferences}:{preferences:DepartmentViewPreferences}){
 return <details className="view-customizer" onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))event.currentTarget.open=false;}} onKeyDown={event=>{if(event.key==='Escape'){event.currentTarget.open=false;event.currentTarget.querySelector('summary')?.focus();}}}>
  <summary><Eye size={16}/> Customize view {preferences.hidden.length>0&&<span className="hidden-section-count">{preferences.hidden.length} hidden</span>}</summary>
  <div className="view-customizer-menu">
   <div className="view-customizer-heading"><strong>Layout & visibility</strong><button type="button" onClick={preferences.showAll}><RotateCcw size={13}/> Show all</button></div>
   <p>Saved for this department in this browser.</p>
   <fieldset className="view-layout-controls"><legend><LayoutDashboard size={13}/> Layout</legend>
    <label>Page density<select aria-label="Page density" value={preferences.layout.density} onChange={event=>preferences.setLayout({density:event.target.value as DepartmentLayout['density']})}><option value="fit">Fit screen</option><option value="compact">Compact</option><option value="comfortable">Comfortable</option></select></label>
    <p>Fit screen keeps stations, key numbers, and pace together. Graphs and history stay below.</p>
    <label>Stations per row<select aria-label="Stations per row" value={preferences.layout.stationColumns} onChange={event=>preferences.setLayout({stationColumns:event.target.value==='auto'?'auto':Number(event.target.value) as DepartmentLayout['stationColumns']})}><option value="auto">Auto fit</option>{[1,2,3,4,5,6].map(count=><option key={count} value={count}>{count}</option>)}</select></label>
    <label>Overview arrangement<select aria-label="Overview arrangement" value={preferences.layout.arrangement} onChange={event=>preferences.setLayout({arrangement:event.target.value as DepartmentLayout['arrangement']})}><option value="auto">Auto fit</option><option value="stations-first">Stations first</option><option value="numbers-first">Numbers first</option><option value="side-by-side">Side by side</option></select></label>
    <button type="button" className="reset-view-layout" onClick={preferences.resetLayout}><RotateCcw size={13}/> Reset layout</button>
   </fieldset>
   <fieldset><legend>Page sections</legend>{sections.map(([id,label])=><label key={id}><input type="checkbox" checked={preferences.isVisible(id)} onChange={()=>preferences.toggle(id)}/>{preferences.isVisible(id)?<Eye size={15}/>:<EyeOff size={15}/>}<span>{label}</span></label>)}</fieldset>
   <fieldset><legend>Individual metrics</legend>{metrics.map(([id,label])=><label key={id}><input type="checkbox" checked={preferences.isVisible(id)} onChange={()=>preferences.toggle(id)}/>{preferences.isVisible(id)?<Eye size={15}/>:<EyeOff size={15}/>}<span>{label}</span></label>)}</fieldset>
  </div>
 </details>;
}
