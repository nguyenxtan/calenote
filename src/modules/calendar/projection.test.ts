import {expect,it} from 'vitest';
import {projectCalendarReminder,boundCalendarProjection} from './projection';
const source={rootPublicId:'root',seriesPublicId:null,occurrenceIndex:null,advanceGroup:false,scheduledAt:Date.UTC(2026,10,7,1),title:'Họp',details:null,status:'PENDING',createdAt:1,updatedAt:2};
it('keeps root identity at the current head time and materializes finite legacy/canonical occurrences',()=>{
 expect(projectCalendarReminder(source)).toMatchObject({uid:'reminder-root@calenote',start:{kind:'UTC',timestamp:Date.UTC(2026,10,7,1)}});
 const occurrences=Array.from({length:30},(_,occurrenceIndex)=>projectCalendarReminder({...source,seriesPublicId:'finite',occurrenceIndex}));
 expect(new Set(occurrences.map(e=>e.uid)).size).toBe(30);expect(occurrences[29].uid).toBe('series-finite-29@calenote');
});
it('projects an advance group as one actual event in fixed Vietnam time, including resolved lunar and date-only dates',()=>{
 const details={location:'Phòng A',eventDate:'2026-11-08',eventTime:'15:30'};
 expect(projectCalendarReminder({...source,seriesPublicId:'advance',advanceGroup:true,details,status:'CANCELLED'})).toMatchObject({uid:'series-advance@calenote',start:{kind:'UTC',timestamp:Date.UTC(2026,10,8,8,30)},location:'Phòng A',status:'CANCELLED'});
 expect(projectCalendarReminder({...source,seriesPublicId:'advance',advanceGroup:true,details:{...details,eventTime:null}}).start).toEqual({kind:'DATE',date:'2026-11-08'});
 expect(()=>projectCalendarReminder({...source,advanceGroup:true,seriesPublicId:'bad'})).toThrow();
});
it('retains nearest upcoming first then nearest past within the fixed 30/400 day window',()=>{
 const now=Date.UTC(2026,10,6),day=86400000;
 const events=[-31,401,-2,4,1,-1].map(n=>projectCalendarReminder({...source,rootPublicId:String(n),scheduledAt:now+n*day}));
 expect(boundCalendarProjection(events,now).events.map(e=>e.uid)).toEqual(['reminder-1@calenote','reminder-4@calenote','reminder--1@calenote','reminder--2@calenote']);
 const result=boundCalendarProjection(Array.from({length:301},(_,n)=>projectCalendarReminder({...source,rootPublicId:String(n),scheduledAt:now+n*1000})),now);
 expect(result.events).toHaveLength(300);expect(result.truncated).toBe(true);expect(result.events.at(-1)?.uid).toBe('reminder-299@calenote');
});
