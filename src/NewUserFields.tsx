import {useState} from 'react';

export function NewUserFields({areas,stations,initialAreaId}:{areas:{id:string;name:string}[];stations:{id:string;name:string;areaId:string}[];initialAreaId:string}){
 const [areaId,setAreaId]=useState(initialAreaId);
 return <><p className="hint">Create a sign-in account and optionally assign this person to a workstation. Share the initial password securely.</p>
  <label>Full name<input name="name" maxLength={100} required/></label>
  <label>Email address<input name="email" type="email" autoComplete="email" required/></label>
  <label>Initial password (at least 12 characters)<input name="password" type="password" minLength={12} maxLength={128} autoComplete="new-password" required/></label>
  <label>Access level<select name="role" defaultValue="viewer"><option value="viewer">Viewer — view production</option><option value="supervisor">Supervisor — manage floor activity</option><option value="admin">Administrator — manage accounts and setup</option></select></label>
  <label>Department<select name="areaId" value={areaId} onChange={e=>setAreaId(e.target.value)} required><option value="" disabled>Choose a department</option>{areas.map(area=><option value={area.id} key={area.id}>{area.name}</option>)}</select></label>
  <label>Workstation (optional)<select name="workstationId" key={areaId} defaultValue=""><option value="">Assign later</option>{stations.filter(station=>station.areaId===areaId).map(station=><option value={station.id} key={station.id}>{station.name}</option>)}</select></label>
  <p className="hint">One operator can be assigned to each workstation. Choosing an occupied station moves its current operator to Unassigned.</p>
 </>;
}
