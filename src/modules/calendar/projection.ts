export interface ProjectedCalendarEvent {uid:string;title:string;location:string|null;start:{kind:'UTC';timestamp:number}|{kind:'DATE';date:string};status:'CONFIRMED'|'CANCELLED';createdAt:number;updatedAt:number}
export interface CalendarProjection {events:ProjectedCalendarEvent[];truncated:boolean;skipped:number}
export interface CalendarReminderSource {rootPublicId:string;seriesPublicId:string|null;occurrenceIndex:number|null;advanceGroup:boolean;scheduledAt:number;title:string;details:{location:string|null;eventDate:string|null;eventTime:string|null}|null;status:string;createdAt:number;updatedAt:number}
export const CALENDAR_EXPORT_MAX_EVENTS=300;
const DAY=86_400_000;
export function calendarExportWindow(now:number){
 if(!Number.isSafeInteger(now)||!Number.isFinite(new Date(now).getTime()))throw new TypeError('Invalid calendar time');
 return {from:now-30*DAY,to:now+400*DAY};
}
function validTimestamp(timestamp:number){return Number.isSafeInteger(timestamp)&&timestamp>=0&&timestamp<=253402300799999;}
export function calendarEventTimestamp(event:ProjectedCalendarEvent):number{
 return event.start.kind==='UTC'?event.start.timestamp:Date.parse(event.start.date+'T00:00:00+07:00');
}
export function projectCalendarReminder(source:CalendarReminderSource):ProjectedCalendarEvent{
 if(!/^[A-Za-z0-9_-]+$/u.test(source.rootPublicId)||!validTimestamp(source.scheduledAt)||!validTimestamp(source.createdAt)||!validTimestamp(source.updatedAt)||source.updatedAt<source.createdAt)throw new TypeError('Invalid calendar source');
 let uid=`reminder-${source.rootPublicId}@calenote`,start:ProjectedCalendarEvent['start']={kind:'UTC',timestamp:source.scheduledAt};
 if(source.seriesPublicId!==null){
  if(!/^[A-Za-z0-9_-]+$/u.test(source.seriesPublicId))throw new TypeError('Invalid calendar series');
  if(source.advanceGroup){
   const date=source.details?.eventDate,time=source.details?.eventTime;
   if(!date||!/^\d{4}-\d{2}-\d{2}$/u.test(date)||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)throw new TypeError('Missing actual calendar event');
   uid=`series-${source.seriesPublicId}@calenote`;
   if(time!==null&&time!==undefined){
    if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(time))throw new TypeError('Invalid calendar event time');
    const timestamp=Date.parse(`${date}T${time}:00+07:00`);if(!validTimestamp(timestamp))throw new TypeError('Invalid calendar event time');
    start={kind:'UTC',timestamp};
   }else start={kind:'DATE',date};
  }else{
   const index=source.occurrenceIndex;
   if(index===null||!Number.isInteger(index)||index<0||index>=30)throw new TypeError('Invalid calendar occurrence');
   uid=`series-${source.seriesPublicId}-${index}@calenote`;
  }
 }else if(source.advanceGroup)throw new TypeError('Missing calendar series');
 return {uid,title:source.title,location:source.details?.location??null,start,status:source.status==='CANCELLED'?'CANCELLED':'CONFIRMED',createdAt:source.createdAt,updatedAt:source.updatedAt};
}
export function boundCalendarProjection(events:ProjectedCalendarEvent[],now:number):CalendarProjection{
 const {from,to}=calendarExportWindow(now),within=events.filter(event=>{const at=calendarEventTimestamp(event);return at>=from&&at<=to;});
 within.sort((a,b)=>{
  const aa=calendarEventTimestamp(a),bb=calendarEventTimestamp(b),pastA=aa<now,pastB=bb<now;
  return Number(pastA)-Number(pastB)||(pastA?bb-aa:aa-bb)||a.uid.localeCompare(b.uid,'en');
 });
 return {events:within.slice(0,CALENDAR_EXPORT_MAX_EVENTS),truncated:within.length>CALENDAR_EXPORT_MAX_EVENTS,skipped:0};
}
