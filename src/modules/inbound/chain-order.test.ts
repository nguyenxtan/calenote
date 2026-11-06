// @vitest-environment node
import {readFileSync} from 'node:fs';
import {afterEach,expect,it,vi} from 'vitest';
import {SqliteD1Database} from '@/testing/sqlite-d1.test-support';
import {D1InboundProcessorStore,processInbound} from './processor';
import {D1InboundDispatchStore} from '@/modules/reminders/scheduler';
import {INBOUND_PROCESSING_LEASE_MS} from './webhook';
const now=Date.parse('2026-11-06T01:00:00Z'),fixtures:SqliteD1Database[]=[];
afterEach(()=>fixtures.splice(0).forEach(db=>db.close()));
function fixture(bound=true){
 const db=new SqliteD1Database({conversationV2:true});fixtures.push(db);
 db.sqlite.exec(readFileSync('migrations/0024_inbound_chat_order.sql','utf8'));
 db.sqlite.exec("INSERT INTO users VALUES ('owner','owner@example.invalid','Owner','Asia/Ho_Chi_Minh',1,1)");
 db.sqlite.prepare("INSERT INTO bot_connections(id,user_id,provider,public_id,provider_bot_id,display_name,encrypted_token,encrypted_token_iv,token_fingerprint,credential_version,state,created_at,updated_at) VALUES ('c','owner','telegram',?,'bot','Bot',x'01',zeroblob(12),'fingerprint',1,?,1,1)").run('A'.repeat(22),bound?'ACTIVE_BOUND':'ACTIVE_UNBOUND');
 const add=(id:string,at=now,chat='chat',user='user')=>db.sqlite.prepare("INSERT INTO inbound_updates(id,connection_id,provider,provider_message_id,provider_user_id,private_chat_id,message_ciphertext,message_iv,message_key_version,state,received_at) VALUES (?,'c','telegram',?,?,?,x'01',zeroblob(12),1,'PENDING',?)").run(id,`provider-${id}`,user,chat,at);
 const store=new D1InboundProcessorStore(db as unknown as D1Database);
 return {db,add,store};
}
it('blocks reverse/tied jobs without consuming either processing attempts or dispatch retry capacity',async()=>{
 const h=fixture();h.add('z-first');h.add('a-second');
 h.db.sqlite.prepare("UPDATE inbound_updates SET dispatch_attempt_count=4,dispatch_started_at=?,dispatch_marker='dispatch' WHERE id='a-second'").run(now);
 expect(await h.store.claim('a-second',now,'b')).toEqual({status:'BLOCKED'});
 expect(await h.db.prepare("SELECT attempt_count,dispatch_attempt_count,dispatch_started_at,dispatch_marker FROM inbound_updates WHERE id='a-second'").first()).toEqual({attempt_count:0,dispatch_attempt_count:0,dispatch_started_at:null,dispatch_marker:null});
 expect(await h.store.claim('z-first',now,'a')).toMatchObject({status:'CLAIMED'});
 h.db.sqlite.prepare("UPDATE inbound_updates SET state='PROCESSED',processed_at=? WHERE id='z-first'").run(now);
 expect(await h.store.claim('a-second',now+1,'b')).toEqual({status:'BLOCKED'});
 expect(await h.store.releaseChain('z-first','a',now+2)).toBe(true);
 expect(await h.store.claim('a-second',now+3,'b')).toMatchObject({status:'CLAIMED'});
});
it('holds a late older provider timestamp behind any live owner and isolates other chat/user scopes',async()=>{
 const h=fixture();h.add('live',now+100);expect(await h.store.claim('live',now+100,'a')).toMatchObject({status:'CLAIMED'});
 h.add('late',now);h.add('other-chat',now,'other');h.add('other-user',now,'chat','other');
 expect(await h.store.claim('late',now+101,'b')).toEqual({status:'BLOCKED'});
 expect(await h.store.claim('other-chat',now+101,'c')).toMatchObject({status:'CLAIMED'});
 expect(await h.store.claim('other-user',now+101,'d')).toMatchObject({status:'CLAIMED'});
});
it('does not block unbound connect traffic',async()=>{
 const h=fixture(false);h.add('first');h.add('second');expect(await h.store.claim('second',now,'b')).toMatchObject({status:'CLAIMED'});
});
it('recovers an exhausted head and prevents an old marker releasing a reclaimed lease',async()=>{
 const h=fixture();h.add('head');h.add('tail');
 expect(await h.store.claim('head',now,'old')).toMatchObject({status:'CLAIMED'});
 expect(await h.store.claim('head',now+INBOUND_PROCESSING_LEASE_MS,'new')).toMatchObject({status:'CLAIMED'});
 expect(await h.store.releaseChain('head','old',now+INBOUND_PROCESSING_LEASE_MS+1)).toBe(false);
 expect(await h.store.claim('tail',now+INBOUND_PROCESSING_LEASE_MS+2,'tail')).toEqual({status:'BLOCKED'});
 h.db.sqlite.prepare("UPDATE inbound_updates SET attempt_count=4,processing_started_at=? WHERE id='head'").run(now-INBOUND_PROCESSING_LEASE_MS);
 expect(await h.store.claim('tail',now+INBOUND_PROCESSING_LEASE_MS+3,'tail')).toMatchObject({status:'CLAIMED'});
 expect(await h.db.prepare("SELECT state FROM inbound_updates WHERE id='head'").first('state')).toBe('FAILED');
});
it('cron selects only ready chat heads in rowid tie order so a burst cannot fill the sweep',async()=>{
 const h=fixture();for(let i=0;i<8;i++)h.add(`burst-${i}`);h.add('other',now,'other');
 const store=new D1InboundDispatchStore(h.db as unknown as D1Database);
 expect(await store.selectOrphans(now,5)).toEqual(['burst-0','other']);
});

it('holds the chain until a real processor send settles, then releases and kicks its next head',async()=>{
 const h=fixture();h.add('head');h.add('tail');
 const {createKeyring}=await import('@/modules/security/keyring');
 const keyring=await createKeyring('A'.repeat(43)),credential=await keyring.encryptCredential('c','telegram',1,'synthetic-token');
 h.db.sqlite.prepare('UPDATE bot_connections SET encrypted_token=?,encrypted_token_iv=?').run(new Uint8Array(credential.ciphertext),new Uint8Array(credential.iv));
 h.db.sqlite.exec("INSERT INTO workspaces VALUES ('workspace','owner','PERSONAL',1,1); INSERT INTO memberships VALUES ('workspace','owner','OWNER',1); INSERT INTO chat_identities(id,connection_id,provider_user_id,private_chat_id,linked_at) VALUES ('identity','c','user','chat',1)");
 const encrypted=await keyring.encryptSensitive('inbound-message','head',1,'xin chào');
 h.db.sqlite.prepare("UPDATE inbound_updates SET message_ciphertext=?,message_iv=? WHERE id='head'").run(new Uint8Array(encrypted.ciphertext),new Uint8Array(encrypted.iv));
 let signal!:(value?:unknown)=>void,finish!:()=>void;
 const started=new Promise(resolve=>{signal=resolve;}),waiting=new Promise<void>(resolve=>{finish=resolve;});
 const kick=vi.fn(async()=>{}),sendText=vi.fn(async()=>{signal();await waiting;return {providerMessageId:'reply'};});
 const work=processInbound('head',{store:h.store,keyring,now:()=>now,sendText,publishNextInChat:kick});
 await started;
 expect(await h.store.claim('tail',now+1,'tail')).toEqual({status:'BLOCKED'});
 expect(await h.db.prepare("SELECT chain_released_at FROM inbound_updates WHERE id='head'").first('chain_released_at')).toBeNull();
 finish();await work;
 expect(await h.db.prepare("SELECT chain_released_at FROM inbound_updates WHERE id='head'").first('chain_released_at')).toBe(now);
 expect(kick).toHaveBeenCalledExactlyOnceWith('head');
 expect(await new D1InboundDispatchStore(h.db as unknown as D1Database).nextInChat('head',now)).toBe('tail');
});
