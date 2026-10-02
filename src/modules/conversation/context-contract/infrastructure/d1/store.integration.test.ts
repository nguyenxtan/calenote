// @vitest-environment node
import { afterEach, expect, it } from "vitest";
import { fixture, now } from "./test-support";
import { D1ContextContractStore } from "./store";
import * as stores from "./store";
import { addConfirmationToken } from "../../confirmation-test-support";
import { buildContextInput } from "../../context";
import { chat, message } from "../../context-test-fixtures";
import { persistedD1Blob } from "@/modules/db/persisted-blob";
import type { Keyring } from "@/modules/security/keyring";
import { ContextSnapshotV1Schema, encodeContextSnapshot } from "../../state";
import { ContextSnapshotV2Schema, encodeContextSnapshotV2 } from "../../state";
import { CONTEXT_PROTOCOL_V3 } from "../../protocol";
import { createD1ContextRuntimeStoreV3, D1ContextRuntimeStore } from "../../runtime-store";
import { contextContractEncryptionIdentity } from "../../store";
const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
async function setup(){ const f=await fixture();fixtures.push(f);return f; }
async function preparedSave(){
 const f=await setup();await addConfirmationToken(f);
 f.snapshot.pendingDecision!.deliveryState="UNCERTAIN";f.snapshot.pendingDecision!.replyReference=null;
 f.snapshot.previewReceipt!.deliveryState="UNCERTAIN";f.snapshot.previewReceipt!.replyReference=null;
 const outbound=f.snapshot.transcript.at(-1)!;outbound.deliveryState="UNCERTAIN";outbound.messageRef=null;
 return f;
}
const preparedReceipt={contextId:"context",contextRevision:1,draftRevision:1,outboundId:"preview",decisionId:"decision",deliveryState:"SENT",messageRef:"actual-delivery"} as const;
afterEach(()=>{for(const f of fixtures.splice(0)) f.close();});
it("family2_is_not_protocol_selection", async () => {
 expect(stores).toHaveProperty("createD1ContextContractStoreV3");
 const f=await setup();
 expect(()=>stores.createD1ContextContractStoreV3({db:f.db,keyring:f.keyring,protocol:{...CONTEXT_PROTOCOL_V3,canonicalVersion:"calenote-context-2"} as never})).toThrow("UNSUPPORTED_CONTEXT_PROTOCOL");
 expect(()=>stores.createD1ContextContractStoreV3({db:f.db,keyring:f.keyring,protocol:undefined as never})).toThrow("UNSUPPORTED_CONTEXT_PROTOCOL");
 expect(()=>createD1ContextRuntimeStoreV3({db:f.db,keyring:f.keyring,protocol:undefined as never})).toThrow("UNSUPPORTED_CONTEXT_PROTOCOL");
});
it("v3_legacy_owner_is_other_contract_not_absent",async()=>{
 const f=await setup();expect((await f.save()).result.status).toBe("APPLIED");
 const successor=stores.createD1ContextContractStoreV3({db:f.db,keyring:f.keyring,protocol:CONTEXT_PROTOCOL_V3});
 const before=await f.db.prepare("SELECT revision,expires_at,payload_ciphertext,payload_iv FROM conversation_contexts").first();
 expect(await successor.observe(f.scope(1))).toEqual({failure:"OTHER_CONTRACT"});
 expect(await successor.observe(f.scope(1))).toEqual({failure:"OTHER_CONTRACT"});
 expect(await createD1ContextRuntimeStoreV3({db:f.db,keyring:f.keyring,protocol:CONTEXT_PROTOCOL_V3}).ownsContext(f.scope(1))).toBe(true);
 expect(await f.db.prepare("SELECT revision,expires_at,payload_ciphertext,payload_iv FROM conversation_contexts").first()).toEqual(before);
 const legacy=await f.store.observe(f.scope(1));if("failure"in legacy)throw new Error("fixture");
 expect(await createD1ContextRuntimeStoreV3({db:f.db,keyring:f.keyring,protocol:CONTEXT_PROTOCOL_V3}).claimAttempt(f.scope(1),legacy.observation,"a".repeat(64))).toBe(false);
 expect(await f.db.prepare("SELECT count(*) n FROM audit_events").first("n")).toBe(0);
});
it("cross_protocol_ciphertext_refused",async()=>{
 const f=await setup(),successor=stores.createD1ContextContractStoreV3({db:f.db,keyring:f.keyring,protocol:CONTEXT_PROTOCOL_V3});
 const observed=await successor.observe(f.scope());if("failure"in observed)throw new Error("fixture");
 const snapshot=ContextSnapshotV2Schema.parse({...f.snapshot,schemaVersion:"calenote-context-state-2",pendingSemanticCandidate:null,pendingDecision:null,previewReceipt:null,lifecycle:"CLARIFYING"});
 const transition={...f.transition,snapshot,preview:null};
 expect(await successor.apply(f.scope(),observed.observation,transition)).toMatchObject({status:"APPLIED"});
 expect(await successor.observe(f.scope(1))).toMatchObject({snapshot:{schemaVersion:"calenote-context-state-2"}});
 expect(await f.store.observe(f.scope(1))).toEqual({failure:"OTHER_CONTRACT"});
 const current=await successor.observe(f.scope(1));if("failure"in current)throw new Error("fixture");
 expect(await new D1ContextRuntimeStore(f.db).claimAttempt(f.scope(1),current.observation,"a".repeat(64))).toBe(false);
 const runtime=createD1ContextRuntimeStoreV3({db:f.db,keyring:f.keyring,protocol:CONTEXT_PROTOCOL_V3});
 expect(await runtime.ownsContext(f.scope(1))).toBe(true);
 expect(await runtime.claimAttempt(f.scope(1),current.observation,"a".repeat(64))).toBe(true);
 expect(await runtime.claimAttempt(f.scope(1),current.observation,"b".repeat(64))).toBe(false);
 const wrong=await f.keyring.encryptSensitive("context-contract-state",contextContractEncryptionIdentity(snapshot.scope,snapshot.id),1,encodeContextSnapshotV2(snapshot));
 await f.db.batch([f.db.prepare("INSERT INTO conversation_contract_write_permits VALUES('identity','context','wrong-protocol','APPLY','in-1',NULL)"),f.db.prepare("UPDATE conversation_contexts SET payload_ciphertext=?,payload_iv=?,write_marker='wrong-protocol'").bind(wrong.ciphertext,wrong.iv),f.db.prepare("DELETE FROM conversation_contract_write_permits")]);
 expect(await successor.observe(f.scope(1))).toEqual({failure:"INVALID"});
 expect(await f.store.observe(f.scope(1))).toEqual({failure:"INVALID"});
});
it("successor_invalid_decision_proof_refuses_without_mutation",async()=>{
 const f=await setup(),successor=stores.createD1ContextContractStoreV3({db:f.db,keyring:f.keyring,protocol:CONTEXT_PROTOCOL_V3});
 const observed=await successor.observe(f.scope());if("failure"in observed)throw new Error("fixture");
 const snapshot=ContextSnapshotV2Schema.parse({...f.snapshot,schemaVersion:"calenote-context-state-2",pendingSemanticCandidate:null,pendingDecision:null,previewReceipt:null,lifecycle:"CLARIFYING"});
 await expect(successor.apply(f.scope(),observed.observation,{...f.transition,snapshot:null as never,preview:null})).resolves.toEqual({status:"INVALID"});
 expect(await successor.apply(f.scope(),observed.observation,{...f.transition,snapshot})).toEqual({status:"INVALID"});
 expect(await successor.apply(f.scope(),observed.observation,{...f.transition,snapshot,preview:null,decisionProof:f.proof})).toEqual({status:"INVALID"});
 expect(await successor.confirm({kind:"CHAT",scope:f.scope()},f.proof)).toEqual({status:"STALE"});
 for(const table of ["conversation_contexts","conversation_contract_ownership","conversation_contract_write_permits","conversation_context_outcomes","reminders","audit_events"])expect(await f.db.prepare(`SELECT count(*) n FROM ${table}`).first("n")).toBe(0);
});
it.each(["CHAT","WEB"] as const)("prepared_preview_only_confirms_on_%s_after_exact_sent_receipt",async channel=>{
 const f=await preparedSave();expect((await f.save()).result.status).toBe("APPLIED");
 const chatAuthority={kind:"CHAT",scope:f.scope(1)} as const;
 const webAuthority={kind:"WEB",principal:{userId:"owner",sessionId:"session",expiresAt:now+1000000},chat:f.snapshot.scope} as const;
 expect(await f.store.confirm(chatAuthority,f.proof)).toEqual({status:"REJECTED"});
 expect(await f.store.confirm(webAuthority,f.proof)).toEqual({status:"REJECTED"});
 expect(await f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
 expect(await f.store.recordDelivery(f.scope(),{...preparedReceipt,decisionId:"wrong"})).toBe("STALE");
 expect(await f.store.recordDelivery(f.scope(),{...preparedReceipt,outboundId:"wrong"})).toBe("STALE");
 expect(await f.store.recordDelivery(f.scope(),preparedReceipt)).toBe("RECORDED");
 expect(await f.store.recordDelivery(f.scope(),preparedReceipt)).toBe("RECORDED");
 expect(await f.store.observe(f.scope(1))).toMatchObject({snapshot:{contextRevision:1,draftRevision:1,draftExpiresAt:f.snapshot.draftExpiresAt,pendingDecision:{decisionId:"decision",deliveryState:"SENT"},previewReceipt:{deliveryState:"SENT"}}});
 expect(await f.store.confirm(channel==="CHAT"?chatAuthority:webAuthority,f.proof)).toMatchObject({status:"COMMITTED",childCount:2});
 expect(await f.store.recordDelivery(f.scope(),preparedReceipt)).toBe("STALE");
 expect(await f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(2);
});
it.each(["FAILED","UNCERTAIN"] as const)("prepared_preview_%s_receipt_clears_authority_without_resurrection",async deliveryState=>{
 const f=await preparedSave();expect((await f.save()).result.status).toBe("APPLIED");
 const receipt={...preparedReceipt,deliveryState,messageRef:null};
 expect(await f.store.recordDelivery(f.scope(),receipt)).toBe("RECORDED");
 expect(await f.store.recordDelivery(f.scope(),receipt)).toBe("STALE");
 expect(await f.store.recordDelivery(f.scope(),preparedReceipt)).toBe("STALE");
 expect(await f.store.recordDelivery(f.scope(),{...preparedReceipt,decisionId:null})).toBe(deliveryState==="UNCERTAIN"?"RECORDED":"STALE");
 expect(await f.store.observe(f.scope(1))).toMatchObject({snapshot:{pendingDecision:null,draftExpiresAt:f.snapshot.draftExpiresAt}});
 expect(await f.store.confirm({kind:"CHAT",scope:f.scope(1)},f.proof)).toEqual({status:"REJECTED"});
 expect(await f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});
it("prepared_preview_receipt_after_newer_transition_cannot_restore_decision",async()=>{
 const f=await preparedSave();expect((await f.save()).result.status).toBe("APPLIED");
 const observed=await f.store.observe(f.scope(1));if(!("observation"in observed)||!observed.snapshot)throw new Error("fixture");
 const next={...observed.snapshot,inbound:{...observed.observation.inbound},contextRevision:2,lifecycle:"CLARIFYING",pendingDecision:null,previewReceipt:null} as const;
 expect(await f.store.apply(f.scope(1),observed.observation,{...f.transition,expectedContextRevision:1,expectedDraftRevision:1,snapshot:next,preview:null})).toMatchObject({status:"APPLIED"});
 expect(await f.store.recordDelivery(f.scope(),preparedReceipt)).toBe("STALE");
 expect(await f.store.observe(f.scope(2))).toMatchObject({snapshot:{contextRevision:2,pendingDecision:null}});
 expect(await f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});
it.each(["timestamp","rowid"] as const)("preview_issue_order_%s_rejects_admission_and_corrupt_persisted_metadata",async variant=>{
 const f=await setup();await addConfirmationToken(f);const original=structuredClone(f.snapshot.previewReceipt!);
 const order=variant==="timestamp"?{receivedAt:new Date(now+10).toISOString(),rowid:11}:{receivedAt:f.snapshot.inbound.receivedAt,rowid:2};
 f.snapshot.previewReceipt!.issuedAfterOrder=order;
 expect((await f.save()).result.status).toBe("INVALID");
 expect(await f.db.prepare("SELECT count(*) n FROM conversation_contexts").first("n")).toBe(0);
 f.snapshot.previewReceipt=original;expect((await f.save()).result.status).toBe("APPLIED");
 const invalid=structuredClone(f.snapshot);invalid.previewReceipt!.issuedAfterOrder=order;
 const encrypted=await f.keyring.encryptSensitive("context-contract-state",contextContractEncryptionIdentity(invalid.scope,invalid.id),1,encodeContextSnapshot(invalid));
 await f.db.batch([f.db.prepare("INSERT INTO conversation_contract_write_permits VALUES('identity','context','bad-order','APPLY','in-1',NULL)"),f.db.prepare("UPDATE conversation_contexts SET payload_ciphertext=?,payload_iv=?,write_marker='bad-order'").bind(encrypted.ciphertext,encrypted.iv),f.db.prepare("DELETE FROM conversation_contract_write_permits")]);
 expect(await f.store.observe(f.scope(1))).toEqual({failure:"INVALID"});
 expect(await f.store.confirm({kind:"CHAT",scope:f.scope(1)},f.proof)).toEqual({status:"REJECTED"});
 expect(await f.store.confirm({kind:"WEB",principal:{userId:"owner",sessionId:"session",expiresAt:now+1000000},chat:f.snapshot.scope},f.proof)).toEqual({status:"REJECTED"});
 expect(await f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
 expect(await f.db.prepare("SELECT count(*) n FROM conversation_contract_write_permits").first("n")).toBe(0);
});
it.each(["RESUME_PENDING","REPLACE_PENDING"] as const)("revision_two_%s_bare_approval_applies_without_saving",async kind=>{
 const f=await setup();expect((await f.save()).result.status).toBe("APPLIED");
 const observed=await f.store.observe(f.scope(1));if(!("observation"in observed)||!observed.snapshot)throw new Error("fixture");
 const edited=structuredClone(observed.snapshot);
 edited.inbound={...observed.observation.inbound};edited.contextRevision=2;edited.draftRevision=2;edited.lifecycle="CLARIFYING";edited.previewReceipt=null;
 const source=edited.slots.notes.evidence[0];
 edited.pendingDecision={...edited.pendingDecision!,decisionId:"edited-question",kind,contextRevision:2,draftRevision:2,previewId:null,issuedAfterInbound:{receivedAt:edited.inbound.receivedAt,rowid:edited.inbound.rowid},acceptedReplies:["có","ok","1"],
  target:{...edited.pendingDecision!.target,proposalId:kind==="REPLACE_PENDING"?"candidate":null},
  candidate:kind==="REPLACE_PENDING"?{proposalId:"candidate",proposalRevision:1,createdAt:edited.inbound.receivedAt,expiresAt:edited.draftExpiresAt!,sourceEvidence:[source],evidenceIndex:[{field:"notes",evidence:[source]}],proposal:{schemaVersion:"calenote-context-2",intent:"CREATE_REMINDER",dialogueAct:"NEW_REQUEST",continuation:"NO",changes:[{field:"notes",operation:"SET",value:edited.slots.notes.value!,evidence:[{kind:"USER_QUOTE",turn:0,quote:source.quote,occurrence:1}]}],query:null,uncertainties:[],controlEvidence:[]}}:null};
 expect(ContextSnapshotV1Schema.safeParse(edited).success).toBe(true);
 expect(await f.store.apply(f.scope(1),observed.observation,{...f.transition,expectedContextRevision:1,expectedDraftRevision:1,snapshot:edited,preview:null})).toMatchObject({status:"APPLIED"});
 const current=await f.store.observe(f.scope(2));if(!("observation"in current)||!current.snapshot)throw new Error("fixture");
 const next={...current.snapshot,inbound:{...current.observation.inbound},contextRevision:3,pendingDecision:null,requestId:kind==="REPLACE_PENDING"?"replacement-request":edited.requestId};
 const proof={...f.proof,operationKey:"non-save-approval",contextRevision:2,decisionId:"edited-question",kind,draftRevision:2,proposalId:edited.pendingDecision.target.proposalId,draftHash:null};
 expect(await f.store.apply(f.scope(2),current.observation,{...f.transition,expectedContextRevision:2,expectedDraftRevision:2,snapshot:next,preview:null,decisionProof:proof})).toMatchObject({status:"APPLIED"});
 expect(await f.store.observe(f.scope(3))).toMatchObject({snapshot:{requestId:next.requestId,contextRevision:3,pendingDecision:null,lifecycle:"CLARIFYING"}});
 expect(await f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});
it("transaction_markers_never_outlive_their_atomic_batch",async()=>{
 const f=await setup();expect((await f.save()).result.status).toBe("APPLIED");
 expect(await f.db.prepare("SELECT write_marker FROM conversation_contexts").first("write_marker")).toBeNull();
 expect(await f.db.prepare("SELECT transaction_marker FROM reminder_series_proposals").first("transaction_marker")).toBeNull();
 expect(await f.store.confirm({kind:"CHAT",scope:f.scope(1)},f.proof)).toMatchObject({status:"COMMITTED"});
 expect(await f.db.prepare("SELECT count(*) n FROM reminders WHERE context_write_marker IS NOT NULL").first("n")).toBe(0);
});
it("assistant_projection_still_removes_controls_after_encrypted_roundtrip",async()=>{
 const f=await setup();await addConfirmationToken(f);
 expect((await f.save()).result.status).toBe("APPLIED");
 const observed=await f.store.observe(f.scope(1));if(!("observation"in observed))throw new Error("fixture");
 const built=buildContextInput({message:{...message("9h"),id:"in-1",receivedAt:now+1},context:chat,snapshot:observed.snapshot,observation:observed.observation});
 expect(built.status).toBe("READY");
 if(built.status==="READY")expect(JSON.stringify(built.input)).not.toContain("CN-test-token");
 expect(await f.store.confirm({kind:"WEB",principal:{userId:"owner",sessionId:"session",expiresAt:now+1000000},chat:f.snapshot.scope},f.proof)).toMatchObject({status:"COMMITTED",childCount:2});
});
it("owner_bound_ciphertext_swap_rejected",async()=>{
 const f=await setup();expect((await f.save()).result.status).toBe("APPLIED");
 const encrypted=await f.keyring.encryptSensitive("context-contract-state",JSON.stringify(["other-owner","identity","context","calenote-context-2"]),1,"{}");
 await f.db.batch([f.db.prepare("INSERT INTO conversation_contract_write_permits VALUES('identity','context','tamper','APPLY','in-1',NULL)"),
  f.db.prepare("UPDATE conversation_contexts SET payload_ciphertext=?,payload_iv=?,write_marker='tamper'").bind(encrypted.ciphertext,encrypted.iv),f.db.prepare("DELETE FROM conversation_contract_write_permits")]);
 expect(await f.store.observe(f.scope(1))).toEqual({failure:"INVALID"});
 expect(await f.store.confirm({kind:"CHAT",scope:f.scope(1)},f.proof)).toEqual({status:"REJECTED"});
 expect(await f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});
it("no_draft_cancellation_has_no_receipt_and_no_canonical_write",async()=>{
 const f=await setup(),observed=await f.store.observe(f.scope());if(!("observation"in observed))throw new Error("fixture");
 expect(await f.store.apply(f.scope(),observed.observation,{...f.transition,terminal:"CANCELLED",preview:null,snapshot:{...f.snapshot,lifecycle:"CANCELLED",pendingDecision:null,previewReceipt:null}})).toEqual({status:"INVALID"});
 expect(await f.db.prepare("SELECT count(*) n FROM conversation_context_outcomes").first("n")).toBe(0);
 expect(await f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});
it("rejected_reply_not_history_and_failed_schema_admission_preserves_draft",async()=>{
 const f=await setup();expect((await f.save()).result.status).toBe("APPLIED");
 const observed=await f.store.observe(f.scope(1));if(!("observation"in observed)||!observed.snapshot)throw new Error("fixture");
 const snapshot={...observed.snapshot,inbound:{...observed.observation.inbound},contextRevision:2,pendingDecision:null,rawModelReply:"Rejected prose"};
 expect(await f.store.apply(f.scope(1),observed.observation,{...f.transition,expectedContextRevision:1,expectedDraftRevision:1,snapshot})).toEqual({status:"INVALID"});
 expect(await f.store.observe(f.scope(1))).toMatchObject({snapshot:{contextRevision:1}});
});
it("authority_is_rechecked_after_encryption_before_any_canonical_write",async()=>{
 const f=await setup();expect((await f.save()).result.status).toBe("APPLIED");
 let suspended=false;
 const keys:Keyring={...f.keyring,encryptSensitive:async(...args)=>{if(args[0]==="reminder-title"&&!suspended){suspended=true;await f.db.prepare("UPDATE bot_connections SET state='SUSPENDED'").run();}return f.keyring.encryptSensitive(...args);}};
 expect(await new D1ContextContractStore(f.db,keys).confirm({kind:"CHAT",scope:f.scope(1)},f.proof)).toEqual({status:"STALE"});
 expect(await f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
 expect(await f.db.prepare("SELECT status FROM conversation_contexts").first("status")).toBe("DRAFT_READY");
});
it("revoked_session_and_cross_chat_proofs_are_not_authority",async()=>{
 const f=await setup();await addConfirmationToken(f);expect((await f.save()).result.status).toBe("APPLIED");
 await f.db.prepare("UPDATE sessions SET revoked_at=?").bind(now).run();
 expect(await f.store.confirm({kind:"WEB",principal:{userId:"owner",sessionId:"session",expiresAt:now+1000000},chat:f.snapshot.scope},f.proof)).toEqual({status:"STALE"});
 expect(await f.store.confirm({kind:"CHAT",scope:{...f.scope(1),chatIdentityId:"other"}},f.proof)).toEqual({status:"STALE"});
 expect(await f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});
it("full_title_above_300_roundtrips_through_preview_and_canonical_storage",async()=>{
 const f=await setup(),title="a".repeat(301);
 f.snapshot.slots.title.value=title;for(const fact of f.snapshot.facts)if(fact.field==="title")fact.value=title;
 f.preview.title=title;await addConfirmationToken(f);
 expect((await f.save()).result.status).toBe("APPLIED");
 expect(await f.store.confirm({kind:"CHAT",scope:f.scope(1)},f.proof)).toMatchObject({status:"COMMITTED"});
 const row=await f.db.prepare("SELECT id,title_ciphertext,title_iv FROM reminders LIMIT 1").first<{id:string;title_ciphertext:unknown;title_iv:unknown}>();
 expect(await f.keyring.decryptSensitive("reminder-title",row!.id,1,{ciphertext:persistedD1Blob(row!.title_ciphertext),iv:persistedD1Blob(row!.title_iv)})).toBe(title);
 expect(await f.store.confirm({kind:"CHAT",scope:f.scope(1)},{...f.proof,draftHash:"0".repeat(64)})).toEqual({status:"STALE"});
});
it("canonical_details_read_is_owner_bound_and_absent_legacy_companions_are_null",async()=>{
 const f=await setup();expect((await f.save()).result.status).toBe("APPLIED");
 const authority={kind:"CHAT",scope:f.scope(1)} as const;
 const result=await f.store.confirm(authority,f.proof);if(result.status!=="COMMITTED")throw new Error("fixture");
 expect(await f.store.readReminderDetails(authority,result.reminderPublicIds[0])).toEqual(f.preview.details);
 expect(await f.store.readReminderDetails({kind:"CHAT",scope:{...f.scope(1),ownerId:"other"}},result.reminderPublicIds[0])).toBeNull();
 await f.db.prepare("UPDATE reminder_context_details SET payload_ciphertext=(SELECT payload_ciphertext FROM reminder_context_details ORDER BY reminder_id LIMIT 1),payload_iv=(SELECT payload_iv FROM reminder_context_details ORDER BY reminder_id LIMIT 1)").run();
 const reads=await Promise.allSettled(result.reminderPublicIds.map(id=>f.store.readReminderDetails(authority,id)));
 expect(reads.filter(read=>read.status==="rejected")).toHaveLength(1);
 await f.db.prepare("DELETE FROM reminder_context_details").run();
 expect(await f.store.readReminderDetails(authority,result.reminderPublicIds[0])).toBeNull();
});
it("selected_reply_roundtrips_encrypted",async()=>{
 const f=await setup();
 expect((await f.save()).result.status).toBe("APPLIED");
 const observed=await f.store.observe(f.scope(1));
 expect(observed).toMatchObject({snapshot:{id:"context",slots:{notes:{value:"nhớ mang giấy tờ"}}}});
 if ("snapshot" in observed) expect(observed.snapshot?.transcript.at(-1)).toEqual(f.snapshot.transcript.at(-1));
 expect(JSON.stringify(await f.db.prepare("SELECT * FROM conversation_contexts").first())).not.toContain("giấy tờ");
});
it("reply_receipt_not_mutation_authority_after_inbound_completion_or_newer_edit",async()=>{
 const f=await setup();
 f.snapshot.pendingDecision=null;
 f.snapshot.previewReceipt!.deliveryState="UNCERTAIN";
 const reply=f.snapshot.transcript.at(-1)!; if(reply.role!=="ASSISTANT")throw new Error("fixture"); reply.deliveryState="UNCERTAIN";reply.messageRef=null;
 expect((await f.save()).result.status).toBe("APPLIED");
 const receipt={contextId:"context",contextRevision:1,draftRevision:1,outboundId:"preview",decisionId:null,deliveryState:"SENT",messageRef:"delivered"} as const;
 expect(await f.store.recordDelivery(f.scope(),receipt)).toBe("RECORDED");
 expect(await f.store.recordDelivery(f.scope(),receipt)).toBe("RECORDED");
 const observed=await f.store.observe(f.scope(1));
 expect(observed).toMatchObject({snapshot:{pendingDecision:null,previewReceipt:{deliveryState:"SENT"},draftExpiresAt:f.snapshot.draftExpiresAt}});
 expect(await f.store.confirm({kind:"CHAT",scope:f.scope(1)},f.proof)).toEqual({status:"REJECTED"});
 expect(await f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
 if(!("observation" in observed)||!observed.snapshot)throw new Error("fixture");
 const next={...observed.snapshot,contextRevision:2,inbound:{...observed.observation.inbound},previewReceipt:null,lifecycle:"CLARIFYING",pendingDecision:null} as const;
 expect(await f.store.apply(f.scope(1),observed.observation,{...f.transition,expectedContextRevision:1,expectedDraftRevision:1,snapshot:next,preview:null})).toMatchObject({status:"APPLIED"});
 expect(await f.store.recordDelivery(f.scope(),receipt)).toBe("STALE");
});
it("expiry_purges_payload_releases_ownership_and_retains_terminal_fence",async()=>{
 const f=await setup(); expect((await f.save()).result.status).toBe("APPLIED");
 expect(await f.store.observe({...f.scope(1),now:now+600000})).toEqual({failure:"EXPIRED"});
 expect(await f.store.purgeExpired(now+600000,1)).toBe(1);
 expect(await f.db.prepare("SELECT status,payload_ciphertext FROM conversation_contexts").first()).toEqual({status:"EXPIRED",payload_ciphertext:null});
 expect(await f.db.prepare("SELECT count(*) n FROM conversation_contract_ownership").first("n")).toBe(0);
 expect(await f.db.prepare("SELECT count(*) n FROM conversation_context_outcomes").first("n")).toBe(2);
 expect(await f.store.confirm({kind:"CHAT",scope:{...f.scope(1),now:now+600000}},f.proof)).toEqual({status:"STALE"});
});
it("none_observation_cannot_overwrite_new_state",async()=>{
 const f=await setup(); const old=await f.store.observe(f.scope(1));
 expect("observation" in old).toBe(true); if(!("observation" in old)) return;
 expect((await f.save()).result.status).toBe("APPLIED");
 expect((await f.store.apply(f.scope(1),old.observation,{...f.transition,snapshot:{...f.snapshot,id:"other"}})).status).toBe("STALE");
});
it.each([1,2,30])("all_%i_children_and_details_commit_once",async count=>{
 const f=await setup(); const saved=await f.save(count); expect(saved.result.status).toBe("APPLIED");
 const authority={kind:"CHAT",scope:f.scope(1)} as const;
 expect(await f.store.confirm(authority,saved.proof)).toMatchObject({status:"COMMITTED",childCount:count});
 expect(await f.store.confirm(authority,saved.proof)).toMatchObject({status:"IDEMPOTENT",childCount:count});
 expect(await f.db.prepare("SELECT count(*) n FROM reminder_context_details").first("n")).toBe(count);
 expect(await f.db.prepare("SELECT count(*) n FROM conversation_contract_write_permits").first("n")).toBe(0);
});
it("details_and_all_children_rollback_together",async()=>{
 const f=await setup(); expect((await f.save()).result.status).toBe("APPLIED");
 f.sqlite!.sqlite.exec("CREATE TRIGGER fail_detail BEFORE INSERT ON reminder_context_details BEGIN SELECT RAISE(ABORT,'injected final detail failure'); END");
 expect(await f.store.confirm({kind:"CHAT",scope:f.scope(1)},f.proof)).toEqual({status:"UNCERTAIN"});
 expect(await f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
 expect(await f.db.prepare("SELECT count(*) n FROM reminder_series").first("n")).toBe(0);
 expect(await f.db.prepare("SELECT status FROM conversation_contexts").first("status")).toBe("DRAFT_READY");
 expect(await f.db.prepare("SELECT count(*) n FROM conversation_contract_write_permits").first("n")).toBe(0);
});
it("uncertain_commit_readback_is_truthful",async()=>{
 const f=await setup(); expect((await f.save()).result.status).toBe("APPLIED");
 const lost=new Proxy(f.db,{get(target,key){if(key==="batch")return async(statements:D1PreparedStatement[])=>{await target.batch(statements);throw new Error("lost response");};const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;}});
 const store=new D1ContextContractStore(lost,f.keyring,()=>now+1);
 expect(await store.confirm({kind:"CHAT",scope:f.scope(1)},f.proof)).toMatchObject({status:"IDEMPOTENT",childCount:2});
 expect(await f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(2);
});
it("same_key_different_proof_racing_winner_is_not_an_idempotent_receipt",async()=>{
 const f=await setup();expect((await f.save()).result.status).toBe("APPLIED");
 const authority={kind:"CHAT",scope:f.scope(1)} as const;
 const raced=new Proxy(f.db,{get(target,key){if(key==="batch")return async(statements:D1PreparedStatement[])=>{
  expect(await f.store.confirm(authority,{...f.proof,response:{kind:"BARE",text:"có"}})).toMatchObject({status:"COMMITTED"});
  return target.batch(statements);
 };const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;}});
 expect(await new D1ContextContractStore(raced,f.keyring,()=>now+1).confirm(authority,f.proof)).toEqual({status:"STALE"});
 expect(await f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(2);
});
