import { expect } from "vitest";
import { buildContextInput } from "./context";
import { at, chat, message, observation, withNotes } from "./context-test-fixtures";
import type { ConversationInterpretation, DateOperand, FieldChange } from "./contracts";
import { validateEvidence } from "./evidence";
import type { ContextSnapshotV1 } from "./state";

export const date = (day = 11, month = 10, year: number | null = null): DateOperand => ({ kind: "CIVIL_DATE", calendar: "GREGORIAN", day, month, year, leapMonth: null });
export const time = (hour = 8) => ({ hour, minute: 0, qualifier: "H24" as const });
export const now = Date.parse(at);
export function request(values: Record<string, unknown> = {}): ContextSnapshotV1 {
  const state = withNotes("nhớ mang giấy tờ");
  for (const [field, value] of Object.entries({ title: "đi thi", location: "Quang Trung", eventDate: date(), reminderTime: time(), frequency: "DAILY", occurrenceCount: 2, eventRelation: "BEFORE_EVENT", ...values })) {
    Object.assign(state.slots[field as keyof typeof state.slots], value === null ? { state: "MISSING", value: null, fact: null, evidence: [], provenance: null, resolution: null, proposalRevision: 1 } : { ...state.slots.notes, value, fact: null });
  }
  state.facts = [];
  for (const [field, slot] of Object.entries(state.slots)) if (slot.value !== null) {
    slot.fact = `f${state.facts.length + 1}`;
    state.facts.push({ alias: slot.fact, field, scope: "REMINDER", value: slot.value, evidenceSlot: field, provenance: { kind: "EXPLICIT_USER" }, sourceReferenceTime: at, dependencies: [] } as ContextSnapshotV1["facts"][number]);
  }
  return state;
}
export function patch(state: ContextSnapshotV1 | null, values: Record<string, unknown>, options: { text?: string; act?: ConversationInterpretation["dialogueAct"]; receivedAt?: number; query?: ConversationInterpretation["query"]; uncertainties?: ConversationInterpretation["uncertainties"] } = {}) {
  const text = options.text ?? "đi thi ở Quang Trung nhớ mang giấy tờ 11/10 2026 2027 8h 9h 2 ngày trước";
  const msg = { ...message(text), id: `turn-${(state?.transcript.length ?? 0) + 1}`, receivedAt: options.receivedAt ?? (state ? Date.parse(state.inbound.receivedAt) + 60000 : now) };
  const context = { ...chat, inboundRowId: (state?.inbound.rowid ?? 0) + 1 };
  const built = buildContextInput({ message: msg, context, snapshot: state, observation: observation(state, msg, context) });
  expect(built.status, JSON.stringify(built)).toBe("READY");
  if (built.status !== "READY") throw new Error(built.reason);
  const evidence = [{ kind: "USER_QUOTE" as const, turn: built.input.currentTurn, quote: text, occurrence: 1 }];
  const query = options.query ? { ...options.query, evidence } : null;
  const result = validateEvidence({ schemaVersion: "calenote-context-2", intent: query ? ({ LIST: "LIST_REMINDERS", CALENDAR_DATE: "CALENDAR_QUERY", CAPABILITY: "CAPABILITY_QUERY" } as const)[query.kind] : "CREATE_REMINDER", dialogueAct: options.act ?? (state ? "CONTINUE" : "NEW_REQUEST"), continuation: state ? "YES" : "NO", changes: Object.entries(values).map(([field, value]) => ({ field, operation: value === null ? "CLEAR" : "SET", value, evidence })) as FieldChange[], query, uncertainties: options.uncertainties ?? [], controlEvidence: [] }, built);
  expect(result.status, JSON.stringify(result)).toBe("VALID");
  if (result.status !== "VALID") throw new Error(result.reason);
  return result.patch;
}
