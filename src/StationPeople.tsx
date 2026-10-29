import {useEffect,useState} from 'react';
import {AlertTriangle,UserRound,UsersRound} from 'lucide-react';

type Person={id:string;name:string;workstationId:string|null};

export function StationPeople({station,areaName,canAssign,mutate}:{station:any;areaName?:string;canAssign:boolean;mutate:(path:string,method:string,body?:unknown)=>Promise<any>}){
 const [roster,setRoster]=useState<Person[]>([]),[selected,setSelected]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const load=async()=>{const response=await fetch(`/api/workstations/${station.id}/people`);const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not load department users');return data as Person[];};
 useEffect(()=>{let active=true;setRoster([]);setSelected('');setError('');if(canAssign)load().then(value=>{if(active)setRoster(value);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[station.id,canAssign]);
 const change=async(userId:string,assigned:boolean)=>{setBusy(true);setError('');try{await mutate(`/workstations/${station.id}/people/${userId}`,'PUT',{assigned});setRoster(await load());setSelected('');}catch(e:any){setError(e.message);}finally{setBusy(false);}};
 const assigned:Person[]=station.people??[];
 const available=roster.filter(p=>p.workstationId!==station.id);
 return <section className={'station-people panel'+(!assigned.length?' unassigned':'')}>
  <div className="station-people-header"><div><span className="station-people-kicker"><UsersRound size={15}/> {areaName||'Department'}</span><h2>People at this workstation</h2></div>{!assigned.length&&<AlertTriangle size={32} aria-hidden="true"/>}</div>
  {!assigned.length?<div className="station-people-warning"><strong>No user assigned</strong><p>Assign someone from this department to show who is working here.</p></div>:<div className="assigned-people">{assigned.map(person=><div className="assigned-person" key={person.id}><span><UserRound size={18}/>{person.name}</span>{canAssign&&<button disabled={busy} onClick={()=>void change(person.id,false)} aria-label={`Remove ${person.name} from this workstation`}>Remove</button>}</div>)}</div>}
  {canAssign&&<div className="station-people-controls"><label>Assign a department user<select value={selected} onChange={e=>setSelected(e.target.value)} disabled={busy}><option value="">Select a person</option>{available.map(person=><option key={person.id} value={person.id}>{person.name}{person.workstationId?' (assigned to another station)':''}</option>)}</select></label><button className="primary" disabled={!selected||busy} onClick={()=>void change(selected,true)}>{busy?'Saving...':'Assign user'}</button><small>Choosing someone at another station moves their assignment here.</small>{!roster.length&&!error&&<small>Add users to this department in Settings first.</small>}</div>}
  {error&&<p className="form-error" role="alert">{error}</p>}
 </section>;
}
