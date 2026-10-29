import {expect,it} from 'vitest';
import {eventSchema,refreshOnEvent} from '../server/domain';

const base={schemaVersion:1,eventId:'boot-1',deviceId:'11111111-1111-4111-8111-111111111111',bootId:'boot-1',sequence:1,uptimeMs:1000,occurredAt:'2026-10-29T15:00:00.000Z',delivery:'buffered',type:'sensor.detection_time_snapshot'};
const data={detected:true,totalDetectedMs:1000,counterId:'counter-1'};

it('refreshes immediately for cabinet transitions and older firmware, while routine snapshots wait for normal polling',()=>{
 const periodic=eventSchema.parse({...base,data:{...data,reason:'periodic'}});
 const transition=eventSchema.parse({...base,data:{...data,reason:'transition'}});
 const oldFirmware=eventSchema.parse({...base,data});
 expect(refreshOnEvent(periodic)).toBe(false);
 expect(refreshOnEvent(transition)).toBe(true);
 expect(refreshOnEvent(oldFirmware)).toBe(true);
 expect(eventSchema.safeParse({...base,data:{...data,reason:'unexpected'}}).success).toBe(false);
});
