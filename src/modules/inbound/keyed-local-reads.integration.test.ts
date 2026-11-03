// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {fixture} from '@/modules/conversation/context-contract/infrastructure/d1/test-support';
import {createRuntimeOperations} from '@/worker/composition-root';
import * as transport from '@/modules/connections/providers/secret-provider-transport';
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
it.each([
 ['Hôm nay là ngày mấy âm lịch?','âm lịch Việt Nam'],
 ['Tháng này có lịch gì?','cuộc trò chuyện này'],
 ['Cú pháp như nào?','nhắc'],
])('keeps the exact local read %s free of model calls after keyed activation',async(text,expected)=>{
 const h=await fixture();try{
  await h.db.prepare('DELETE FROM inbound_updates').run();
  const credential=await h.keyring.encryptCredential('connection','telegram',1,'123456789:AAExample_secret-token_123456789');
  await h.db.prepare("UPDATE bot_connections SET encrypted_token=?,encrypted_token_iv=? WHERE id='connection'").bind(credential.ciphertext,credential.iv).run();
  const payload=await h.keyring.encryptSensitive('inbound-message','local-read',1,text),at=Date.now();
  await h.db.prepare("INSERT INTO inbound_updates(id,connection_id,provider,provider_message_id,provider_user_id,private_chat_id,message_ciphertext,message_iv,message_key_version,state,received_at) VALUES('local-read','connection','telegram','local-read','provider-user','chat',?,?,1,'PENDING',?)").bind(payload.ciphertext,payload.iv,at).run();
  let network=0;vi.stubGlobal('fetch',async()=>{network++;throw Error('Network forbidden');});
  const send=vi.spyOn(transport,'postSecretProviderJson').mockResolvedValue({ok:true,result:{message_id:'synthetic'}});
  const env={DB:h.db,CALENOTE_MASTER_KEY:'A'.repeat(43),AI_MODE:'privacy',OPENROUTER_API_KEY:'synthetic-key',OPENROUTER_PRIVACY_MODEL:'openai/gpt-5-mini',OPENROUTER_PRIVACY_PROVIDER:'azure/swedencentral',AI_MAX_PRIVACY_PRICE:'2.2',AI_TIMEOUT_MS:'45000',AI_MAX_OUTPUT_TOKENS:'3072',JOBS:{send:async()=>{}}} as unknown as Env;
  await(await createRuntimeOperations(env,{conversationV2:true,contextContract:'calenote-context-2',sourceSha:'a'.repeat(40)})).processInbound('local-read');
  expect(network).toBe(0);expect(send.mock.calls.at(-1)?.[0].body?.text).toContain(expected);
  expect(await h.db.prepare('SELECT count(*) n FROM semantic_budget_windows').first('n')).toBe(0);
  expect(await h.db.prepare('SELECT count(*) n FROM conversation_contexts').first('n')).toBe(0);
 }finally{h.close();}
});
