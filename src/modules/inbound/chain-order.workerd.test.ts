// @vitest-environment node
import {readFileSync,readdirSync} from 'node:fs';
import {expect,it} from 'vitest';
import {semanticRuntime} from '@/modules/semantic/infrastructure/d1/runtime.test-support';
import {migrationStatements} from '@/testing/sqlite-d1.test-support';
import {D1InboundProcessorStore} from './processor';
import {D1InboundDispatchStore} from '@/modules/reminders/scheduler';
it('real D1 enforces chat order and delivery hold with all forward migrations applied',async()=>{
 const {db,runtime}=await semanticRuntime();
 try{
  for(const file of readdirSync('migrations').filter(n=>n.endsWith('.sql')).sort())for(const sql of migrationStatements(readFileSync('migrations/'+file,'utf8')))if(sql.replace(/--[^\n]*/gu,'').trim())await db.prepare(sql).run();
  const now=1800000000000;
  await db.prepare("INSERT INTO users VALUES ('owner','owner@example.invalid','Owner','Asia/Ho_Chi_Minh',1,1)").run();
  await db.prepare("INSERT INTO bot_connections(id,user_id,provider,public_id,provider_bot_id,display_name,encrypted_token,encrypted_token_iv,token_fingerprint,credential_version,state,created_at,updated_at) VALUES ('c','owner','telegram',?,'bot','Bot',x'01',zeroblob(12),'fingerprint',1,'ACTIVE_BOUND',1,1)").bind('A'.repeat(22)).run();
  for(const id of ['z-head','a-tail'])await db.prepare("INSERT INTO inbound_updates(id,connection_id,provider,provider_message_id,provider_user_id,private_chat_id,message_ciphertext,message_iv,message_key_version,state,received_at) VALUES (?,'c','telegram',?,'user','chat',x'01',zeroblob(12),1,'PENDING',?)").bind(id,id,now).run();
  const store=new D1InboundProcessorStore(db),dispatch=new D1InboundDispatchStore(db);
  const [head,tail]=await Promise.all([store.claim('z-head',now,'head'),store.claim('a-tail',now,'tail')]);
  expect(head).toMatchObject({status:'CLAIMED'});expect(tail).toEqual({status:'BLOCKED'});
  await db.prepare("UPDATE inbound_updates SET state='PROCESSED',processed_at=? WHERE id='z-head'").bind(now).run();
  expect(await store.claim('a-tail',now+1,'tail')).toEqual({status:'BLOCKED'});
  expect(await dispatch.selectOrphans(now+1,5)).toEqual([]);
  expect(await store.releaseChain('z-head','wrong',now+2)).toBe(false);
  expect(await store.releaseChain('z-head','head',now+2)).toBe(true);
  expect(await dispatch.nextInChat('z-head',now+2)).toBe('a-tail');
  expect(await dispatch.selectOrphans(now+2,5)).toEqual(['a-tail']);
  expect(await store.claim('a-tail',now+3,'tail')).toMatchObject({status:'CLAIMED'});
 }finally{await runtime.dispose();}
},30000);
