import type { ControlAuthority, PendingDecision } from "./state";
import type { DecisionProof } from "./store";
import { requiresBoundPreviewConfirmation } from "./preview-control";

export type ControlSelection = { kind: "NONE" } | { kind: "AMBIGUOUS_TARGET" }
  | { kind: "ABANDON"; requestId: string | null; proposalId: string | null }
  | { kind: "DECLINE"; decisionId: string }
  | { kind: "APPROVE"; decisionId: string; decisionKind: PendingDecision["kind"]; response: DecisionProof["response"] };
export interface ControlContext {
  /** Needed for a draft without a current decision, and for channel replies. */
  snapshot?: import("./state").ContextSnapshotV1 | import("./state").ContextSnapshotV2;
  replyReference?: string | null;
  now?: number;
}
const normalize = (text: string) => text.normalize("NFC").trim().toLocaleLowerCase("vi").replace(/[.!]$/u, "");
/** Exact UI vocabulary only. No prefix or general-language interpretation.
 * This selection is not authority: transition/store recheck the full proof. */
export function selectControl(text: string, decision: PendingDecision | import("./state").ContextSnapshotV2["pendingDecision"], authority: ControlAuthority, context: ControlContext = {}): ControlSelection {
  const none: ControlSelection = { kind: "NONE" };
  if (!text.isWellFormed() || authority.kind !== "CHAT") return none;
  const now = context.now ?? authority.scope.now;
  const target = decision?.target ?? context.snapshot?.scope;
  if (!target || target.ownerId !== authority.scope.ownerId || target.chatIdentityId !== authority.scope.chatIdentityId) return none;
  const normalized = normalize(text);
  const requestId = decision?.target.requestId ?? context.snapshot?.requestId ?? null;
  const proposalId = decision?.candidate?.proposalId ?? (decision && ["REPLACE_PENDING", "ACCEPT_ONE_TIME_ALTERNATIVE"].includes(decision.kind) ? decision.target.proposalId : null)
    ?? (context.snapshot?.schemaVersion === "calenote-context-state-2" ? context.snapshot.pendingSemanticCandidate?.proposalId ?? null : null);
  if (["bỏ", "hủy", "huỷ"].includes(normalized)) {
    if (requestId && proposalId) return { kind: "AMBIGUOUS_TARGET" };
    return requestId || proposalId ? { kind: "ABANDON", requestId, proposalId } : none;
  }
  if (!decision || Date.parse(decision.expiresAt) <= now) return none;
  if (context.replyReference && context.replyReference !== decision.replyReference) return none;
  if (["không", "2"].includes(normalized)) return { kind: "DECLINE", decisionId: decision.decisionId };
  if (decision.deliveryState !== "SENT") return none;
  let response: DecisionProof["response"] | null = null;
  const prefix = decision.kind === "SAVE_PREVIEW" ? "xác nhận" : "đồng ý";
  if (decision.tokenHandle && normalized === normalize(`${prefix} ${decision.tokenHandle}`)) response = { kind: "TOKEN", handle: decision.tokenHandle };
  else if (decision.acceptedReplies.some(reply => reply === normalized)) {
    if (context.replyReference && context.replyReference === decision.replyReference) response = { kind: "REPLY", reference: context.replyReference };
    else if (decision.kind !== "SAVE_PREVIEW" || !requiresBoundPreviewConfirmation(context.snapshot)) response = { kind: "BARE", text };
  }
  return response ? { kind: "APPROVE", decisionId: decision.decisionId, decisionKind: decision.kind, response } : none;
}
