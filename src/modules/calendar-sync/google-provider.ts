import { GOOGLE_CALENDAR_SCOPE, type CalendarTokens, type SyncEvent } from './contracts';

export type CalendarHttpTransport = (url:string,init:RequestInit)=>Promise<Response>;
export type ProviderErrorKind = 'REAUTH_REQUIRED'|'RETRYABLE'|'UNKNOWN'|'CONFLICT'|'OWNERSHIP_CONFLICT'|'REJECTED';
export class CalendarProviderError extends Error {
 constructor(readonly kind:ProviderErrorKind,readonly retryAfterMs:number|null=null) {super('Calendar provider request failed.');this.name='CalendarProviderError';}
}
export interface GoogleCalendarConfig {clientId:string;clientSecret:string;appOrigin:string}
const API = 'https://www.googleapis.com/calendar/v3';
function record(value:unknown):value is Record<string,unknown> {return typeof value==='object'&&value!==null&&!Array.isArray(value);}
function tokenString(value:unknown):value is string {return typeof value==='string'&&value.length>0&&value.length<=16_384&&!/[\u0000-\u0020\u007f]/u.test(value);}
export function base32Hex(bytes:Uint8Array):string {
 const alphabet='0123456789abcdefghijklmnopqrstuv';let bits=0,value=0,out='';
 for(const b of bytes){value=(value<<8)|b;bits+=8;while(bits>=5){bits-=5;out+=alphabet[(value>>>bits)&31];}}
 if(bits)out+=alphabet[(value<<(5-bits))&31];return out;
}
function eventPayload(eventId:string,event:SyncEvent):Record<string,unknown> {
 let start:Record<string,string>,end:Record<string,string>;
 if(event.start.kind==='UTC'){
  if(!Number.isSafeInteger(event.start.timestamp))throw new CalendarProviderError('REJECTED');
  start={dateTime:new Date(event.start.timestamp).toISOString()};end={dateTime:new Date(event.start.timestamp+60_000).toISOString()};
 }else{
  const date=event.start.date;
  if(!/^\d{4}-\d{2}-\d{2}$/u.test(date)||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)throw new CalendarProviderError('REJECTED');
  start={date};end={date:new Date(Date.parse(date+'T00:00:00Z')+86_400_000).toISOString().slice(0,10)};
 }
 return {id:eventId,summary:event.title.replace(/[\u0000-\u001f\u007f]/gu,' ').slice(0,512),start,end,transparency:'transparent',reminders:{useDefault:false},extendedProperties:{private:{calenote:eventId}}};
}

/** Has no ambient network implementation. The caller supplies a transport that honors AbortSignal. */
export class GoogleCalendarProvider {
 constructor(private readonly config:GoogleCalendarConfig,private readonly transport:CalendarHttpTransport) {
  if(new URL(config.appOrigin).origin!==config.appOrigin)throw new TypeError('Calendar app origin must be canonical');
 }
 private async request(url:string,init:RequestInit,allowed:number[]=[]):Promise<{status:number;body:unknown}> {
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),10_000);
  try {
   const response=await this.transport(url,{...init,redirect:'error',signal:controller.signal});
   let payload:unknown=null;
   if(!allowed.includes(response.status)&&response.status!==204){
    const reader=response.body?.getReader();let bytes=0,text='';const decoder=new TextDecoder();
    if(reader){try{while(true){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>65_536){await reader.cancel();throw new CalendarProviderError('UNKNOWN');}text+=decoder.decode(chunk.value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}}
    if(text){try{payload=JSON.parse(text);}catch{if(response.ok)throw new CalendarProviderError('UNKNOWN');}}
   }
   if(!response.ok&&!allowed.includes(response.status)){
    const error=record(payload)?payload.error:null;
    if(response.status===401||error==='invalid_grant'||error==='invalid_token')throw new CalendarProviderError('REAUTH_REQUIRED');
    if(response.status===409)throw new CalendarProviderError('CONFLICT');
    const quota=response.status===429||(response.status===403&&record(error)&&Array.isArray(error.errors)&&error.errors.some(e=>record(e)&&['rateLimitExceeded','userRateLimitExceeded','quotaExceeded'].includes(String(e.reason))));
    if(quota||response.status>=500){const seconds=Number(response.headers.get('retry-after'));throw new CalendarProviderError('RETRYABLE',Number.isFinite(seconds)&&seconds>0?Math.min(seconds*1000,3_600_000):null);}
    if(response.status===403)throw new CalendarProviderError('REAUTH_REQUIRED');
    throw new CalendarProviderError('REJECTED');
   }
   return {status:response.status,body:payload};
  }catch(error){if(error instanceof CalendarProviderError)throw error;throw new CalendarProviderError('UNKNOWN');}
  finally{clearTimeout(timeout);}
 }
 private async token(fields:Record<string,string>,now:number,previousRefresh?:string):Promise<CalendarTokens>{
  const {body}=await this.request('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...fields,client_id:this.config.clientId,client_secret:this.config.clientSecret}).toString()});
  if(!record(body)||!tokenString(body.access_token)||body.token_type!=='Bearer'||typeof body.expires_in!=='number'||!Number.isFinite(body.expires_in)||body.expires_in<=0||body.expires_in>86_400)throw new CalendarProviderError('UNKNOWN');
  if(typeof body.scope==='string'&&!body.scope.split(' ').includes(GOOGLE_CALENDAR_SCOPE))throw new CalendarProviderError('REAUTH_REQUIRED');
  const refresh=body.refresh_token??previousRefresh;if(!tokenString(refresh))throw new CalendarProviderError('REAUTH_REQUIRED');
  return {accessToken:body.access_token,refreshToken:refresh,expiresAt:now+body.expires_in*1000};
 }
 exchangeCode(code:string,now:number):Promise<CalendarTokens>{return this.token({grant_type:'authorization_code',code,redirect_uri:this.config.appOrigin},now);}
 refresh(refreshToken:string,now:number):Promise<CalendarTokens>{return this.token({grant_type:'refresh_token',refresh_token:refreshToken},now,refreshToken);}
 async revoke(token:string):Promise<void>{await this.request('https://oauth2.googleapis.com/revoke',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token}).toString()},[400]);}
 private headers(accessToken:string):Record<string,string>{return {authorization:`Bearer ${accessToken}`,'content-type':'application/json'};}
 async createCalendar(accessToken:string):Promise<string>{
  const {body}=await this.request(API+'/calendars',{method:'POST',headers:this.headers(accessToken),body:JSON.stringify({summary:'Calenote',timeZone:'Asia/Ho_Chi_Minh'})});
  if(!record(body)||!tokenString(body.id))throw new CalendarProviderError('UNKNOWN');return body.id;
 }
 private eventUrl(calendarId:string,eventId?:string):string{return API+'/calendars/'+encodeURIComponent(calendarId)+'/events'+(eventId?'/'+encodeURIComponent(eventId):'');}
 private verifyEvent(body:unknown,eventId:string):void {
  if(!record(body)||body.id!==eventId||!record(body.extendedProperties)||!record(body.extendedProperties.private)||body.extendedProperties.private.calenote!==eventId)throw new CalendarProviderError('OWNERSHIP_CONFLICT');
 }
 async getEvent(accessToken:string,calendarId:string,eventId:string):Promise<boolean>{const r=await this.request(this.eventUrl(calendarId,eventId),{method:'GET',headers:this.headers(accessToken)},[404,410]);if(r.status===404||r.status===410)return false;this.verifyEvent(r.body,eventId);return true;}
 async insertEvent(accessToken:string,calendarId:string,eventId:string,event:SyncEvent):Promise<void>{const r=await this.request(this.eventUrl(calendarId),{method:'POST',headers:this.headers(accessToken),body:JSON.stringify(eventPayload(eventId,event))});this.verifyEvent(r.body,eventId);}
 async updateEvent(accessToken:string,calendarId:string,eventId:string,event:SyncEvent):Promise<void>{const r=await this.request(this.eventUrl(calendarId,eventId),{method:'PUT',headers:this.headers(accessToken),body:JSON.stringify(eventPayload(eventId,event))});this.verifyEvent(r.body,eventId);}
 async removeEvent(accessToken:string,calendarId:string,eventId:string):Promise<void>{await this.request(this.eventUrl(calendarId,eventId),{method:'DELETE',headers:this.headers(accessToken)},[404,410]);}
}
