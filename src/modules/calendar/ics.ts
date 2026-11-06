import {CALENDAR_EXPORT_MAX_EVENTS,type CalendarProjection,type ProjectedCalendarEvent} from './projection';
export const CALENDAR_EXPORT_MAX_BYTES=1_048_576;
const encoder=new TextEncoder();
// RFC 5545 §§3.1,3.3.11: fold bytes, preserve whole code points, escape TEXT.
function text(value:string):string{return value.replace(/\r\n|\r|\n/gu,'\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu,'').replace(/\\/gu,'\\\\').replace(/\n/gu,'\\n').replace(/;/gu,'\\;').replace(/,/gu,'\\,');}
function fold(line:string):string{
 let physical='',bytes=0;const lines:string[]=[];
 for(const char of line){const size=encoder.encode(char).length;if(bytes+size>75){lines.push(physical);physical=' ';bytes=1;}physical+=char;bytes+=size;}
 lines.push(physical);return lines.join('\r\n')+'\r\n';
}
function utc(timestamp:number):string{
 if(!Number.isSafeInteger(timestamp)||timestamp<0||timestamp>253402300799999)throw new TypeError('Invalid calendar timestamp');
 return new Date(timestamp).toISOString().replace(/[-:]/gu,'').replace(/\.\d{3}Z$/u,'Z');
}
function eventText(event:ProjectedCalendarEvent):string{
 if(!/^[A-Za-z0-9_-]+@calenote$/u.test(event.uid)||event.updatedAt<event.createdAt)throw new TypeError('Invalid calendar event');
 let start:string;
 if(event.start.kind==='UTC')start='DTSTART:'+utc(event.start.timestamp);
 else{
  if(!/^\d{4}-\d{2}-\d{2}$/u.test(event.start.date)||new Date(event.start.date+'T00:00:00Z').toISOString().slice(0,10)!==event.start.date)throw new TypeError('Invalid calendar date');
  start='DTSTART;VALUE=DATE:'+event.start.date.replace(/-/gu,'');
 }
 const lines=['BEGIN:VEVENT','UID:'+event.uid,'DTSTAMP:'+utc(event.updatedAt),'LAST-MODIFIED:'+utc(event.updatedAt),'SEQUENCE:'+Math.min(2147483647,Math.max(0,Math.floor((event.updatedAt-event.createdAt)/1000))),start,'SUMMARY:'+text(event.title),'STATUS:'+(event.status==='CANCELLED'?'CANCELLED':'CONFIRMED')];
 if(event.location!==null)lines.push('LOCATION:'+text(event.location));
 lines.push('END:VEVENT');return lines.map(fold).join('');
}
export interface CalendarExportFile {body:string;eventCount:number;truncated:boolean;skipped:number}
export function serializeCalendarExport(input:CalendarProjection):CalendarExportFile{
 const start=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Calenote//Calendar Export//VI','CALSCALE:GREGORIAN'].map(fold).join(''),end=fold('END:VCALENDAR');
 let body=start,eventCount=0,bytes=encoder.encode(start+end).length,truncated=input.truncated,skipped=input.skipped;
 for(const event of input.events){
  if(eventCount>=CALENDAR_EXPORT_MAX_EVENTS){truncated=true;break;}
  let rendered:string;try{rendered=eventText(event);}catch{skipped++;continue;}
  const eventBytes=encoder.encode(rendered).length;if(bytes+eventBytes>CALENDAR_EXPORT_MAX_BYTES){truncated=true;break;}
  body+=rendered;bytes+=eventBytes;eventCount++;
 }
 return {body:body+end,eventCount,truncated,skipped};
}
