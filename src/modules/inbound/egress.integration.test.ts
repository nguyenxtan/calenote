// @vitest-environment node
import { expect,it,vi } from "vitest";
import { harness,proposal,complete,completeText } from "@/modules/conversation/context-contract/service-test-support";
import { D1ConnectionLifecycleStore } from "@/modules/connections/lifecycle";
import { D1InboundProcessorStore,processInbound,type ProcessInboundDependencies } from "./processor";
async function setup(provider:'telegram'|'zalo',text:string){
 const h=await harness([proposal(complete)]);const {db,keyring}=h.f;const now=h.deps.now();
 const credential=await keyring.encryptCredential('connection',provider,1,'synthetic-token');
 await db.prepare("UPDATE bot_connections SET provider=?,encrypted_token=?,encrypted_token_iv=? WHERE id='connection'").bind(provider,credential.ciphertext,credential.iv).run();
 const encrypted=await keyring.encryptSensitive('inbound-message','old',1,text);
 await db.prepare("UPDATE inbound_updates SET provider=?,state='PENDING',transition_marker=NULL,message_ciphertext=?,message_iv=? WHERE id='old'").bind(provider,encrypted.ciphertext,encrypted.iv).run();
 // Remove unrelated future fixture turns so this inbound owns conversation order.
 await db.prepare("DELETE FROM inbound_updates WHERE id<>'old'").run();
 await db.prepare(`INSERT INTO bot_connections(id,user_id,provider,public_id,provider_bot_id,display_name,encrypted_token,encrypted_token_iv,token_fingerprint,credential_version,state,created_at,updated_at)
 SELECT 'alternate',user_id,'telegram','alternate-public','alternate-provider','Alternate',encrypted_token,encrypted_token_iv,'alternate-fingerprint',1,'ACTIVE_BOUND',created_at,updated_at FROM bot_connections WHERE id='connection'`).run();
 await db.prepare("INSERT INTO chat_identities VALUES ('alternate-chat','alternate','alternate-user','alternate-private',NULL,1)").run();
 const lifecycle=new D1ConnectionLifecycleStore(db);
 const sendText=vi.fn(async()=>({providerMessageId:'receipt'}));
 const deps:ProcessInboundDependencies={store:new D1InboundProcessorStore(db),keyring,contextContract:h.deps,connectionEgress:lifecycle,sendText,now:()=>now};
 return {h,db,lifecycle,sendText,deps,now};
}
it.each(['timeout','invalid','success','decrypt-failed'] as const)('receipt adapter retains ambiguity and safely releases settled/pre-dispatch outcomes: %s',async outcome=>{
 const {db,lifecycle,sendText,deps,now}=await setup('telegram','chào');
 if(outcome==='timeout')sendText.mockRejectedValue(new Error('timeout'));
 if(outcome==='invalid')sendText.mockResolvedValue({providerMessageId:123} as never);
 if(outcome==='decrypt-failed')vi.spyOn(deps.keyring,'decryptCredential').mockRejectedValue(new Error('decrypt failed'));
 await processInbound('old',deps);
 expect(sendText).toHaveBeenCalledTimes(outcome==='decrypt-failed'?0:1);
 expect((await db.prepare("SELECT state FROM inbound_updates WHERE id='old'").first('state'))).toBe('PROCESSED');
 expect(await db.prepare('SELECT COUNT(*) AS n FROM connection_egress').first('n')).toBe(['success','decrypt-failed'].includes(outcome)?0:1);
 expect(await lifecycle.disconnect('owner','public',now+1,'disconnect')).toBe(['success','decrypt-failed'].includes(outcome));
});
it.each(['throw','success','decrypt-failed'] as const)('typing dispatch retains uncertainty but releases safe outcomes: %s',async outcome=>{
 const {db,lifecycle,deps,now}=await setup('zalo',completeText);const tasks:Promise<unknown>[]=[];
 const typing=vi.fn(async()=>{if(outcome==='throw')throw new Error('typing request uncertain');});
 deps.feedbackLifetime={waitUntil:task=>{tasks.push(task);}};deps.sendProcessingFeedback=typing;
 if(outcome==='decrypt-failed')vi.spyOn(deps.keyring,'decryptCredential').mockRejectedValue(new Error('decrypt failed'));
 await processInbound('old',deps);await Promise.all(tasks);
 if(outcome==='decrypt-failed')expect(typing).not.toHaveBeenCalled();else expect(typing).toHaveBeenCalledOnce();
 expect(await db.prepare('SELECT COUNT(*) AS n FROM connection_egress').first('n')).toBe(outcome==='throw'?1:0);
 expect(await lifecycle.disconnect('owner','public',now+1,'disconnect')).toBe(outcome!=='throw');
});
