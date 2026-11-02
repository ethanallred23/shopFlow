import {CheckCircle2,Factory,Workflow,UsersRound,Cpu} from 'lucide-react';

export function FirstRun({areas,stations,devices,canManage,onSettings,onDevices}:{areas:number;stations:number;devices:number;canManage:boolean;onSettings:()=>void;onDevices:()=>void}){
 if(areas>0&&stations>0&&devices>0)return null;
 return <section className="panel first-run"><h2>Get the floor ready</h2><p>Follow these steps to make the production numbers useful. You can explore the app before devices start reporting.</p><div className="first-run-steps">
  <div><span>{areas?<CheckCircle2/>:<Factory/>}</span><strong>1. Add a department</strong><small>Group workstations by the part of the shop they belong to.</small></div>
  <div><span>{stations?<CheckCircle2/>:<Workflow/>}</span><strong>2. Add workstations and people</strong><small>Create accounts, then assign one operator to each workstation.</small></div>
  <div><span>{devices?<CheckCircle2/>:<Cpu/>}</span><strong>3. Connect devices</strong><small>Assign each device to its workstation and confirm its first event.</small></div>
 </div><div className="first-run-actions">{canManage?<><button onClick={onSettings}><UsersRound size={16}/> Open setup</button><button onClick={onDevices}><Cpu size={16}/> Open devices</button></>:<p className="hint">An administrator creates departments, workstations, accounts, and devices. Supervisors can assign people and manage floor activity after setup.</p>}</div></section>;
}
