import { describe, expect, it } from "vitest";
import { buildLegacyV2ContextInput as buildContextInput } from "./context";
import * as contextBuilder from "./context";
import { at, chat, message, observation, snapshot, turn, withNotes } from "./context-test-fixtures";
import { serializeLegacyV2ContextRequestReference as serializeContextRequest } from "./wire";
import { ContextSnapshotV1Schema, encodeContextSnapshot } from "./state";
import { ContextSnapshotV2Schema, encodeContextSnapshotV2 } from "./state";

describe("bounded private context", () => {
  it("state_capacity_retains_evidence_or_refuses", () => {
    expect(contextBuilder).toHaveProperty("buildContextInputV2");
    const legacy=withNotes("mang giấy tờ"),state=ContextSnapshotV2Schema.parse({ ...legacy, schemaVersion: "calenote-context-state-2", pendingSemanticCandidate: null }),msg=message();
    const prior=encodeContextSnapshotV2(state);
    const result=contextBuilder.buildContextInputV2({message:msg,context:chat,snapshot:state,observation:observation(legacy,msg)});
    expect(result.status).toBe("READY");
    if(result.status==="READY") {
      expect(result.input.schemaVersion).toBe("calenote-context-input-2");
      expect(result.candidateSnapshot.schemaVersion).toBe("calenote-context-state-2");
      expect(result.candidateSnapshot.slots.notes.evidence).toEqual(state.slots.notes.evidence);
      expect(result.candidateSnapshot.draftExpiresAt).toBe(state.draftExpiresAt);
      expect(result.measurement.admitted).toBe(false);
      expect(result.measurement.reasons).toEqual(["TOKEN_BOUND_UNVERIFIED"]);
    }
    expect(encodeContextSnapshotV2(state)).toBe(prior);
    state.transcript.push({...turn("x".repeat(11000),"assistant"),role:"ASSISTANT",kind:"NOTICE",deliveryState:"SENT"});
    const full=encodeContextSnapshotV2(state),large=message("ế".repeat(1800));
    expect(new TextEncoder().encode(full).length).toBeLessThanOrEqual(16384);
    expect(contextBuilder.buildContextInputV2({message:large,context:chat,snapshot:state,observation:observation(legacy,large)})).toEqual({status:"REFUSED",reason:"CONTEXT_SNAPSHOT_TOO_LARGE"});
    expect(encodeContextSnapshotV2(state)).toBe(full);
  });
  it("successor_input_preserves_typed_operation_ambiguity_and_bound_candidate",()=>{
    const legacy=snapshot(),msg=message("Tiếp tục yêu cầu này.");
    const evidence={kind:"USER_QUOTE",sourceTurnId:"old",sourceMapTurnId:"old",quote:"nhắc tôi",occurrence:1,sourceSpan:{start:0,end:8},viewSpan:{start:0,end:8},normalizationVersion:"nfc-codepoint-v1"};
    const refs=[{kind:"USER_QUOTE",turn:0,quote:"nhắc tôi",occurrence:1}];
    const state=ContextSnapshotV2Schema.parse({...legacy,schemaVersion:"calenote-context-state-2",
      pendingReminderQuestion:{questionId:"operation",text:"Yêu cầu nào?",scope:"REMINDER",field:"operation",decisionKind:null,reason:"AMBIGUOUS",noProgressCount:0,deliveryState:"SENT",issuedAfterOrder:{receivedAt:at,rowid:1}},
      ambiguities:[{field:"operation",reason:"AMBIGUOUS",alternatives:[{value:"CURRENT",evidence:refs},{value:"NEW",evidence:refs}]}],
      pendingSemanticCandidate:{proposalId:"candidate",proposalRevision:1,baseContextRevision:1,questionId:"operation",sourceEvidence:[evidence],evidenceIndex:[],createdAt:at,expiresAt:legacy.draftExpiresAt,proposal:{schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"UNRESOLVED",evidence:refs},changes:[],query:null,uncertainties:[]}},
    });
    const result=contextBuilder.buildContextInputV2({message:msg,context:chat,snapshot:state,observation:observation(legacy,msg)});
    expect(result.status,JSON.stringify(result)).toBe("READY");
    if(result.status==="READY"){
      expect(result.input.ambiguities).toEqual([{field:"operation",reason:"AMBIGUOUS",alternatives:[{value:"CURRENT",evidence:refs},{value:"NEW",evidence:refs}]}]);
      expect(result.candidateSnapshot.pendingSemanticCandidate).toEqual(state.pendingSemanticCandidate);
      expect(result.input).not.toHaveProperty("pendingSemanticCandidate");
    }
    expect(buildContextInput({message:msg,context:chat,snapshot:state as never,observation:observation(legacy,msg)})).toEqual({status:"REFUSED",reason:"CONTEXT_INVALID"});
    expect(contextBuilder.buildContextInputV2({message:msg,context:chat,snapshot:legacy as never,observation:observation(legacy,msg)})).toEqual({status:"REFUSED",reason:"CONTEXT_INVALID"});
  });
  it("controls_absent_in_every_provider_string", () => {
    const state = withNotes("mang CN-AbC123 giấy tờ");
    state.slots.notes.evidence = [{ ...state.slots.notes.evidence[0], quote: "giấy tờ", sourceSpan: { start: 15, end: 22 }, viewSpan: { start: 15, end: 22 } }];
    state.controlRegistry = [{ handle: "CN-AbC123", kind: "TOKEN", ownerId: "owner", chatIdentityId: "identity", chatId: "chat", decisionId: "d1", contextRevision: 1, draftRevision: 1, expiresAt: "2026-09-28T03:10:00.000Z" }];
    state.pendingReminderQuestion = { questionId: "question", text: "Nhắc lúc nào CN-AbC123?", scope: "REMINDER", field: "reminderTime", reason: "MISSING", decisionKind: null, noProgressCount: 0, deliveryState: "SENT", issuedAfterOrder: { receivedAt: at, rowid: 1 } };
    state.ambiguities = [{ field: "location", reason: "AMBIGUOUS", alternatives: [{ value: "CN-AbC123 Quang Trung", evidence: [{ kind: "USER_QUOTE", turn: 0, quote: "giấy tờ", occurrence: 1 }] }] }];
    const msg = message("CN%2DAbC123, đổi sang 9h.");
    const result = buildContextInput({ message: msg, context: chat, snapshot: state, observation: observation(state, msg) });
    expect(result.status, JSON.stringify(result)).toBe("READY");
    if (result.status === "READY") {
      const wire = JSON.stringify(serializeContextRequest(result.input));
      expect(wire).not.toContain("CN-AbC123"); expect(wire).not.toContain("CN%2D");
      expect(result.input.activeRequest?.slots.notes.value).toBe("mang [CONTROL] giấy tờ");
      expect(result.input.turns.at(-1)?.text).toBe("[CONTROL], đổi sang 9h.");
      expect(result.candidateSnapshot.transcript[0].text).toBe("mang CN-AbC123 giấy tờ");
      expect(result.measurement.admitted).toBe(false);
      expect(result.measurement.reasons).toEqual(["TOKEN_BOUND_UNVERIFIED"]);
    }
  });
  it("never projects an internal web decline receipt into provider input", () => {
    const base = snapshot(), msg = message();
    const retained = structuredClone(base);
    retained.webDeclineReceipt = { publicId: "A".repeat(22), operationKey: "a".repeat(64), proofHash: "b".repeat(64),
      settledRevision: retained.contextRevision, settledAt: retained.inbound.receivedAt };
    const parsed = ContextSnapshotV1Schema.safeParse(retained);
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
    const ordinary = buildContextInput({ message: msg, context: chat, snapshot: base, observation: observation(base, msg) });
    const afterDecline = buildContextInput({ message: msg, context: chat, snapshot: retained, observation: observation(retained, msg) });
    expect(ordinary.status).toBe("READY"); expect(afterDecline.status, JSON.stringify(afterDecline)).toBe("READY");
    if (ordinary.status === "READY" && afterDecline.status === "READY") expect(afterDecline.input).toEqual(ordinary.input);
  });
  it.each([1799, 1800, 1801, 2000])("INPUT_%i_obeys_preprojection_length_and_preserves_state", n => {
    const state = snapshot(), prior = encodeContextSnapshot(state), msg = message("ế".repeat(n));
    const result = buildContextInput({ message: msg, context: chat, snapshot: state, observation: observation(state, msg) });
    expect(result.status).toBe(n <= 1800 ? "READY" : "REFUSED");
    if (n > 1800) expect(result).toEqual({ status: "REFUSED", reason: "SEMANTIC_INPUT_TOO_LONG" });
    expect(encodeContextSnapshot(state)).toBe(prior);
  });
  it("overflow_preserves_prior_state", () => {
    const state = snapshot(); state.transcript.push({ ...turn("x".repeat(11000), "assistant"), role: "ASSISTANT", kind: "NOTICE", deliveryState: "SENT" });
    const prior = encodeContextSnapshot(state), msg = message("ế".repeat(1800));
    expect(new TextEncoder().encode(prior).length).toBeLessThanOrEqual(16384);
    expect(buildContextInput({ message: msg, context: chat, snapshot: state, observation: observation(state, msg) })).toEqual({ status: "REFUSED", reason: "CONTEXT_SNAPSHOT_TOO_LARGE" });
    expect(encodeContextSnapshot(state)).toBe(prior);
  });
  it("failed_and_uncertain_assistant_sends_are_not_presented_as_seen", () => {
    const state = snapshot();
    state.transcript.push(...["FAILED", "UNCERTAIN", "SENT"].map((deliveryState, i) => ({ ...turn(`question ${i}`, `a${i}`), role: "ASSISTANT" as const, kind: "CLARIFICATION" as const, deliveryState: deliveryState as "FAILED" | "UNCERTAIN" | "SENT" })));
    const result = buildContextInput({ message: message(), context: chat, snapshot: state, observation: observation(state) });
    expect(result.status).toBe("READY");
    if (result.status === "READY") expect(result.input.turns.map(t => t.text)).toEqual(["nhắc tôi", "question 2", "Đổi sang 9h."]);
  });
  it("absence_is_distinct_from_failed_or_stale_observation", () => {
    const args = { message: message(), context: chat, snapshot: null, observation: observation(null) };
    const result = buildContextInput(args); expect(result.status).toBe("READY");
    if (result.status === "READY") { expect(result.input.activeRequest).toBeNull(); expect(result.input.facts).toEqual([]); }
    expect(buildContextInput({ ...args, snapshot: snapshot() }).status).toBe("REFUSED");
    expect(buildContextInput({ ...args, observation: null as never }).status).toBe("REFUSED");
    const noRequest = { ...withNotes(), lifecycle: "NONE" as const, requestId: null, draftRevision: null, draftCreatedAt: null, draftExpiresAt: null };
    expect(buildContextInput({ ...args, snapshot: noRequest, observation: observation(noRequest) }).status).toBe("REFUSED");
  });
  it("expired_terminal_scope_revision_and_out_of_order_state_refuse", () => {
    const state = snapshot(), msg = message();
    const args = { message: msg, context: chat, snapshot: state, observation: observation(state, msg) };
    expect(buildContextInput(args).status).toBe("READY");
    for (const changed of [{ ...state, scope: { ...state.scope, ownerId: "other" } }, { ...state, scope: { ...state.scope, chatId: "other" } }, { ...state, contextRevision: 2 }, { ...state, lifecycle: "CANCELLED" as const }, { ...state, draftExpiresAt: "2026-09-28T03:00:30.000Z" }]) expect(buildContextInput({ ...args, snapshot: changed }).status).toBe("REFUSED");
    const oldMessage = { ...msg, receivedAt: Date.parse(at) - 1 };
    expect(buildContextInput({ ...args, message: oldMessage, observation: observation(state, oldMessage) }).status).toBe("REFUSED");
  });
  it("seventh_user_and_seventh_assistant_refuse_without_eviction", () => {
    const state = snapshot(); state.transcript = Array.from({ length: 6 }, (_, i) => turn(`source ${i}`, `u${i}`));
    expect(buildContextInput({ message: message(), context: chat, snapshot: state, observation: observation(state) })).toEqual({ status: "REFUSED", reason: "CONTEXT_TURN_COUNT_EXCEEDED" });
    state.transcript = Array.from({ length: 7 }, (_, i) => ({ ...turn(`reply ${i}`, `a${i}`), role: "ASSISTANT", kind: "NOTICE", deliveryState: "SENT" }));
    expect(buildContextInput({ message: message(), context: chat, snapshot: state, observation: observation(state) }).status).toBe("REFUSED");
  });
  it("decomposed_and_supplementary_limits_use_nfc_utf16_before_redaction", () => {
    for (const [text, expected] of [["e\u0301".repeat(1800), "READY"], ["😀".repeat(900), "READY"], ["😀".repeat(900) + "x", "REFUSED"], ["e\u0301".repeat(1801), "REFUSED"]]) {
      const msg = message(text); expect(buildContextInput({ message: msg, context: chat, snapshot: null, observation: observation(null, msg) }).status).toBe(expected);
    }
  });
  it("query_question_priority_preserves_reminder_and_draft_expiry", () => {
    const state = withNotes(), question = { questionId: "q", text: "Khoảng nào?", reason: "MISSING" as const, decisionKind: null, noProgressCount: 0, deliveryState: "SENT" as const, issuedAfterOrder: { receivedAt: at, rowid: 1 } };
    state.pendingReminderQuestion = { ...question, scope: "REMINDER", field: "reminderTime" }; state.pendingQueryQuestion = { ...question, scope: "QUERY", field: "queryRange" };
    const result = buildContextInput({ message: message(), context: chat, snapshot: state, observation: observation(state) });
    expect(result.status).toBe("READY");
    if (result.status === "READY") { expect(result.input.pendingQuestion?.scope).toBe("QUERY"); expect(result.candidateSnapshot.draftExpiresAt).toBe(state.draftExpiresAt); expect(result.candidateSnapshot.idleExpiresAt).toBe(state.idleExpiresAt); }
  });
  it("fact_dependencies_cannot_be_cyclic_or_cross_scope", () => {
    const state = withNotes(); state.facts[0].dependencies = ["f9"];
    expect(buildContextInput({ message: message(), context: chat, snapshot: state, observation: observation(state) }).status).toBe("REFUSED");
  });
  it("retained_evidence_is_remapped_or_refused_never_lost", () => {
    const state = withNotes("mang CN-LongerToken123 giấy tờ");
    state.controlRegistry = [{ handle: "CN-LongerToken123", kind: "TOKEN", ownerId: "owner", chatIdentityId: "identity", chatId: "chat", decisionId: "d", contextRevision: 1, draftRevision: 1, expiresAt: "2026-09-28T03:10:00.000Z" }];
    const args = { message: message(), context: chat, snapshot: state, observation: observation(state) };
    expect(buildContextInput(args)).toEqual({ status: "REFUSED", reason: "RETAINED_EVIDENCE_CONTROL_CONFLICT" });
    state.slots.notes.evidence = [{ ...state.slots.notes.evidence[0], quote: "giấy tờ", sourceSpan: { start: 23, end: 30 }, viewSpan: { start: 23, end: 30 } }];
    const result = buildContextInput(args); expect(result.status).toBe("READY");
    if (result.status === "READY") { expect(result.candidateSnapshot.slots.notes.evidence[0].viewSpan).toEqual({ start: 15, end: 22 }); expect(result.candidateSnapshot.transcript[0].semanticView).toBe("mang [CONTROL] giấy tờ"); }
  });
  it("retained_query_evidence_indexes_follow_delivered_payload_roles", () => {
    const state = snapshot();
    state.transcript = [{ ...turn("not delivered", "failed"), role: "ASSISTANT", kind: "NOTICE", deliveryState: "FAILED" }, turn("tháng này", "query")];
    state.facts = [{ alias: "f9", scope: "QUERY", field: "queryRange", value: { kind: "LIST", period: { kind: "MONTH", offset: 0 }, statusScope: "DEFAULT", evidence: [{ kind: "USER_QUOTE", turn: 1, quote: "tháng này", occurrence: 1 }] }, provenance: { kind: "EXPLICIT_USER" }, sourceReferenceTime: at, dependencies: [], evidenceSlot: null }];
    const result = buildContextInput({ message: message(), context: chat, snapshot: state, observation: observation(state) }); expect(result.status).toBe("READY");
    if (result.status === "READY") { const fact = result.input.facts[0]; if (fact.scope === "QUERY") expect(fact.value.evidence[0]).toMatchObject({ turn: 0 }); }
  });
  it("unvalidated_facts_never_enter_the_provider_fact_table", () => {
    const state = withNotes();
    state.slots.notes.state = "PROPOSED";
    expect(buildContextInput({ message: message(), context: chat, snapshot: state, observation: observation(state) }).status).toBe("REFUSED");
    const queryState = snapshot();
    queryState.facts = [{ alias: "f9", scope: "QUERY", field: "queryRange", value: { kind: "LIST", period: { kind: "MONTH", offset: 0 }, statusScope: "DEFAULT", evidence: [{ kind: "USER_QUOTE", turn: 0, quote: "invented", occurrence: 1 }] }, provenance: { kind: "EXPLICIT_USER" }, sourceReferenceTime: at, dependencies: [], evidenceSlot: null }];
    expect(buildContextInput({ message: message(), context: chat, snapshot: queryState, observation: observation(queryState) }).status).toBe("REFUSED");
    const wrongReceipt = withNotes(); wrongReceipt.facts[0].sourceReferenceTime = "2026-09-28T03:00:01.000Z";
    expect(buildContextInput({ message: message(), context: chat, snapshot: wrongReceipt, observation: observation(wrongReceipt) }).status).toBe("REFUSED");
  });
  it("unknown_control_in_nested_alternative_or_pending_question_refuses", () => {
    const state = snapshot(); state.ambiguities = [{ field: "location", reason: "AMBIGUOUS", alternatives: [{ value: "CN-Unknown Quang Trung", evidence: [{ kind: "USER_QUOTE", turn: 0, quote: "nhắc tôi", occurrence: 1 }] }] }];
    expect(buildContextInput({ message: message(), context: chat, snapshot: state, observation: observation(state) }).status).toBe("REFUSED");
  });
  it("ordinary_900_codepoint_notes_and_six_user_six_assistant_candidates_fit", () => {
    const states = [withNotes("ế".repeat(900)), snapshot()];
    states[1].transcript = [...Array.from({ length: 5 }, (_, i) => turn(`USER ${i}`, `u${i}`)), ...Array.from({ length: 6 }, (_, i) => ({ ...turn(`ASSISTANT ${i}`, `a${i}`), role: "ASSISTANT" as const, kind: "NOTICE" as const, deliveryState: "SENT" as const }))];
    for (const state of states) {
      const result = buildContextInput({ message: message(), context: chat, snapshot: state, observation: observation(state) }); expect(result.status).toBe("READY");
      if (result.status === "READY") {
        expect(result.measurement.bytes.snapshot).toBeLessThanOrEqual(16384); expect(result.candidateSnapshot.slots.notes.value).toBe(state.slots.notes.value);
        if (process.env.CONTEXT_FIT_REPORT === "1") console.info(JSON.stringify({ t2BuilderCase: state.slots.notes.value ? "notes_900" : "six_user_six_assistant", ...result.measurement.bytes, reasons: result.measurement.reasons }));
      }
    }
  });
});
