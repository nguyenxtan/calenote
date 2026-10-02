import type { ConversationScope } from "../contracts";
import type { CanonicalDetailsV1, ContextObservation, ContextSnapshotV1, ControlAuthority, PendingDecision } from "./state";
import type { SeriesOccurrence } from "@/modules/reminders/series";
import type { ContextSnapshotV2 } from "./state";
import { isContextProtocolV3, type ContextProtocolV3 } from "./protocol";

/** Separate envelope from the 16KiB context. Covers the strict detail schema's
 * escaped Unicode maxima, including both bounded policy/version identifiers. */
export const CONTEXT_DETAIL_MAX_BYTES = 24576;
export const contextContractEncryptionIdentity = (scope:{ownerId:string;chatIdentityId:string}, id:string, protocol?: ContextProtocolV3) => {
  if (protocol !== undefined && !isContextProtocolV3(protocol)) throw new Error("UNSUPPORTED_CONTEXT_PROTOCOL");
  return JSON.stringify([scope.ownerId,scope.chatIdentityId,id,protocol?.canonicalVersion ?? "calenote-context-2"]);
};
export type StoredTransitionV2 = Omit<StoredTransition, "snapshot"> & { snapshot: ContextSnapshotV2 };
export type ObservedContextV2 = { observation: ContextObservation; snapshot: ContextSnapshotV2 | null } | Extract<ObservedContext, { failure: string }>;
export interface ContextContractStoreV3 {
  readonly protocol: Readonly<ContextProtocolV3>;
  observe(scope: ConversationScope): Promise<ObservedContextV2>;
  apply(scope: ConversationScope, observation: ContextObservation, transition: StoredTransitionV2): Promise<AppliedTransition | { status: "NOT_READY"; reason: "SUCCESSOR_DECISIONS_NOT_INTEGRATED" }>;
  confirm(authority: ControlAuthority, proof: DecisionProof): Promise<{ status: "NOT_READY"; reason: "SUCCESSOR_DECISIONS_NOT_INTEGRATED" }>;
}

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
