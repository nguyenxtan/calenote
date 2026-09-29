import { request, now } from "./resolution-test-support";
import { resolveRequest } from "./resolve";
import { lunarCalendar } from "../lunar-calendar";
import { previewHash } from "./confirmation";
import type { CanonicalPreview, DecisionProof } from "./store";
import type { ControlAuthority } from "./state";
import { turn } from "./context-test-fixtures";
import { renderReminderDetails } from "@/modules/reminders/detail-presentation";
import { projectSemanticView } from "./projection";
export async function confirmationFixture(count = 2) {
  const snapshot = request({ frequency: count === 1 ? "ONCE" : "DAILY", occurrenceCount: count === 1 ? null : count,
    eventRelation: "STARTING_ON", reminderDate: { kind: "CIVIL_DATE", calendar: "GREGORIAN", day: 8, month: 10, year: 2026, leapMonth: null } });
  const resolved = resolveRequest(snapshot, now, lunarCalendar);
  if (resolved.status !== "READY") throw new Error("fixture did not resolve");
  snapshot.slots = resolved.resolvedSlots; snapshot.facts = resolved.resolvedFacts;
  snapshot.lifecycle = "AWAITING_CONFIRMATION";
  const preview: CanonicalPreview = { schemaVersion: "calenote-context-preview-1", title: snapshot.slots.title.value!,
    details: resolved.details, occurrences: resolved.occurrences, prefix: "", suffix: "" };
  const hash = await previewHash(preview);
  const rendered = renderReminderDetails(preview.title, preview.details, preview.occurrences);
  if (rendered.status !== "COMPLETE") throw new Error("preview cannot render");
  snapshot.transcript.push({ ...turn(rendered.text, "preview"), role: "ASSISTANT", kind: "PREVIEW", deliveryState: "SENT", messageRef: "reply" });
  snapshot.previewReceipt = { previewId: "preview", requestId: snapshot.requestId!, draftRevision: 1, draftHash: hash,
    ownerId: snapshot.scope.ownerId, chatIdentityId: snapshot.scope.chatIdentityId, chatId: snapshot.scope.chatId, channel: "TELEGRAM",
    issuedAfterOrder: { receivedAt: snapshot.inbound.receivedAt, rowid: 1 }, expiresAt: snapshot.draftExpiresAt!, deliveryState: "SENT", replyReference: "reply" };
  snapshot.pendingDecision = { decisionId: "decision", kind: "SAVE_PREVIEW", target: { ...snapshot.scope, requestId: snapshot.requestId, proposalId: count > 1 ? "proposal" : null },
    questionId: "question", previewId: "preview", draftRevision: 1, contextRevision: 1, issuedAfterInbound: snapshot.previewReceipt.issuedAfterOrder,
    deliveryState: "SENT", expiresAt: snapshot.draftExpiresAt!, acceptedReplies: ["có","ok","1","xác nhận"], replyReference: "reply", tokenHandle: null, candidate: null };
  // Decision targets intentionally carry only their strict identity fields.
  const target = snapshot.pendingDecision.target;
  snapshot.pendingDecision.target = { ownerId: target.ownerId, chatIdentityId: target.chatIdentityId, chatId: target.chatId, requestId: target.requestId, proposalId: target.proposalId };
  const authority: ControlAuthority = { kind: "CHAT", scope: { ownerId: snapshot.scope.ownerId, chatIdentityId: snapshot.scope.chatIdentityId, sourceInboundId: "confirm", claimMarker: "claim", now: now + 1 } };
  const proof: DecisionProof = { operationKey: "confirm-op", contextId: snapshot.id, contextRevision: 1, decisionId: "decision", kind: "SAVE_PREVIEW",
    requestId: snapshot.requestId, proposalId: snapshot.pendingDecision.target.proposalId, draftRevision: 1, draftHash: hash, response: { kind: "BARE", text: "Có." } };
  return { snapshot, preview, proof, authority };
}
export async function addConfirmationToken(f:Awaited<ReturnType<typeof confirmationFixture>>) {
 const handle="CN-test-token";
 f.preview.suffix="\nXác nhận "+handle;
 f.proof.response={kind:"TOKEN",handle};
 f.proof.draftHash=await previewHash(f.preview);
 f.snapshot.previewReceipt!.draftHash=f.proof.draftHash;
 f.snapshot.pendingDecision!.tokenHandle=handle;
 f.snapshot.controlRegistry=[{handle,kind:"TOKEN",ownerId:f.snapshot.scope.ownerId,chatIdentityId:f.snapshot.scope.chatIdentityId,chatId:f.snapshot.scope.chatId,decisionId:"decision",contextRevision:1,draftRevision:1,expiresAt:f.snapshot.draftExpiresAt!}];
 const rendered=renderReminderDetails(f.preview.title,f.preview.details,f.preview.occurrences);
 if(rendered.status!=="COMPLETE")throw new Error("fixture");
 const text=f.preview.prefix+rendered.text+f.preview.suffix,projected=projectSemanticView(text,[handle]);
 if(projected.status!=="READY")throw new Error("fixture projection");
 const reply=f.snapshot.transcript.at(-1)!;
 Object.assign(reply,{text,semanticView:projected.text,controlSpans:projected.controlSpans,sourceMap:projected.sourceMap});
}
