import {expect,it} from 'vitest';
import {serializeCalendarExport} from './ics';
import type {ProjectedCalendarEvent} from './projection';
const event:ProjectedCalendarEvent={uid:'reminder-public@calenote',title:'Họp',location:null,start:{kind:'UTC',timestamp:Date.UTC(2026,10,6,1)},status:'CONFIRMED',createdAt:Date.UTC(2026,10,1),updatedAt:Date.UTC(2026,10,2)};
it('escapes property injection and folds Vietnamese UTF-8 into at most 75 octets without damage',()=>{
 const title='Họp tiếng Việt '.repeat(20)+'\r\nATTENDEE:x;,\\\u0000\u007f';
 const result=serializeCalendarExport({events:[{...event,title,location:'Phòng; A, B'}],truncated:false,skipped:0});
 expect(result.body).not.toMatch(/(?<!\r)\n/u);
 for(const line of result.body.split('\r\n'))expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
 const unfolded=result.body.replace(/\r\n /gu,'');
 expect(unfolded).toContain('\\nATTENDEE:x\\;\\,\\\\');
 expect(unfolded).not.toContain('\r\nATTENDEE:');expect(unfolded).not.toContain('\u0000');expect(unfolded).not.toContain('�');
 expect(unfolded).toContain('LOCATION:Phòng\\; A\\, B');
});
it('exports deterministic UTC and date-only events without recurrence, notes or alarms',()=>{
 const input={events:[event,{...event,uid:'series-public@calenote',start:{kind:'DATE' as const,date:'2026-11-07'},status:'CANCELLED' as const}],truncated:false,skipped:0};
 const result=serializeCalendarExport(input);expect(serializeCalendarExport(input)).toEqual(result);
 expect(result.body).toContain('DTSTART:20261106T010000Z\r\n');expect(result.body).toContain('DTSTART;VALUE=DATE:20261107\r\n');
 expect(result.body).toContain('DTSTAMP:20261102T000000Z\r\n');expect(result.body).toContain('SEQUENCE:86400\r\n');expect(result.body).toContain('STATUS:CANCELLED');
 expect(result.body).not.toMatch(/RRULE|VALARM|DESCRIPTION/u);expect(result.eventCount).toBe(2);
});
it('limits complete VEVENTs to 300 events and 1 MiB while retaining skipped and partial metadata',()=>{
 const result=serializeCalendarExport({events:Array.from({length:301},(_,i)=>({...event,uid:`reminder-${i}@calenote`,title:'ộ'.repeat(3000)})),truncated:false,skipped:2});
 expect(result.truncated).toBe(true);expect(result.skipped).toBe(2);expect(result.eventCount).toBeLessThan(300);
 expect(new TextEncoder().encode(result.body).length).toBeLessThanOrEqual(1_048_576);expect(result.body).toMatch(/END:VEVENT\r\nEND:VCALENDAR\r\n$/u);
});
