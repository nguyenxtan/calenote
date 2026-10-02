// @vitest-environment node
import { expect, it } from "vitest";
import * as contracts from "./contracts";

const successor = contracts;
const evidence = [{ kind: "USER_QUOTE", turn: 0, quote: "đổi tên", occurrence: 1 }];
const base = { schemaVersion: "calenote-context-3", intent: "CREATE_REMINDER", requestTarget: { kind: "CURRENT", evidence }, changes: [], query: null, uncertainties: [], conversationDirective: { kind: "ASK_FOR_FIELD", field: "title" }, replyProposal: null };
function schema() { expect(successor.ConversationInterpretationV3Schema).toBeDefined(); return successor.ConversationInterpretationV3Schema; }
it("replace_is_typed_semantic", () => {
  expect(schema().safeParse({ ...base, changes: [{ field: "title", operation: "REPLACE", value: "new", evidence }] }).success).toBe(true);
  expect(schema().safeParse({ ...base, changes: [{ field: "title", operation: "REPLACE", value: "new", evidence: [{ kind: "CONTEXT_FACT", ref: "f1" }] }] }).success).toBe(false);
});
it("isolated_guidance_failure_keeps_core", () => {
  schema();
  const core = Object.fromEntries(Object.entries(base).filter(([key]) => !["conversationDirective", "replyProposal"].includes(key)));
  expect(successor.parseInterpretationSectionsV3(core)).toMatchObject({ status: "PARSED", value: { semantic: core, directive: { status: "INVALID" }, reply: { status: "INVALID" }, fullSchemaValid: false } });
  expect(successor.parseInterpretationSectionsV3({ ...base, conversationDirective: { kind: "PRESENT_PREVIEW" }, replyProposal: { text: "x", unexpected: true } })).toMatchObject({ status: "PARSED", value: { directive: { status: "INVALID" }, reply: { status: "INVALID" } } });
});
it("outer_failure_rejects", () => {
  schema();
  expect(successor.parseInterpretationSectionsV3({ ...base, unexpected: true })).toMatchObject({ status: "REFUSED" });
  expect(successor.parseInterpretationSectionsV3({ ...base, changes: undefined })).toMatchObject({ status: "REFUSED" });
});
it("duplicate_fields_and_strict_capacity_bounds_reject", () => {
  const change = { field: "title", operation: "SET", value: "x", evidence };
  expect(schema().safeParse({ ...base, changes: [change, change] }).success).toBe(false);
  for (const count of [0, 4]) expect(schema().safeParse({ ...base, changes: [{ ...change, evidence: Array(count).fill(evidence[0]) }] }).success).toBe(false);
  expect(schema().safeParse({ ...base, uncertainties: Array(5).fill({ field: "title", reason: "MISSING", alternatives: [] }) }).success).toBe(false);
  expect(schema().safeParse({ ...base, uncertainties: [{ field: "title", reason: "AMBIGUOUS", alternatives: Array(3).fill({ value: "x", evidence }) }] }).success).toBe(false);
});
it("request_target_and_operation_alternatives_are_scoped", () => {
  expect(schema().safeParse({ ...base, requestTarget: null }).success).toBe(false);
  expect(schema().safeParse({ ...base, requestTarget: { kind: "NEW", evidence: [{ kind: "CONTEXT_FACT", ref: "f1" }] } }).success).toBe(false);
  expect(schema().safeParse({ ...base, requestTarget: { kind: "NEW", evidence: [...evidence, { kind: "CONTEXT_FACT", ref: "f1" }] } }).success).toBe(false);
  expect(schema().safeParse({ ...base, intent: "HELP", requestTarget: null }).success).toBe(true);
  expect(schema().safeParse({ ...base, intent: "HELP" }).success).toBe(false);
  expect(schema().safeParse({ ...base, intent: "AMBIGUOUS", requestTarget: { kind: "UNRESOLVED", evidence }, uncertainties: [{ field: "operation", reason: "UNSUPPORTED_COMBINATION", alternatives: [{ value: "CURRENT", evidence }, { value: "NEW", evidence }] }] }).success).toBe(true);
  expect(schema().safeParse({ ...base, uncertainties: [{ field: "operation", reason: "AMBIGUOUS", alternatives: [{ value: "EDIT", evidence }] }] }).success).toBe(false);
  expect(schema().safeParse({ ...base, uncertainties: [{ field: "operation", reason: "AMBIGUOUS", alternatives: [{ value: "UNRESOLVED", evidence }] }] }).success).toBe(false);
});
it("successor_input_uses_typed_operation_ambiguity_and_preserves_input_bounds", () => {
  const input = { schemaVersion: "calenote-context-input-2", reference: { instant: "2026-09-28T03:00:00.000Z", localDate: "2026-09-28", timezone: "Asia/Ho_Chi_Minh" }, turns: [{ role: "USER", text: "synthetic" }], currentTurn: 0, activeRequest: null, facts: [], pendingQuestion: null, ambiguities: [{ field: "operation", reason: "AMBIGUOUS", alternatives: [{ value: "CURRENT", evidence }] }], capabilities: { version: "context-capabilities-1", supported: ["ONCE"], unsupported: ["YEARLY"], calendars: ["GREGORIAN"], limits: { dailyCount: 30, horizonDays: 366 } } };
  expect(contracts.ContextInputV2Schema.safeParse(input).success).toBe(true);
  expect(contracts.ContextInputV2Schema.safeParse({ ...input, ambiguities: [{ field: "operation", reason: "AMBIGUOUS", alternatives: [{ value: "EDIT", evidence }] }] }).success).toBe(false);
  expect(contracts.ContextInputV2Schema.safeParse({ ...input, currentTurn: 1 }).success).toBe(false);
  expect(contracts.ContextInputV2Schema.safeParse({ ...input, turns: [{ role: "ASSISTANT", text: "synthetic" }] }).success).toBe(false);
  expect(contracts.ContextInputSchema.safeParse({ ...input, schemaVersion: "calenote-context-input-1" }).success).toBe(false);
});
