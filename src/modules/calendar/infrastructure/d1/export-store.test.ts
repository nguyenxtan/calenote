// @vitest-environment node
import {readFileSync,readdirSync} from 'node:fs';
import {afterEach,expect,it} from 'vitest';
import {SqliteD1Database} from '@/testing/sqlite-d1.test-support';
import {createKeyring} from '@/modules/security/keyring';
import {contextContractEncryptionIdentity} from '@/modules/conversation/context-contract/store';
import {D1CalendarExportStore} from './export-store';
import {exportOwnerCalendar} from '../../export-service';
import {D1RateLimitStore} from '@/modules/db/rate-limit-store';
import {D1FollowThroughService} from '@/modules/follow-through/service';
const now=Date.UTC(2026,10,6),principal={userId:'owner',sessionId:'session',expiresAt:now+1_000_000};
const disposers:Array<()=>void>=[];afterEach(()=>disposers.splice(0).forEach(fn=>fn()));
async function fixture(){
 const sqlite=new SqliteD1Database({skipInit:true});disposers.push(()=>sqlite.close());
 for(const file of readdirSync('migrations').filter(n=>n.endsWith('.sql')).sort())sqlite.sqlite.exec(readFileSync('migrations/'+file,'utf8'));
 const db=sqlite as unknown as D1Database,keyring=await createKeyring('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
 sqlite.sqlite.exec(`INSERT INTO users VALUES('owner','owner@example.test','Test','Asia/Ho_Chi_Minh',1,1);INSERT INTO workspaces(id,owner_user_id,kind,created_at,updated_at) VALUES('workspace','owner','PERSONAL',1,1);INSERT INTO memberships VALUES('workspace','owner','OWNER',1);
 INSERT INTO bot_connections(id,user_id,provider,public_id,provider_bot_id,display_name,encrypted_token,encrypted_token_iv,token_fingerprint,credential_version,state,created_at,updated_at) VALUES('connection','owner','telegram','public','bot','Test',x'01',zeroblob(12),'fingerprint',1,'ACTIVE_BOUND',1,1);
 INSERT INTO chat_identities(id,connection_id,provider_user_id,private_chat_id,linked_at) VALUES('identity','connection','provider-user','chat',1);
 INSERT INTO inbound_updates(id,connection_id,provider,provider_message_id,provider_user_id,private_chat_id,message_ciphertext,message_iv,message_key_version,state,received_at) VALUES('inbound','connection','telegram','msg','provider-user','chat',x'01',zeroblob(12),1,'PROCESSED',1);`);
 await db.prepare("INSERT INTO sessions VALUES('session','owner','digest',?,NULL,1)").bind(principal.expiresAt).run();
 async function reminder(id:string,scheduledAt=now+1000){
  const e=await keyring.encryptSensitive('reminder-title',id,1,'Họp riêng '+id);
  await db.prepare("INSERT INTO reminders(id,public_id,workspace_id,chat_identity_id,title_ciphertext,title_iv,title_key_version,scheduled_at,timezone,status,created_at,updated_at) VALUES(?,?,'workspace','identity',?,?,1,?,'Asia/Ho_Chi_Minh','PENDING',1,2)").bind(id,id+'-public',e.ciphertext,e.iv,scheduledAt).run();
 }
 async function series(id:string,ids:string[],canonical=false,advance=false){
  await db.prepare("INSERT INTO inbound_updates(id,connection_id,provider,provider_message_id,provider_user_id,private_chat_id,message_ciphertext,message_iv,message_key_version,state,received_at) VALUES(?,'connection','telegram',?,'provider-user','chat',x'01',zeroblob(12),1,'PROCESSED',1)").bind('in-'+id,'msg-'+id).run();
  if(canonical&&!await db.prepare("SELECT id FROM conversation_contexts WHERE id='context'").first()){
   await db.prepare("INSERT INTO conversation_contract_write_permits(chat_identity_id,context_id,marker,operation) VALUES('identity','context','fixture-permit','APPLY')").run();
   await db.prepare("INSERT INTO conversation_contexts(id,owner_id,chat_identity_id,source_inbound_id,last_inbound_id,claim_marker,revision,status,created_at,updated_at,expires_at,contract_version,write_marker) VALUES('context','owner','identity','inbound','inbound','claim',1,'COMPLETED',1,1,2,2,'fixture-permit')").run();
   await db.prepare("INSERT INTO conversation_contract_ownership VALUES('identity','owner','context',2)").run();
  }
  await db.prepare("INSERT INTO reminder_series_proposals(id,owner_id,chat_identity_id,revision,source_inbound_id,action,target_series_id,target_revision,status,payload_ciphertext,payload_iv,key_version,created_at,expires_at,contract_version,transaction_marker) VALUES(?,'owner','identity',1,?,'CANCEL',?,1,'CONFIRMED',zeroblob(16),zeroblob(12),1,1,2,?,?)").bind(id+'-proposal','in-'+id,id,canonical?2:1,canonical?'fixture-permit':null).run();
  await db.prepare("INSERT INTO reminder_series VALUES(?,?,'owner','identity',?,1,'ACTIVE',1,2)").bind(id,id+'-public',id+'-proposal').run();
  for(const [i,r]of ids.entries())await db.prepare('INSERT INTO reminder_series_occurrences VALUES(?,?,?)').bind(id,i,r).run();
  if(canonical||advance){
   if(advance)await db.prepare("INSERT INTO advance_notification_groups VALUES(?,'owner','identity')").bind(id).run();
   const details={schemaVersion:'calenote-reminder-details-1',location:'Phòng riêng',notes:'DO NOT EXPORT',eventDate:'2026-11-08',eventTime:'15:00',calendarProvenance:{calendar:'GREGORIAN',sourceDate:null,provenance:{kind:'EXPLICIT_USER'}},resolutionVersion:'v1'};
   const e=await keyring.encryptSensitive('context-contract-series-details',contextContractEncryptionIdentity({ownerId:'owner',chatIdentityId:'identity'},id),1,JSON.stringify(details));
   await db.prepare("INSERT INTO reminder_series_context_details VALUES(?,'owner','identity',?,'calenote-reminder-details-1',?,?,1)").bind(id,id,e.ciphertext,e.iv).run();
  }
 }
 return {db,keyring,sqlite,reminder,series,store:new D1CalendarExportStore(db,keyring)};
}
it('projects one stable root at current head and both finite versions without duplicate runs or advance notifications',async()=>{
 const f=await fixture();await f.reminder('root');
 await f.db.prepare("INSERT INTO follow_through_spawn_permits VALUES('snooze','root','permit')").run();await f.reminder('snooze',now+9000);
 await f.db.prepare("INSERT INTO follow_through_runs VALUES('root','snooze','SNOOZE',1,'snooze')").run();await f.db.prepare("UPDATE follow_through_items SET current_reminder_id='snooze' WHERE id='root'").run();
 for(const id of ['legacy1','legacy2','canonical1','canonical2','advance1','advance2'])await f.reminder(id);
 await f.series('legacy',['legacy1','legacy2']);await f.series('canonical',['canonical1','canonical2'],true);await f.series('advance',['advance1','advance2'],true,true);
 const result=await f.store.read(principal,now);expect(result.skipped).toBe(0);expect(result.events).toHaveLength(6);
 expect(result.events.find(e=>e.uid==='reminder-root-public@calenote')).toMatchObject({start:{kind:'UTC',timestamp:now+9000},title:'Họp riêng snooze'});
 expect(result.events.filter(e=>e.uid.startsWith('series-legacy-public-'))).toHaveLength(2);expect(result.events.filter(e=>e.uid.startsWith('series-canonical-public-'))).toHaveLength(2);
 expect(result.events.find(e=>e.uid==='series-advance-public@calenote')).toMatchObject({start:{kind:'UTC',timestamp:Date.UTC(2026,10,8,8)},location:'Phòng riêng'});
 expect(JSON.stringify(result)).not.toContain('DO NOT EXPORT');expect(JSON.stringify(result)).not.toContain('advance1-public');
});
it('rejects foreign, missing, revoked and expired sessions and skips corrupt ciphertext with no content in the result',async()=>{
 const f=await fixture();await f.reminder('good');await f.reminder('bad');await f.db.prepare("UPDATE reminders SET title_ciphertext=zeroblob(16) WHERE id='bad'").run();
 const result=await f.store.read(principal,now);expect(result.events.map(e=>e.title)).toEqual(['Họp riêng good']);expect(result.skipped).toBe(1);
 await expect(f.store.read({...principal,userId:'other'},now)).rejects.toMatchObject({status:401});await expect(f.store.read({...principal,sessionId:'missing'},now)).rejects.toMatchObject({status:401});
 await expect(f.store.read(principal,principal.expiresAt)).rejects.toMatchObject({status:401});
 await f.db.prepare("UPDATE sessions SET revoked_at=1 WHERE id='session'").run();await expect(f.store.read(principal,now)).rejects.toMatchObject({status:401});
 // Internal sync entry point has owner fences and requires a caller-held connection lease.
 expect((await f.store.readForSyncAuthorizedOwner('owner',now)).events).toHaveLength(1);expect((await f.store.readForSyncAuthorizedOwner('other',now)).events).toEqual([]);
});
it('bounds a large owner projection and keeps the nearest 300 upcoming reminders',async()=>{
 const f=await fixture();for(let i=0;i<301;i++)await f.reminder('r'+i,now+(301-i)*1000);
 const result=await f.store.read(principal,now);expect(result.events).toHaveLength(300);expect(result.truncated).toBe(true);expect(result.events[0].uid).toBe('reminder-r300-public@calenote');expect(result.events.at(-1)?.uid).toBe('reminder-r1-public@calenote');
});
it('rate limits actual downloads and audits only content-free owner/session-authorized exports',async()=>{
 const f=await fixture();await f.reminder('private');
 const deps={store:f.store,keyring:f.keyring,rateLimitStore:new D1RateLimitStore(f.db),now:()=>now};
 for(let i=0;i<6;i++)expect((await exportOwnerCalendar(principal,deps)).eventCount).toBe(1);
 await expect(exportOwnerCalendar(principal,deps)).rejects.toMatchObject({status:429});
 const audits=(await f.db.prepare("SELECT * FROM audit_events WHERE action='CALENDAR_EXPORTED'").all()).results;expect(audits).toHaveLength(6);expect(JSON.stringify(audits)).not.toContain('Họp riêng');
 await f.db.prepare("UPDATE sessions SET revoked_at=1 WHERE id='session'").run();await expect(f.store.recordExport(principal,now)).rejects.toMatchObject({status:401});
});
it('does not return decrypted content if the session is revoked during projection',async()=>{
 const f=await fixture();await f.reminder('private');
 const decrypt=f.keyring.decryptSensitive.bind(f.keyring);
 const keyring={...f.keyring,decryptSensitive:async(...args:Parameters<typeof decrypt>)=>{const title=await decrypt(...args);await f.db.prepare("UPDATE sessions SET revoked_at=1 WHERE id='session'").run();return title;}};
 await expect(new D1CalendarExportStore(f.db,keyring).read(principal,now)).rejects.toMatchObject({status:401});
});
it('isolates two valid owners and requires the personal workspace OWNER membership',async()=>{
 const f=await fixture();await f.reminder('mine');await f.reminder('foreign');
 f.sqlite.sqlite.exec(`INSERT INTO users VALUES('other','other@example.test','Other','Asia/Ho_Chi_Minh',1,1);
 INSERT INTO workspaces(id,owner_user_id,kind,created_at,updated_at) VALUES('other-space','other','PERSONAL',1,1);
 INSERT INTO memberships VALUES('other-space','other','OWNER',1);
 INSERT INTO bot_connections(id,user_id,provider,public_id,provider_bot_id,display_name,encrypted_token,encrypted_token_iv,token_fingerprint,credential_version,state,created_at,updated_at) VALUES('other-connection','other','telegram','other-public','other-bot','Other',x'01',zeroblob(12),'other-fingerprint',1,'ACTIVE_BOUND',1,1);
 INSERT INTO chat_identities(id,connection_id,provider_user_id,private_chat_id,linked_at) VALUES('other-identity','other-connection','other-user','other-chat',1);
 UPDATE reminders SET workspace_id='other-space',chat_identity_id='other-identity' WHERE id='foreign';
 UPDATE follow_through_items SET owner_user_id='other',workspace_id='other-space',chat_identity_id='other-identity',connection_id='other-connection' WHERE root_reminder_id='foreign';`);
 await f.db.prepare("INSERT INTO sessions VALUES('other-session','other','other-digest',?,NULL,1)").bind(principal.expiresAt).run();
 expect((await f.store.read(principal,now)).events.map(e=>e.title)).toEqual(['Họp riêng mine']);
 expect((await f.store.read({...principal,userId:'other',sessionId:'other-session'},now)).events.map(e=>e.title)).toEqual(['Họp riêng foreign']);
 await f.db.prepare("DELETE FROM memberships WHERE workspace_id='workspace' AND user_id='owner'").run();expect((await f.store.read(principal,now)).events).toEqual([]);
});
it('exports cancellation and date-only actual dates while skipping a foreign-bound advance detail once',async()=>{
 const f=await fixture();for(const id of ['one','two','three','four'])await f.reminder(id);
 await f.series('dateonly',['one','two'],true,true);await f.series('foreign',['three','four'],true,true);
 const details={schemaVersion:'calenote-reminder-details-1',location:null,notes:'never export notes',eventDate:'2026-11-09',eventTime:null,calendarProvenance:{calendar:'LUNAR_VN',sourceDate:null,provenance:{kind:'EXPLICIT_USER'}},resolutionVersion:'v1'};
 const e=await f.keyring.encryptSensitive('context-contract-series-details',contextContractEncryptionIdentity({ownerId:'owner',chatIdentityId:'identity'},'dateonly'),1,JSON.stringify(details));
 await f.db.prepare("UPDATE reminder_series_context_details SET payload_ciphertext=?,payload_iv=? WHERE series_id='dateonly'").bind(e.ciphertext,e.iv).run();
 await f.db.prepare("UPDATE reminder_series SET status='CANCELLED' WHERE id='dateonly'").run();
 await f.db.prepare("UPDATE reminder_series_context_details SET encryption_entity_id='other' WHERE series_id='foreign'").run();
 const result=await f.store.read(principal,now);expect(result.skipped).toBe(1);expect(result.events).toHaveLength(1);expect(result.events[0]).toMatchObject({uid:'series-dateonly-public@calenote',status:'CANCELLED',start:{kind:'DATE',date:'2026-11-09'}});expect(JSON.stringify(result)).not.toContain('notes');
});
it('keeps an actual advance event confirmed when one alert is cancelled and cancels it only with its series',async()=>{
 const f=await fixture();await f.reminder('first');await f.reminder('second');await f.series('advance',['first','second'],true,true);
 await f.db.prepare("UPDATE reminders SET status='CANCELLED',updated_at=1000 WHERE id='first'").run();
 expect(await f.db.prepare("SELECT status FROM reminders WHERE id='second'").first('status')).toBe('PENDING');
 const partial=await f.store.read(principal,now);expect(partial.events).toHaveLength(1);expect(partial.events[0]).toMatchObject({uid:'series-advance-public@calenote',status:'CONFIRMED'});
 expect((await f.store.readForSyncAuthorizedOwner('owner',now)).events[0].status).toBe('CONFIRMED');
 await f.db.prepare("UPDATE reminder_series SET status='CANCELLED',updated_at=2000 WHERE id='advance'").run();
 expect((await f.store.read(principal,now)).events[0]).toMatchObject({uid:'series-advance-public@calenote',status:'CANCELLED',updatedAt:2000});
});
it('versions the single advance event from all notification heads, follow-through items and its series',async()=>{
 const f=await fixture();await f.reminder('first');await f.reminder('second');
 await f.db.prepare("INSERT INTO follow_through_spawn_permits VALUES('second-head','second','head-permit')").run();await f.reminder('second-head');
 await f.db.prepare("INSERT INTO follow_through_runs VALUES('second','second-head','SNOOZE',1,'second-head')").run();await f.db.prepare("UPDATE follow_through_items SET current_reminder_id='second-head' WHERE id='second'").run();
 await f.series('advance',['first','second'],true,true);
 await f.db.prepare("UPDATE reminders SET updated_at=3000 WHERE id='second'").run();
 expect((await f.store.read(principal,now)).events[0].updatedAt).toBe(3000);
 await f.db.prepare("UPDATE reminders SET updated_at=3500 WHERE id='second-head'").run();
 expect((await f.store.read(principal,now)).events[0].updatedAt).toBe(3500);
 await f.db.prepare("UPDATE follow_through_items SET updated_at=4000 WHERE root_reminder_id='second'").run();
 expect((await f.store.read(principal,now)).events[0].updatedAt).toBe(4000);
 await f.db.prepare("UPDATE reminder_series SET updated_at=5000 WHERE id='advance'").run();
 expect((await f.store.read(principal,now)).events[0].updatedAt).toBe(5000);
});
it.each([['SENT','CONFIRMED'],['PENDING','CANCELLED']] as const)('stopping follow-through preserves standalone reminder semantics for %s',async(status,exportedStatus)=>{
 const f=await fixture();await f.reminder('root',now-1000);await f.db.prepare('UPDATE reminders SET status=? WHERE id=?').bind(status,'root').run();
 const service=new D1FollowThroughService(f.db,f.keyring,{now:()=>now+10});await service.act({userId:'owner'},{action:'STOP',publicId:'root-public',expectedRevision:0,idempotencyKey:'stop-root'});
 expect(await f.db.prepare("SELECT status FROM reminders WHERE id='root'").first('status')).toBe(status==='SENT'?'SENT':'CANCELLED');
 expect((await f.store.read(principal,now+11)).events[0]).toMatchObject({uid:'reminder-root-public@calenote',status:exportedStatus});
});
it('stopping a pending follow-up cancels the current reminder projection while retaining its sent original history',async()=>{
 const f=await fixture();await f.reminder('root',now-1000);await f.db.prepare("UPDATE reminders SET status='SENT' WHERE id='root'").run();await f.db.prepare("INSERT INTO follow_through_spawn_permits VALUES('head','root','head-permit')").run();await f.reminder('head',now+9000);
 await f.db.prepare("INSERT INTO follow_through_runs VALUES('root','head','FOLLOW_UP',1,'head')").run();await f.db.prepare("UPDATE follow_through_items SET current_reminder_id='head' WHERE id='root'").run();
 await new D1FollowThroughService(f.db,f.keyring,{now:()=>now+10}).act({userId:'owner'},{action:'STOP',publicId:'root-public',expectedRevision:0,idempotencyKey:'stop-head'});
 expect(await f.db.prepare("SELECT status FROM reminders WHERE id='root'").first('status')).toBe('SENT');expect((await f.store.read(principal,now+11)).events[0]).toMatchObject({uid:'reminder-root-public@calenote',status:'CANCELLED',start:{kind:'UTC',timestamp:now+9000}});
});
