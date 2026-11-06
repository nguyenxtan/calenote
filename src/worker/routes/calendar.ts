import {parseSessionCredentials,SessionAuthError,type SessionCredentials,type SessionPrincipal} from '@/modules/auth/session';
import type {CalendarExportFile} from '@/modules/calendar/ics';
export interface CalendarExportOperations {
 requireUser(credentials:SessionCredentials):Promise<SessionPrincipal>;
 exportCalendar(principal:SessionPrincipal):Promise<CalendarExportFile>;
}
export async function handleCalendarExport(request:Request,createOperations:()=>Promise<CalendarExportOperations>):Promise<Response>{
 const credentials=parseSessionCredentials(request.headers.get('cookie'));if(!credentials)throw new SessionAuthError();
 const operations=await createOperations(),principal=await operations.requireUser(credentials),file=await operations.exportCalendar(principal);
 return new Response(file.body,{headers:{'content-type':'text/calendar; charset=utf-8','content-disposition':'attachment; filename="calenote.ics"','cache-control':'no-store',vary:'Cookie','x-content-type-options':'nosniff','x-calenote-export-truncated':String(file.truncated),'x-calenote-export-skipped':String(file.skipped),'x-calenote-export-events':String(file.eventCount)}});
}
