import { SqliteD1Database } from "@/testing/sqlite-d1.test-support";
import { createKeyring } from "@/modules/security/keyring";
import { confirmationFixture } from "../../confirmation-test-support";
import { now } from "../../resolution-test-support";
import { D1ContextContractStore } from "./store";
import type { ConversationScope } from "../../../contracts";
export { now };
export async function fixture(database?: D1Database) {
 const sqlite = database ? null : new SqliteD1Database({ contextContract: true });
 const db = database ?? sqlite as unknown as D1Database;
 const keyring = await createKeyring("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
 for (const sql of [
 "INSERT INTO users VALUES('owner','owner@example.test','Test','Asia/Ho_Chi_Minh',1,1)",
 "INSERT INTO workspaces VALUES('workspace','owner','PERSONAL',1,1)",
 "INSERT INTO memberships VALUES('workspace','owner','OWNER',1)",
 "INSERT INTO bot_connections(id,user_id,provider,public_id,provider_bot_id,display_name,encrypted_token,encrypted_token_iv,token_fingerprint,credential_version,state,created_at,updated_at) VALUES('connection','owner','telegram','public','bot','Test',x'01',zeroblob(12),'fingerprint',1,'ACTIVE_BOUND',1,1)",
 "INSERT INTO chat_identities(id,connection_id,provider_user_id,private_chat_id,linked_at) VALUES('identity','connection','provider-user','chat',1)",
 ]) await db.prepare(sql).run();
 await db.prepare("INSERT INTO sessions VALUES('session','owner','digest',?,NULL,1)").bind(now+1000000).run();
 const scope = (i=0): ConversationScope => ({ ownerId:"owner", chatIdentityId:"identity", sourceInboundId: i===0 ? "old" : "in-"+i, claimMarker:i===0 ? "old-claim":"claim", now:now+i });
 for(let i=0;i<10;i++) await db.prepare("INSERT INTO inbound_updates(id,connection_id,provider,provider_message_id,provider_user_id,private_chat_id,message_ciphertext,message_iv,message_key_version,state,received_at,transition_marker) VALUES(?,'connection','telegram',?,'provider-user','chat',x'01',zeroblob(12),1,'PROCESSING',?,?)")
  .bind(scope(i).sourceInboundId,scope(i).sourceInboundId,now+i,scope(i).claimMarker).run();
 const store = new D1ContextContractStore(db,keyring,()=>now+1);
 const f = await confirmationFixture();
 const transition = { expectedContextRevision:null, expectedDraftRevision:null, snapshot:f.snapshot, preview:f.preview, terminal:null, inboundOutcome:"PROCESSED" } as const;
 async function save(count=2) {
  const next = count===2 ? f : await confirmationFixture(count);
  const observed = await store.observe(scope());
  if("failure" in observed) throw new Error(observed.failure);
  const result = await store.apply(scope(),observed.observation,{...transition,snapshot:next.snapshot,preview:next.preview});
  return { ...next, result };
 }
 return { db, sqlite, keyring, store, scope, ...f, transition, save, close:()=>sqlite?.close() };
}
