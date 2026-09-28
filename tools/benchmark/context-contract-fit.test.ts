// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { measureEnvelope } from "../../src/modules/conversation/context-contract/admission";
import { ContextInputSchema, ConversationInterpretationSchema, InterpretationJsonSchema, SLOT_NAMES, type ContextInput } from "../../src/modules/conversation/context-contract/contracts";
import { CONTEXT_CONTRACT_PROMPT } from "../../src/modules/conversation/context-contract/prompt";
import { serializeContextRequest } from "../../src/modules/conversation/context-contract/wire";

const input = ContextInputSchema.parse({
  schemaVersion: "calenote-context-input-1",
  reference: { instant: "2026-09-28T03:00:00.000Z", localDate: "2026-09-28", timezone: "Asia/Ho_Chi_Minh" },
  turns: [{ role: "USER", text: "Mai 8h nhắc gọi mẹ" }], currentTurn: 0,
  activeRequest: null, facts: [], pendingQuestion: null, ambiguities: [],
  capabilities: { version: "context-capabilities-1", supported: ["ONCE", "FINITE_DAILY", "LIST", "CALENDAR_DATE"], unsupported: ["WEEKLY", "MONTHLY", "YEARLY"], calendars: ["GREGORIAN", "LUNAR_VN"], limits: { dailyCount: 30, horizonDays: 366 } },
});
const output = { schemaVersion: "calenote-context-1", intent: "CREATE_REMINDER", dialogueAct: "NEW_REQUEST", continuation: "NO", changes: [
  { field: "title", operation: "SET", value: "gọi mẹ", evidence: [{ kind: "USER_QUOTE", turn: 0, quote: "gọi mẹ", occurrence: 1 }] },
], query: null, uncertainties: [], controlEvidence: [] };

const utf8 = (value: string) => Buffer.byteLength(value, "utf8");
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const quote = (turn: number, text: string, occurrence = 1) => ({ kind: "USER_QUOTE", turn, quote: text, occurrence });
const change = (field: string, value: unknown, turn: number, text: string) => ({ field, operation: "SET", value, evidence: [quote(turn, text)] });
const proposal = (changes: unknown[], extra: Record<string, unknown> = {}) => ConversationInterpretationSchema.parse({ ...output, changes, ...extra });
const at = "2026-09-28T03:00:00.000Z";
const clock9 = { hour: 9, minute: 0, qualifier: "H24" };
const examDate = { kind: "CIVIL_DATE", calendar: "GREGORIAN", day: 11, month: 10, year: null, leapMonth: null };
const examTurns = ["Ngày 11/10 đi thi ở Quang Trung, nhớ mang giấy tờ.", "Nhắc hai ngày liên tiếp trước hôm thi.", "8h.", "Đổi sang 9h."];
// Test-only literal serialization samples. These are not a context builder,
// projector, state machine, provenance validator or multi-turn evaluator.
function sampleInput(texts: string[], retained: Record<string, unknown> = {}): ContextInput {
  const facts = Object.entries(retained).map(([field, value], i) => ({ alias: `f${i + 1}`, scope: "REMINDER", field, value, provenance: { kind: "EXPLICIT_USER" }, sourceReferenceTime: at, dependencies: [] }));
  const slots = Object.fromEntries(SLOT_NAMES.map(field => {
    const fact = facts.find(f => f.field === field);
    return [field, { state: fact ? "RESOLVED" : "MISSING", value: fact?.value ?? null, fact: fact?.alias ?? null }];
  }));
  return ContextInputSchema.parse({ ...input,
    turns: texts.flatMap((text, i) => i === texts.length - 1 ? [{ role: "USER", text: text.normalize("NFC") }] : [{ role: "USER", text: text.normalize("NFC") }, { role: "ASSISTANT", text: "Bạn muốn được nhắc lúc mấy giờ?" }]),
    currentTurn: texts.length * 2 - 2, facts,
    activeRequest: facts.length ? { lifecycle: "CLARIFYING", slots } : null,
    pendingQuestion: facts.length ? { text: "Bạn muốn được nhắc lúc mấy giờ?", scope: "REMINDER", field: "reminderTime", decisionKind: null, reason: "MISSING" } : null,
  });
}
function snapshotSample(value: ContextInput, originals = value.turns.map(t => t.text), candidate: unknown = null) {
  // Only literal groundings for this fixed specimen corpus. No language parsing,
  // resolution, projection or accepted-state transition is implemented here.
  const groundings: Record<string, { text: string; quote: string; start: number; end: number }> = {
    title: { text: examTurns[0], quote: "đi thi", start: 11, end: 17 },
    location: { text: examTurns[0], quote: "Quang Trung", start: 20, end: 31 },
    notes: { text: examTurns[0], quote: "nhớ mang giấy tờ", start: 33, end: 49 },
    eventDate: { text: examTurns[0], quote: "Ngày 11/10", start: 0, end: 10 },
    frequency: { text: examTurns[1], quote: "hai ngày liên tiếp", start: 5, end: 23 },
    occurrenceCount: { text: examTurns[1], quote: "hai ngày liên tiếp", start: 5, end: 23 },
    eventRelation: { text: examTurns[1], quote: "trước hôm thi", start: 24, end: 37 },
    reminderDate: { text: "mai nhắc tui gọi khách", quote: "mai", start: 0, end: 3 },
    reminderTime: { text: examTurns[2], quote: "8h.", start: 0, end: 3 },
  };
  const slots = Object.fromEntries(SLOT_NAMES.map(field => {
    const fact = value.facts.find(f => f.field === field);
    const base = value.activeRequest?.slots[field] ?? { state: "MISSING", value: null, fact: null };
    if (!fact) return [field, { ...base, evidence: [], provenance: null, resolution: null, proposalRevision: 3 }];
    let grounding = groundings[field];
    if (fact.value === "gọi khách") grounding = { text: "mai nhắc tui gọi khách", quote: "gọi khách", start: 13, end: 22 };
    if (typeof fact.value === "string" && ["title", "location", "notes"].includes(field) && fact.value.startsWith("ế")) grounding = { text: fact.value, quote: fact.value, start: 0, end: [...fact.value].length };
    if (field === "reminderTime" && typeof fact.value === "object" && fact.value !== null && "hour" in fact.value && fact.value.hour === 9) grounding = { text: examTurns[3], quote: "Đổi sang 9h.", start: 0, end: 12 };
    const turn = value.turns.findIndex(t => t.role === "USER" && t.text === grounding.text);
    return [field, { ...base, evidence: [{ kind: "USER_QUOTE", sourceTurnId: `synthetic-turn-${turn}`, sourceMapTurnId: `synthetic-turn-${turn}`, quote: grounding.quote, occurrence: 1, sourceSpan: { start: grounding.start, end: grounding.end }, viewSpan: { start: grounding.start, end: grounding.end }, normalizationVersion: "nfc-codepoint-v1" }], provenance: fact.provenance,
      resolution: { method: "EXPLICIT_OPERAND", version: "synthetic-resolution-v1", referenceTime: at, timezone: "Asia/Ho_Chi_Minh", dependencies: [] }, proposalRevision: 3 }];
  }));
  return {
    schemaVersion: "calenote-context-state-1", scope: { ownerId: "synthetic-owner", workspaceId: "synthetic-workspace", connectionId: "synthetic-connection", chatId: "synthetic-chat" },
    inbound: { id: "synthetic-inbound", receivedAt: at, rowid: 7, claimMarker: "synthetic-claim" },
    requestId: "synthetic-request", contextRevision: 4, draftRevision: 3, lifecycle: "CLARIFYING",
    slots, facts: value.facts.map(f => ({ ...f, evidenceSlot: f.field })),
    pendingReminderQuestion: value.pendingQuestion, pendingQueryQuestion: null, ambiguities: value.ambiguities,
    transcript: value.turns.map((t, i) => ({ id: `synthetic-turn-${i}`, role: t.role, text: originals[i], receivedAt: at, kind: t.role === "USER" ? "RECEIVED" : "CLARIFICATION", deliveryState: t.role === "USER" ? "RECEIVED" : "SENT", semanticView: t.text,
      sourceMap: { normalizationVersion: "nfc-codepoint-v1", sourceCodePoints: [...originals[i]].length, viewCodePoints: [...t.text].length, segments: [{ sourceStart: 0, sourceEnd: [...originals[i]].length, viewStart: 0, viewEnd: [...t.text].length, kind: originals[i] === t.text ? "UNCHANGED" : "NFC_COMPOSITION_RUN", sourceStride: originals[i] === t.text ? 1 : 3, viewStride: 1 }] } })),
    pendingDecision: { kind: "REPLACE_PENDING", target: { ownerId: "synthetic-owner", chatId: "synthetic-chat", requestId: "synthetic-request" }, questionId: "synthetic-question", previewId: "synthetic-preview", draftRevision: 3, contextRevision: 4, issuedAfterInbound: { receivedAt: at, rowid: 7 }, deliveryState: "SENT", expiresAt: "2026-09-28T03:10:00.000Z", acceptedReplies: ["có", "ok", "1"], candidate },
    previewReceipt: { previewId: "synthetic-preview", draftRevision: 3, draftHash: "a".repeat(64), ownerId: "synthetic-owner", chatId: "synthetic-chat", issuedAfterOrder: { receivedAt: at, rowid: 7 }, expiresAt: "2026-09-28T03:10:00.000Z", deliveryState: "SENT" },
    controlRegistry: [{ handle: "CN-SYNTHETIC-TOKEN", ownerId: "synthetic-owner", chatId: "synthetic-chat", decisionId: "synthetic-decision", expiresAt: "2026-09-28T03:10:00.000Z" }],
    modelAttemptBinding: { contextRevision: 4, sourceInboundId: "synthetic-inbound" }, createdAt: at, idleExpiresAt: "2026-09-28T03:30:00.000Z", absoluteExpiresAt: "2026-09-28T05:00:00.000Z", draftExpiresAt: "2026-09-28T03:10:00.000Z", capabilityVersion: "context-capabilities-1",
  };
}
type Specimen = { name: string; input: ContextInput; snapshot: string; output: string; expectedReasons: string[]; schemaValid: boolean };
const specimens: Specimen[] = [];
function add(name: string, value: ContextInput, out: unknown, expectedReasons: string[] = [], snapshot = JSON.stringify(snapshotSample(value))) {
  ContextInputSchema.parse(value);
  const valid = ConversationInterpretationSchema.parse(out);
  specimens.push({ name, input: value, snapshot, output: JSON.stringify(valid), expectedReasons, schemaValid: true });
}
const simple = proposal([change("title", "gọi mẹ", 0, "gọi mẹ"), change("reminderDate", { kind: "RELATIVE_DAY", offsetDays: 1 }, 0, "Mai"), change("reminderTime", { hour: 8, minute: 0, qualifier: "H24" }, 0, "8h")]);
add("simple_create", input, simple);
add("two_turn_start", sampleInput(["mai nhắc tui gọi khách"]), proposal([change("title", "gọi khách", 0, "gọi khách"), change("reminderDate", { kind: "RELATIVE_DAY", offsetDays: 1 }, 0, "mai")], { uncertainties: [{ field: "reminderTime", reason: "MISSING", alternatives: [] }] }));
add("two_turn_complete", sampleInput(["mai nhắc tui gọi khách", "9h"], { title: "gọi khách", reminderDate: { kind: "RELATIVE_DAY", offsetDays: 1 } }), proposal([change("reminderTime", clock9, 2, "9h")], { dialogueAct: "CONTINUE", continuation: "YES" }));
const examFacts = { title: "đi thi", location: "Quang Trung", notes: "nhớ mang giấy tờ", eventDate: examDate };
const examProposals = [
  proposal([change("title", "đi thi", 0, "đi thi"), change("location", "Quang Trung", 0, "Quang Trung"), change("notes", "nhớ mang giấy tờ", 0, "nhớ mang giấy tờ"), change("eventDate", examDate, 0, "Ngày 11/10")], { uncertainties: [{ field: "reminderTime", reason: "MISSING", alternatives: [] }] }),
  proposal([change("frequency", "DAILY", 2, "hai ngày liên tiếp"), change("occurrenceCount", 2, 2, "hai ngày liên tiếp"), change("eventRelation", "BEFORE_EVENT", 2, "trước hôm thi")], { dialogueAct: "CONTINUE", continuation: "YES" }),
  proposal([change("reminderTime", { hour: 8, minute: 0, qualifier: "H24" }, 4, "8h.")], { dialogueAct: "CONTINUE", continuation: "YES" }),
  proposal([change("reminderTime", clock9, 6, "Đổi sang 9h.")], { dialogueAct: "EDIT", continuation: "YES" }),
];
examProposals.forEach((out, i) => add(`exam_turn_${i + 1}`, sampleInput(examTurns.slice(0, i + 1), i === 0 ? {} : { ...examFacts, ...(i >= 2 ? { frequency: "DAILY", occurrenceCount: 2, eventRelation: "BEFORE_EVENT" } : {}), ...(i >= 3 ? { reminderTime: { hour: 8, minute: 0, qualifier: "H24" } } : {}) }), out));
const correction = "Đổi sang 9h, địa điểm ở Quang Trung, ghi chú nhớ mang giấy tờ.";
add("multi_field_correction", sampleInput([examTurns[0], correction], examFacts), proposal([change("reminderTime", clock9, 2, "Đổi sang 9h"), change("location", "Quang Trung", 2, "địa điểm ở Quang Trung"), change("notes", "nhớ mang giấy tờ", 2, "ghi chú nhớ mang giấy tờ")], { dialogueAct: "EDIT", continuation: "YES" }));
for (const [field, length] of [["title", 1800], ["location", 300], ["notes", 2000]] as const) {
  const long = "ế".repeat(length);
  const value = sampleInput([long, "Giữ nguyên."], { [field]: long });
  add(`maximum_${field}`, value, proposal([{ field, operation: "SET", value: long, evidence: [{ kind: "CONTEXT_FACT", ref: "f1" }] }], { dialogueAct: "CONTINUE", continuation: "YES" }), field === "location" ? [] : ["CONTEXT_SNAPSHOT_TOO_LARGE"]);
}
for (const field of ["title", "notes"] as const) for (const length of [900, 600]) {
  const long = "ế".repeat(length);
  add(`long_${field}_${length}`, sampleInput([long, "Giữ nguyên."], { [field]: long }), proposal([{ field, operation: "SET", value: long, evidence: [{ kind: "CONTEXT_FACT", ref: "f1" }] }], { dialogueAct: "CONTINUE", continuation: "YES" }), length === 900 ? ["CONTEXT_SNAPSHOT_TOO_LARGE"] : []);
}
const combinedFacts = { title: "ế".repeat(1800), location: "ế".repeat(300), notes: "ế".repeat(2000) };
const combinedInput = sampleInput([combinedFacts.title, combinedFacts.location, combinedFacts.notes, "Giữ nguyên."], combinedFacts);
add("long_combined", combinedInput, proposal(Object.entries(combinedFacts).map(([field, value], i) => ({ field, operation: "SET", value, evidence: [{ kind: "CONTEXT_FACT", ref: `f${i + 1}` }] }))), ["CONTEXT_SNAPSHOT_TOO_LARGE"]);
const escaped = 'Nhớ "giấy tờ" \\ hồ sơ\nnhớ mang giấy tờ; nhớ mang giấy tờ';
for (const refs of [1, 2, 3]) add(`escaped_refs_${refs}`, sampleInput([escaped]), proposal([{ field: "notes", operation: "SET", value: escaped, evidence: [quote(0, '"giấy tờ" \\ hồ sơ\n'), quote(0, "nhớ mang giấy tờ", 1), quote(0, "nhớ mang giấy tờ", 2)].slice(0, refs) }]));
const ambiguities = ["eventDate", "reminderDate", "endDate", "eventTime"].map(field => ({ field, reason: "AMBIGUOUS", alternatives: field === "eventTime" ? [{ value: { hour: 8, minute: 0, qualifier: "AM" }, evidence: [quote(4, "8h")] }, { value: { hour: 8, minute: 0, qualifier: "PM" }, evidence: [quote(4, "8h")] }] : [{ value: { kind: "RELATIVE_DAY", offsetDays: 1 }, evidence: [quote(4, "mai")] }, { value: { kind: "RELATIVE_DAY", offsetDays: 2 }, evidence: [quote(4, "mốt")] }] }));
const uncertainInput = ContextInputSchema.parse({ ...sampleInput([examTurns[0], "Mai 8h nhắc gọi mẹ", "mai hay mốt lúc 8h"], examFacts), ambiguities });
const candidateProposal = proposal([change("title", "gọi mẹ", 2, "gọi mẹ"), change("reminderDate", { kind: "RELATIVE_DAY", offsetDays: 1 }, 2, "Mai"), change("reminderTime", { hour: 8, minute: 0, qualifier: "H24" }, 2, "8h")]);
add("four_uncertainties_candidate", uncertainInput, proposal([], { intent: "AMBIGUOUS", dialogueAct: "AMBIGUOUS", continuation: "UNCERTAIN", uncertainties: ambiguities }), [], JSON.stringify(snapshotSample(uncertainInput, undefined, {
  proposal: candidateProposal, sourceEvidence: [quote(2, "Mai 8h nhắc gọi mẹ")], sourceTurnId: "synthetic-turn-2", sourceText: "Mai 8h nhắc gọi mẹ", sourceSpan: { start: 0, end: 18 }, normalizationVersion: "nfc-codepoint-v1",
  evidenceIndex: [
    { field: "title", sourceTurnId: "synthetic-turn-2", sourceSpan: { start: 12, end: 18 }, viewSpan: { start: 12, end: 18 }, sourceMapTurnId: "synthetic-turn-2", normalizationVersion: "nfc-codepoint-v1" },
    { field: "reminderDate", sourceTurnId: "synthetic-turn-2", sourceSpan: { start: 0, end: 3 }, viewSpan: { start: 0, end: 3 }, sourceMapTurnId: "synthetic-turn-2", normalizationVersion: "nfc-codepoint-v1" },
    { field: "reminderTime", sourceTurnId: "synthetic-turn-2", sourceSpan: { start: 4, end: 6 }, viewSpan: { start: 4, end: 6 }, sourceMapTurnId: "synthetic-turn-2", normalizationVersion: "nfc-codepoint-v1" },
  ],
})));
const twelveInput = sampleInput([examTurns[0], examTurns[1], examTurns[2], examTurns[3], "Giữ địa điểm.", "Giữ ghi chú."], { ...examFacts, reminderTime: clock9, frequency: "DAILY", occurrenceCount: 2, eventRelation: "BEFORE_EVENT" });
twelveInput.turns.unshift({ role: "ASSISTANT", text: "Bạn cần nhắc việc gì?" }); twelveInput.currentTurn++;
add("six_user_six_assistant", twelveInput, proposal([], { dialogueAct: "CONTINUE", continuation: "YES" }));
const boundaryInput = structuredClone(twelveInput);
const missing = 16384 - utf8(JSON.stringify(snapshotSample(boundaryInput)));
// Fill actual assistant source/view, recalculate maps, then use the final few
// bytes in an internal synthetic request identity (not hidden padding).
boundaryInput.turns[0].text += "x".repeat(Math.floor(missing / 2) - 16);
const boundarySnapshot = snapshotSample(boundaryInput);
boundarySnapshot.requestId += "x".repeat(16384 - utf8(JSON.stringify(boundarySnapshot)));
const boundaryJson = JSON.stringify(boundarySnapshot);
add("snapshot_16384", boundaryInput, proposal([]), [], boundaryJson);
add("snapshot_16385", boundaryInput, proposal([]), ["CONTEXT_SNAPSHOT_TOO_LARGE"], JSON.stringify({ ...boundarySnapshot, requestId: boundarySnapshot.requestId + "x" }));
const projectedInput = sampleInput([examTurns[0], "[CONTROL] Đổi sang 9h."], examFacts);
const projectedSnapshot = snapshotSample(projectedInput, [examTurns[0], "Bạn muốn được nhắc lúc mấy giờ?", "CN-SYNTHETIC-TOKEN Đổi sang 9h."]);
projectedSnapshot.transcript[2].sourceMap.segments = [
  { sourceStart: 0, sourceEnd: 18, viewStart: 0, viewEnd: 9, kind: "CONTROL_REPLACEMENT", sourceStride: 0, viewStride: 0 },
  { sourceStart: 18, sourceEnd: 31, viewStart: 9, viewEnd: 22, kind: "UNCHANGED", sourceStride: 1, viewStride: 1 },
];
add("control_projection_literal", projectedInput, proposal([change("reminderTime", clock9, 2, "Đổi sang 9h.")], { dialogueAct: "EDIT", continuation: "YES" }), [], JSON.stringify(projectedSnapshot));

describe("full specimen measurements", () => {
  it("retained_snapshot_slots_include_grounded_evidence_and_resolution_metadata", () => {
    for (const s of specimens) {
      const snapshot = JSON.parse(s.snapshot);
      for (const fact of s.input.facts) {
        const slot = snapshot.slots[fact.field];
        expect(slot.evidence, `${s.name}:${fact.field}`).toHaveLength(1);
        expect(slot.resolution).toMatchObject({ method: "EXPLICIT_OPERAND", version: "synthetic-resolution-v1", referenceTime: at, timezone: "Asia/Ho_Chi_Minh" });
        const ref = slot.evidence[0];
        const source = snapshot.transcript.find((t: { id: string }) => t.id === ref.sourceTurnId);
        expect(source?.role).toBe("USER");
        expect([...source.text].slice(ref.sourceSpan.start, ref.sourceSpan.end).join("")).toBe(ref.quote);
        expect([...source.semanticView].slice(ref.viewSpan.start, ref.viewSpan.end).join("")).toBe(ref.quote);
        expect(ref.normalizationVersion).toBe("nfc-codepoint-v1");
        expect(ref.sourceMapTurnId).toBe(source.id);
        expect(source.sourceMap.segments.some((segment: { kind: string; sourceStart: number; sourceEnd: number; viewStart: number; viewEnd: number }) => segment.kind === "UNCHANGED" && segment.sourceStart <= ref.sourceSpan.start && segment.sourceEnd >= ref.sourceSpan.end && segment.viewStart <= ref.viewSpan.start && segment.viewEnd >= ref.viewSpan.end)).toBe(true);
        expect(snapshot.facts.find((f: { alias: string }) => f.alias === fact.alias).evidenceSlot).toBe(fact.field);
      }
    }
  });
  it("uncertainty_and_control_samples_retain_exam_sources_and_candidate_quotes", () => {
    for (const name of ["four_uncertainties_candidate", "control_projection_literal"]) {
      const s = specimens.find(s => s.name === name)!;
      const snapshot = JSON.parse(s.snapshot);
      expect(snapshot.transcript.map((t: { text: string }) => t.text)).toContain(examTurns[0]);
      const candidate = snapshot.pendingDecision.candidate;
      if (candidate) for (const c of candidate.proposal.changes) for (const ref of c.evidence) {
        const source = snapshot.transcript[ref.turn];
        expect(source.role).toBe("USER");
        expect(source.text).toBe("Mai 8h nhắc gọi mẹ");
        const grounding = candidate.evidenceIndex.find((e: { field: string }) => e.field === c.field);
        expect(grounding.sourceTurnId).toBe(source.id);
        expect([...source.text].slice(grounding.sourceSpan.start, grounding.sourceSpan.end).join("")).toBe(ref.quote);
        expect([...source.semanticView].slice(grounding.viewSpan.start, grounding.viewSpan.end).join("")).toBe(ref.quote);
        expect(source.sourceMap.segments[0].kind).toBe("UNCHANGED");
        expect(source.sourceMap.segments[0].sourceEnd).toBe(18);
        expect(ref.occurrence).toBe(1);
      }
    }
  });
  it("boundary_snapshot_source_maps_cover_the_actual_retained_text", () => {
    const s = specimens.find(s => s.name === "snapshot_16384")!;
    const snapshot = JSON.parse(s.snapshot);
    for (const [i, turn] of snapshot.transcript.entries()) {
      expect(turn.sourceMap.sourceCodePoints).toBe([...turn.text].length);
      expect(turn.sourceMap.viewCodePoints).toBe([...turn.semanticView].length);
      expect(turn.semanticView).toBe(s.input.turns[i].text);
    }
  });
  it.each(specimens)("$name preserves complete serialized artifacts and reports actual limits", specimen => {
    const before = JSON.stringify(specimen);
    const m = measureEnvelope(specimen.input, specimen.snapshot, specimen.output);
    expect(m.reasons).toEqual([...specimen.expectedReasons, "TOKEN_BOUND_UNVERIFIED"]);
    expect(m.admitted).toBe(false);
    expect(m.inputTokens).toBeNull(); expect(m.outputTokens).toBeNull();
    expect(m.bytes.request).toBe(m.bytes.prompt + m.bytes.schema + m.bytes.input + m.bytes.framing);
    expect(JSON.parse(serializeContextRequest(specimen.input).messages[1].content)).toEqual(specimen.input);
    expect(JSON.stringify(specimen)).toBe(before);
  });
  it("exam_correction_keeps_location_notes_event_and_schedule_operands_on_wire", () => {
    const value = JSON.parse(serializeContextRequest(specimens.find(s => s.name === "exam_turn_4")!.input).messages[1].content);
    expect(value.activeRequest.slots.location.value).toBe("Quang Trung");
    expect(value.activeRequest.slots.notes.value).toBe("nhớ mang giấy tờ");
    expect(value.activeRequest.slots.eventDate.value).toEqual(examDate);
    expect(value.activeRequest.slots.occurrenceCount.value).toBe(2);
    expect(value.activeRequest.slots.eventRelation.value).toBe("BEFORE_EVENT");
    expect(examProposals[3].changes.map(c => c.field)).toEqual(["reminderTime"]);
  });
  it("reports_reproducible_numeric_matrix_and_artifact_digests", () => {
    const rows = specimens.map(s => {
      const m = measureEnvelope(s.input, s.snapshot, s.output);
      const raw = JSON.stringify({ choices: [{ message: { role: "assistant", content: s.output }, finish_reason: "stop" }] });
      return { case: s.name, utf16: m.current.utf16Units, cp: m.current.codePoints, input: m.bytes.input, snapshot: m.bytes.snapshot, request: m.bytes.request, framing: m.bytes.framing, output: m.bytes.output, syntheticRaw: utf8(raw), reasons: m.reasons.join(","), specimenSha256: digest(JSON.stringify(s)) };
    });
    expect(rows.find(r => r.case === "snapshot_16384")?.snapshot).toBe(16384);
    expect(rows.find(r => r.case === "snapshot_16385")?.snapshot).toBe(16385);
    if (process.env.CONTEXT_FIT_REPORT === "1") {
      console.log(JSON.stringify({ promptBytes: utf8(CONTEXT_CONTRACT_PROMPT), schemaBytes: utf8(JSON.stringify(InterpretationJsonSchema)), promptSha256: digest(CONTEXT_CONTRACT_PROMPT), schemaSha256: digest(JSON.stringify(InterpretationJsonSchema)), method: "gemini-2.5-flash-lite:UNVERIFIED", sources: Object.fromEntries(["contracts", "prompt", "wire", "admission"].map(name => [name, digest(readFileSync(`src/modules/conversation/context-contract/${name}.ts`, "utf8"))])), rows }, null, 2));
    }
  });
});

describe("independent admission boundaries", () => {
  for (const units of [1799, 1800, 1801, 2000]) for (const variant of ["NFC", "DECOMPOSED", "SUPPLEMENTARY"]) {
    it(`INPUT_${units}_${variant}`, () => {
      const raw = variant === "NFC" ? "ế".repeat(units) : variant === "DECOMPOSED" ? "e\u0302\u0301".repeat(units) : "😀".repeat(Math.floor(units / 2)) + (units % 2 ? "ế" : "");
      const value = sampleInput([raw]);
      const original = JSON.stringify(snapshotSample(value, [raw]));
      const m = measureEnvelope(value, original);
      expect(m.current.utf16Units).toBe(units);
      expect(m.current.codePoints).toBe(variant === "SUPPLEMENTARY" ? Math.ceil(units / 2) : units);
      expect(m.reasons.includes("SEMANTIC_INPUT_TOO_LONG")).toBe(units > 1800);
      expect(m.reasons).not.toContain("CONTEXT_TURN_TOO_LONG");
      expect(JSON.parse(original).transcript[0].text).toBe(raw);
      if (process.env.CONTEXT_FIT_REPORT === "1") console.log(JSON.stringify({ unicode: `INPUT_${units}_${variant}`, originalUnits: raw.length, originalCp: [...raw].length, ...m.current, snapshotBytes: m.bytes.snapshot, requestBytes: m.bytes.request, reasons: m.reasons }));
    });
  }
  it("retained_turn_exceeding_2000_codepoints_is_rejected_without_clipping", () => {
    const value = { ...input, turns: [{ role: "USER" as const, text: "ế".repeat(2001) }] };
    expect(measureEnvelope(value, "{}").reasons).toContain("CONTEXT_TURN_TOO_LONG");
    expect(value.turns[0].text.length).toBe(2001);
  });
  it("seven_users_or_assistants_cannot_evade_role_bounds", () => {
    for (const role of ["USER", "ASSISTANT"] as const) {
      const value = { ...input, turns: [...Array.from({ length: 7 }, () => ({ role, text: "Giữ nguyên." })), { role: "USER" as const, text: "9h" }], currentTurn: 7 };
      expect(measureEnvelope(value, "{}").reasons).toContain("CONTEXT_TURN_COUNT_EXCEEDED");
    }
  });
  it("oversized_json_and_truncation_never_return_a_partial_patch", () => {
    const long = "ế".repeat(2000);
    const large = proposal([{ field: "notes", operation: "SET", value: long, evidence: [quote(0, long), quote(0, long), quote(0, long)] }], { uncertainties: [{ field: "notes", reason: "AMBIGUOUS", alternatives: [{ value: long, evidence: [quote(0, long)] }, { value: long, evidence: [quote(0, long)] }] }] });
    const json = JSON.stringify(large);
    expect(utf8(json)).toBeGreaterThan(32768);
    expect(measureEnvelope(input, "{}", json).reasons).toContain("OUTPUT_JSON_TOO_LARGE");
    expect(measureEnvelope(input, "{}", json.slice(0, -1)).reasons).toContain("OUTPUT_JSON_INVALID");
    const small = JSON.stringify(simple);
    const raw = JSON.stringify({ choices: [{ message: { content: small }, finish_reason: "stop" }], diagnostic: "x".repeat(32768) });
    expect(utf8(small)).toBeLessThan(32768); expect(utf8(raw)).toBeGreaterThan(32768);
    // Extracted JSON cannot certify raw transport fit. Admission remains blocked;
    // the future gateway must inspect raw bytes and finish reason separately.
    expect(measureEnvelope(input, "{}", small).admitted).toBe(false);
    if (process.env.CONTEXT_FIT_REPORT === "1") console.log(JSON.stringify({ overflow: { validOutputBytes: utf8(json), truncatedBytes: utf8(json.slice(0, -1)), smallOutputBytes: utf8(small), oversizedRawBytes: utf8(raw) } }));
  });
  it("strict_nested_shapes_cover_all_slots_dates_queries_and_typed_alternatives", () => {
    expect(ConversationInterpretationSchema.safeParse({ ...output, changes: [{ ...output.changes[0], evidence: [] }] }).success).toBe(false);
    expect(ConversationInterpretationSchema.safeParse({ ...output, changes: [{ ...output.changes[0], operation: "CLEAR", value: null, evidence: [{ kind: "CONTEXT_FACT", ref: "f1" }] }] }).success).toBe(false);
    expect(ConversationInterpretationSchema.safeParse({ ...output, changes: [change("eventDate", { ...examDate, leapMonth: false }, 0, "11/10")] }).success).toBe(false);
    expect(ConversationInterpretationSchema.safeParse({ ...output, changes: [change("reminderTime", { hour: 23, minute: 0, qualifier: "PM" }, 0, "23h")] }).success).toBe(false);
    expect(ConversationInterpretationSchema.safeParse({ ...output, intent: "LIST_REMINDERS", query: { kind: "LIST", period: { kind: "MONTH", offset: 0 }, statusScope: "DEFAULT", evidence: [quote(0, "tháng này")] } }).success).toBe(false);
    const list = proposal([], { intent: "LIST_REMINDERS", query: { kind: "LIST", period: { kind: "MONTH", offset: 0 }, statusScope: "DEFAULT", evidence: [quote(0, "tháng này")] } });
    expect(list.query?.kind).toBe("LIST");
    expect(ConversationInterpretationSchema.safeParse({ ...list, query: { ...list.query, ownerId: "model-owner" } }).success).toBe(false);
    expect(ConversationInterpretationSchema.safeParse({ ...output, uncertainties: [{ field: "reminderTime", reason: "AMBIGUOUS", alternatives: [{ value: "9h", evidence: [quote(0, "9h")] }] }] }).success).toBe(false);
  });
});

describe("offline context contract feasibility", () => {
  // These catch omitted normalization/counting, accidental dispatch and partial acceptance.
  it("fit_reports_units_bytes_and_method_separately", () => {
    const measured = measureEnvelope({ ...input, turns: [{ role: "USER", text: "e\u0301😀" }] }, "{}");
    expect(measured.current).toEqual({ utf16Units: 3, codePoints: 2 });
    expect(measured.bytes.snapshot).toBe(2);
    expect(measured.bytes.schema).toBeGreaterThan(1000);
    expect(measured.tokenMethod).toBe("gemini-2.5-flash-lite:UNVERIFIED");
  });
  it("ordinary_flows_fit_or_block", () => {
    expect(ConversationInterpretationSchema.safeParse(output).success).toBe(true);
    const wire = serializeContextRequest(input);
    expect(wire.messages).toHaveLength(2);
    const measured = measureEnvelope(input, "{}", JSON.stringify(output));
    expect(measured.admitted).toBe(false);
    expect(measured.reasons).toEqual(["TOKEN_BOUND_UNVERIFIED"]);
  });
  it("oversize_never_clips", () => {
    const tooLong: ContextInput = { ...input, turns: [{ role: "USER", text: "ế".repeat(1801) }] };
    const before = JSON.stringify(tooLong);
    expect(measureEnvelope(tooLong, "{}").reasons).toContain("SEMANTIC_INPUT_TOO_LONG");
    expect(JSON.stringify(tooLong)).toBe(before);
  });
  it("truncated_patch_never_admitted", () => {
    const measured = measureEnvelope(input, "{}", JSON.stringify(output).slice(0, -1));
    expect(measured.admitted).toBe(false);
    expect(measured.reasons).toContain("OUTPUT_JSON_INVALID");
  });
  it("schema_rejects_duplicate_unknown_wrongly_typed_or_authorizing_changes", () => {
    expect(ConversationInterpretationSchema.safeParse({ ...output, changes: [...output.changes, ...output.changes] }).success).toBe(false);
    expect(ConversationInterpretationSchema.safeParse({ ...output, confirmed: true }).success).toBe(false);
    expect(ConversationInterpretationSchema.safeParse({ ...output, changes: [{ ...output.changes[0], field: "reminderTime" }] }).success).toBe(false);
  });
});
