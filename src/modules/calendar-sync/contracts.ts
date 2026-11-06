export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';
export const SYNC_LEASE_MS = 5 * 60_000;
export const SYNC_INTERVAL_MS = 5 * 60_000;
export const SYNC_MAX_EVENTS = 300;
export const SYNC_MAX_WRITES = 20;
export const SYNC_MAX_REQUESTS = 50;
export const SYNC_MAX_ATTEMPTS = 6;
export const OAUTH_NONCE_TTL_MS = 5 * 60_000;

export interface CalendarEnvironment {
 CALENDAR_SYNC_ENABLED?: string;
 GOOGLE_CALENDAR_CLIENT_ID?: string;
 GOOGLE_CALENDAR_CLIENT_SECRET?: string;
}
export function calendarSyncCapability(env:CalendarEnvironment):{available:false}|{available:true;clientId:string} {
 return env.CALENDAR_SYNC_ENABLED === 'true' && !!env.GOOGLE_CALENDAR_CLIENT_ID?.trim() && !!env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim()
  ? {available:true,clientId:env.GOOGLE_CALENDAR_CLIENT_ID} : {available:false};
}
export type SyncEvent = {uid:string;title:string;start:{kind:'UTC';timestamp:number}|{kind:'DATE';date:string};status:'CONFIRMED'|'CANCELLED'};
/** Background caller must hold this owner's actual calendar connection lease. Never expose an owner selector publicly. */
export interface CalendarSyncProjection { read(userId:string,now:number):Promise<{events:SyncEvent[];truncated:boolean}> }
export interface CalendarTokens {accessToken:string;refreshToken:string;expiresAt:number}
export type CalendarConnectionState = 'AUTHORIZING'|'PENDING'|'CREATING_CALENDAR'|'ACTIVE'|'SETUP_UNCERTAIN'|'REAUTH_REQUIRED'|'DISCONNECTING'|'DISCONNECTED';
export type CalendarSyncErrorCode = 'REAUTH_REQUIRED'|'PROVIDER_UNAVAILABLE'|'SETUP_UNCERTAIN'|'OWNERSHIP_CONFLICT'|'RETRY_EXHAUSTED'|'PROJECTION_INVALID'|'EGRESS_UNRESOLVED'|null;
export interface CalendarSyncStatus {available:boolean;state:'UNAVAILABLE'|'NOT_CONNECTED'|CalendarConnectionState;lastSyncedAt:number|null;error:CalendarSyncErrorCode}
export class CalendarSyncError extends Error {
 constructor(readonly code:'CALENDAR_UNAVAILABLE'|'CALENDAR_INVALID_REQUEST'|'CALENDAR_NONCE_REJECTED'|'CALENDAR_BUSY'|'CALENDAR_CONNECTION_EXISTS'|'CALENDAR_RATE_LIMITED',readonly status=400) {super('Không thể hoàn tất kết nối lịch. Vui lòng thử lại.');this.name='CalendarSyncError';}
}
