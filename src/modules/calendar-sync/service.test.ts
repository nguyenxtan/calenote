// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { SqliteD1Database } from '@/testing/sqlite-d1.test-support';
import { createKeyring } from '@/modules/security/keyring';
import { D1CalendarSyncStore } from './store';
import { CalendarSyncService } from './service';
import { GoogleCalendarProvider } from './google-provider';
import { GOOGLE_CALENDAR_SCOPE, SYNC_LEASE_MS, type SyncEvent } from './contracts';
const databases:SqliteD1Database[]=[];
afterEach(()=>{databases.splice(0).forEach(db=>db.close());vi.unstubAllGlobals();});
async function fixture(){
 const db=new SqliteD1Database();databases.push(db);db.sqlite.exec(readFileSync('migrations/0025_calendar_sync.sql','utf8'));
 db.sqlite.exec("INSERT INTO users VALUES ('u','u@test','U','Asia/Ho_Chi_Minh',1,1),('other','o@test','O','Asia/Ho_Chi_Minh',1,1); INSERT INTO sessions VALUES ('s','u','digest',999999999,NULL,1),('s2','u','digest2',999999999,NULL,1),('foreign','other','digest3',999999999,NULL,1);");
 const keyring=await createKeyring('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');const store=new D1CalendarSyncStore(db as unknown as D1Database);
 let now=100000;const events:SyncEvent[]=[{uid:'reminder-one',title:'Private title',start:{kind:'UTC',timestamp:200000},status:'CONFIRMED'}];
 const remote=new Map<string,unknown>();let failCreate=false;let unknownCalendar=false;
 const transport=vi.fn(async(url:string,init:RequestInit)=>{
  if(url.endsWith('/token'))return Response.json({access_token:'access-fixture',refresh_token:'refresh-fixture',expires_in:3600,token_type:'Bearer',scope:GOOGLE_CALENDAR_SCOPE});
  if(url.endsWith('/revoke'))return new Response(null,{status:200});
  if(url.endsWith('/calendars')){if(unknownCalendar)throw new Error('unknown calendar');return Response.json({id:'remote-calendar'});}
  const eventId=url.split('/').at(-1)!;
  if(init.method==='GET')return remote.has(eventId)?Response.json(remote.get(eventId)):new Response(null,{status:404});
  if(init.method==='DELETE'){remote.delete(eventId);return new Response(null,{status:204});}
  const body=JSON.parse(init.body as string);remote.set(body.id,body);
  if(failCreate&&init.method==='POST'){failCreate=false;throw new Error('connection reset after dispatch');}
  return Response.json(body);
 });
 const provider=new GoogleCalendarProvider({clientId:'fixture-client',clientSecret:'fixture-secret',appOrigin:'https://calenote.test'},transport);
 const projection={read:vi.fn(async()=>({events,truncated:false}))};
 const service=new CalendarSyncService({enabled:true,clientId:'fixture-client',store,keyring,provider,projection,now:()=>now});
 const principal={userId:'u',sessionId:'s',expiresAt:999999999};
 async function connect(){const begun=await service.begin(principal);return service.complete(principal,{nonce:begun.nonce,code:'fixture-code'});}
 async function runDue(id:string){const row=db.sqlite.prepare('SELECT next_sync_at FROM calendar_connections WHERE id=?').get(id) as {next_sync_at:number|null}|undefined;now=Math.max(now,row?.next_sync_at??now);return service.sync(id);}
 return {db,store,service,transport,keyring,events,projection,remote,principal,connect,runDue,setNow:(n:number)=>{now=n;},failCreate:()=>{failCreate=true;},unknownCalendar:()=>{unknownCalendar=true;}};
}
it('does nothing when capability is disabled',async()=>{
 const h=await fixture();const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
 const off=new CalendarSyncService({enabled:false,clientId:'',store:h.store,keyring:h.keyring,provider:null,projection:h.projection,now:()=>100});
 expect(await off.status('u')).toEqual({available:false,state:'UNAVAILABLE',lastSyncedAt:null,error:null});
 await expect(off.begin(h.principal)).rejects.toMatchObject({code:'CALENDAR_UNAVAILABLE'});
 expect(await off.sync('unknown')).toEqual({status:'UNAVAILABLE'});expect(h.transport).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
});
it('binds nonce to same live owner and session and consumes it exactly once before exchange',async()=>{
 const h=await fixture();const {nonce}=await h.service.begin(h.principal);
 await expect(h.service.complete({...h.principal,sessionId:'s2'},{nonce,code:'c'})).rejects.toMatchObject({code:'CALENDAR_NONCE_REJECTED'});
 await expect(h.service.complete({userId:'other',sessionId:'foreign',expiresAt:999999999},{nonce,code:'c'})).rejects.toMatchObject({code:'CALENDAR_NONCE_REJECTED'});
 expect(h.transport).not.toHaveBeenCalled();await h.service.complete(h.principal,{nonce,code:'c'});
 await expect(h.service.complete(h.principal,{nonce,code:'c'})).rejects.toMatchObject({code:'CALENDAR_NONCE_REJECTED'});
 expect(h.transport).toHaveBeenCalledTimes(1);
 const row=h.db.sqlite.prepare('SELECT * FROM calendar_connections').get() as Record<string,unknown>;
 expect(row.token_ciphertext).toBeInstanceOf(Uint8Array);expect(JSON.stringify(row)).not.toContain('access-fixture');
 expect(JSON.stringify(await h.service.status('u'))).not.toContain('refresh-fixture');
});
it.each(['expired','revoked'] as const)('rejects %s nonce session before provider exchange',async kind=>{
 const h=await fixture();const {nonce}=await h.service.begin(h.principal);
 if(kind==='expired')h.setNow(400001);else h.db.sqlite.exec("UPDATE sessions SET revoked_at=2 WHERE id='s'");
 await expect(h.service.complete(h.principal,{nonce,code:'c'})).rejects.toMatchObject({code:'CALENDAR_NONCE_REJECTED'});expect(h.transport).not.toHaveBeenCalled();
});
it('syncs idempotently, updates title at stable id and deletes only explicit cancellation',async()=>{
 const h=await fixture();const {connectionId}=await h.connect();await h.runDue(connectionId);
 expect(h.remote.size).toBe(1);const id=[...h.remote.keys()][0];expect(id).toMatch(/^cn[0-9a-v]{52}$/u);
 const count=h.transport.mock.calls.length;await h.runDue(connectionId);expect(h.transport).toHaveBeenCalledTimes(count);
 h.events[0].title='Changed';await h.runDue(connectionId);expect(h.transport.mock.calls.at(-1)?.[1].method).toBe('PUT');expect(h.remote.size).toBe(1);expect(h.remote.has(id)).toBe(true);
 const current=h.events.pop()!;await h.runDue(connectionId);expect(h.remote.size).toBe(1);
 h.events.push({...current,status:'CANCELLED'});await h.runDue(connectionId);expect(h.remote.size).toBe(0);
});
it('resolves unknown create by GET before update and never blindly inserts twice',async()=>{
 const h=await fixture();const {connectionId}=await h.connect();h.failCreate();await h.runDue(connectionId);
 expect(h.db.sqlite.prepare('SELECT state FROM calendar_event_mappings').get()).toEqual({state:'UNCERTAIN'});
 expect((await h.service.status('u')).state).toBe('ACTIVE');
 await h.runDue(connectionId);
 const methods=h.transport.mock.calls.filter(([url])=>url.includes('/events')).map(([,init])=>init.method);
 expect(methods).toEqual(['POST','GET','PUT']);expect(h.remote.size).toBe(1);
});
it('serializes concurrent sweeps and refuses disconnect until in-flight egress is settled',async()=>{
 const h=await fixture();const {connectionId}=await h.connect();
 let release!:()=>void;const blocked=new Promise<void>(r=>{release=r;});let started!:()=>void;const waiting=new Promise<void>(r=>{started=r;});
 h.projection.read.mockImplementationOnce(async()=>{started();await blocked;return {events:h.events,truncated:false};});
 const first=h.service.sync(connectionId);await waiting;expect(await h.service.sync(connectionId)).toEqual({status:'BUSY'});
 await expect(h.service.disconnect('u')).rejects.toMatchObject({code:'CALENDAR_BUSY'});release();await first;
 expect(await h.service.disconnect('u')).toEqual({disconnected:true,remoteEventsKept:true,revocation:'SUCCEEDED'});
 const count=h.transport.mock.calls.length;expect(await h.runDue(connectionId)).toEqual({status:'SKIPPED'});expect(h.transport).toHaveBeenCalledTimes(count);
 expect(h.db.sqlite.prepare('SELECT token_ciphertext,token_iv FROM calendar_connections').get()).toEqual({token_ciphertext:null,token_iv:null});
 expect(h.remote.size).toBe(1);
});
it('does not reclaim an expired lease with unresolved egress or let a zombie overwrite state',async()=>{
 const h=await fixture();const {connectionId}=await h.connect();const claim=await h.store.claim(connectionId,'first',100000);expect(claim).not.toBeNull();
 expect(await h.store.reserveEgress(connectionId,'first','request',100001)).toBe(true);h.setNow(100000+SYNC_LEASE_MS+1);
 expect(await h.service.sync(connectionId)).toEqual({status:'BUSY'});await expect(h.service.disconnect('u')).rejects.toMatchObject({code:'CALENDAR_BUSY'});
 await h.store.finishEgress(connectionId,'first','request');await h.store.claim(connectionId,'second',100000+SYNC_LEASE_MS+1);
 expect(await h.store.activate(connectionId,'first','foreign',100000+SYNC_LEASE_MS+2)).toBe(false);
});
it('pauses unknown secondary-calendar create instead of creating another calendar',async()=>{
 const h=await fixture();const {connectionId}=await h.connect();h.unknownCalendar();await h.runDue(connectionId);await h.runDue(connectionId);
 expect((await h.service.status('u')).state).toBe('SETUP_UNCERTAIN');expect(h.transport.mock.calls.filter(([url])=>url.endsWith('/calendars'))).toHaveLength(1);
});
it('keeps mapped payload digests keyed and survives owner deletion through cascading foreign keys',async()=>{
 const h=await fixture();const {connectionId}=await h.connect();await h.runDue(connectionId);
 expect(await h.service.status('other')).toMatchObject({state:'NOT_CONNECTED'});
 const row=h.db.sqlite.prepare('SELECT * FROM calendar_event_mappings').get() as Record<string,unknown>;expect(JSON.stringify(row)).not.toContain('Private title');expect(String(row.payload_digest)).toHaveLength(43);
 h.db.sqlite.exec("DELETE FROM sessions WHERE user_id='u'; DELETE FROM users WHERE id='u'");expect(h.db.sqlite.prepare('SELECT count(*) AS n FROM calendar_event_mappings').get()).toEqual({n:0});
});
it('does not confuse successful edits with failed-attempt exhaustion',async()=>{
 const h=await fixture();const {connectionId}=await h.connect();await h.runDue(connectionId);
 for(let i=0;i<8;i++){h.events[0].title='Edit '+i;expect(await h.runDue(connectionId)).toMatchObject({status:'SYNCED',writes:1});}
 expect(h.db.sqlite.prepare('SELECT attempt_count FROM calendar_event_mappings').get()).toEqual({attempt_count:0});
});
it('caps writes per sweep and never deletes mappings absent from a truncated projection',async()=>{
 const h=await fixture();const {connectionId}=await h.connect();
 h.events.splice(0,1,...Array.from({length:25},(_,i)=>({uid:'event-'+i,title:'Title '+i,start:{kind:'UTC' as const,timestamp:200000+i},status:'CONFIRMED' as const})));
 expect(await h.runDue(connectionId)).toMatchObject({status:'SYNCED',writes:20,truncated:true});expect(h.remote.size).toBe(20);
 expect(await h.runDue(connectionId)).toMatchObject({writes:5});expect(h.remote.size).toBe(25);
 h.events.splice(0);h.projection.read.mockResolvedValue({events:[],truncated:true});await h.runDue(connectionId);expect(h.remote.size).toBe(25);
});
it('drops secrets even if revocation fails and blocks a new grant while revoke is in flight',async()=>{
 const h=await fixture();await h.connect();let release!:()=>void;const wait=new Promise<void>(r=>{release=r;});let started!:()=>void;const ready=new Promise<void>(r=>{started=r;});
 h.transport.mockImplementationOnce(async()=>{started();await wait;throw new Error('revoke unavailable');});
 const disconnect=h.service.disconnect('u');await ready;
 expect(h.db.sqlite.prepare('SELECT token_ciphertext FROM calendar_connections').get()).toEqual({token_ciphertext:null});
 await expect(h.service.begin(h.principal)).rejects.toMatchObject({code:'CALENDAR_CONNECTION_EXISTS'});release();
 expect(await disconnect).toMatchObject({disconnected:true,revocation:'FAILED'});
});
it('stops retrying exhausted transient sweeps even if the same queue job is delivered again',async()=>{
 const h=await fixture();const {connectionId}=await h.connect();await h.runDue(connectionId);
 h.db.sqlite.exec('UPDATE calendar_connections SET attempt_count=5');h.projection.read.mockRejectedValue(new Error('projection unavailable'));
 await h.runDue(connectionId);const count=h.transport.mock.calls.length;
 expect(await h.runDue(connectionId)).toEqual({status:'SKIPPED'});expect(h.transport).toHaveBeenCalledTimes(count);
});
it('uses only the injected HTTP transport during an enabled end-to-end mocked sweep',async()=>{
 const h=await fixture();const fetch=vi.fn(()=>{throw new Error('ambient network forbidden');});vi.stubGlobal('fetch',fetch);
 const {connectionId}=await h.connect();expect(await h.runDue(connectionId)).toMatchObject({status:'SYNCED'});await h.service.disconnect('u');expect(fetch).not.toHaveBeenCalled();
});
it('rechecks live session after exchanging a code and drops tokens if the session was revoked meanwhile',async()=>{
 const h=await fixture();const {nonce}=await h.service.begin(h.principal);
 h.transport.mockImplementationOnce(async()=>{h.db.sqlite.exec("UPDATE sessions SET revoked_at=1 WHERE id='s'");return Response.json({access_token:'fixture',refresh_token:'fixture-refresh',expires_in:3600,token_type:'Bearer',scope:GOOGLE_CALENDAR_SCOPE});});
 await expect(h.service.complete(h.principal,{nonce,code:'code'})).rejects.toMatchObject({code:'CALENDAR_NONCE_REJECTED'});
 expect(h.db.sqlite.prepare('SELECT token_ciphertext,state FROM calendar_connections').get()).toEqual({token_ciphertext:null,state:'REAUTH_REQUIRED'});expect(h.transport.mock.calls.at(-1)?.[0]).toBe('https://oauth2.googleapis.com/revoke');
});
it('requires a live lease at provider dispatch even if projection work outlives its claim',async()=>{
 const h=await fixture();const {connectionId}=await h.connect();await h.runDue(connectionId);h.events[0].title='Changed';
 h.projection.read.mockImplementationOnce(async()=>{h.setNow(100000+3*SYNC_LEASE_MS+1);return {events:h.events,truncated:false};});
 const count=h.transport.mock.calls.length;await h.runDue(connectionId);expect(h.transport).toHaveBeenCalledTimes(count);
});
it('bounds repeated OAuth begin requests per owner before contacting Google',async()=>{
 const h=await fixture();for(let i=0;i<5;i++)await h.service.begin(h.principal);
 await expect(h.service.begin(h.principal)).rejects.toMatchObject({code:'CALENDAR_RATE_LIMITED',status:429});expect(h.transport).not.toHaveBeenCalled();
});
it('writes content-free connection lifecycle audit rows',async()=>{
 const h=await fixture();await h.connect();await h.service.disconnect('u');
 const rows=h.db.sqlite.prepare("SELECT action,result,actor_user_id,target_connection_id FROM audit_events WHERE action LIKE 'CALENDAR_%' ORDER BY action").all();
 expect(rows).toEqual([{action:'CALENDAR_CONNECTED',result:'SUCCESS',actor_user_id:'u',target_connection_id:null},{action:'CALENDAR_DISCONNECTED',result:'SUCCESS',actor_user_id:'u',target_connection_id:null}]);expect(JSON.stringify(rows)).not.toContain('fixture');
});
it('honors next-sync backoff even for duplicate queue deliveries',async()=>{
 const h=await fixture();const {connectionId}=await h.connect();await h.service.sync(connectionId);h.events[0].title='Changed immediately';
 const count=h.transport.mock.calls.length;expect(await h.service.sync(connectionId)).toEqual({status:'SKIPPED'});expect(h.transport).toHaveBeenCalledTimes(count);
});
it.each([404,410])('recovers missing update HTTP %s with GET ownership probe and stable event id',async status=>{
 const h=await fixture();const {connectionId}=await h.connect();await h.runDue(connectionId);const id=[...h.remote.keys()][0];h.remote.delete(id);h.events[0].title='Edited after remote deletion';
 const original=h.transport.getMockImplementation()!;h.transport.mockImplementation(async(url,init)=>init.method==='PUT'&&!h.remote.has(url.split('/').at(-1)!)?new Response(null,{status}):original(url,init));
 expect(await h.runDue(connectionId)).toMatchObject({status:'SYNCED',writes:1});
 expect(h.transport.mock.calls.filter(([url])=>url.includes('/events')).map(([,init])=>init.method)).toEqual(['POST','PUT','GET','POST']);
 expect([...h.remote.keys()]).toEqual([id]);expect((await h.service.status('u')).state).toBe('ACTIVE');
});
it('restores an owned id-only tombstone with confirmed status without creating a new event',async()=>{
 const h=await fixture();const {connectionId}=await h.connect();await h.runDue(connectionId);const id=[...h.remote.keys()][0];h.remote.set(id,{id,status:'cancelled'});h.events[0].title='Edited';
 const original=h.transport.getMockImplementation()!;let failed=false;
 h.transport.mockImplementation(async(url,init)=>{if(init.method==='PUT'&&!failed){failed=true;return new Response(null,{status:410});}return original(url,init);});
 expect(await h.runDue(connectionId)).toMatchObject({status:'SYNCED',writes:1});
 expect(h.transport.mock.calls.filter(([url])=>url.includes('/events')).map(([,init])=>init.method)).toEqual(['POST','PUT','GET','PUT']);
 expect(h.remote.get(id)).toMatchObject({id,status:'confirmed',extendedProperties:{private:{calenote:id}}});
});
it('does not grant ownership from an id-only tombstone after an unconfirmed create',async()=>{
 const h=await fixture();const {connectionId}=await h.connect();h.failCreate();await h.runDue(connectionId);const id=[...h.remote.keys()][0];h.remote.set(id,{id,status:'cancelled'});
 const count=h.transport.mock.calls.length;expect(await h.runDue(connectionId)).toMatchObject({status:'PAUSED'});
 expect((await h.service.status('u')).error).toBe('OWNERSHIP_CONFLICT');expect(h.transport.mock.calls.slice(count).map(([,init])=>init.method)).toEqual(['GET']);
});
it('isolates repeated event-not-found failures while other events continue and the calendar identity is preserved',async()=>{
 const h=await fixture();const {connectionId}=await h.connect();await h.runDue(connectionId);const brokenId=[...h.remote.keys()][0];h.remote.delete(brokenId);h.events[0].title='Missing remote';
 const original=h.transport.getMockImplementation()!;h.transport.mockImplementation(async(url,init)=>{if(url.includes('/events')&&(url.endsWith(brokenId)||(init.method==='POST'&&JSON.parse(init.body as string).id===brokenId)))return new Response(null,{status:404});return original(url,init);});
 for(let i=0;i<8;i++){h.events.push({uid:'healthy-'+i,title:'Healthy '+i,start:{kind:'UTC',timestamp:300000+i},status:'CONFIRMED'});await h.runDue(connectionId);}
 expect(h.remote.size).toBe(8);expect((await h.service.status('u')).state).toBe('ACTIVE');expect(h.db.sqlite.prepare('SELECT remote_calendar_id,generation FROM calendar_connections').get()).toEqual({remote_calendar_id:'remote-calendar',generation:1});
});
it('reads current event mappings in one bounded query rather than one query per event',async()=>{
 const h=await fixture();const {connectionId}=await h.connect();const read=vi.spyOn(h.store,'mappings');
 h.events.splice(0,1,...Array.from({length:300},(_,i)=>({uid:'bound-'+i,title:'T',start:{kind:'UTC' as const,timestamp:300000+i},status:'CONFIRMED' as const})));
 await h.runDue(connectionId);expect(read).toHaveBeenCalledTimes(1);expect(read.mock.calls[0][2]).toHaveLength(300);
});
it('does not delete a remote event whose ownership marker conflicts with the original mapping',async()=>{
 const h=await fixture();const {connectionId}=await h.connect();await h.runDue(connectionId);const id=[...h.remote.keys()][0];h.remote.set(id,{id,extendedProperties:{private:{calenote:'foreign'}}});h.events[0].status='CANCELLED';
 const before=h.transport.mock.calls.length;expect(await h.runDue(connectionId)).toMatchObject({status:'PAUSED'});expect(h.transport.mock.calls.slice(before).map(([,init])=>init.method)).toEqual(['GET']);expect(h.remote.has(id)).toBe(true);
});
it('settles cancellation of an originally owned tombstone without deleting anything else',async()=>{
 const h=await fixture();const {connectionId}=await h.connect();await h.runDue(connectionId);const id=[...h.remote.keys()][0];h.remote.set(id,{id,status:'cancelled'});h.events[0].status='CANCELLED';
 const before=h.transport.mock.calls.length;expect(await h.runDue(connectionId)).toMatchObject({status:'SYNCED',writes:1});expect(h.transport.mock.calls.slice(before).map(([,init])=>init.method)).toEqual(['GET']);expect(h.db.sqlite.prepare('SELECT state FROM calendar_event_mappings').get()).toEqual({state:'REMOVED'});
});
it('preserves calendar identity and mappings after an unfamiliar non-auth 403',async()=>{
 const h=await fixture();const {connectionId}=await h.connect();await h.runDue(connectionId);const id=[...h.remote.keys()][0];h.events[0].title='Changed';
 h.transport.mockImplementationOnce(async()=>Response.json({error:{errors:[{reason:'dailyLimitExceeded'}]}},{status:403}));
 expect(await h.runDue(connectionId)).toMatchObject({status:'RETRY'});expect((await h.service.status('u')).state).toBe('ACTIVE');expect(h.db.sqlite.prepare('SELECT remote_calendar_id,generation FROM calendar_connections').get()).toEqual({remote_calendar_id:'remote-calendar',generation:1});expect(h.remote.has(id)).toBe(true);
});
it('retries a definitely rejected calendar create without forcing reconnect or treating it as an uncertain write',async()=>{
 const h=await fixture();const {connectionId}=await h.connect();h.transport.mockImplementationOnce(async()=>Response.json({error:{errors:[{reason:'dailyLimitExceeded'}]}},{status:403}));
 expect(await h.runDue(connectionId)).toMatchObject({status:'RETRY'});expect((await h.service.status('u')).state).toBe('PENDING');expect(await h.runDue(connectionId)).toMatchObject({status:'SYNCED'});expect(h.db.sqlite.prepare('SELECT generation FROM calendar_connections').get()).toEqual({generation:1});
});
