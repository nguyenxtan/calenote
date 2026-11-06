import { persistedD1Blob } from '@/modules/db/persisted-blob';
import type { SessionPrincipal } from '@/modules/auth/session';
import { base64UrlToBytes, bytesToBase64Url } from '@/modules/security/encoding';
import type { Keyring } from '@/modules/security/keyring';
import { randomOpaqueId } from '@/modules/platform/types';
import { CalendarSyncError, OAUTH_NONCE_TTL_MS, SYNC_INTERVAL_MS, SYNC_MAX_ATTEMPTS, SYNC_MAX_EVENTS, SYNC_MAX_REQUESTS, SYNC_MAX_WRITES, type CalendarSyncProjection, type CalendarSyncStatus, type CalendarTokens, type SyncEvent } from './contracts';
import { CalendarProviderError, GoogleCalendarProvider, base32Hex } from './google-provider';
import { D1CalendarSyncStore, type CalendarConnectionRow } from './store';

interface Dependencies {enabled:boolean;clientId:string;store:D1CalendarSyncStore;keyring:Pick<Keyring,'encryptSensitive'|'decryptSensitive'|'digestCode'>;provider:GoogleCalendarProvider|null;projection:CalendarSyncProjection;now?:()=>number}
export type CalendarSyncResult = {status:'UNAVAILABLE'|'BUSY'|'SKIPPED'|'SYNCED'|'PAUSED'|'RETRY';writes?:number;truncated?:boolean};
export class CalendarSyncService {
 private readonly now:()=>number;
 constructor(private readonly d:Dependencies){this.now=d.now??Date.now;}
 private requireEnabled():GoogleCalendarProvider {if(!this.d.enabled||!this.d.provider)throw new CalendarSyncError('CALENDAR_UNAVAILABLE',503);return this.d.provider;}
 private digest(domain:string,parts:unknown[]):Promise<string>{return this.d.keyring.digestCode(JSON.stringify(['calendar-sync',1,domain,...parts]));}
 private binding(row:CalendarConnectionRow):string{return `${row.id}:${row.generation}`;}
 private async encrypt(row:CalendarConnectionRow,tokens:CalendarTokens){return this.d.keyring.encryptSensitive('calendar-oauth-tokens',this.binding(row),row.token_key_version,JSON.stringify(tokens));}
 private async decrypt(row:CalendarConnectionRow):Promise<CalendarTokens>{
  if(!row.token_ciphertext||!row.token_iv)throw new CalendarProviderError('REAUTH_REQUIRED');
  try{const value=JSON.parse(await this.d.keyring.decryptSensitive('calendar-oauth-tokens',this.binding(row),row.token_key_version,{ciphertext:persistedD1Blob(row.token_ciphertext),iv:persistedD1Blob(row.token_iv)}));
   if(typeof value.accessToken!=='string'||!value.accessToken||typeof value.refreshToken!=='string'||!value.refreshToken||!Number.isFinite(value.expiresAt))throw new Error();return value;
  }catch{throw new CalendarProviderError('REAUTH_REQUIRED');}
 }
 /** Every provider request owns a durable egress reservation. Expired leases cannot bypass an unresolved reservation. */
 private async invoke<T>(row:CalendarConnectionRow,marker:string,operation:()=>Promise<T>):Promise<T>{
  const requestMarker=randomOpaqueId();if(!await this.d.store.reserveEgress(row.id,marker,requestMarker,this.now()))throw new CalendarSyncError('CALENDAR_BUSY',409);
  try{return await operation();}finally{await this.d.store.finishEgress(row.id,marker,requestMarker);}
 }
 async status(userId:string):Promise<CalendarSyncStatus>{
  if(!this.d.enabled)return {available:false,state:'UNAVAILABLE',lastSyncedAt:null,error:null};
  const row=await this.d.store.findOwner(userId);return {available:true,state:row?.state??'NOT_CONNECTED',lastSyncedAt:row?.last_synced_at??null,error:row?.egress_marker&&(row.lease_until??0)<=this.now()?'EGRESS_UNRESOLVED':row?.last_error??null};
 }
 async begin(principal:SessionPrincipal):Promise<{nonce:string;clientId:string;expiresAt:number}>{
  this.requireEnabled();const row=await this.d.store.findOwner(principal.userId);
  if(row&&!['DISCONNECTED','REAUTH_REQUIRED'].includes(row.state))throw new CalendarSyncError('CALENDAR_CONNECTION_EXISTS',409);
  if(!await this.d.store.consumeOAuthLimit(await this.digest('oauth-rate-limit',[principal.userId]),this.now()))throw new CalendarSyncError('CALENDAR_RATE_LIMITED',429);
  const nonce=bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));const now=this.now();const expiresAt=Math.min(now+OAUTH_NONCE_TTL_MS,principal.expiresAt);
  if(!await this.d.store.putNonce(principal,await this.digest('oauth-nonce',[nonce]),expiresAt,now))throw new CalendarSyncError('CALENDAR_NONCE_REJECTED',409);
  return {nonce,clientId:this.d.clientId,expiresAt};
 }
 async complete(principal:SessionPrincipal,input:{nonce:string;code:string}):Promise<{connectionId:string;state:'PENDING'}>{
  const provider=this.requireEnabled();if(base64UrlToBytes(input.nonce)?.byteLength!==32||!input.code||input.code.length>4096||/[\u0000-\u0020\u007f]/u.test(input.code))throw new CalendarSyncError('CALENDAR_INVALID_REQUEST');
  if(!await this.d.store.consumeNonce(principal,await this.digest('oauth-nonce',[input.nonce]),this.now()))throw new CalendarSyncError('CALENDAR_NONCE_REJECTED',409);
  const marker=randomOpaqueId();const row=await this.d.store.reserveAuthorization(principal,randomOpaqueId(),marker,this.now());
  if(!row)throw new CalendarSyncError('CALENDAR_BUSY',409);
  let tokens:CalendarTokens|null=null;
  try{
   tokens=await this.invoke(row,marker,()=>provider.exchangeCode(input.code,this.now()));
   if(!await this.d.store.saveAuthorization(row,marker,await this.encrypt(row,tokens),principal,this.now()))throw new CalendarSyncError('CALENDAR_NONCE_REJECTED',409);
   return {connectionId:row.id,state:'PENDING'};
  }catch(error){
   if(tokens){try{await this.invoke(row,marker,()=>provider.revoke(tokens!.refreshToken));}catch{/* Content-free cleanup failure; local secrets are still dropped. */}}
   await this.d.store.dropAuthorization(row.id,marker,this.now());
   if(error instanceof CalendarSyncError)throw error;throw new CalendarSyncError('CALENDAR_INVALID_REQUEST');
  }finally{await this.d.store.release(row.id,marker);}
 }
 async disconnect(userId:string):Promise<{disconnected:true;remoteEventsKept:true;revocation:'SUCCEEDED'|'FAILED'|'NOT_NEEDED'}>{
  const provider=this.requireEnabled();const row=await this.d.store.findOwner(userId);
  if(!row||row.state==='DISCONNECTED')return {disconnected:true,remoteEventsKept:true,revocation:'NOT_NEEDED'};
  const marker=randomOpaqueId();
  // Copy/decrypt only this owner's ciphertext before the CAS drops it. No outbound request occurs before CAS.
  let tokens:CalendarTokens|null=null;try{tokens=await this.decrypt(row);}catch{/* Corrupt or absent tokens must not prevent local removal. */}
  if(!await this.d.store.beginDisconnect(row,marker,this.now()))throw new CalendarSyncError('CALENDAR_BUSY',409);
  let revocation:'SUCCEEDED'|'FAILED'|'NOT_NEEDED'='NOT_NEEDED';
  try{if(tokens){try{await provider.revoke(tokens.refreshToken);revocation='SUCCEEDED';}catch{revocation='FAILED';}}}
  finally{await this.d.store.finishDisconnect(row.id,marker,this.now());}
  return {disconnected:true,remoteEventsKept:true,revocation};
 }
 async selectDue(limit=5):Promise<string[]>{return this.d.enabled?this.d.store.selectDue(this.now(),limit):[];}
 async sync(connectionId:string):Promise<CalendarSyncResult>{
  if(!this.d.enabled||!this.d.provider)return {status:'UNAVAILABLE'};const provider=this.d.provider;
  const marker=randomOpaqueId();const row=await this.d.store.claim(connectionId,marker,this.now());
  if(!row){const current=await this.d.store.find(connectionId);return {status:current&&(current.egress_marker||(current.lease_until??0)>this.now())?'BUSY':'SKIPPED'};}
  let writes=0,requests=0;let creating=false;let active=!!row.remote_calendar_id;
  const call=<T>(operation:()=>Promise<T>)=>{if(requests>=SYNC_MAX_REQUESTS)throw new CalendarProviderError('RETRYABLE');requests++;return this.invoke(row,marker,operation);};
  try{
   // An interrupted non-idempotent calendar insert cannot safely be repeated.
   if(row.state==='CREATING_CALENDAR'){
    await this.d.store.finish(row.id,marker,{state:'SETUP_UNCERTAIN',error:'SETUP_UNCERTAIN',nextAt:null,attempts:row.attempt_count+1},this.now());return {status:'PAUSED'};
   }
   let tokens=await this.decrypt(row);
   if(tokens.expiresAt<=this.now()+60_000){tokens=await call(()=>provider.refresh(tokens.refreshToken,this.now()));if(!await this.d.store.saveTokens(row.id,marker,await this.encrypt(row,tokens),this.now()))throw new CalendarSyncError('CALENDAR_BUSY',409);}
   let calendarId=row.remote_calendar_id;
   if(!calendarId){
    if(!await this.d.store.markCreating(row.id,marker,this.now()))throw new CalendarSyncError('CALENDAR_BUSY',409);
    creating=true;calendarId=await call(()=>provider.createCalendar(tokens.accessToken));
    if(!await this.d.store.activate(row.id,marker,calendarId,this.now()))throw new CalendarSyncError('CALENDAR_BUSY',409);
    creating=false;active=true;
   }
   const projection=await this.d.projection.read(row.user_id,this.now());
   if(projection.events.length>SYNC_MAX_EVENTS||new Set(projection.events.map(e=>e.uid)).size!==projection.events.length||projection.events.some(e=>!this.validEvent(e))){
    await this.d.store.finish(row.id,marker,{state:'ACTIVE',error:'PROJECTION_INVALID',nextAt:null,attempts:0},this.now());return {status:'PAUSED'};
   }
   let more=false,eventFailures=false,retryEventFailures=false;
   const mappings=await this.d.store.mappings(row.id,marker,projection.events.map(event=>event.uid),this.now());
   for(const event of projection.events){
    const old=mappings.get(event.uid);
    const digest=await this.digest('payload',[event.uid,event.title,event.start,event.status]);
    if((event.status==='CANCELLED'&&(!old||old.state==='REMOVED'))||(old?.state==='SYNCED'&&old.payload_digest===digest))continue;
    if(writes>=SYNC_MAX_WRITES||requests>SYNC_MAX_REQUESTS-6){more=true;break;}
    if((old?.attempt_count??0)>=SYNC_MAX_ATTEMPTS){eventFailures=true;continue;}
    const bytes=base64UrlToBytes(await this.digest('event-id',[row.id,row.generation,event.uid]));if(!bytes)throw new CalendarProviderError('REJECTED');
    const expectedId='cn'+base32Hex(bytes);const remoteId=old?.remote_event_id??expectedId;
    if(remoteId!==expectedId)throw new CalendarProviderError('OWNERSHIP_CONFLICT');
    const ownedMapping=old?.payload_digest!==null&&old?.payload_digest!==undefined;
    const recovering=old?.state==='WRITING'||old?.state==='UNCERTAIN';
    if(!await this.d.store.prepareMapping(row.id,marker,event.uid,remoteId,digest,event.status==='CANCELLED'?'REMOVE':'UPSERT',this.now()))throw new CalendarSyncError('CALENDAR_BUSY',409);
    try{
     const probe=()=>call(()=>provider.getEvent(tokens.accessToken,calendarId!,remoteId,ownedMapping));
     let exists:boolean|'DELETED'=!!old&&old.state!=='REMOVED';
     if(recovering||event.status==='CANCELLED')exists=await probe();
     if(event.status==='CANCELLED'){
      if(exists===true)await call(()=>provider.removeEvent(tokens.accessToken,calendarId!,remoteId));
      await this.d.store.settleMapping(row.id,marker,event.uid,'REMOVED',digest,this.now());
     }else{
      const update=()=>call(()=>provider.updateEvent(tokens.accessToken,calendarId!,remoteId,event));
      const insert=async()=>{
       try{await call(()=>provider.insertEvent(tokens.accessToken,calendarId!,remoteId,event));}
       catch(error){if(!(error instanceof CalendarProviderError)||error.kind!=='CONFLICT')throw error;
        if(!await probe())throw new CalendarProviderError('UNKNOWN');
        await update();}
      };
      try{if(exists)await update();else await insert();}
      catch(error){
       if(!(error instanceof CalendarProviderError)||error.kind!=='NOT_FOUND')throw error;
       // A deleted event (or temporarily inaccessible calendar) cannot authorize
       // a new calendar. Probe this deterministic id; restore only owned content.
       const recovered=await probe();if(recovered)await update();else await insert();
      }
      await this.d.store.settleMapping(row.id,marker,event.uid,'SYNCED',digest,this.now());
     }
     writes++;
    }catch(error){await this.d.store.settleMapping(row.id,marker,event.uid,'UNCERTAIN',digest,this.now());
     if(error instanceof CalendarProviderError&&error.kind==='NOT_FOUND'){eventFailures=true;retryEventFailures=true;continue;}throw error;}
   }
   await this.d.store.finish(row.id,marker,{state:'ACTIVE',error:eventFailures?'PROVIDER_UNAVAILABLE':null,nextAt:this.now()+((more||retryEventFailures)?60_000:SYNC_INTERVAL_MS),attempts:0,syncedAt:this.now()},this.now());
   return {status:'SYNCED',writes,truncated:projection.truncated||more||eventFailures};
  }catch(error){
   const p=error instanceof CalendarProviderError?error:null;const attempts=row.attempt_count+1;
   if(creating&&!p?.definitelyRejected){await this.d.store.finish(row.id,marker,{state:'SETUP_UNCERTAIN',error:'SETUP_UNCERTAIN',nextAt:null,attempts},this.now());return {status:'PAUSED'};}
   const reauth=p?.kind==='REAUTH_REQUIRED';const conflict=p?.kind==='OWNERSHIP_CONFLICT';const exhausted=attempts>=SYNC_MAX_ATTEMPTS||p?.kind==='REJECTED';
   await this.d.store.finish(row.id,marker,{state:reauth?'REAUTH_REQUIRED':active?'ACTIVE':'PENDING',error:reauth?'REAUTH_REQUIRED':conflict?'OWNERSHIP_CONFLICT':exhausted?'RETRY_EXHAUSTED':'PROVIDER_UNAVAILABLE',nextAt:reauth||conflict||exhausted?null:this.now()+Math.max(p?.retryAfterMs??0,Math.min(3_600_000,60_000*2**attempts)),attempts},this.now());
   return {status:reauth||conflict||exhausted?'PAUSED':'RETRY',writes};
  }finally{await this.d.store.release(row.id,marker);}
 }
 private validEvent(event:SyncEvent):boolean {
  if(typeof event.uid!=='string'||!event.uid||event.uid.length>512||typeof event.title!=='string'||event.title.length>4096||!['CONFIRMED','CANCELLED'].includes(event.status))return false;
  if(event.start.kind==='UTC')return Number.isSafeInteger(event.start.timestamp)&&Math.abs(event.start.timestamp)<8.64e15-60_000;
  return /^\d{4}-\d{2}-\d{2}$/u.test(event.start.date)&&Number.isFinite(Date.parse(event.start.date+'T00:00:00Z'))&&new Date(event.start.date+'T00:00:00Z').toISOString().slice(0,10)===event.start.date;
 }
}
