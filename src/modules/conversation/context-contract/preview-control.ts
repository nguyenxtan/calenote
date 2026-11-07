import type { ContextSnapshotV1, ContextSnapshotV2 } from "./state";

export const SAVE_APPROVAL_REPLIES = ["có", "ok", "1", "xác nhận"] as const;

/** Reserved legacy UI vocabulary, not a general-language action classifier. */
export function isAddressedPreviewControl(text: string): boolean {
  return /^(?:xác nhận|đồng ý) cn-[a-f0-9]{20}$/u.test(text.normalize("NFC").trim().toLocaleLowerCase("vi").replace(/[.!]$/u, ""));
}

/** Current SAVE needs the latest delivered preview. Historical snapshots
 * without delivery timestamps retain their stricter addressed-proof policy. */
export function requiresBoundPreviewConfirmation(snapshot?: ContextSnapshotV1 | ContextSnapshotV2): boolean {
  // Current receipts can prove visibility directly. A draft completed over
  // several turns, an edit, or an earlier failed send does not invalidate a
  // later successfully delivered current preview. The immutable inbound
  // timestamp is checked separately before both proof creation and commit.
  if (snapshot?.schemaVersion === "calenote-context-state-2") {
    const receipt = snapshot.previewReceipt, decision = snapshot.pendingDecision;
    const latest = snapshot.transcript.filter(t => t.role === "ASSISTANT").at(-1);
    return snapshot.lifecycle !== "AWAITING_CONFIRMATION" || !receipt || !decision
      || decision.kind !== "SAVE_PREVIEW" || !decision.deliveredAt
      || decision.deliveryState !== "SENT" || receipt.deliveryState !== "SENT"
      || decision.previewId !== receipt.previewId || latest?.id !== receipt.previewId
      || latest.kind !== "PREVIEW" || latest.deliveryState !== "SENT"
      || decision.draftRevision !== snapshot.draftRevision || receipt.draftRevision !== snapshot.draftRevision;
  }
  if (!snapshot || snapshot.draftRevision !== 1) return true;
  const outbounds = snapshot.transcript.filter(t => t.role === "ASSISTANT");
  const previews = outbounds.filter(t => t.kind === "PREVIEW");
  return outbounds.length !== snapshot.contextRevision || previews.length !== 1
    || previews[0].id !== snapshot.previewReceipt?.previewId || previews[0].deliveryState !== "SENT"
    || outbounds.at(-1)?.id !== previews[0].id || snapshot.previewReceipt.deliveryState !== "SENT";
}

/** An explicit UI response can request a new presentation, never a mutation. */
export function isPreviewRecoveryResponse(snapshot: ContextSnapshotV1 | ContextSnapshotV2 | null, text: string): boolean {
  if (!snapshot?.previewReceipt || snapshot.pendingReminderQuestion || snapshot.pendingQueryQuestion
    || (snapshot.pendingDecision && snapshot.pendingDecision.kind !== "SAVE_PREVIEW")) return false;
  const normalized = text.normalize("NFC").trim().toLocaleLowerCase("vi").replace(/[.!]$/u, "");
  return SAVE_APPROVAL_REPLIES.some(reply => reply === normalized) && requiresBoundPreviewConfirmation(snapshot);
}
