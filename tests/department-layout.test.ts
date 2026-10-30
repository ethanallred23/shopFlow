import {expect,it} from 'vitest';
import {defaultDepartmentLayout,overviewArrangement,parseDepartmentLayout,stationColumnCount} from '../src/department-layout';

it('defaults to a fitting layout and safely reads saved choices',()=>{
 expect(parseDepartmentLayout(null)).toEqual(defaultDepartmentLayout);
 expect(parseDepartmentLayout({density:['fit'],stationColumns:99,arrangement:'bad'})).toEqual(defaultDepartmentLayout);
 expect(parseDepartmentLayout({density:'compact',stationColumns:4,arrangement:'numbers-first'})).toEqual({density:'compact',stationColumns:4,arrangement:'numbers-first'});
});
it('limits station columns to the available width so manual choices cannot squash mobile cards',()=>{
 const layout={...defaultDepartmentLayout,stationColumns:6 as const};
 expect(stationColumnCount(1200,3,layout)).toBe(3);
 expect(stationColumnCount(600,6,layout)).toBe(2);
 expect(stationColumnCount(360,6,layout)).toBe(1);
 expect(stationColumnCount(1300,6,defaultDepartmentLayout)).toBe(3);
});
it('uses spare horizontal space for two stations and stacks when there is insufficient width',()=>{
 expect(overviewArrangement(1400,2,defaultDepartmentLayout)).toBe('side-by-side');
 expect(overviewArrangement(1400,3,defaultDepartmentLayout)).toBe('stations-first');
 expect(overviewArrangement(800,3,{...defaultDepartmentLayout,arrangement:'side-by-side'})).toBe('stations-first');
 expect(overviewArrangement(1400,3,{...defaultDepartmentLayout,arrangement:'numbers-first'})).toBe('numbers-first');
});
