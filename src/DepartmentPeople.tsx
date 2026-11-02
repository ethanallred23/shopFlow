import {useEffect,useState} from 'react';
import type {CSSProperties} from 'react';
import {Plus,UsersRound} from 'lucide-react';

type Person={id:string;name:string;email:string;role:string;workstationId:string|null};
type Station={id:string;name:string};

export function DepartmentPeople({department,stations,siteTheme,canCreate,onCreate,mutate,revision}:{department:{id:string;name:string;themeColor?:string};stations:Station[];siteTheme:'light'|'dark';canCreate:boolean;onCreate:()=>void;mutate:(path:string,method:string,body?:unknown)=>Promise<any>;revision:number}){
 const [people,setPeople]=useState<Person[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[changing,setChanging]=useState<string|null>(null);
 async function load(){const response=await fetch('/api/departments/'+department.id+'/people');const body=await response.json();if(!response.ok)throw new Error(body.error||'Could not load people');return body as Person[];}
 useEffect(()=>{let active=true;setLoading(true);setError('');load().then(rows=>{if(active)setPeople(rows);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[department.id,revision]);
 async function assign(person:Person,stationId:string){setChanging(person.id);setError('');try{
  if(stationId)await mutate(`/workstations/${stationId}/people/${person.id}`,'PUT',{assigned:true});
  else if(person.workstationId)await mutate(`/workstations/${person.workstationId}/people/${person.id}`,'PUT',{assigned:false});
  setPeople(await load());
 }catch(e:any){setError(e.message);setPeople(await load().catch(()=>people));}finally{setChanging(null);}}
 return <section className={'panel department-people theme-'+siteTheme} style={{'--department-color':department.themeColor||'#287f83'} as CSSProperties} id="department-people"><div className="panel-heading"><div><h2><UsersRound size={19}/> Department people</h2><p>{loading?'Loading roster…':`${people.length} people · ${people.filter(person=>person.workstationId).length} assigned to stations`}</p></div>{canCreate&&<button onClick={onCreate}><Plus size={16}/> Add person</button>}</div>
  <details><summary>View people and station assignments</summary><p className="hint">Choose a workstation to assign or move a person. Each workstation has one operator.</p>
  {error&&<p className="form-error" role="alert">{error}</p>}
  {loading?<p className="muted">Loading people…</p>:people.length?<div className="people-list">{people.map(person=><div className="people-row" key={person.id}><div><strong>{person.name}</strong><small>{person.email} · {person.role}</small></div><label>Workstation<select aria-label={'Workstation for '+person.name} value={person.workstationId??''} disabled={changing===person.id} onChange={e=>void assign(person,e.target.value)}><option value="">Unassigned</option>{stations.map(station=><option value={station.id} key={station.id}>{station.name}</option>)}</select></label></div>)}</div>:<div className="empty">No people in {department.name} yet. {canCreate?'Add the first person here.':'Ask an administrator to add a person to this department.'}</div>}
  {!stations.length&&<p className="hint">Add a workstation in Settings before assigning operators.</p>}</details>
 </section>;
}
