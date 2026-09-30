import type { ContextSnapshotV1 } from "./state";

export const SAVE_APPROVAL_REPLIES = ["có", "ok", "1", "xác nhận"] as const;

/** Bare SAVE needs positive proof of one stable preview, not merely absence
 * of a retained failed send. Every accepted context revision has an outbound;
 * missing earlier outbounds (including rollover) cannot prove that history. */
export function requiresBoundPreviewConfirmation(snapshot?: ContextSnapshotV1): boolean {
  if (!snapshot || snapshot.draftRevision !== 1) return true;
  const outbounds = snapshot.transcript.filter(t => t.role === "ASSISTANT");
  const previews = outbounds.filter(t => t.kind === "PREVIEW");
  return outbounds.length !== snapshot.contextRevision || previews.length !== 1
    || previews[0].id !== snapshot.previewReceipt?.previewId || previews[0].deliveryState !== "SENT"
    || outbounds.at(-1)?.id !== previews[0].id || snapshot.previewReceipt.deliveryState !== "SENT";
}

/** An explicit UI response can request a new presentation, never a mutation. */
export function isPreviewRecoveryResponse(snapshot: ContextSnapshotV1 | null, text: string): boolean {
  if (!snapshot?.previewReceipt || snapshot.pendingReminderQuestion || snapshot.pendingQueryQuestion
    || (snapshot.pendingDecision && snapshot.pendingDecision.kind !== "SAVE_PREVIEW")) return false;
  const normalized = text.normalize("NFC").trim().toLocaleLowerCase("vi").replace(/[.!]$/u, "");
  return SAVE_APPROVAL_REPLIES.some(reply => reply === normalized) && requiresBoundPreviewConfirmation(snapshot);
}
