import {expect,it} from 'vitest';
import {buildStationSpeed,stationDuration,stationSpeedLabel} from '../src/build-station-speed';

it('compares average measured build time with desired time instead of cabinet counts',()=>{
 const fast=buildStationSpeed(270000,600000,24),slow=buildStationSpeed(630000,600000,24);
 expect(fast).toMatchObject({status:'good',ratio:.45,differenceMs:-330000});
 expect(slow).toMatchObject({status:'slow',ratio:1.05,differenceMs:30000});
 expect(stationSpeedLabel(fast)).toBe('5m 30s under desired time');
 expect(stationSpeedLabel(slow)).toBe('30s over desired time');
 expect(buildStationSpeed(600000,600000,1).status).toBe('good');
});
it('shows unknown speed until a completed cabinet and a valid pace exist',()=>{
 expect(buildStationSpeed(0,600000,0).status).toBe('unknown');
 expect(buildStationSpeed(1000,undefined,1).status).toBe('unknown');
 expect(stationDuration(45000)).toBe('45s');
 expect(stationDuration(630000)).toBe('10m 30s');
});
