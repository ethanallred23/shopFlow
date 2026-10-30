export type DepartmentLayout={density:'fit'|'compact'|'comfortable';stationColumns:'auto'|1|2|3|4|5|6;arrangement:'auto'|'stations-first'|'numbers-first'|'side-by-side'};
export const defaultDepartmentLayout:DepartmentLayout={density:'fit',stationColumns:'auto',arrangement:'auto'};

export function parseDepartmentLayout(value:unknown):DepartmentLayout{
 const input=value&&typeof value==='object'?value as Record<string,unknown>:{};
 return {density:typeof input.density==='string'&&['fit','compact','comfortable'].includes(input.density)?input.density as DepartmentLayout['density']:'fit',
  stationColumns:input.stationColumns==='auto'||[1,2,3,4,5,6].includes(input.stationColumns as number)?input.stationColumns as DepartmentLayout['stationColumns']:'auto',
  arrangement:typeof input.arrangement==='string'&&['auto','stations-first','numbers-first','side-by-side'].includes(input.arrangement)?input.arrangement as DepartmentLayout['arrangement']:'auto'};
}

export function stationColumnCount(width:number,count:number,layout:DepartmentLayout){
 const minimum=layout.density==='comfortable'?280:layout.density==='compact'?260:240;
 const readable=Math.max(1,Math.floor((width+12)/(minimum+12)));
 const maximum=Math.max(1,Math.min(count,readable,layout.stationColumns==='auto'?6:layout.stationColumns));
 if(layout.stationColumns!=='auto'||count<=maximum)return maximum;
 return Math.ceil(count/Math.ceil(count/maximum));
}

export function overviewArrangement(width:number,count:number,layout:DepartmentLayout){
 if(layout.arrangement==='numbers-first')return 'numbers-first';
 if(layout.arrangement==='side-by-side')return width>=850?'side-by-side':'stations-first';
 if(layout.arrangement==='auto'&&layout.density==='fit'&&width>=1000&&count<=2)return 'side-by-side';
 return 'stations-first';
}
