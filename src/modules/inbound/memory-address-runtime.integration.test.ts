// @vitest-environment node
import { afterEach,expect,it,vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fixture } from '@/modules/conversation/context-contract/infrastructure/d1/test-support';
import { createRuntimeOperations } from '@/worker/composition-root';
import * as transport from '@/modules/connections/providers/secret-provider-transport';
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals()});
it.each(['telegram','zalo'] as const)('wires current owner preferences into %s memory replies without AI',async provider=>{
 const h=await fixture();try{
  h.sqlite!.sqlite.exec(readFileSync('migrations/0015_personal_assistant.sql','utf8'));
  await h.db.prepare('DELETE FROM inbound_updates').run();
  await h.db.prepare("INSERT INTO user_preferences(user_id,address_style,tone,updated_at) VALUES('owner','sep','friendly',1)").run();
  const credential=await h.keyring.encryptCredential('connection',provider,1,provider==='telegram'?'123456789:AAExample_secret-token_123456789':'synthetic-zalo-token');
  await h.db.prepare("UPDATE bot_connections SET provider=?,encrypted_token=?,encrypted_token_iv=? WHERE id='connection'").bind(provider,credential.ciphertext,credential.iv).run();
  const payload=await h.keyring.encryptSensitive('inbound-message','memory-address',1,'trí nhớ missing');const now=Date.now();
  await h.db.prepare("INSERT INTO inbound_updates(id,connection_id,provider,provider_message_id,provider_user_id,private_chat_id,message_ciphertext,message_iv,message_key_version,state,received_at) VALUES('memory-address','connection',?,'memory-address','provider-user','chat',?,?,1,'PENDING',?)").bind(provider,payload.ciphertext,payload.iv,now).run();
  const noNetwork=vi.fn(async()=>{throw new Error('Network forbidden')});vi.stubGlobal('fetch',noNetwork);
  const send=vi.spyOn(transport,'postSecretProviderJson').mockResolvedValue({ok:true,result:{message_id:'synthetic'}});
  const operations=await createRuntimeOperations({DB:h.db,CALENOTE_MASTER_KEY:'A'.repeat(43),AI_MODE:'off',JOBS:{send:vi.fn()}} as unknown as Env,{conversationV2:true});
  expect(await operations.processInbound('memory-address')).toEqual({status:'FOLLOW_THROUGH_HANDLED'});
  expect(send).toHaveBeenCalledTimes(1);expect(send.mock.calls[0][0].body?.text).toContain('Sếp có thể');expect(noNetwork).not.toHaveBeenCalled();
  expect(await h.db.prepare('SELECT count(*) n FROM semantic_budget_windows').first()).toEqual({n:0});
 }finally{h.close()}
});
