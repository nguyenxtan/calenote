import type { SessionPrincipal } from '@/modules/auth/session';
import type { EncryptedValue } from '@/modules/security/keyring';
import { D1RateLimitStore } from '@/modules/db/rate-limit-store';
import { d1Changes, randomOpaqueId } from '@/modules/platform/types';
import { SYNC_LEASE_MS, type CalendarConnectionState, type CalendarSyncErrorCode } from './contracts';

export interface CalendarConnectionRow {
 id:string;user_id:string;state:CalendarConnectionState;generation:number;
 token_ciphertext:ArrayBuffer|null;token_iv:ArrayBuffer|null;token_key_version:number;
 remote_calendar_id:string|null;lease_marker:string|null;lease_until:number|null;egress_marker:string|null;
 last_synced_at:number|null;next_sync_at:number|null;attempt_count:number;last_error:CalendarSyncErrorCode;
}
export interface CalendarMappingRow {logical_uid:string;remote_event_id:string;payload_digest:string|null;target_digest:string;state:'WRITING'|'UNCERTAIN'|'SYNCED'|'REMOVED';operation:'UPSERT'|'REMOVE';write_marker:string;attempt_count:number}
const liveSession = `EXISTS (SELECT 1 FROM sessions s WHERE s.id=? AND s.user_id=? AND s.revoked_at IS NULL AND s.expires_at>?)`;
const lease = `id=? AND lease_marker=? AND lease_until>? AND egress_marker IS NULL AND state<>'DISCONNECTED'`;
export class D1CalendarSyncStore {
 constructor(private readonly db:D1Database){}
 async consumeOAuthLimit(subjectDigest:string,now:number):Promise<boolean>{return (await new D1RateLimitStore(this.db).consume({subjectDigest,bucket:'calendar.oauth.begin',limit:5,now,resetAt:now+15*60_000})).allowed;}
 findOwner(userId:string):Promise<CalendarConnectionRow|null>{return this.db.prepare('SELECT * FROM calendar_connections WHERE user_id=? AND provider=\'google\'').bind(userId).first<CalendarConnectionRow>();}
 find(id:string):Promise<CalendarConnectionRow|null>{return this.db.prepare('SELECT * FROM calendar_connections WHERE id=?').bind(id).first<CalendarConnectionRow>();}
 async putNonce(principal:SessionPrincipal,digest:string,expiresAt:number,now:number):Promise<boolean>{
  return d1Changes(await this.db.prepare(`INSERT INTO calendar_oauth_states(user_id,session_id,nonce_digest,expires_at,consumed_at,created_at)
   SELECT ?,?,?,?,NULL,? WHERE ${liveSession}
   ON CONFLICT(user_id) DO UPDATE SET session_id=excluded.session_id,nonce_digest=excluded.nonce_digest,expires_at=excluded.expires_at,consumed_at=NULL,created_at=excluded.created_at`).bind(principal.userId,principal.sessionId,digest,expiresAt,now,principal.sessionId,principal.userId,now).run())===1;
 }
 async consumeNonce(principal:SessionPrincipal,digest:string,now:number):Promise<boolean>{
  return d1Changes(await this.db.prepare(`UPDATE calendar_oauth_states SET consumed_at=? WHERE user_id=? AND session_id=? AND nonce_digest=? AND expires_at>? AND consumed_at IS NULL AND ${liveSession}`).bind(now,principal.userId,principal.sessionId,digest,now,principal.sessionId,principal.userId,now).run())===1;
 }
 async reserveAuthorization(principal:SessionPrincipal,id:string,marker:string,now:number):Promise<CalendarConnectionRow|null>{
  const result=await this.db.prepare(`INSERT INTO calendar_connections(id,user_id,state,lease_marker,lease_until,created_at,updated_at)
   SELECT ?,?,'AUTHORIZING',?,?,?,? WHERE ${liveSession}
   ON CONFLICT(user_id,provider) DO UPDATE SET state='AUTHORIZING',generation=calendar_connections.generation+1,token_ciphertext=NULL,token_iv=NULL,remote_calendar_id=NULL,lease_marker=excluded.lease_marker,lease_until=excluded.lease_until,attempt_count=0,next_sync_at=NULL,last_error=NULL,last_synced_at=NULL,updated_at=excluded.updated_at
   WHERE calendar_connections.state IN ('DISCONNECTED','REAUTH_REQUIRED') AND calendar_connections.egress_marker IS NULL AND (calendar_connections.lease_until IS NULL OR calendar_connections.lease_until<=?) RETURNING *`)
   .bind(id,principal.userId,marker,now+SYNC_LEASE_MS,now,now,principal.sessionId,principal.userId,now,now).all<CalendarConnectionRow>();
  const row=result.results[0]??null;
  if(row)await this.db.prepare('DELETE FROM calendar_event_mappings WHERE connection_id=? AND EXISTS(SELECT 1 FROM calendar_connections WHERE id=? AND lease_marker=?)').bind(row.id,row.id,marker).run();
  return row;
 }
 async saveAuthorization(row:CalendarConnectionRow,marker:string,encrypted:EncryptedValue,principal:SessionPrincipal,now:number):Promise<boolean>{
  const results=await this.db.batch([
   this.db.prepare(`UPDATE calendar_connections SET state='PENDING',token_ciphertext=?,token_iv=?,next_sync_at=?,updated_at=? WHERE ${lease} AND state='AUTHORIZING' AND ${liveSession}`).bind(encrypted.ciphertext,encrypted.iv,now,now,row.id,marker,now,principal.sessionId,principal.userId,now),
   this.db.prepare(`INSERT INTO audit_events(id,actor_user_id,action,target_user_id,result,created_at) SELECT ?,user_id,'CALENDAR_CONNECTED',user_id,'SUCCESS',? FROM calendar_connections WHERE id=? AND lease_marker=? AND state='PENDING' AND ${liveSession}`).bind(randomOpaqueId(),now,row.id,marker,principal.sessionId,principal.userId,now),
  ]);return d1Changes(results[0])===1;
 }
 async claim(id:string,marker:string,now:number):Promise<CalendarConnectionRow|null>{
  return (await this.db.prepare(`UPDATE calendar_connections SET lease_marker=?,lease_until=?,updated_at=? WHERE id=? AND state IN ('PENDING','ACTIVE','CREATING_CALENDAR') AND next_sync_at<=? AND attempt_count<6 AND egress_marker IS NULL AND (lease_until IS NULL OR lease_until<=?) RETURNING *`).bind(marker,now+SYNC_LEASE_MS,now,id,now,now).all<CalendarConnectionRow>()).results[0]??null;
 }
 async reserveEgress(id:string,marker:string,requestMarker:string,now:number):Promise<boolean>{return d1Changes(await this.db.prepare(`UPDATE calendar_connections SET egress_marker=? WHERE ${lease}`).bind(requestMarker,id,marker,now).run())===1;}
 async finishEgress(id:string,marker:string,requestMarker:string):Promise<void>{await this.db.prepare('UPDATE calendar_connections SET egress_marker=NULL WHERE id=? AND lease_marker=? AND egress_marker=?').bind(id,marker,requestMarker).run();}
 async release(id:string,marker:string):Promise<void>{await this.db.prepare('UPDATE calendar_connections SET lease_marker=NULL,lease_until=NULL WHERE id=? AND lease_marker=? AND egress_marker IS NULL').bind(id,marker).run();}
 async saveTokens(id:string,marker:string,value:EncryptedValue,now:number):Promise<boolean>{return d1Changes(await this.db.prepare(`UPDATE calendar_connections SET token_ciphertext=?,token_iv=?,updated_at=? WHERE ${lease}`).bind(value.ciphertext,value.iv,now,id,marker,now).run())===1;}
 async markCreating(id:string,marker:string,now:number):Promise<boolean>{return d1Changes(await this.db.prepare(`UPDATE calendar_connections SET state='CREATING_CALENDAR',updated_at=? WHERE ${lease} AND state='PENDING' AND remote_calendar_id IS NULL`).bind(now,id,marker,now).run())===1;}
 async activate(id:string,marker:string,remoteId:string,now:number):Promise<boolean>{return d1Changes(await this.db.prepare(`UPDATE calendar_connections SET state='ACTIVE',remote_calendar_id=?,updated_at=? WHERE ${lease} AND state='CREATING_CALENDAR'`).bind(remoteId,now,id,marker,now).run())===1;}
 async finish(id:string,marker:string,input:{state:CalendarConnectionState;error:CalendarSyncErrorCode;nextAt:number|null;attempts:number;syncedAt?:number},now:number):Promise<void>{
  await this.db.prepare(`UPDATE calendar_connections SET state=?,last_error=?,next_sync_at=?,attempt_count=?,last_synced_at=COALESCE(?,last_synced_at),updated_at=? WHERE ${lease}`).bind(input.state,input.error,input.nextAt,input.attempts,input.syncedAt??null,now,id,marker,now).run();
 }
 async dropAuthorization(id:string,marker:string,now:number):Promise<void>{await this.db.prepare(`UPDATE calendar_connections SET state='REAUTH_REQUIRED',token_ciphertext=NULL,token_iv=NULL,next_sync_at=NULL,last_error='REAUTH_REQUIRED',updated_at=? WHERE ${lease} AND state='AUTHORIZING'`).bind(now,id,marker,now).run();}
 async mappings(id:string,marker:string,uids:string[],now:number):Promise<Map<string,CalendarMappingRow>>{
  if(uids.length>300)throw new TypeError('Calendar projection exceeds mapping lookup bound');
  if(!uids.length)return new Map();
  const rows=await this.db.prepare(`SELECT * FROM calendar_event_mappings WHERE connection_id=? AND logical_uid IN (SELECT value FROM json_each(?)) AND EXISTS(SELECT 1 FROM calendar_connections WHERE ${lease})`).bind(id,JSON.stringify(uids),id,marker,now).all<CalendarMappingRow>();
  return new Map(rows.results.map(row=>[row.logical_uid,row]));
 }
 async prepareMapping(id:string,marker:string,uid:string,remoteId:string,digest:string,operation:'UPSERT'|'REMOVE',now:number):Promise<boolean>{
  return d1Changes(await this.db.prepare(`INSERT INTO calendar_event_mappings(connection_id,logical_uid,remote_event_id,target_digest,state,operation,write_marker,attempt_count,updated_at)
   SELECT ?,?,?,?,'WRITING',?,?,1,? WHERE EXISTS(SELECT 1 FROM calendar_connections WHERE ${lease})
   ON CONFLICT(connection_id,logical_uid) DO UPDATE SET target_digest=excluded.target_digest,state='WRITING',operation=excluded.operation,write_marker=excluded.write_marker,attempt_count=calendar_event_mappings.attempt_count+1,updated_at=excluded.updated_at`)
   .bind(id,uid,remoteId,digest,operation,marker,now,id,marker,now).run())===1;
 }
 async settleMapping(id:string,marker:string,uid:string,state:'SYNCED'|'UNCERTAIN'|'REMOVED',digest:string,now:number):Promise<void>{
  await this.db.prepare(`UPDATE calendar_event_mappings SET state=?,attempt_count=CASE WHEN ?='UNCERTAIN' THEN attempt_count ELSE 0 END,payload_digest=CASE WHEN ?='UNCERTAIN' THEN payload_digest ELSE ? END,updated_at=? WHERE connection_id=? AND logical_uid=? AND write_marker=? AND EXISTS(SELECT 1 FROM calendar_connections WHERE ${lease})`).bind(state,state,state,digest,now,id,uid,marker,id,marker,now).run();
 }
 async beginDisconnect(row:CalendarConnectionRow,marker:string,now:number):Promise<boolean>{
  const results=await this.db.batch([
   this.db.prepare(`UPDATE calendar_connections SET state='DISCONNECTING',generation=generation+1,token_ciphertext=NULL,token_iv=NULL,lease_marker=?,lease_until=?,egress_marker=?,next_sync_at=NULL,last_error=NULL,updated_at=? WHERE id=? AND user_id=? AND generation=? AND egress_marker IS NULL AND (lease_until IS NULL OR lease_until<=?) AND state NOT IN ('DISCONNECTED','DISCONNECTING')`).bind(marker,now+SYNC_LEASE_MS,marker,now,row.id,row.user_id,row.generation,now),
   this.db.prepare(`INSERT INTO audit_events(id,actor_user_id,action,target_user_id,result,created_at) SELECT ?,user_id,'CALENDAR_DISCONNECTED',user_id,'SUCCESS',? FROM calendar_connections WHERE id=? AND state='DISCONNECTING' AND lease_marker=? AND egress_marker=?`).bind(randomOpaqueId(),now,row.id,marker,marker),
  ]);return d1Changes(results[0])===1;
 }
 async finishDisconnect(id:string,marker:string,now:number):Promise<void>{await this.db.prepare(`UPDATE calendar_connections SET state='DISCONNECTED',lease_marker=NULL,lease_until=NULL,egress_marker=NULL,updated_at=? WHERE id=? AND state='DISCONNECTING' AND lease_marker=? AND egress_marker=?`).bind(now,id,marker,marker).run();}
 async selectDue(now:number,limit=5):Promise<string[]>{const result=await this.db.prepare(`SELECT id FROM calendar_connections WHERE state IN ('PENDING','ACTIVE','CREATING_CALENDAR') AND next_sync_at<=? AND egress_marker IS NULL AND (lease_until IS NULL OR lease_until<=?) ORDER BY next_sync_at,id LIMIT ?`).bind(now,now,Math.min(5,Math.max(1,Math.floor(limit)))).all<{id:string}>();return result.results.map(r=>r.id);}
}
