import {expect,it} from 'vitest';
import {handleCalendarExport,type CalendarExportOperations} from './calendar';
import {SESSION_COOKIE_NAME,SessionAuthError} from '@/modules/auth/session';
const credentials='A'.repeat(43),principal={userId:'owner',sessionId:'session',expiresAt:9999999999999};
const file={body:'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n',eventCount:0,truncated:true,skipped:2};
const ops:CalendarExportOperations={requireUser:async()=>principal,exportCalendar:async()=>file};
it('requires the session cookie and never accepts URL or authorization tokens',async()=>{
 for(const request of [new Request('https://calenote.test/api/calendar/export.ics?token='+credentials),new Request('https://calenote.test/api/calendar/export.ics',{headers:{authorization:'Bearer '+credentials}})])await expect(handleCalendarExport(request,async()=>ops)).rejects.toBeInstanceOf(SessionAuthError);
 await expect(handleCalendarExport(new Request('https://calenote.test/api/calendar/export.ics',{headers:{cookie:SESSION_COOKIE_NAME+'='+credentials}}),async()=>({...ops,requireUser:async()=>{throw new SessionAuthError();}}))).rejects.toBeInstanceOf(SessionAuthError);
});
it('returns a private attachment with truthful completeness headers',async()=>{
 const response=await handleCalendarExport(new Request('https://calenote.test/api/calendar/export.ics',{headers:{cookie:SESSION_COOKIE_NAME+'='+credentials}}),async()=>ops);
 expect(response.headers.get('content-type')).toBe('text/calendar; charset=utf-8');expect(response.headers.get('content-disposition')).toBe('attachment; filename="calenote.ics"');
 expect(response.headers.get('cache-control')).toBe('no-store');expect(response.headers.get('vary')).toBe('Cookie');expect(response.headers.get('x-calenote-export-truncated')).toBe('true');expect(response.headers.get('x-calenote-export-skipped')).toBe('2');expect(await response.text()).toBe(file.body);
});
