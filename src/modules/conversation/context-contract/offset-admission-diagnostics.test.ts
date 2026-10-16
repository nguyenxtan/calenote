import { expect, it } from "vitest";
import { buildContextInputV2, buildLegacyV2ContextInput } from "./context";
import { chat, message, observation, withNotes } from "./context-test-fixtures";
import { SemanticPatchProposalV3Schema } from "./contracts";
import { validateEvidenceV3, validateLegacyV2Evidence } from "./evidence";
import { ContextSnapshotV2Schema } from "./state";
import { type DownstreamDiagnostic, DownstreamTraceSchema, OffsetBindingDiagnosticSchema } from "./downstream";
import { harness, proposal } from "./service-test-support";
import { date } from "./resolution-test-support";

function run(kind: "QUOTE" | "COUNT_FACT" | "OFFSET_FACT" | "MIXED" | "MIXED_MISSING" | "UNKNOWN_FACT" | "ALTERNATIVE" | "OLD_QUOTE" | "MISSING_QUOTE", text = "Nhắc trước 2 ngày.", legacy = false, throwObserver = false) {
  const hasOffset = ["OFFSET_FACT", "MIXED", "MIXED_MISSING"].includes(kind);
  const state = withNotes(hasOffset ? "Nhắc trước 2 ngày." : "Nhắc 2 ngày liên tiếp.");
  const field = hasOffset ? "leadOffsetDays" : "occurrenceCount";
  Object.assign(state.slots[field], { ...state.slots.notes, value: 2 });
  state.slots.notes = { ...state.slots.notes, state: "MISSING", value: null, fact: null, evidence: [], provenance: null, resolution: null };
  const factBase = { alias: "f9", scope: "REMINDER" as const, provenance: { kind: "EXPLICIT_USER" as const }, sourceReferenceTime: state.createdAt, dependencies: [] };
  state.facts = [field === "leadOffsetDays"
    ? { ...factBase, field: "leadOffsetDays", value: 2, evidenceSlot: "leadOffsetDays" }
    : { ...factBase, field: "occurrenceCount", value: 2, evidenceSlot: "occurrenceCount" }];
  const msg = message(text), built = legacy
    ? buildLegacyV2ContextInput({ message: msg, context: chat, snapshot: state, observation: observation(state, msg) })
    : buildContextInputV2({ message: msg, context: chat, snapshot: ContextSnapshotV2Schema.parse({ ...state, schemaVersion: "calenote-context-state-2", pendingSemanticCandidate: null }), observation: observation(state, msg) });
  if (built.status !== "READY") throw new Error(built.reason);
  const quote = { kind: "USER_QUOTE", turn: built.input.currentTurn, quote: text, occurrence: 1 };
  const fact = { kind: "CONTEXT_FACT", ref: built.input.facts[0].alias };
  const evidence = kind === "MIXED_MISSING" ? [fact, { ...quote, quote: "SENSITIVE_NOT_FOUND" }]
    : kind === "UNKNOWN_FACT" ? [{ ...fact, ref: "f999" }]
    : kind === "OLD_QUOTE" ? [{ ...quote, turn: 0, quote: "Nhắc 2 ngày liên tiếp." }]
    : kind === "MISSING_QUOTE" ? [{ ...quote, quote: "SENSITIVE_NOT_FOUND" }]
    : kind === "QUOTE" || kind === "ALTERNATIVE" ? [quote] : kind === "MIXED" ? [fact, quote] : [fact];
  const changes = kind === "ALTERNATIVE" ? [] : [{ field: "leadOffsetDays", operation: "SET", value: 2, evidence }];
  const uncertainties = kind === "ALTERNATIVE" ? [{ field: "leadOffsetDays", reason: "AMBIGUOUS", alternatives: [{ value: 2, evidence }] }] : [];
  const events: DownstreamDiagnostic[] = [];
  const observe = (e: DownstreamDiagnostic) => { events.push(e); if (throwObserver) throw new Error("SENSITIVE_OBSERVER_ERROR"); };
  const semantic = { schemaVersion: "calenote-context-3", intent: "CREATE_REMINDER", requestTarget: { kind: "CURRENT", evidence: [quote] }, changes, query: null, uncertainties };
  const result = legacy
    ? validateLegacyV2Evidence({ schemaVersion: "calenote-context-2", intent: "CREATE_REMINDER", changes, query: null, uncertainties, dialogueAct: "CONTINUE", continuation: "YES", controlEvidence: [] }, built as Parameters<typeof validateLegacyV2Evidence>[1], observe)
    : validateEvidenceV3(SemanticPatchProposalV3Schema.parse(semantic), built as Parameters<typeof validateEvidenceV3>[1], observe);
  return { result, events, text };
}

it.each([false, true])("quote diagnostics report exact offset check, not just source validity; legacy=%s", legacy => {
  const { result, events } = run("QUOTE", "Nhắc trước 2 ngày.", legacy);
  expect(result.status).toBe("VALID");
  expect(events).toContainEqual(expect.objectContaining({ stage: "EVIDENCE_BINDING", offsetBinding: expect.objectContaining({ field: "leadOffsetDays", valueType: "number", numericValue: 2, evidenceKinds: ["USER_QUOTE"], sourceTurnOrdinals: [1], validatorBranch: legacy ? "LEGACY_V2_RESOLVER" : "V3_RESOLVER", bindingBranch: "USER_QUOTE", fieldValueCheckExecuted: true, fieldValueCheckResult: "PASS" }) }));
});
it.each(["Nhắc 2 ngày liên tiếp.", "mang 2 cây bút"])("unsupported quotes retain FAIL diagnostics without raw content: %s", text => {
  const { result, events } = run("QUOTE", text);
  expect(result).toEqual({ status: "REFUSED", reason: "LEAD_OFFSET_NOT_SUPPORTED" });
  expect(events).toContainEqual(expect.objectContaining({ stage: "EVIDENCE_BINDING", offsetBinding: expect.objectContaining({ fieldValueCheckExecuted: true, fieldValueCheckResult: "FAIL" }) }));
  expect(JSON.stringify(events)).not.toContain(text);
});
it.each([false, true])("count context fact cannot bind offset; legacy=%s", legacy => {
  const { result, events } = run("COUNT_FACT", "Nhắc trước 2 ngày.", legacy);
  expect(result).toEqual({ status: "REFUSED", reason: "EVIDENCE_FACT_SCOPE_OR_VALUE" });
  expect(events).toContainEqual(expect.objectContaining({ stage: "EVIDENCE_BINDING", offsetBinding: expect.objectContaining({ evidenceKinds: ["CONTEXT_FACT"], bindingBranch: "CONTEXT_FACT", fieldValueCheckExecuted: null, fieldValueCheckResult: "UNKNOWN" }) }));
});
it.each(["OFFSET_FACT", "MIXED"] as const)("exact inherited offset binding is visible without fresh numeric support: %s", kind => {
  const { result, events } = run(kind, "Giữ như cũ.");
  expect(result.status).toBe("VALID");
  expect(events).toContainEqual(expect.objectContaining({ stage: "EVIDENCE_BINDING", offsetBinding: expect.objectContaining({ bindingBranch: kind === "MIXED" ? "MIXED" : "CONTEXT_FACT", fieldValueCheckExecuted: true, fieldValueCheckResult: "PASS" }) }));
  expect(JSON.stringify(events)).not.toContain("Giữ như cũ.");
});
it("uncertainty alternatives use the same verifier and retain their path", () => {
  const { result, events } = run("ALTERNATIVE", "mang 2 cây bút");
  expect(result.status).toBe("REFUSED");
  expect(events).toContainEqual(expect.objectContaining({ stage: "EVIDENCE_BINDING", offsetBinding: expect.objectContaining({ path: ["uncertainties", 0, "alternatives", 0, "evidence"], fieldValueCheckResult: "FAIL" }) }));
});
it("observer failures cannot change offset admission and diagnostics contain no content", () => {
  const { result, events } = run("QUOTE", "SENSITIVE_USER_TEXT; Nhắc trước 2 ngày.", false, true);
  expect(result.status).toBe("VALID");
  expect(DownstreamTraceSchema.safeParse(events).success).toBe(true);
  expect(events.some(e => e.stage === ("EVIDENCE_BINDING" as string))).toBe(true);
  expect(JSON.stringify(events)).not.toContain("SENSITIVE_USER_TEXT");
});
it("historical count quote cannot supply missing canonical offset", () => {
  expect(run("OLD_QUOTE").result).toEqual({ status: "REFUSED", reason: "LEAD_OFFSET_NOT_SUPPORTED" });
});
it("failed source check is not falsely reported as running the value guard", () => {
  const { result, events } = run("MISSING_QUOTE");
  expect(result).toEqual({ status: "REFUSED", reason: "EVIDENCE_QUOTE_NOT_FOUND" });
  expect(events).toContainEqual(expect.objectContaining({ offsetBinding: expect.objectContaining({ sourceIdentityValidated: false, fieldValueCheckExecuted: false, fieldValueCheckResult: "NOT_RUN" }) }));
  expect(JSON.stringify(events)).not.toContain("SENSITIVE_NOT_FOUND");
});
it.each([false, true])("mixed failure never claims value check did not run; legacy=%s", legacy => {
  const { result, events } = run("MIXED_MISSING", "Giữ như cũ.", legacy);
  expect(result).toEqual({ status: "REFUSED", reason: "EVIDENCE_QUOTE_NOT_FOUND" });
  expect(events).toContainEqual(expect.objectContaining({ offsetBinding: expect.objectContaining({ bindingBranch: "MIXED", fieldValueCheckExecuted: null, fieldValueCheckResult: "UNKNOWN" }) }));
});
it("unknown fact alias never claims the value comparison ran", () => {
  const { result, events } = run("UNKNOWN_FACT");
  expect(result).toEqual({ status: "REFUSED", reason: "EVIDENCE_FACT_SCOPE_OR_VALUE" });
  expect(events).toContainEqual(expect.objectContaining({ offsetBinding: expect.objectContaining({ fieldValueCheckExecuted: null, fieldValueCheckResult: "UNKNOWN" }) }));
});
it("closed diagnostic schema rejects arbitrary text, extra content and unbounded control values", () => {
  const good = run("QUOTE").events.find(e => e.offsetBinding)!.offsetBinding!;
  expect(OffsetBindingDiagnosticSchema.safeParse(good).success).toBe(true);
  for (const bad of [{ ...good, quote: "SECRET" }, { ...good, numericValue: "SECRET" }, { ...good, numericValue: 367 }, { ...good, field: "SECRET" }, { ...good, validatorBranch: "SECRET" }, { ...good, sourceTurnOrdinals: [12] }, { ...good, evidenceKinds: Array(4).fill("USER_QUOTE") }]) expect(OffsetBindingDiagnosticSchema.safeParse(bad).success).toBe(false);
});
it("actual R02 series relation answer cannot also authorize an equal start offset", async () => {
  const h = await harness([proposal({ title: "đi thi", location: "Quang Trung", eventDate: date(), frequency: "DAILY", occurrenceCount: 2 }), proposal({ eventRelation: "BEFORE_EVENT", leadOffsetDays: 2 }, "CURRENT")]);
  await h.turn(0, "Ngày 11/10 đi thi ở Quang Trung, nhắc 2 ngày liên tiếp giúp tôi.");
  expect((await h.read(1))?.slots.leadOffsetDays.value).toBeNull();
  await h.turn(1, "Nhắc trước 2 ngày.");
  const state = await h.read(2);
  expect(state?.slots.leadOffsetDays.value).toBeNull();
  expect(state?.slots.eventRelation.value).toBeNull();
  expect(state?.slots.occurrenceCount.value).toBe(2);
  expect(h.events).toContainEqual(expect.objectContaining({ event: "POST_CANONICAL_STAGE", diagnostic: expect.objectContaining({ stage: "EVIDENCE_BINDING", offsetBinding: expect.objectContaining({ bindingBranch: "USER_QUOTE", fieldValueCheckResult: "FAIL" }) }) }));
});
