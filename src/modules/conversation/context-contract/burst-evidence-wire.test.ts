// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildContextInputV2, type ReadyContextV2 } from "./context";
import { chat, message, observation } from "./context-test-fixtures";
import { ConversationInterpretationV3Schema, FieldChangeV3Schema, SemanticPatchProposalV3Schema, type ContextInput, type EvidenceRef, type FieldChangeV3 } from "./contracts";
import { validateEvidenceV3 } from "./evidence";
import { deriveGenerationFieldCapability } from "./field-capability";
import { mergePatchV3 } from "./merge";
import type { ContextSnapshotV2 } from "./state";
import { serializeKeyedSmallComparison } from "./keyed-small-wire";
import { serializeTypedContextRequest } from "./typed-wire";
import { serializeSmallContextRequest } from "./small-wire";
import { serializeContextRequest } from "./wire";
import { createKeyedContextContractGateway } from "../../intelligence/infrastructure/openrouter/keyed-context-gateway";
import { contextPromptForInput, currentRequestTurnIndexes } from "./burst-prompt";
import { ContextInputSchema } from "./contracts";
import { decodeKeyedSmallComparison, encodeKeyedSmallComparison } from "../../intelligence/infrastructure/openrouter/context-provider-keyed-small-wire";
import { decodeSmallContextV3, encodeSmallContextV3 } from "../../intelligence/infrastructure/openrouter/context-provider-small-wire";
import { CONTEXT_SMALL_PROTOCOL_V3 } from "./small-protocol";

/** Build real, privately branded contexts over separate reply-less receipts. */
const bases = new WeakMap<ReadyContextV2, ContextSnapshotV2 | null>();
function burst(texts: string[], receipts = texts.map((_, i) => Date.parse("2026-11-05T16:59:58.000Z") + i * 2000)): ReadyContextV2 {
  let state: ContextSnapshotV2 | null = null;
  let built: ReadyContextV2 | undefined;
  texts.forEach((text, index) => {
    const msg = { ...message(text), id: `burst-${index}`, receivedAt: receipts[index] };
    const context = { ...chat, inboundRowId: index + 1 };
    const seen = observation(null, msg, context);
    const result = buildContextInputV2({ message: msg, context, snapshot: state,
      observation: { ...seen, observed: state ? { presence: "PRESENT", contextId: state.id, contextRevision: state.contextRevision } : { presence: "ABSENT" } } });
    if (result.status !== "READY") throw new Error(result.reason);
    built = result;
    bases.set(result, state);
    state = structuredClone(result.candidateSnapshot);
    state.contextRevision++;
  });
  return built!;
}
const quote = (built: ReadyContextV2, turn: number, text = built.input.turns[turn].text): EvidenceRef[] => [{ kind: "USER_QUOTE", turn, quote: text, occurrence: 1 }];
function proposal(built: ReadyContextV2, changes: FieldChangeV3[], targetTurn = 0, kind: "NEW" | "CURRENT" = "NEW") {
  return SemanticPatchProposalV3Schema.parse({ schemaVersion: "calenote-context-3", intent: "CREATE_REMINDER",
    requestTarget: { kind, evidence: quote(built, targetTurn) }, changes, query: null, uncertainties: [] });
}
const set = (built: ReadyContextV2, field: FieldChangeV3["field"], value: unknown, source: number): FieldChangeV3 =>
  ({ field, operation: "SET", value, evidence: quote(built, source) }) as FieldChangeV3;

describe("source-bound deferred burst evidence", () => {
  it("NEW admits exact member quotes while preserving their source identity and receipt", () => {
    const built = burst(["Mai đi thi ở Trường A.", "Nhắc trước 30 phút."]);
    const result = validateEvidenceV3(proposal(built, [set(built, "title", "đi thi", 0), set(built, "location", "Trường A", 0),
      set(built, "eventDate", { kind: "RELATIVE_DAY", offsetDays: 1 }, 0), set(built, "leadOffsetMinutes", 30, 1)]), built);
    expect(result.status).toBe("VALID");
    if (result.status !== "VALID") throw new Error(result.reason);
    expect(result.patch.requestTargetEvidence.map(s => s.sourceTurnId)).toEqual(["burst-0"]);
    expect(result.patch.changeEvidence[2]).toMatchObject({ current: false, referenceTime: "2026-11-05T16:59:58.000Z", sources: [{ sourceTurnId: "burst-0" }] });
    const merged = mergePatchV3(bases.get(built)!, result.patch);
    expect(merged.status).toBe("MERGED");
    if (merged.status === "MERGED") expect(merged.candidate.slots.eventDate.resolution?.referenceTime).toBe("2026-11-05T16:59:58.000Z");
  });
  it.each(["target", "operand", "alternative"])("NEW refuses foreign old USER %s outside the declared burst", variant => {
    const built = burst(["Nhắc mang giấy tờ.", "Nhắc gọi mẹ.", "Nhắc gọi mẹ lúc 8h."], [Date.parse("2026-11-05T16:58:00Z"), Date.parse("2026-11-05T16:59:58Z"), Date.parse("2026-11-05T17:00:00Z")]);
    const value = proposal(built, [set(built, "title", variant === "operand" ? "mang giấy tờ" : "gọi mẹ", variant === "operand" ? 0 : 2)], variant === "target" ? 0 : 2);
    if (variant === "alternative") value.uncertainties = [{ field: "notes", reason: "AMBIGUOUS", alternatives: [{ value: "mang giấy tờ", evidence: quote(built, 0) }] }];
    expect(validateEvidenceV3(value, built)).toEqual({ status: "REFUSED", reason: variant === "target" ? "CURRENT_USER_EVIDENCE_REQUIRED" : "NEW_REQUEST_FACT_REUSE" });
  });
  it("burst membership never widens CURRENT targeting or REPLACE authority", () => {
    const built = burst(["Nhắc gọi mẹ.", "Lúc 8h."]);
    expect(validateEvidenceV3(proposal(built, [], 0, "CURRENT"), built)).toEqual({ status: "REFUSED", reason: "CURRENT_USER_EVIDENCE_REQUIRED" });
    const change = FieldChangeV3Schema.parse({ ...set(built, "title", "gọi mẹ", 0), operation: "REPLACE" });
    expect(validateEvidenceV3(proposal(built, [change], 1), built)).toEqual({ status: "REFUSED", reason: "CURRENT_USER_EVIDENCE_REQUIRED" });
  });
  it.each([
    { first: "đi thi ở Trường A.", fields: ["title"], reason: "SEMANTIC_LOCATION_OMITTED" },
    { first: "Nhắc đi thi trước 30 phút.", fields: ["title"], reason: "SEMANTIC_LEAD_DURATION_OMITTED" },
    { first: "đi thi, nhắc trước 2 ngày.", fields: ["title"], reason: "SEMANTIC_LEAD_OFFSET_OMITTED" },
    { first: "đi thi.", fields: [], reason: "SEMANTIC_TITLE_OMITTED" },
  ])("omission checks cover earlier members: $reason", ({ first, fields, reason }) => {
    const built = burst([first, "Lúc 8h."]);
    const changes = fields.map(() => set(built, "title", "đi thi", 0));
    expect(validateEvidenceV3(proposal(built, changes, 1), built)).toEqual({ status: "REFUSED", reason });
  });
  it("relative-date evidence spanning local midnight cannot select a convenient member anchor", () => {
    const built = burst(["Mai đi thi.", "Nhắc ngày mai."]);
    const value = proposal(built, [set(built, "title", "đi thi", 0), { ...set(built, "eventDate", { kind: "RELATIVE_DAY", offsetDays: 1 }, 0), evidence: [...quote(built, 0), ...quote(built, 1)] }], 1);
    expect(validateEvidenceV3(value, built)).toEqual({ status: "REFUSED", reason: "EVIDENCE_ANCHOR_CONFLICT" });
  });
  it("scheduling-only content in an earlier member cannot manufacture notes", () => {
    const built = burst(["đi thi.", "Lúc 8h."]);
    const value = proposal(built, [set(built, "title", "đi thi", 0), set(built, "notes", "đi thi", 0)], 1);
    expect(validateEvidenceV3(value, built)).toEqual({ status: "REFUSED", reason: "SEMANTIC_NOTES_UNOWNED" });
  });
  it("event-owned date in an earlier member cannot become a notification date", () => {
    const built = burst(["Ngày 11/10 đi thi.", "Lúc 8h."]);
    const value = proposal(built, [set(built, "title", "đi thi", 0), set(built, "reminderDate", { kind: "CIVIL_DATE", calendar: "GREGORIAN", day: 11, month: 10, year: null, leapMonth: null }, 0)], 1);
    expect(validateEvidenceV3(value, built)).toEqual({ status: "REFUSED", reason: "SEMANTIC_REMINDER_DATE_UNOWNED" });
  });
  it("refuses the observed BURST04 live counterexample's duplicated relative event date", () => {
    const built = burst(["Mai đi thi ở Trường A.", "Nhắc lúc 8h."]);
    const value = proposal(built, [set(built, "title", "đi thi", 0), set(built, "location", "Trường A.", 0),
      set(built, "eventDate", { kind: "RELATIVE_DAY", offsetDays: 1 }, 0), set(built, "reminderDate", { kind: "RELATIVE_DAY", offsetDays: 1 }, 0),
      set(built, "reminderTime", { hour: 8, minute: 0, qualifier: "H24" }, 1)]);
    value.requestTarget!.evidence = [...quote(built, 0), ...quote(built, 1)];
    expect(validateEvidenceV3(value, built)).toEqual({ status: "REFUSED", reason: "SEMANTIC_REMINDER_DATE_UNOWNED" });
  });
  it("an independently authored relative notification date retains its own member's midnight reference", () => {
    const built = burst(["Mai đi thi.", "Nhắc ngày mai."]);
    const value = proposal(built, [set(built, "title", "đi thi", 0), set(built, "eventDate", { kind: "RELATIVE_DAY", offsetDays: 1 }, 0),
      set(built, "reminderDate", { kind: "RELATIVE_DAY", offsetDays: 1 }, 1)]);
    const result = validateEvidenceV3(value, built);
    expect(result.status).toBe("VALID");
    if (result.status === "VALID") expect(result.patch.changeEvidence.map(bound => bound.referenceTime)).toEqual([
      "2026-11-05T16:59:58.000Z", "2026-11-05T16:59:58.000Z", "2026-11-05T17:00:00.000Z",
    ]);
  });
  it("an earlier scheduling-only member does not exclude independently authored notes or reminder date", () => {
    const built = burst(["Ngày 11/10 đi thi.", "Nhắc ngày 10/10.", "Ghi chú: mang giấy tờ."]);
    const value = proposal(built, [set(built, "title", "đi thi", 0), set(built, "reminderDate", { kind: "CIVIL_DATE", calendar: "GREGORIAN", day: 10, month: 10, year: null, leapMonth: null }, 1), set(built, "notes", "mang giấy tờ", 2)], 2);
    expect(validateEvidenceV3(value, built).status).toBe("VALID");
  });
  it("a claimed burst member still needs an exact quote in its individual source map", () => {
    const built = burst(["Nhắc gọi mẹ.", "Lúc 8h."]);
    const value = proposal(built, [set(built, "title", "gọi mẹ", 0)]);
    value.changes[0].evidence = quote(built, 0, "nhắc gọi mẹ");
    expect(validateEvidenceV3(value, built)).toEqual({ status: "REFUSED", reason: "EVIDENCE_QUOTE_NOT_FOUND" });
  });
});

describe("conditional burst request envelope", () => {
  it("a three-member duration burst round-trips both authored units through the compact owner grammar", () => {
    const built = burst(["Mai đi thi lúc 9h.", "Nhắc trước 1 giờ 30 phút.", "Ghi chú: mang giấy tờ."]);
    const value = ConversationInterpretationV3Schema.parse({ ...proposal(built, [set(built, "title", "đi thi", 0),
      set(built, "eventDate", { kind: "RELATIVE_DAY", offsetDays: 1 }, 0), set(built, "eventTime", { hour: 9, minute: 0, qualifier: "H24" }, 0),
      set(built, "eventRelation", "BEFORE_EVENT", 1), set(built, "leadOffsetHours", 1, 1), set(built, "leadOffsetMinutes", 30, 1), set(built, "notes", "mang giấy tờ", 2)]), conversationDirective: null, replyProposal: null });
    const request = serializeSmallContextRequest(built.input);
    expect(request.response_format.json_schema.name).toBe("calenote_context_small_106");
    const encoded = encodeSmallContextV3(value, built.input);
    const decoded = decodeSmallContextV3(encoded, CONTEXT_SMALL_PROTOCOL_V3, undefined, undefined, built.input);
    expect(decoded).toMatchObject({ status: "PARSED", value: { semantic: { changes: value.changes } } });
  });
  it("the actual grouped prompt constrains event-date ownership and exterior venue punctuation", () => {
    const request = serializeKeyedSmallComparison(burst(["Mai đi thi ở Trường A.", "Nhắc lúc 8h."]).input);
    expect(request.messages[0].content).toContain("An event date in one member plus a notification clock in another does not author a notification date");
    expect(request.messages[0].content).toContain("Exclude exterior sentence punctuation from a venue");
  });
  it("the actual keyed generation/decoder grammar permits member NEW targeting and preserves CURRENT source restrictions", () => {
    const built = burst(["Nhắc gọi mẹ.", "Lúc 8h."]);
    const value = ConversationInterpretationV3Schema.parse({ ...proposal(built, [set(built, "title", "gọi mẹ", 0)]), conversationDirective: null, replyProposal: null });
    const encoded = encodeKeyedSmallComparison(value, built.input) as { operation: { code: string; targetEvidence: string[] } };
    expect(encoded.operation).toMatchObject({ code: "START_NEW_REMINDER", targetEvidence: ["U0"] });
    expect(decodeKeyedSmallComparison(encoded, built.input).status).toBe("PARSED");
    const wrongCurrent = structuredClone(encoded);
    wrongCurrent.operation.code = "CONTINUE_CURRENT_REMINDER";
    expect(decodeKeyedSmallComparison(wrongCurrent, built.input).status).not.toBe("PARSED");
  });
  it("a tail notes certificate cannot restrict punctuation authored by an earlier burst member", () => {
    const built = burst(['Nhắc gọi mẹ, ghi chú: "A. B."', "Ghi chú: mang giấy tờ."]);
    const value = ConversationInterpretationV3Schema.parse({ ...proposal(built, [set(built, "title", "gọi mẹ", 0), set(built, "notes", "A. B.", 0)]), conversationDirective: null, replyProposal: null });
    const encoded = encodeKeyedSmallComparison(value, built.input);
    expect(decodeKeyedSmallComparison(encoded, built.input).status).toBe("PARSED");
  });
  it("an authored NEW operation alternative may cite an earlier member while CURRENT alternatives stay final-turn only", () => {
    const built = burst(["Nhắc gọi mẹ.", "Lúc 8h."]);
    const value = ConversationInterpretationV3Schema.parse({ ...proposal(built, []), intent: "AMBIGUOUS",
      uncertainties: [{ field: "operation", reason: "AMBIGUOUS", alternatives: [{ value: "NEW", evidence: quote(built, 0) }] }], conversationDirective: null, replyProposal: null });
    const encoded = encodeKeyedSmallComparison(value, built.input) as { operation: { operationUncertainties: Array<{ alternatives: Array<{ value: string }> }> } };
    expect(decodeKeyedSmallComparison(encoded, built.input).status).toBe("PARSED");
    const wrongCurrent = structuredClone(encoded);
    wrongCurrent.operation.operationUncertainties[0].alternatives[0].value = "CURRENT";
    expect(decodeKeyedSmallComparison(wrongCurrent, built.input).status).not.toBe("PARSED");
  });
  it("generation unions only burst member capabilities without initial-source certificates", () => {
    const built = burst(["Nhắc đi thi trước 30 phút.", "Tại Trường A."]);
    const capability = deriveGenerationFieldCapability(built.input);
    expect(capability.allowedNumericFields).toEqual(["leadOffsetMinutes"]);
    expect(capability.allowedClockFields).toEqual(["eventTime", "reminderTime"]);
    expect(capability).toMatchObject({ notesProposalAllowed: true, titlePresenceRequired: false, eventDateYearNullRequired: false, titleCorrectionAllowed: false });
  });
  it.each(["missing-references", "duplicate", "nonconsecutive", "stale", "wrong-day", "wrong-tail", "backwards", "partial-transcript"])("invalid burst metadata does not widen prompt/source admission: %s", variant => {
    const input = structuredClone(burst(["Nhắc gọi mẹ.", "Lúc 8h."]).input);
    if (variant === "missing-references") delete input.currentBurstReferences;
    if (variant === "duplicate") input.currentBurstTurns = [1, 1];
    if (variant === "nonconsecutive") input.currentBurstTurns = [0, 2];
    if (variant === "stale") input.currentBurstReferences![0].instant = "2026-11-05T16:00:00.000Z";
    if (variant === "wrong-day") input.currentBurstReferences![0].localDate = "2026-11-06";
    if (variant === "wrong-tail") input.currentBurstReferences![1].instant = "2026-11-05T17:00:01.000Z";
    if (variant === "backwards") input.currentBurstReferences![0] = { turn: 0, instant: "2026-11-05T17:00:01.000Z", localDate: "2026-11-06" };
    if (variant === "partial-transcript") { input.turns.unshift({ role: "USER", text: "Nhắc yêu cầu cũ." }); input.currentTurn = 2; input.currentBurstTurns = [1, 2]; input.currentBurstReferences!.forEach(reference => reference.turn++); }
    expect(ContextInputSchema.safeParse(input).success).toBe(false);
    expect(contextPromptForInput("base", input)).toBe("base");
    expect(currentRequestTurnIndexes(input)).toEqual([input.currentTurn]);
  });
  it.each([serializeKeyedSmallComparison, serializeTypedContextRequest, serializeSmallContextRequest, serializeContextRequest])("actual serialized prompt explains separate member authority (%#)", serialize => {
    const built = burst(["Nhắc gọi mẹ.", "Lúc 8h."]);
    const single = burst(["Nhắc gọi mẹ."]);
    const request = serialize(built.input), baseline = serialize(single.input);
    expect(request.messages[0].content.length).toBeGreaterThan(baseline.messages[0].content.length);
    expect(request.messages[0].content).toContain("currentBurstTurns");
    expect(JSON.parse(request.messages[1].content)).toMatchObject({ currentBurstTurns: [0, 1], currentBurstReferences: [
      { turn: 0, instant: "2026-11-05T16:59:58.000Z", localDate: "2026-11-05" },
      { turn: 1, instant: "2026-11-05T17:00:00.000Z", localDate: "2026-11-06" },
    ] });
  });
  it("all four independently captured request149 single-message request bodies stay byte-identical", async () => {
    const rows = JSON.parse(readFileSync(new URL("../../intelligence/infrastructure/openrouter/__fixtures__/keyed155-request-hashes.json", import.meta.url), "utf8")) as Array<{ input: ContextInput; requestSha256: string }>;
    for (const row of rows) {
      let captured: unknown;
      const gateway = createKeyedContextContractGateway(async request => { captured = request; return { status: 500, body: "" }; }, { status: "OBSERVABLE_CANARY", advertisedContextTokens: 400000 });
      const prepared = gateway.prepare("PRIMARY", row.input);
      expect(prepared.status).toBe("READY");
      if (prepared.status !== "READY") throw new Error("request admission failed");
      await prepared.dispatch();
      expect(createHash("sha256").update(JSON.stringify(captured)).digest("hex")).toBe(row.requestSha256);
    }
  });
});
