// @vitest-environment node
import {readFileSync,readdirSync} from 'node:fs';
import {afterEach,expect,it} from 'vitest';
import {SqliteD1Database} from '@/testing/sqlite-d1.test-support';
import {createKeyring} from '@/modules/security/keyring';
import {contextContractEncryptionIdentity} from '@/modules/conversation/context-contract/store';
import {bytesToBase64Url} from '@/modules/security/encoding';
import {D1CanonicalSeriesStore} from './canonical-series-store';
const now=Date.UTC(2026,10,6),principal={userId:'owner',sessionId:'session',expiresAt:now+100000};
const dispose:Array<()=>void>=[];afterEach(()=>dispose.splice(0).forEach(fn=>fn()));
async function fixture(){
 const sqlite=new SqliteD1Database({skipInit:true});dispose.push(()=>sqlite.close());for(const file of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())sqlite.sqlite.exec(readFileSync('migrations/'+file,'utf8'));
 const db=sqlite as unknown as D1Database,keyring=await createKeyring('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
 sqlite.sqlite.exec(`INSERT INTO users VALUES('owner','owner@example.test','Owner','Asia/Ho_Chi_Minh',1,1);INSERT INTO workspaces VALUES('workspace','owner','PERSONAL',1,1);INSERT INTO memberships VALUES('workspace','owner','OWNER',1);
 INSERT INTO bot_connections(id,user_id,provider,public_id,provider_bot_id,display_name,encrypted_token,encrypted_token_iv,token_fingerprint,credential_version,state,created_at,updated_at) VALUES('connection','owner','telegram','public','bot','Bot',x'01',zeroblob(12),'fingerprint',1,'ACTIVE_BOUND',1,1);
 INSERT INTO chat_identities(id,connection_id,provider_user_id,private_chat_id,linked_at) VALUES('identity','connection','user','chat',1);
 INSERT INTO inbound_updates(id,connection_id,provider,provider_message_id,provider_user_id,private_chat_id,message_ciphertext,message_iv,message_key_version,state,received_at) VALUES('inbound','connection','telegram','msg','user','chat',x'01',zeroblob(12),1,'PROCESSED',1);
 INSERT INTO conversation_contract_write_permits(chat_identity_id,context_id,marker,operation) VALUES('identity','context','permit','APPLY');
 INSERT INTO conversation_contexts(id,owner_id,chat_identity_id,source_inbound_id,last_inbound_id,claim_marker,revision,status,created_at,updated_at,expires_at,contract_version,write_marker) VALUES('context','owner','identity','inbound','inbound','claim',1,'COMPLETED',1,1,2,2,'permit');
 INSERT INTO conversation_contract_ownership VALUES('identity','owner','context',2);UPDATE conversation_contract_write_permits SET operation='CONFIRM' WHERE marker='permit';`);
 await db.prepare("INSERT INTO sessions VALUES('session','owner','digest',?,NULL,1)").bind(principal.expiresAt).run();
 async function series(index:number,cancelled=false,corrupt=false){
  const id='s'+index,publicId=bytesToBase64Url(new Uint8Array(16).fill(index+1));
  await db.prepare("INSERT INTO inbound_updates(id,connection_id,provider,provider_message_id,provider_user_id,private_chat_id,message_ciphertext,message_iv,message_key_version,state,received_at) VALUES(?,'connection','telegram',?,'user','chat',x'01',zeroblob(12),1,'PROCESSED',1)").bind('in'+id,'msg'+id).run();
  await db.prepare("INSERT INTO reminder_series_proposals(id,owner_id,chat_identity_id,revision,source_inbound_id,action,target_series_id,target_revision,status,payload_ciphertext,payload_iv,key_version,created_at,expires_at,contract_version,transaction_marker) VALUES(?,'owner','identity',1,?,'CANCEL',?,1,'CONFIRMED',zeroblob(16),zeroblob(12),1,1,2,2,'permit')").bind('p'+id,'in'+id,id).run();
  await db.prepare("INSERT INTO reminder_series VALUES(?,?,'owner','identity',?,1,?,?,?)").bind(id,publicId,'p'+id,cancelled?'CANCELLED':'ACTIVE',index+1,index+1).run();
  const title=await keyring.encryptSensitive('reminder-title','r'+id,1,'Owned series '+index);
  await db.prepare("INSERT INTO reminders(id,public_id,workspace_id,chat_identity_id,title_ciphertext,title_iv,title_key_version,scheduled_at,timezone,status,created_at,updated_at,context_write_marker) VALUES(?,?,'workspace','identity',?,?,1,?,'Asia/Ho_Chi_Minh','PENDING',1,1,'permit')").bind('r'+id,'r-public'+index,title.ciphertext,title.iv,now+1000).run();
  await db.prepare('INSERT INTO reminder_series_occurrences VALUES(?,0,?)').bind(id,'r'+id).run();
  const details={schemaVersion:'calenote-reminder-details-1',location:null,notes:null,eventDate:null,eventTime:null,calendarProvenance:{calendar:'GREGORIAN',sourceDate:null,provenance:{kind:'EXPLICIT_USER'}},resolutionVersion:'v1'};
  const encrypted=await keyring.encryptSensitive('context-contract-series-details',contextContractEncryptionIdentity({ownerId:'owner',chatIdentityId:'identity'},id),1,JSON.stringify(details));
  await db.prepare("INSERT INTO reminder_series_context_details VALUES(?,'owner','identity',?,'calenote-reminder-details-1',?,?,1)").bind(id,corrupt?'foreign':id,encrypted.ciphertext,encrypted.iv).run();return publicId;
 }
 return {db,series,store:new D1CanonicalSeriesStore(db,keyring)};
}
it('reaches every owned series through bounded pages, keeps active series first, and skips corrupt rows per page',async()=>{
 const f=await fixture();const ids=[];for(let i=0;i<13;i++)ids.push(await f.series(i,i>=11,i===6));
 const first=await f.store.listPage(principal,now);expect(first.series).toHaveLength(9);expect(first.skipped).toBe(1);expect(first.hasMore).toBe(true);expect(first.nextCursor).toBeTypeOf('string');expect(first.series.every(s=>s.state==='ACTIVE')).toBe(true);
 const second=await f.store.listPage(principal,now,first.nextCursor!);expect(second.hasMore).toBe(false);expect(second.series.map(s=>s.publicId)).toEqual([ids[0],ids[12],ids[11]]);
 const all=[...first.series,...second.series];expect(new Set(all.map(s=>s.publicId)).size).toBe(12);expect(all.map(s=>s.publicId)).not.toContain(ids[6]);
 expect(await f.store.listPage({...principal,userId:'foreign'},now,first.nextCursor!)).toMatchObject({series:[],skipped:0,hasMore:false,nextCursor:null});
 await f.db.prepare("UPDATE sessions SET revoked_at=1 WHERE id='session'").run();expect(await f.store.listPage(principal,now,first.nextCursor!)).toMatchObject({series:[],skipped:0,hasMore:false,nextCursor:null});
});
it('skips an out-of-range occurrence timestamp without failing healthy series on the same page',async()=>{
 const f=await fixture();await f.series(0);await f.series(1);await f.db.prepare("UPDATE reminders SET scheduled_at=9000000000000000 WHERE id='rs1'").run();
 const page=await f.store.listPage(principal,now);expect(page.skipped).toBe(1);expect(page.series.map(s=>s.title)).toEqual(['Owned series 0']);
});
