import { z } from 'zod';
import { parseSessionCredentials, SessionAuthError, type SessionCredentials, type SessionPrincipal } from '@/modules/auth/session';
import { readBoundedJson } from '@/modules/http/body';
import { jsonResponse, requireSameOrigin, SameOriginError } from '@/modules/http/security';
import { CalendarSyncError, type CalendarSyncStatus } from '@/modules/calendar-sync/contracts';

/** Root's completeCalendarSync wrapper schedules only the returned internal id. */
export interface CalendarSyncOperations {
 requireUser(credentials:SessionCredentials):Promise<SessionPrincipal>;
 getCalendarSyncStatus(userId:string):Promise<CalendarSyncStatus>;
 beginCalendarSync(principal:SessionPrincipal):Promise<{nonce:string;clientId:string;expiresAt:number}>;
 completeCalendarSync(principal:SessionPrincipal,input:{nonce:string;code:string}):Promise<{connectionId:string;state:'PENDING'}>;
 disconnectCalendarSync(userId:string):Promise<{disconnected:true;remoteEventsKept:true;revocation:'SUCCEEDED'|'FAILED'|'NOT_NEEDED'}>;
}
type CreateOperations=()=>Promise<CalendarSyncOperations>;
const empty=z.object({}).strict();
const codeBody=z.object({nonce:z.string().length(43),code:z.string().min(1).max(4096).regex(/^[^\u0000-\u0020\u007f]+$/u)}).strict();
function credentials(request:Request):SessionCredentials {const result=parseSessionCredentials(request.headers.get('cookie'));if(!result)throw new SessionAuthError();return result;}
async function body(request:Request):Promise<unknown>{return readBoundedJson(request,6144,{timeoutMs:5000});}
function response(data:unknown):Response{return jsonResponse({data},{headers:{vary:'Cookie','referrer-policy':'no-referrer'}});}
export async function handleCalendarSyncStatus(request:Request,create:CreateOperations):Promise<Response>{
 const session=credentials(request);const operations=await create();const principal=await operations.requireUser(session);return response(await operations.getCalendarSyncStatus(principal.userId));
}
export async function handleCalendarSyncBegin(request:Request,appOrigin:string,create:CreateOperations):Promise<Response>{
 requireSameOrigin(request,appOrigin);const session=credentials(request);if(!empty.safeParse(await body(request)).success)throw new CalendarSyncError('CALENDAR_INVALID_REQUEST');
 const operations=await create();const principal=await operations.requireUser(session);return response(await operations.beginCalendarSync(principal));
}
export async function handleCalendarSyncCode(request:Request,appOrigin:string,create:CreateOperations):Promise<Response>{
 requireSameOrigin(request,appOrigin);const session=credentials(request);if(request.headers.get('x-requested-with')!=='XmlHttpRequest')throw new SameOriginError();
 const parsed=codeBody.safeParse(await body(request));if(!parsed.success)throw new CalendarSyncError('CALENDAR_INVALID_REQUEST');
 const operations=await create();const principal=await operations.requireUser(session);const result=await operations.completeCalendarSync(principal,parsed.data);return response({state:result.state});
}
export async function handleCalendarSyncDisconnect(request:Request,appOrigin:string,create:CreateOperations):Promise<Response>{
 requireSameOrigin(request,appOrigin);const session=credentials(request);if(!empty.safeParse(await body(request)).success)throw new CalendarSyncError('CALENDAR_INVALID_REQUEST');
 const operations=await create();const principal=await operations.requireUser(session);return response(await operations.disconnectCalendarSync(principal.userId));
}
