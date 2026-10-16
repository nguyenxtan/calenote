import type { BoundChatContext, BoundChatMessage } from "@/modules/reminders/command-service";
import { SLOT_NAMES } from "./contracts";
import { ContextSnapshotV1Schema, type ContextObservation, type ContextSnapshotV1, type TranscriptEntry } from "./state";
export const at = "2026-09-28T03:00:00.000Z";
export const scope = { ownerId: "owner", chatIdentityId: "identity", workspaceId: "workspace", connectionId: "connection", chatId: "chat" };
export const chat: BoundChatContext = { chatIdentityId: "identity", userId: "owner", workspaceId: "workspace", timezone: "Asia/Ho_Chi_Minh", inboundRowId: 2 };
export const message = (text = "Đổi sang 9h."): BoundChatMessage => ({ id: "current", text, receivedAt: Date.parse(at) + 60000, connectionId: "connection", providerUserId: "provider-user", privateChatId: "chat", claimMarker: "claim" });
export function turn(text: string, id = "old"): TranscriptEntry {
  const n = [...text].length;
  return { id, text, semanticView: text, role: "USER", kind: "RECEIVED", deliveryState: "RECEIVED", messageRef: id, receivedAt: at, controlSpans: [], sourceMap: { normalizationVersion: "nfc-codepoint-v1", sourceCodePoints: n, viewCodePoints: n, segments: n ? [{ sourceStart: 0, sourceEnd: n, viewStart: 0, viewEnd: n, kind: "UNCHANGED", sourceStride: 1, viewStride: 1 }] : [] } };
}
export function snapshot(): ContextSnapshotV1 {
  return ContextSnapshotV1Schema.parse({ schemaVersion: "calenote-context-state-1", id: "context", scope, inbound: { id: "old", receivedAt: at, rowid: 1, claimMarker: "old-claim" }, requestId: "request", contextRevision: 1, draftRevision: 1, lifecycle: "CLARIFYING", slots: Object.fromEntries(SLOT_NAMES.map(f => [f, { state: "MISSING", value: null, fact: null, evidence: [], provenance: null, resolution: null, proposalRevision: 1 }])), facts: [], pendingReminderQuestion: null, pendingQueryQuestion: null, ambiguities: [], transcript: [turn("nhắc tôi")], pendingDecision: null, previewReceipt: null, controlRegistry: [], modelAttemptBinding: null, lastTerminalOutcome: null, createdAt: at, idleExpiresAt: "2026-09-28T03:30:00.000Z", absoluteExpiresAt: "2026-09-28T05:00:00.000Z", draftCreatedAt: at, draftExpiresAt: "2026-09-28T03:10:00.000Z", capabilityVersion: "capabilities-1" });
}
/** Test-only stand-in for the future authoritative store's opaque read. */
export function observation(state: ContextSnapshotV1 | null, msg = message(), context = chat): ContextObservation {
  return { scope: { ...scope, ownerId: context.userId, chatIdentityId: context.chatIdentityId, workspaceId: context.workspaceId }, inbound: { id: msg.id, receivedAt: new Date(msg.receivedAt).toISOString(), rowid: context.inboundRowId, claimMarker: msg.claimMarker }, observed: state ? { presence: "PRESENT", contextId: state.id, contextRevision: state.contextRevision } : { presence: "ABSENT" }, lastTerminalOutcome: null } as ContextObservation;
}
export function withNotes(text = "mang giấy tờ"): ContextSnapshotV1 {
  const state = snapshot(); state.transcript = [turn(text)];
  state.slots.notes = { state: "RESOLVED", value: text, fact: "f9", evidence: [{ kind: "USER_QUOTE", sourceTurnId: "old", sourceMapTurnId: "old", quote: text, occurrence: 1, sourceSpan: { start: 0, end: [...text].length }, viewSpan: { start: 0, end: [...text].length }, normalizationVersion: "nfc-codepoint-v1" }], provenance: { kind: "EXPLICIT_USER" }, resolution: { method: "EXPLICIT_OPERAND", version: "r1", referenceTime: at, timezone: "Asia/Ho_Chi_Minh", dependencies: [] }, proposalRevision: 1 };
  state.facts = [{ alias: "f9", scope: "REMINDER", field: "notes", value: text, evidenceSlot: "notes", provenance: { kind: "EXPLICIT_USER" }, sourceReferenceTime: at, dependencies: [] }];
  return state;
}
