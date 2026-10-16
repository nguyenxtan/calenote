import { describe, expect, it } from "vitest";
import { classifyQuoteMismatch } from "./quote-classification";
import { turn, chat, message, observation, snapshot } from "./context-test-fixtures";
import { projectSemanticView } from "./projection";
import { buildLegacyV2ContextInput as buildContextInput } from "./context";
import { validateLegacyV2Evidence as validateEvidence } from "./evidence";
import { DownstreamTraceSchema, type DownstreamDiagnostic } from "./downstream";

describe("diagnostic-only scoped quote classification", () => {
  it.each([
    ["gọi mẹ", "gọi mẹ", "UNKNOWN", "exactMatchIntendedUser"],
    ["é", "e\u0301", "NORMALIZATION_VARIANT", "nfcMatch"],
    ["nhắc  hai ngày", "nhắc hai ngày", "FORMATTING_VARIANT", "whitespaceNormalizedMatch"],
    ["nhắc, hai ngày", "nhắc hai ngày", "FORMATTING_VARIANT", "punctuationNormalizedMatch"],
    ["GỌI MẸ", "gọi mẹ", "FORMATTING_VARIANT", "caseFoldedMatch"],
  ])("identifies identity transform without returning operands", (source, quote, classification, flag) => {
    const d = classifyQuoteMismatch(quote, 0, [turn(source)], [turn(source)]);
    expect(d.classification).toBe(classification);
    expect(d[flag as keyof typeof d]).toBe(true);
    expect(JSON.stringify(d)).not.toContain(JSON.stringify(quote));
    expect(JSON.stringify(d)).not.toContain(JSON.stringify(source));
  });
  it("reports lexical paraphrase-like signals without claiming semantic proof", () => {
    const d = classifyQuoteMismatch("hai ngày liên tiếp nhắc tôi", 0, [turn("nhắc tôi hai ngày liên tiếp")], [turn("nhắc tôi hai ngày liên tiếp")]);
    expect(d).toMatchObject({ classification: "PARAPHRASED_QUOTE", confidence: "LOW", tokenOverlapBucket: "HIGH", editDistanceBucket: "PARAPHRASE_LIKE", semanticParaphraseConfirmed: false });
    expect(d.longestCommonContiguousSpanLength).toBeGreaterThan(5);
  });
  it("identifies lexical unrelatedness conservatively", () => {
    const d = classifyQuoteMismatch("xyz", 0, [turn("abc")], [turn("abc")]);
    expect(d).toMatchObject({ classification: "UNRELATED_QUOTE", confidence: "LOW", tokenOverlapBucket: "NONE", editDistanceBucket: "UNRELATED" });
  });
  it.each(["USER", "ASSISTANT"] as const)("finds an exact quote only in another scoped %s turn", role => {
    const other = role === "USER" ? turn("other source", "other") : { ...turn("other source", "other"), role, kind: "NOTICE" as const, deliveryState: "SENT" as const };
    const turns = [turn("intended source"), other];
    const d = classifyQuoteMismatch("other source", 0, turns, turns);
    expect(d).toMatchObject({ classification: "EXACT_WRONG_SOURCE", confidence: "HIGH", exactMatchIntendedUser: false, exactMatchOtherUser: role === "USER", exactMatchAssistant: role === "ASSISTANT" });
  });
  it("diagnoses malformed map and retained-source drift without granting authority", () => {
    const source = turn("source");
    expect(classifyQuoteMismatch("absent", 0, [{ ...source, sourceMap: { ...source.sourceMap, segments: [] } }], [source])).toMatchObject({ classification: "SOURCE_MAP_DEFECT", sourceMapStatus: "INVALID" });
    expect(classifyQuoteMismatch("absent", 0, [source], [turn("other")])).toMatchObject({ classification: "SOURCE_MAP_DEFECT", retainedUserBindingValid: false });
  });
  it("recognizes an approved NFC source projection without treating it as a mapping defect", () => {
    const source = turn("e\u0301");
    const projected = projectSemanticView(source.text, []);
    if (projected.status !== "READY") throw new Error("fixture projection");
    const valid = { ...source, semanticView: projected.text, sourceMap: projected.sourceMap };
    expect(classifyQuoteMismatch("absent", 0, [valid], [valid])).toMatchObject({ sourceMapStatus: "VALID", sourceChangedUnderNfc: true });
  });
  it("closed classification output rejects raw content and out-of-budget metric injection", async () => {
    const { QuoteClassificationSchema } = await import("./downstream");
    const d = classifyQuoteMismatch("absent", 0, [turn("source")], [turn("source")]);
    for (const extra of [{ rawQuote: "private" }, { source: "private" }, { classification: "private" }, { tokenOverlapRatio: 2 }, { longestCommonContiguousSpanLength: 2001 }]) expect(QuoteClassificationSchema.safeParse({ ...d, ...extra }).success).toBe(false);
  });
  it("records removed controls near a lexical candidate even on quote failure", () => {
    const raw = "nhắc CN-test hai ngày";
    const p = projectSemanticView(raw, ["CN-test"]);
    if (p.status !== "READY") throw new Error("fixture projection");
    const source = { ...turn(raw), semanticView: p.text, sourceMap: p.sourceMap, controlSpans: p.controlSpans };
    expect(classifyQuoteMismatch("nhắc hai ngày", 0, [source], [source])).toMatchObject({ sourceMapStatus: "VALID", removedControlSpanNearby: true });
  });
  it("never changes exact-match rejection for formatting or paraphrase-like similarity", () => {
    for (const [source, quote] of [["nhắc  hai ngày", "nhắc hai ngày"], ["nhắc tôi hai ngày liên tiếp", "hai ngày liên tiếp nhắc tôi"]]) {
      const msg = message(source), built = buildContextInput({ message: msg, context: chat, snapshot: null, observation: observation(null, msg) });
      if (built.status !== "READY") throw new Error("fixture context");
      const trace: DownstreamDiagnostic[] = [];
      const result = validateEvidence({ schemaVersion: "calenote-context-2", intent: "CREATE_REMINDER", dialogueAct: "EDIT", continuation: "YES", changes: [{ field: "notes", operation: "SET", value: "private value", evidence: [{ kind: "USER_QUOTE", turn: 0, quote, occurrence: 1 }] }], query: null, uncertainties: [], controlEvidence: [] }, built, d => trace.push(d));
      expect(result).toEqual({ status: "REFUSED", reason: "EVIDENCE_QUOTE_NOT_FOUND" });
      expect(trace[0].evidenceFailure?.quoteClassification).toBeDefined();
      expect(DownstreamTraceSchema.safeParse(trace).success).toBe(true);
      for (const secret of [source, quote, "private value", "provider-user"]) expect(JSON.stringify(trace)).not.toContain(JSON.stringify(secret));
    }
  });
  it("bounds similarity work rather than truncating long sources into false conclusions", () => {
    const source = { ...turn("x".repeat(10001)), role: "ASSISTANT" as const, kind: "NOTICE" as const, deliveryState: "SENT" as const };
    const d = classifyQuoteMismatch("absent", 0, [source], [source]);
    expect(d).toMatchObject({ classification: "UNKNOWN", similarityMeasured: false });
  });
  it("keeps R02 eventRelation rejection and first failure path", () => {
    const state = snapshot(); state.transcript = [];
    const msg = message("Ngày 11/10 đi thi ở Quang Trung, nhắc 2 ngày liên tiếp giúp tôi."), built = buildContextInput({ message: msg, context: chat, snapshot: state, observation: observation(state, msg) });
    if (built.status !== "READY") throw new Error("fixture context");
    const trace: DownstreamDiagnostic[] = [];
    const result = validateEvidence({ schemaVersion: "calenote-context-2", intent: "CREATE_REMINDER", dialogueAct: "NEW_REQUEST", continuation: "NO", changes: [{ field: "eventRelation", operation: "SET", value: "BEFORE_EVENT", evidence: [{ kind: "USER_QUOTE", turn: 0, quote: "nhắc trước sự kiện", occurrence: 1 }] }], query: null, uncertainties: [], controlEvidence: [] }, built, d => trace.push(d));
    expect(result).toEqual({ status: "REFUSED", reason: "EVIDENCE_QUOTE_NOT_FOUND" });
    expect(trace[0].evidenceFailure).toMatchObject({ field: "eventRelation", path: ["changes", 0, "evidence"], matchCount: 0 });
  });
});
