import type {SessionPrincipal} from '@/modules/auth/session';
import type {Keyring} from '@/modules/security/keyring';
import {consumeRateLimit,type RateLimitStore} from '@/modules/rate-limit/service';
import {RateLimitExceededError} from '@/modules/onboarding/service';
import type {CalendarProjection} from './projection';
import {serializeCalendarExport,type CalendarExportFile} from './ics';
export interface CalendarExportStore {read(principal:SessionPrincipal,now:number):Promise<CalendarProjection>;recordExport(principal:SessionPrincipal,now:number):Promise<void>}
export interface CalendarExportDependencies {store:CalendarExportStore;keyring:Pick<Keyring,'digestCode'>;rateLimitStore:RateLimitStore;now?:()=>number}
export async function exportOwnerCalendar(principal:SessionPrincipal,dependencies:CalendarExportDependencies):Promise<CalendarExportFile>{
 const now=(dependencies.now??Date.now)();
 const subjectDigest=await dependencies.keyring.digestCode(`rate-limit:calendar-export:${principal.userId}`);
 const rate=await consumeRateLimit({subjectDigest,scope:'calendar-export',limit:6,windowMs:60_000},{store:dependencies.rateLimitStore,now:()=>now});
 if(!rate.allowed)throw new RateLimitExceededError(Math.max(1,Math.ceil((rate.resetAt-now)/1000)));
 const projection=await dependencies.store.read(principal,now),file=serializeCalendarExport(projection);
 await dependencies.store.recordExport(principal,(dependencies.now??Date.now)());return file;
}
