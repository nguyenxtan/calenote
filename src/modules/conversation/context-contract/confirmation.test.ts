import { expect, it } from "vitest";
import { now } from "./resolution-test-support";
import { resolveRequest } from "./resolve";
import { lunarCalendar } from "../lunar-calendar";
import { CanonicalPreviewSchema, validateConfirmation, validDecision, validPreview } from "./confirmation";
import { CanonicalDetailsV1Schema, ContextSnapshotV1Schema } from "./state";
import { CONTEXT_DETAIL_MAX_BYTES } from "./store";
import { confirmationFixture } from "./confirmation-test-support";
it("revision_two_save_still_requires_bound_proof_and_non_save_requires_current_sent_question",async()=>{
 const f=await confirmationFixture();f.snapshot.draftRevision=2;f.snapshot.previewReceipt!.draftRevision=2;f.snapshot.pendingDecision!.draftRevision=2;f.proof.draftRevision=2;
 expect(validDecision(f.snapshot,f.proof,f.authority,now+1)).toBe(false);
 f.snapshot.pendingDecision!.kind="RESUME_PENDING";f.snapshot.pendingDecision!.acceptedReplies=["có","ok","1"];f.proof.kind="RESUME_PENDING";
 expect(validDecision(f.snapshot,f.proof,f.authority,now+1)).toBe(true);
 for(const deliveryState of ["UNCERTAIN","FAILED"] as const)expect(validDecision({...f.snapshot,pendingDecision:{...f.snapshot.pendingDecision!,deliveryState}},f.proof,f.authority,now+1)).toBe(false);
 expect(validDecision(f.snapshot,{...f.proof,decisionId:"old"},f.authority,now+1)).toBe(false);
});
it.each(["future_timestamp","future_rowid","after_save_decision"] as const)("preview_issue_order_rejects_%s",async variant=>{
 const f=await confirmationFixture();
 f.snapshot.previewReceipt!.issuedAfterOrder=variant==="future_rowid"?{receivedAt:f.snapshot.inbound.receivedAt,rowid:2}:{receivedAt:new Date(now+10).toISOString(),rowid:11};
 if(variant==="after_save_decision")f.snapshot.inbound={...f.snapshot.inbound,receivedAt:new Date(now+20).toISOString(),rowid:21};
 expect(ContextSnapshotV1Schema.safeParse(f.snapshot).success).toBe(true);
 expect(validPreview(f.snapshot,f.preview,now+1)).toBe(false);
 expect(await validateConfirmation(f.snapshot,f.preview,f.proof,f.authority,now+1)).toBe(false);
});
it("save_decision_may_be_reissued_after_an_older_preview_but_not_before_it",async()=>{
 const f=await confirmationFixture();
 f.snapshot.inbound={...f.snapshot.inbound,receivedAt:new Date(now+2).toISOString(),rowid:3};
 f.snapshot.pendingDecision!.issuedAfterInbound={receivedAt:f.snapshot.inbound.receivedAt,rowid:3};
 expect(await validateConfirmation(f.snapshot,f.preview,f.proof,f.authority,now+3)).toBe(true);
});
it("exact_current_preview_is_the_only_canonical_candidate", async () => {
  const f = await confirmationFixture();
  expect(ContextSnapshotV1Schema.safeParse(f.snapshot)).toMatchObject({ success: true });
  expect(validDecision(f.snapshot, f.proof, f.authority, now + 1)).toBe(true);
  expect(resolveRequest(f.snapshot, now + 1, lunarCalendar)).toMatchObject({ status: "READY", details: f.preview.details, occurrences: f.preview.occurrences });
  expect(validPreview(f.snapshot, f.preview, now + 1)).toBe(true);
  expect(await validateConfirmation(f.snapshot, f.preview, f.proof, f.authority, now + 1)).toBe(true);
  expect(await validateConfirmation(f.snapshot, { ...f.preview, details: { ...f.preview.details, notes: "changed" } }, f.proof, f.authority, now + 1)).toBe(false);
});
it("non_save_stale_mixed_cross_chat_or_unseen_approval_never_saves", async () => {
  const f = await confirmationFixture();
  for (const proof of [{ ...f.proof, kind: "RESUME_PENDING" as const }, { ...f.proof, contextRevision: 2 }, { ...f.proof, response: { kind: "BARE" as const, text: "Có, nhưng đổi sang 9h" } }])
    expect(await validateConfirmation(f.snapshot, f.preview, proof, f.authority, now + 1)).toBe(false);
  expect(await validateConfirmation({ ...f.snapshot, previewReceipt: { ...f.snapshot.previewReceipt!, deliveryState: "UNCERTAIN" } }, f.preview, f.proof, f.authority, now + 1)).toBe(false);
});
it("expired_past_and_channel_overflow_fail_closed", async () => {
  const f = await confirmationFixture();
  expect(await validateConfirmation(f.snapshot, f.preview, f.proof, f.authority, now + 600000)).toBe(false);
  expect(await validateConfirmation(f.snapshot, { ...f.preview, suffix: "x".repeat(2000) }, f.proof, f.authority, now + 1)).toBe(false);
});
it("selected_complete_sent_preview_is_required_not_a_model_proposed_reply", async () => {
 const f=await confirmationFixture();
 expect(await validateConfirmation({...f.snapshot,transcript:f.snapshot.transcript.filter(t=>t.role!=="ASSISTANT")},f.preview,f.proof,f.authority,now+1)).toBe(false);
 const snapshot=structuredClone(f.snapshot);snapshot.transcript.at(-1)!.text="rejected model prose";
 expect(await validateConfirmation(snapshot,f.preview,f.proof,f.authority,now+1)).toBe(false);
});
it("canonical_title_accepts_above_300_within_the_approved_slot_bound",async()=>{
 const f=await confirmationFixture();
 expect(CanonicalPreviewSchema.safeParse({...f.preview,title:"a".repeat(301)}).success).toBe(true);
 expect(CanonicalPreviewSchema.safeParse({...f.preview,title:"a".repeat(1801)}).success).toBe(false);
});
it("detail_envelope_covers_independent_escaped_schema_maxima",async()=>{
 const f=await confirmationFixture();
 const details=CanonicalDetailsV1Schema.parse({...f.preview.details,location:"\u0000".repeat(300),notes:"\u0000".repeat(2000),resolutionVersion:"\u0000".repeat(512),calendarProvenance:{...f.preview.details.calendarProvenance,provenance:{kind:"DERIVED_POLICY",policyVersion:"\u0000".repeat(512),dependencies:["title","location","notes","eventDate","eventTime","reminderDate","reminderTime","calendar","frequency","occurrenceCount","eventRelation","leadOffsetDays","endDate"],referenceTime:"2026-09-28T03:00:00.000Z"}}});
 const measured=new TextEncoder().encode(JSON.stringify(details)).length;
 expect(measured).toBeGreaterThan(20000);
 expect(measured).toBeLessThanOrEqual(CONTEXT_DETAIL_MAX_BYTES);
});
