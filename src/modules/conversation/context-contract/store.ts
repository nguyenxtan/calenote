import type { ConversationScope } from "../contracts";
import type { CanonicalDetailsV1, ContextObservation, ContextSnapshotV1, ControlAuthority, PendingDecision } from "./state";
import type { SeriesOccurrence } from "@/modules/reminders/series";

/** Separate envelope from the 16KiB context. Covers the strict detail schema's
 * escaped Unicode maxima, including both bounded policy/version identifiers. */
export const CONTEXT_DETAIL_MAX_BYTES = 24576;
export const contextContractEncryptionIdentity = (scope:{ownerId:string;chatIdentityId:string}, id:string) => JSON.stringify([scope.ownerId,scope.chatIdentityId,id,"calenote-context-2"]);

export interface CanonicalPreview {
  schemaVersion: "calenote-context-preview-1";
  title: string;
  details: CanonicalDetailsV1;
  occurrences: SeriesOccurrence[];
  /** Exact complete backend preview wording, including its controls. */
  prefix: string;
  suffix: string;
}
export interface DecisionProof {
  operationKey: string;
  contextId: string;
  contextRevision: number;
  decisionId: string;
  kind: PendingDecision["kind"];
  requestId: string | null;
  proposalId: string | null;
  draftRevision: number | null;
  draftHash: string | null;
  response: { kind: "BARE"; text: string } | { kind: "TOKEN"; handle: string } | { kind: "REPLY"; reference: string };
}
export interface StoredTransition {
  expectedContextRevision: number | null;
  expectedDraftRevision: number | null;
  snapshot: ContextSnapshotV1;
  preview: CanonicalPreview | null;
  terminal: "CANCELLED" | "INVALID" | null;
  decisionProof?: DecisionProof;
  inboundOutcome: "PROCESSED" | "REJECTED";
}
export type AppliedTransition = { status: "APPLIED" | "IDEMPOTENT"; contextId: string; contextRevision: number }
  | { status: "STALE" | "INVALID" | "UNCERTAIN" };
export type ConfirmationResult = { status: "COMMITTED" | "IDEMPOTENT"; reminderPublicIds: string[]; seriesPublicId: string | null; childCount: number }
  | { status: "STALE" | "EXPIRED" | "REJECTED" | "UNCERTAIN" };
export interface DeliveryReceipt {
  contextId: string; contextRevision: number; draftRevision: number | null;
  outboundId: string; decisionId: string | null;
  deliveryState: "SENT" | "FAILED" | "UNCERTAIN"; messageRef: string | null;
}
export type ObservedContext = { observation: ContextObservation; snapshot: ContextSnapshotV1 | null }
  | { failure: "INVALID" | "EXPIRED" | "UNAVAILABLE" | "UNAUTHORIZED" | "OTHER_CONTRACT" };
export interface ContextContractStore {
  observe(scope: ConversationScope): Promise<ObservedContext>;
  apply(scope: ConversationScope, observation: ContextObservation, transition: StoredTransition): Promise<AppliedTransition>;
  confirm(authority: ControlAuthority, proof: DecisionProof): Promise<ConfirmationResult>;
  readOutcome(authority: ControlAuthority, operationKey: string): Promise<ConfirmationResult | null>;
  readReminderDetails(authority: ControlAuthority, reminderPublicId: string): Promise<CanonicalDetailsV1 | null>;
  recordDelivery(scope: ConversationScope, receipt: DeliveryReceipt): Promise<"RECORDED" | "STALE">;
  purgeExpired(now: number, limit: number): Promise<number>;
}
