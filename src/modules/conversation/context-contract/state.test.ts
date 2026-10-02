import { describe, expect, expectTypeOf, it } from "vitest";
import { confirmationFixture } from "./confirmation-test-support";
import { SLOT_NAMES } from "./contracts";
import * as stateCodec from "./state";
import { CanonicalDetailsV1Schema, ContextObservationBindingSchema, ContextSnapshotV1Schema, decodeContextSnapshot, encodeContextSnapshot, type ContextObservation, type ContextSlots, type ContextSnapshotV1, type ControlAuthority } from "./state";

const at = "2026-09-28T03:00:00.000Z";
const expires = "2026-09-28T03:10:00.000Z";
const order = { receivedAt: at, rowid: 1 };
const scope = { ownerId: "owner", chatIdentityId: "identity", workspaceId: "workspace", connectionId: "connection", chatId: "chat" };
function snapshot() {
  return {
    schemaVersion: "calenote-context-state-1", id: "context", scope,
    inbound: { id: "inbound", ...order, claimMarker: "claim" }, requestId: "request", contextRevision: 1, draftRevision: 1, lifecycle: "CLARIFYING",
    slots: Object.fromEntries(SLOT_NAMES.map(field => [field, { state: "MISSING", value: null, fact: null, evidence: [], provenance: null, resolution: null, proposalRevision: 1 }])),
    facts: [], pendingReminderQuestion: null, pendingQueryQuestion: null, ambiguities: [],
    transcript: [{ id: "turn", role: "USER", text: "nhắc tôi", receivedAt: at, kind: "RECEIVED", deliveryState: "RECEIVED", messageRef: "message", semanticView: "nhắc tôi", controlSpans: [], sourceMap: { normalizationVersion: "nfc-codepoint-v1", sourceCodePoints: 8, viewCodePoints: 8, segments: [{ sourceStart: 0, sourceEnd: 8, viewStart: 0, viewEnd: 8, kind: "UNCHANGED", sourceStride: 1, viewStride: 1 }] } }],
    pendingDecision: null, previewReceipt: null, controlRegistry: [], modelAttemptBinding: null, lastTerminalOutcome: null,
    createdAt: at, idleExpiresAt: "2026-09-28T03:30:00.000Z", absoluteExpiresAt: "2026-09-28T05:00:00.000Z", draftCreatedAt: at, draftExpiresAt: expires, capabilityVersion: "capabilities-1",
  };
}
const details = { schemaVersion: "calenote-reminder-details-1", location: "Quang Trung", notes: "giấy tờ", eventDate: "2026-10-11", eventTime: "08:00", calendarProvenance: { calendar: "GREGORIAN", sourceDate: { kind: "CIVIL_DATE", calendar: "GREGORIAN", day: 11, month: 10, year: null, leapMonth: null }, provenance: { kind: "DERIVED_POLICY", policyVersion: "year-1", dependencies: ["eventDate"], referenceTime: at } }, resolutionVersion: "resolution-1" };

describe("internal application state", () => {
  it("state2_roundtrips_new_and_replace_candidates", () => {
    expect(stateCodec).toHaveProperty("ContextSnapshotV2Schema");
    expect(stateCodec).toHaveProperty("encodeContextSnapshotV2");
    expect(stateCodec).toHaveProperty("decodeContextSnapshotV2");
    const proposal = { schemaVersion: "calenote-context-3", intent: "CREATE_REMINDER", requestTarget: { kind: "NEW", evidence: [{ kind: "USER_QUOTE", turn: 0, quote: "nhắc tôi", occurrence: 1 }] }, changes: [{ field: "title", operation: "REPLACE", value: "nhắc tôi", evidence: [{ kind: "USER_QUOTE", turn: 0, quote: "nhắc tôi", occurrence: 1 }] }], query: null, uncertainties: [] };
    const source = { kind: "USER_QUOTE", sourceTurnId: "turn", sourceMapTurnId: "turn", quote: "nhắc tôi", occurrence: 1, sourceSpan: { start: 0, end: 8 }, viewSpan: { start: 0, end: 8 }, normalizationVersion: "nfc-codepoint-v1" };
    const value = { ...snapshot(), schemaVersion: "calenote-context-state-2", pendingSemanticCandidate: null,
      pendingDecision: { decisionId: "decision", kind: "REPLACE_PENDING", target: { ownerId: "owner", chatIdentityId: "identity", chatId: "chat", requestId: "request", proposalId: "proposal" }, questionId: "question", previewId: null, draftRevision: 1, contextRevision: 1, issuedAfterInbound: order, deliveryState: "SENT", expiresAt: expires, acceptedReplies: ["có"], replyReference: null, tokenHandle: null,
        candidate: { proposalId: "proposal", proposalRevision: 1, proposal, sourceEvidence: [source], evidenceIndex: [{ field: "title", evidence: [source] }], createdAt: at, expiresAt: expires } } };
    const parsed = stateCodec.ContextSnapshotV2Schema.parse(value);
    const encoded = stateCodec.encodeContextSnapshotV2(parsed);
    expect(stateCodec.decodeContextSnapshotV2(encoded)).toEqual(parsed);
    expect(() => decodeContextSnapshot(encoded)).toThrow();
    expect(() => stateCodec.decodeContextSnapshotV2(encodeContextSnapshot(snapshot()))).toThrow();
    expect(ContextSnapshotV1Schema.safeParse({ ...snapshot(), pendingDecision: value.pendingDecision }).success).toBe(false);
    expect(stateCodec.ContextSnapshotV2Schema.safeParse({ ...value, pendingDecision: { ...value.pendingDecision, candidate: { ...value.pendingDecision.candidate, proposal: { ...proposal, dialogueAct: "START_NEW" } } } }).success).toBe(false);
  });
  it("unresolved_candidate_is_nonapprovable_and_revision_bound", () => {
    const source = { kind: "USER_QUOTE", sourceTurnId: "turn", sourceMapTurnId: "turn", quote: "nhắc tôi", occurrence: 1, sourceSpan: { start: 0, end: 8 }, viewSpan: { start: 0, end: 8 }, normalizationVersion: "nfc-codepoint-v1" };
    const value = { ...snapshot(), schemaVersion: "calenote-context-state-2", pendingSemanticCandidate: {
      proposalId: "candidate", proposalRevision: 1, baseContextRevision: 1, questionId: "operation-question", sourceEvidence: [source], evidenceIndex: [], createdAt: at, expiresAt: expires,
      proposal: { schemaVersion: "calenote-context-3", intent: "CREATE_REMINDER", requestTarget: { kind: "UNRESOLVED", evidence: [{ kind: "USER_QUOTE", turn: 0, quote: "nhắc tôi", occurrence: 1 }] }, changes: [], query: null, uncertainties: [] },
    }, pendingReminderQuestion: { questionId: "operation-question", text: "Nhắc nào?", scope: "REMINDER", field: "operation", decisionKind: null, reason: "AMBIGUOUS", noProgressCount: 0, deliveryState: "SENT", issuedAfterOrder: order } };
    expect(stateCodec.ContextSnapshotV2Schema.safeParse(value).success).toBe(true);
    for (const patch of [{ baseContextRevision: 2 }, { questionId: "old" }, { acceptedReplies: ["ok"] }, { tokenHandle: "CN-x" }, { expiresAt: "2026-09-28T03:11:00.000Z" }, { sourceEvidence: [{ ...source, quote: "missing" }] }]) {
      expect(stateCodec.ContextSnapshotV2Schema.safeParse({ ...value, pendingSemanticCandidate: { ...value.pendingSemanticCandidate, ...patch } }).success).toBe(false);
    }
    expect(stateCodec.ContextSnapshotV2Schema.safeParse({ ...value, lifecycle: "CANCELLED" }).success).toBe(false);
    const missingOriginal = structuredClone(value); missingOriginal.pendingSemanticCandidate.proposal.requestTarget.evidence[0].quote = "forged";
    expect(stateCodec.ContextSnapshotV2Schema.safeParse(missingOriginal).success).toBe(false);
    const wrongOccurrence = structuredClone(value); wrongOccurrence.pendingSemanticCandidate.sourceEvidence[0].occurrence = 2; wrongOccurrence.pendingSemanticCandidate.proposal.requestTarget.evidence[0].occurrence = 2;
    expect(stateCodec.ContextSnapshotV2Schema.safeParse(wrongOccurrence).success).toBe(false);
    const wrongMap = structuredClone(value);
    wrongMap.transcript[0] = { ...wrongMap.transcript[0], text: "nhắc tôi nhắc tôi", semanticView: "nhắc tôi nhắc tôi", sourceMap: { ...wrongMap.transcript[0].sourceMap, sourceCodePoints: 17, viewCodePoints: 17, segments: [{ sourceStart: 0, sourceEnd: 17, viewStart: 0, viewEnd: 17, kind: "UNCHANGED", sourceStride: 1, viewStride: 1 }] } };
    wrongMap.pendingSemanticCandidate.sourceEvidence[0].sourceSpan = { start: 9, end: 17 };
    expect(stateCodec.ContextSnapshotV2Schema.safeParse(wrongMap).success).toBe(false);
    const futureQuestion=structuredClone(value);futureQuestion.pendingReminderQuestion.issuedAfterOrder.rowid=2;
    expect(stateCodec.ContextSnapshotV2Schema.safeParse(futureQuestion).success).toBe(false);
  });
  it("state2_capacity_and_corruption_never_truncate_sources", () => {
    const state=stateCodec.ContextSnapshotV2Schema.parse({ ...snapshot(), schemaVersion: "calenote-context-state-2", pendingSemanticCandidate: null });
    const encoded=stateCodec.encodeContextSnapshotV2(state);
    for(const bad of [encoded+" ","{}","x".repeat(16385)])expect(()=>stateCodec.decodeContextSnapshotV2(bad)).toThrow();
    const huge=structuredClone(state); huge.transcript.push({ ...huge.transcript[0], id:"assistant",role:"ASSISTANT",kind:"NOTICE",deliveryState:"SENT",text:"x".repeat(16384),semanticView:"x".repeat(16384),sourceMap:{normalizationVersion:"nfc-codepoint-v1",sourceCodePoints:16384,viewCodePoints:16384,segments:[{sourceStart:0,sourceEnd:16384,viewStart:0,viewEnd:16384,kind:"UNCHANGED",sourceStride:1,viewStride:1}]} });
    const full=stateCodec.encodeContextSnapshotV2(huge);
    expect(new TextEncoder().encode(full).length).toBeGreaterThan(16384);
    expect(()=>stateCodec.decodeContextSnapshotV2(full)).toThrow("storage limit");
    expect(huge.transcript[0]).toEqual(state.transcript[0]);
  });
  it("prepared_save_decision_is_inert_and_matches_its_current_outbound",async()=>{
    const f=await confirmationFixture(),s=f.snapshot,outbound=s.transcript.at(-1)!;
    s.pendingDecision!.deliveryState="UNCERTAIN";s.pendingDecision!.replyReference=null;
    s.previewReceipt!.deliveryState="UNCERTAIN";s.previewReceipt!.replyReference=null;
    outbound.deliveryState="UNCERTAIN";outbound.messageRef=null;
    expect(ContextSnapshotV1Schema.safeParse(s).success).toBe(true);
    expect(decodeContextSnapshot(encodeContextSnapshot(s))).toEqual(s);
    for(const field of ["pendingDecision","previewReceipt"] as const){
      const mismatched=structuredClone(s);mismatched[field]!.deliveryState="SENT";
      expect(ContextSnapshotV1Schema.safeParse(mismatched).success).toBe(false);
    }
    const wrongOutbound=structuredClone(s);wrongOutbound.transcript.at(-1)!.id="other-preview";
    expect(ContextSnapshotV1Schema.safeParse(wrongOutbound).success).toBe(false);
    const sentOutbound=structuredClone(s);sentOutbound.transcript.at(-1)!.deliveryState="SENT";
    expect(ContextSnapshotV1Schema.safeParse(sentOutbound).success).toBe(false);
    const failed=structuredClone(s);failed.pendingDecision!.deliveryState="FAILED";failed.previewReceipt!.deliveryState="FAILED";failed.transcript.at(-1)!.deliveryState="FAILED";
    expect(ContextSnapshotV1Schema.safeParse(failed).success).toBe(false);
  });
  it("observation_is_store_opaque_and_chat_web_authority_stays_separate", () => {
    expectTypeOf<ReturnType<typeof ContextObservationBindingSchema.parse>>().not.toExtend<ContextObservation>();
    expectTypeOf<ContextSlots["title"]["value"]>().toEqualTypeOf<string | null>();
    expectTypeOf<Extract<ContextSnapshotV1["facts"][number], { field: "title" }>["value"]>().toEqualTypeOf<string>();
    type Web = Extract<ControlAuthority, { kind: "WEB" }>;
    expectTypeOf<Web>().not.toExtend<Extract<ControlAuthority, { kind: "CHAT" }>>();
    const binding = { scope, inbound: { id: "inbound", ...order, claimMarker: "claim" }, observed: { presence: "ABSENT" }, lastTerminalOutcome: null };
    expect(ContextObservationBindingSchema.safeParse(binding).success).toBe(true);
    expect(ContextObservationBindingSchema.safeParse({ ...binding, observed: { presence: "PRESENT", contextId: "context", contextRevision: 1 } }).success).toBe(true);
    expect(ContextObservationBindingSchema.safeParse({ ...binding, observed: { presence: "ABSENT", contextRevision: 1 } }).success).toBe(false);
  });
  it("context_and_detail_versions_distinct", () => {
    expect(ContextSnapshotV1Schema.safeParse(snapshot()).success).toBe(true);
    expect(CanonicalDetailsV1Schema.safeParse(details).success).toBe(true);
    expect(ContextSnapshotV1Schema.safeParse(details).success).toBe(false);
    expect(CanonicalDetailsV1Schema.safeParse({ ...details, schemaVersion: "calenote-context-state-1" }).success).toBe(false);
    expect(CanonicalDetailsV1Schema.safeParse({ ...details, title: "no packed title" }).success).toBe(false);
  });
  it("preserves_all_thirteen_typed_slots_and_rejects_wrong_slot_values", () => {
    const state = snapshot();
    expect(ContextSnapshotV1Schema.safeParse(state).success).toBe(true);
    delete state.slots.endDate;
    expect(ContextSnapshotV1Schema.safeParse(state).success).toBe(false);
    const resolved = { state: "RESOLVED", value: "Quang Trung", fact: "f1", evidence: [{ kind: "USER_QUOTE", sourceTurnId: "turn", sourceMapTurnId: "turn", quote: "nhắc tôi", occurrence: 1, sourceSpan: { start: 0, end: 8 }, viewSpan: { start: 0, end: 8 }, normalizationVersion: "nfc-codepoint-v1" }], provenance: { kind: "EXPLICIT_USER" }, resolution: { method: "EXPLICIT_OPERAND", version: "resolve-1", referenceTime: at, timezone: "Asia/Ho_Chi_Minh", dependencies: [] }, proposalRevision: 1 };
    expect(ContextSnapshotV1Schema.safeParse({ ...snapshot(), slots: { ...snapshot().slots, location: resolved } }).success).toBe(true);
    expect(ContextSnapshotV1Schema.safeParse({ ...snapshot(), slots: { ...snapshot().slots, occurrenceCount: resolved } }).success).toBe(false);
    expect(ContextSnapshotV1Schema.safeParse({ ...snapshot(), slots: { ...snapshot().slots, location: { ...resolved, state: "MISSING" } } }).success).toBe(false);
    expect(ContextSnapshotV1Schema.safeParse({ ...snapshot(), slots: { ...snapshot().slots, location: { ...resolved, provenance: null } } }).success).toBe(false);
  });
  it("strict_details_reject_invalid_dates_times_calendar_mismatch_and_metadata", () => {
    expect(CanonicalDetailsV1Schema.safeParse(details).success).toBe(true);
    for (const extra of [{ eventDate: "2026-02-30" }, { eventTime: "25:00" }, { location: "x".repeat(301) }, { resolutionVersion: "" }, { confirmed: true }, { calendarProvenance: { ...details.calendarProvenance, calendar: "LUNAR_VN" } }]) expect(CanonicalDetailsV1Schema.safeParse({ ...details, ...extra }).success).toBe(false);
  });
  it("lifetime_revision_scope_and_attempt_bounds_fail_closed", () => {
    expect(ContextSnapshotV1Schema.safeParse(snapshot()).success).toBe(true);
    for (const extra of [{ contextRevision: 0 }, { scope: { ...scope, ownerId: "" } }, { idleExpiresAt: "2026-09-28T04:00:00.000Z" }, { absoluteExpiresAt: "2026-09-28T06:00:00.000Z" }, { draftExpiresAt: "2026-09-28T03:11:00.000Z" }, { modelAttemptBinding: { contextRevision: 1, sourceInboundId: "inbound" } }, { freeFormSummary: "invented" }]) expect(ContextSnapshotV1Schema.safeParse({ ...snapshot(), ...extra }).success).toBe(false);
  });
  it("source_maps_receipts_and_role_delivery_are_strict", () => {
    const state = snapshot();
    expect(ContextSnapshotV1Schema.safeParse(state).success).toBe(true);
    for (const extra of [{ deliveryState: "SENT" }, { sourceMap: { ...state.transcript[0].sourceMap, sourceCodePoints: 7 } }, { sourceMap: { ...state.transcript[0].sourceMap, segments: [] } }, { semanticView: "e\u0301" }, { controlSpans: [{ start: 9, end: 12, handle: "CN-1" }] }]) expect(ContextSnapshotV1Schema.safeParse({ ...state, transcript: [{ ...state.transcript[0], ...extra }] }).success).toBe(false);
    expect(ContextSnapshotV1Schema.safeParse({ ...state, transcript: Array.from({ length: 7 }, (_, i) => ({ ...state.transcript[0], id: `t${i}` })) }).success).toBe(false);
  });
  it("decision_binding_is_owner_revision_and_target_scoped", () => {
    const state = snapshot();
    const decision = { decisionId: "decision", kind: "RESUME_PENDING", target: { ownerId: scope.ownerId, chatIdentityId: scope.chatIdentityId, chatId: scope.chatId, requestId: "request", proposalId: null }, questionId: "question", previewId: null, draftRevision: 1, contextRevision: 1, issuedAfterInbound: order, deliveryState: "SENT", expiresAt: expires, acceptedReplies: ["có", "ok", "1"], replyReference: null, tokenHandle: null, candidate: null };
    expect(ContextSnapshotV1Schema.safeParse({ ...state, pendingDecision: decision }).success).toBe(true);
    for (const extra of [{ kind: "SAVE_PREVIEW" }, { contextRevision: 2 }, { expiresAt: "2026-09-28T03:11:00.000Z" }, { target: { ...decision.target, ownerId: "other" } }, { acceptedReplies: ["có nhưng"] }, { candidate: { proposal: {} } }]) expect(ContextSnapshotV1Schema.safeParse({ ...state, pendingDecision: { ...decision, ...extra } }).success).toBe(false);
    expect(ContextSnapshotV1Schema.safeParse({ ...state, lifecycle: "COMPLETED", pendingDecision: decision }).success).toBe(false);
    expect(ContextSnapshotV1Schema.safeParse({ ...state, pendingDecision: { ...decision, issuedAfterInbound: { receivedAt: "2026-09-28T03:01:00.000Z", rowid: 2 } } }).success).toBe(false);
  });
});

describe("lossless runtime snapshot representation", () => {
  it("roundtrips_sources_transformed_views_and_reserved_looking_strings", () => {
    const state = snapshot();
    const encoded = encodeContextSnapshot(state);
    expect(JSON.parse(encoded).encoding).toBe("calenote-context-storage-2");
    expect(decodeContextSnapshot(encoded)).toEqual(state);
    expect(JSON.stringify(state)).toContain("nhắc tôi");
    const transformed = { ...state, transcript: [{ ...state.transcript[0], text: "e\u0301😀CN-x", semanticView: "é😀[CONTROL]", controlSpans: [{ start: 3, end: 7, handle: "CN-x" }], sourceMap: { normalizationVersion: "nfc-codepoint-v1", sourceCodePoints: 7, viewCodePoints: 11, segments: [
      { sourceStart: 0, sourceEnd: 2, viewStart: 0, viewEnd: 1, kind: "NFC_COMPOSITION_RUN", sourceStride: 2, viewStride: 1 },
      { sourceStart: 2, sourceEnd: 3, viewStart: 1, viewEnd: 2, kind: "UNCHANGED", sourceStride: 1, viewStride: 1 },
      { sourceStart: 3, sourceEnd: 7, viewStart: 2, viewEnd: 11, kind: "CONTROL_REPLACEMENT", sourceStride: 0, viewStride: 0 },
    ] } }], controlRegistry: [{ handle: "CN-x", kind: "TOKEN", ownerId: scope.ownerId, chatIdentityId: scope.chatIdentityId, chatId: scope.chatId, decisionId: "d1", contextRevision: 1, draftRevision: 1, expiresAt: expires }] };
    expect(decodeContextSnapshot(encodeContextSnapshot(transformed))).toEqual(transformed);
  });
  it("decoder_rejects_forged_references_unknown_fields_and_oversize_envelopes", () => {
    const good = encodeContextSnapshot(snapshot());
    expect(decodeContextSnapshot(good)).toEqual(snapshot());
    for (const bad of [{ encoding: "calenote-context-storage-1", strings: [], snapshot: { $s: 0 } }, { ...JSON.parse(good), extra: true }, { encoding: "other", strings: [], snapshot: {} }]) expect(() => decodeContextSnapshot(JSON.stringify(bad))).toThrow();
    expect(() => decodeContextSnapshot(" ".repeat(16385) + good)).toThrow();
  });
  it("reads legacy persisted payloads without migrating them and refuses compact key collisions", () => {
    const state = snapshot();
    const legacy = JSON.stringify({ encoding: "calenote-context-storage-1", strings: [], snapshot: state });
    expect(decodeContextSnapshot(legacy)).toEqual(state);
    expect(JSON.parse(legacy).encoding).toBe("calenote-context-storage-1");
    const good = JSON.parse(encodeContextSnapshot(state));
    for (const key of ["$kzz", "normalizationVersion", "schemaVersion"]) {
      const bad = structuredClone(good);
      bad.snapshot[key] = "collision";
      expect(() => decodeContextSnapshot(JSON.stringify(bad))).toThrow();
    }
  });
  it("compact decoder rejects depth bombs, reference collisions and unknown dictionary indices", () => {
    let nested: unknown = null;
    for (let i = 0; i < 34; i++) nested = [nested];
    const envelope = (snapshot: unknown, strings: string[] = []) => JSON.stringify({ encoding: "calenote-context-storage-2", strings, snapshot });
    expect(() => decodeContextSnapshot(envelope(nested))).toThrow("Excessive encoded structure");
    for (const invalid of [{ $kzz: 1 }, { $s: 0, $k0: 1 }, { $s: 0.5 }, { $s: -1 }, { $s: 4 }]) expect(() => decodeContextSnapshot(envelope(invalid, ["text"]))).toThrow();
    expect(() => decodeContextSnapshot(envelope(Array.from({ length: 1000 }, () => ({ $s: 0 })), ["x".repeat(5000)]))).toThrow("Excessive decoded text");
  });
  it("duplicate JSON member names cannot hide a corrupt version or compact field", () => {
    const encoded = encodeContextSnapshot(snapshot());
    const duplicateVersion = encoded.replace('{"encoding":', '{"encoding":"unrecognized","encoding":');
    expect(() => decodeContextSnapshot(duplicateVersion)).toThrow("Noncanonical encoded JSON");
    const duplicateKey = encoded.replace('"$k1a":', '"$k1a":"corrupt","$k1a":');
    expect(duplicateKey).not.toBe(encoded);
    expect(() => decodeContextSnapshot(duplicateKey)).toThrow("Noncanonical encoded JSON");
  });
  it("retains six USER and six ASSISTANT original Unicode texts and complete maps losslessly", () => {
    const base = snapshot();
    const texts = ["e\u0301😀 répété répété", "ế".repeat(1800), "Địa điểm " + "ế".repeat(290), "🧾 ghi chú " + "ế".repeat(900), "Giữ nguyên.", "Đổi lúc 9h."];
    const turns = texts.flatMap((text, i) => [
      { ...base.transcript[0], id: `user-${i}`, text, semanticView: text.normalize("NFC"), sourceMap: { normalizationVersion: "nfc-codepoint-v1", sourceCodePoints: [...text].length, viewCodePoints: [...text.normalize("NFC")].length, segments: i === 0 ? [
        { sourceStart: 0, sourceEnd: 2, viewStart: 0, viewEnd: 1, kind: "NFC_COMPOSITION_RUN", sourceStride: 2, viewStride: 1 },
        { sourceStart: 2, sourceEnd: [...text].length, viewStart: 1, viewEnd: [...text.normalize("NFC")].length, kind: "UNCHANGED", sourceStride: 1, viewStride: 1 },
      ] : [{ sourceStart: 0, sourceEnd: [...text].length, viewStart: 0, viewEnd: [...text].length, kind: "UNCHANGED", sourceStride: 1, viewStride: 1 }] } },
      { ...base.transcript[0], id: `assistant-${i}`, role: "ASSISTANT", kind: "CLARIFICATION", deliveryState: "SENT" },
    ]);
    const state = ContextSnapshotV1Schema.parse({ ...base, transcript: turns });
    const decoded = decodeContextSnapshot(encodeContextSnapshot(state));
    expect(decoded).toEqual(state);
    expect(decoded.transcript.filter(t => t.role === "USER").map(t => t.text)).toEqual(texts);
    expect(decoded.transcript[0].sourceMap.segments[0]).toEqual({ sourceStart: 0, sourceEnd: 2, viewStart: 0, viewEnd: 1, kind: "NFC_COMPOSITION_RUN", sourceStride: 2, viewStride: 1 });
  });
  it("decoder_rejects_unreferenced_strings_noncanonical_refs_and_expansion_bombs", () => {
    const good = JSON.parse(encodeContextSnapshot(snapshot()));
    good.strings.push("unused injected text");
    expect(() => decodeContextSnapshot(JSON.stringify(good))).toThrow();
    for (const $s of [-1, 0.5, 9999]) expect(() => decodeContextSnapshot(JSON.stringify({ encoding: "calenote-context-storage-1", strings: ["x"], snapshot: { $s } }))).toThrow();
    expect(() => decodeContextSnapshot(JSON.stringify({ encoding: "calenote-context-storage-1", strings: ["x"], snapshot: { $s: 0, value: "collision" } }))).toThrow();
    expect(() => decodeContextSnapshot(JSON.stringify({ encoding: "calenote-context-storage-1", strings: ["x".repeat(5000)], snapshot: Array.from({ length: 1000 }, () => ({ $s: 0 })) }))).toThrow("Excessive decoded text");
  });
  it("valid_repeated_query_evidence_does_not_create_a_smaller_implicit_storage_limit", () => {
    const base = snapshot(), text = "ế".repeat(2000);
    const state = { ...base, transcript: [{ ...base.transcript[0], text, semanticView: text, sourceMap: { normalizationVersion: "nfc-codepoint-v1", sourceCodePoints: 2000, viewCodePoints: 2000, segments: [{ sourceStart: 0, sourceEnd: 2000, viewStart: 0, viewEnd: 2000, kind: "UNCHANGED", sourceStride: 1, viewStride: 1 }] } }], facts: Array.from({ length: 15 }, (_, i) => ({ alias: `f${i + 1}`, scope: "QUERY", field: "queryRange", value: { kind: "LIST", period: { kind: "MONTH", offset: 0 }, statusScope: "DEFAULT", evidence: Array.from({ length: 3 }, () => ({ kind: "USER_QUOTE", turn: 0, quote: text, occurrence: 1 })) }, provenance: { kind: "EXPLICIT_USER" }, sourceReferenceTime: at, dependencies: [], evidenceSlot: null })) };
    const encoded = encodeContextSnapshot(state);
    expect(new TextEncoder().encode(encoded).byteLength).toBeLessThanOrEqual(16384);
    expect(decodeContextSnapshot(encoded)).toEqual(state);
  });
  it("source_evidence_cannot_point_into_different_or_removed_source_segments", () => {
    const state = snapshot();
    const evidence = { kind: "USER_QUOTE", sourceTurnId: "turn", sourceMapTurnId: "turn", quote: "tôi", occurrence: 1, sourceSpan: { start: 0, end: 3 }, viewSpan: { start: 5, end: 8 }, normalizationVersion: "nfc-codepoint-v1" };
    const slot = { ...state.slots.notes, state: "RESOLVED", value: "tôi", fact: "f1", evidence: [evidence], provenance: { kind: "EXPLICIT_USER" }, resolution: { method: "EXPLICIT_OPERAND", version: "r1", referenceTime: at, timezone: "Asia/Ho_Chi_Minh", dependencies: [] } };
    expect(ContextSnapshotV1Schema.safeParse({ ...state, slots: { ...state.slots, notes: slot } }).success).toBe(false);
    expect(ContextSnapshotV1Schema.safeParse({ ...state, slots: { ...state.slots, notes: { ...slot, evidence: [{ ...evidence, sourceSpan: evidence.viewSpan }] } } }).success).toBe(true);
  });
  it("complete_encoded_envelope_obeys_exact_16384_byte_boundary", () => {
    const base = snapshot();
    const candidate = (n: number) => ({ ...base, transcript: [...base.transcript, { ...base.transcript[0], id: "assistant", role: "ASSISTANT", kind: "NOTICE", deliveryState: "SENT", text: "x".repeat(n), semanticView: "x".repeat(n), sourceMap: { normalizationVersion: "nfc-codepoint-v1", sourceCodePoints: n, viewCodePoints: n, segments: [{ sourceStart: 0, sourceEnd: n, viewStart: 0, viewEnd: n, kind: "UNCHANGED", sourceStride: 1, viewStride: 1 }] } }] });
    let low = 1, high = 16000;
    while (low < high) { const n = Math.ceil((low + high) / 2); if (new TextEncoder().encode(encodeContextSnapshot(candidate(n))).byteLength <= 16384) low = n; else high = n - 1; }
    const exact = encodeContextSnapshot(candidate(low)), overflow = encodeContextSnapshot(candidate(low + 1));
    expect(new TextEncoder().encode(exact).byteLength).toBe(16384);
    expect(new TextEncoder().encode(overflow).byteLength).toBe(16385);
    expect(decodeContextSnapshot(exact)).toEqual(candidate(low));
    expect(() => decodeContextSnapshot(overflow)).toThrow("storage limit");
    expect(base.transcript[0].text).toBe("nhắc tôi");
    expect(base.draftExpiresAt).toBe(expires);
  });
});
