// @vitest-environment node
import { afterEach, expect, it } from "vitest";
import { fixture, now } from "./test-support";
import { D1ConversationStore } from "../../../infrastructure/d1/context-store";
import { D1SeriesStore } from "@/modules/reminders/infrastructure/d1/series-store";
import { D1ReminderCommandStore } from "@/modules/reminders/infrastructure/d1/command-store";
const fixtures: Awaited<ReturnType<typeof fixture>>[]=[];
async function setup(count=2){const f=await fixture();fixtures.push(f);expect((await f.save(count)).result.status).toBe("APPLIED");return f;}
afterEach(()=>{for(const f of fixtures.splice(0))f.close();});
it("old_sql_cannot_confirm_or_create_overlapping_request",async()=>{
 const f=await setup();
 for(const sql of [
  "UPDATE reminder_series_proposals SET status='CONFIRMED' WHERE id='proposal'",
  "UPDATE conversation_contexts SET status='CANCELLED',payload_ciphertext=NULL,payload_iv=NULL,key_version=NULL WHERE id='context'",
  "INSERT INTO command_drafts(id,chat_identity_id,source_inbound_id,title_ciphertext,title_iv,title_key_version,scheduled_at,timezone,status,expires_at,created_at,updated_at) VALUES('old-draft','identity','in-2',x'01',zeroblob(12),1,1900000000000,'Asia/Ho_Chi_Minh','PENDING',1900000000000,1,1)",
  "INSERT INTO reminders(id,public_id,workspace_id,chat_identity_id,title_ciphertext,title_iv,title_key_version,scheduled_at,timezone,status,created_at,updated_at) VALUES('old-reminder','old-public','workspace','identity',x'01',zeroblob(12),1,1900000000000,'Asia/Ho_Chi_Minh','PENDING',1,1)",
  "DELETE FROM conversation_contract_ownership",
 ]) await expect(f.db.prepare(sql).run()).rejects.toThrow("CONTEXT_CONTRACT_FENCE");
 expect(await f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});
it("new_legacy_readers_never_decrypt_successor_payloads_or_expose_old_preview",async()=>{
 const f=await setup();
 expect(await new D1ConversationStore(f.db,f.keyring).load(f.scope(1))).toBeNull();
 const legacy=new D1SeriesStore(f.db,f.keyring);
 expect(await legacy.findPending(f.scope(1))).toBeNull();
 expect(await legacy.listWeb({userId:"owner",sessionId:"session",expiresAt:now+1000000},now+1)).toEqual([]);
 expect(await legacy.confirm(f.scope(1),"proposal",1)).toEqual({status:"STALE"});
});
it("new_legacy_command_reader_excludes_successor_oneoff",async()=>{
 const f=await setup(1);
 expect(await new D1ReminderCommandStore(f.db).findPendingDraft({id:"in-1",connectionId:"connection",providerUserId:"provider-user",privateChatId:"chat",claimMarker:"claim",receivedAt:now+1,text:"có"},"identity")).toBeNull();
});
it("orphaned_permit_cannot_authorize_a_fresh_store_operation",async()=>{
 const f=await setup();
 await f.db.prepare("INSERT INTO conversation_contract_write_permits VALUES('identity','context','orphan','CONFIRM','in-9',NULL)").run();
 await expect(f.db.prepare("UPDATE reminder_series_proposals SET status='CONFIRMED' WHERE id='proposal'").run()).rejects.toThrow("CONTEXT_CONTRACT_FENCE");
 expect(await f.store.confirm({kind:"CHAT",scope:f.scope(1)},f.proof)).toEqual({status:"STALE"});
 expect(await f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});
it("old_inflight_sql_remains_fenced_after_cancellation_releases_ownership",async()=>{
 const f=await setup(); const observed=await f.store.observe(f.scope(2));
 if(!("observation" in observed)||!observed.snapshot)throw new Error("fixture");
 expect(await f.store.apply(f.scope(2),observed.observation,{...f.transition,expectedContextRevision:1,expectedDraftRevision:1,preview:null,terminal:"CANCELLED",
  snapshot:{...observed.snapshot,inbound:{...observed.observation.inbound},contextRevision:2,lifecycle:"CANCELLED",pendingDecision:null,previewReceipt:null}})).toMatchObject({status:"APPLIED"});
 expect(await f.db.prepare("SELECT count(*) n FROM conversation_contract_ownership").first("n")).toBe(0);
 await expect(f.db.prepare("INSERT INTO command_drafts(id,chat_identity_id,source_inbound_id,title_ciphertext,title_iv,title_key_version,scheduled_at,timezone,status,expires_at,created_at,updated_at) VALUES('delayed','identity','in-1',x'01',zeroblob(12),1,1900000000000,'Asia/Ho_Chi_Minh','PENDING',1900000000000,1,1)").run()).rejects.toThrow("CONTEXT_CONTRACT_FENCE");
});
