import type {ReactNode} from 'react';

export function OperatorActivity({cabinets,actions}:{cabinets:any[];actions?:ReactNode}){
 const rows=new Map<string,{name:string;started:number;completed:number}>();
 const person=(id:string|null,name:string|null)=>{const key=id??'unassigned';if(!rows.has(key))rows.set(key,{name:name||'Unassigned / unknown',started:0,completed:0});return rows.get(key)!;};
 for(const cabinet of cabinets){person(cabinet.operatorId,cabinet.operatorName).started++;if(cabinet.status==='completed')person(cabinet.completedById,cabinet.completedByName).completed++;}
 return <section className="panel"><div className="panel-heading"><div><h2>Operator activity</h2><p>Who started and completed the cabinets in this log. Assignment history preserves earlier work when operators change.</p></div>{actions}</div>{rows.size?<div className="table-wrap"><table><thead><tr><th>Operator</th><th>Cabinets started</th><th>Cabinets completed</th></tr></thead><tbody>{[...rows.entries()].map(([id,row])=><tr key={id}><th>{row.name}</th><td>{row.started}</td><td>{row.completed}</td></tr>)}</tbody></table></div>:<p>Operator activity will appear as cabinets are recorded.</p>}<p className="hint">Cabinets with unavailable times or no recorded operator remain unassigned. Build duration belongs to the cabinet and can span more than one operator.</p></section>;
}
