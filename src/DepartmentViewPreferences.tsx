import {Eye,EyeOff,RotateCcw} from 'lucide-react';
import {useState} from 'react';
import './department-view-preferences.css';

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
 const [stored,setStored]=useState(()=>({key,hidden:readHidden(key)}));
 const hidden=stored.key===key?stored.hidden:readHidden(key);
 const update=(next:DepartmentSection[])=>{
  setStored({key,hidden:next});
  try{localStorage.setItem(key,JSON.stringify(next));}catch{/* Customization still works when browser storage is unavailable. */}
 };
 return {hidden,isVisible:(id:DepartmentSection)=>!hidden.includes(id),hide:(id:DepartmentSection)=>update([...new Set([...hidden,id])]),
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
 return <details className="view-customizer" onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))event.currentTarget.open=false;}} onKeyDown={event=>{if(event.key==='Escape'){event.currentTarget.open=false;event.currentTarget.querySelector('summary')?.focus();}}}><summary><Eye size={16}/> Customize view {preferences.hidden.length>0&&<span className="hidden-section-count">{preferences.hidden.length} hidden</span>}</summary><div className="view-customizer-menu"><div className="view-customizer-heading"><strong>Visible sections</strong><button type="button" onClick={preferences.showAll}><RotateCcw size={13}/> Show all</button></div><p>Saved for this department in this browser.</p><fieldset><legend>Page sections</legend>{sections.map(([id,label])=><label key={id}><input type="checkbox" checked={preferences.isVisible(id)} onChange={()=>preferences.toggle(id)}/>{preferences.isVisible(id)?<Eye size={15}/>:<EyeOff size={15}/>}<span>{label}</span></label>)}</fieldset><fieldset><legend>Individual metrics</legend>{metrics.map(([id,label])=><label key={id}><input type="checkbox" checked={preferences.isVisible(id)} onChange={()=>preferences.toggle(id)}/>{preferences.isVisible(id)?<Eye size={15}/>:<EyeOff size={15}/>}<span>{label}</span></label>)}</fieldset></div></details>;
}
