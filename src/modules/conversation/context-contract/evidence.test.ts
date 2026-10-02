import { describe, expect, it } from "vitest";
import { buildLegacyV2ContextInput as buildContextInput, type ReadyContext } from "./context";
import { chat, message, observation, snapshot, turn, withNotes } from "./context-test-fixtures";
import { isLegacyV2ValidatedPatch as isValidatedPatch, validateLegacyV2Evidence as validateEvidence, validateGuidancePrivacy } from "./evidence";
import { LegacyV2parseInterpretationSections as parseInterpretationSections } from "./contracts";
import { decodeContextSnapshot, type ContextSnapshotV1 } from "./state";
import { buildContextInputV2 } from "./context";
import { validateEvidenceV3 } from "./evidence";
import { SemanticPatchProposalV3Schema } from "./contracts";
import { ContextSnapshotV2Schema } from "./state";
import { mergePatchV3 } from "./merge";
import { DownstreamDiagnosticSchema, type DownstreamDiagnostic } from "./downstream";

describe("successor scoped semantic evidence", () => {
  it("requestTarget refusal reports the actual sanitized structural path", () => {
    const msg = message("nhắc mới"), built = buildContextInputV2({ message: msg, context: chat, snapshot: null, observation: observation(null, msg) });
    if (built.status !== "READY") throw new Error(built.reason);
    const proposal = SemanticPatchProposalV3Schema.parse({ schemaVersion: "calenote-context-3", intent: "CREATE_REMINDER", requestTarget: { kind: "NEW", evidence: [{ kind: "USER_QUOTE", turn: built.input.currentTurn, quote: "SYNTHETIC_PRIVATE", occurrence: 1 }] }, changes: [], query: null, uncertainties: [] });
    const diagnostics: DownstreamDiagnostic[] = [];
    expect(validateEvidenceV3(proposal, built, value => diagnostics.push(value))).toEqual({ status: "REFUSED", reason: "EVIDENCE_QUOTE_NOT_FOUND" });
    const failure = diagnostics.find(value => value.stage === "EVIDENCE")!;
    expect(failure.evidenceFailure?.path).toEqual(["requestTarget", "evidence"]);
    expect(failure.evidenceFailure?.referenceOrdinal).toBe(0);
    expect(DownstreamDiagnosticSchema.safeParse(failure).success).toBe(true);
    expect(JSON.stringify(failure)).not.toContain("SYNTHETIC_PRIVATE");
  });
  it.each(["old-quote", "fact", "mixed-old-quote", "mixed-fact", "current"])("NEW_fresh_factual_alternative_%s_requires_B_sources", source => {
    const state = ContextSnapshotV2Schema.parse({ ...withNotes(), schemaVersion: "calenote-context-state-2", pendingSemanticCandidate: null });
    const msg = message("tạo lịch mới gọi mẹ mang giấy tờ"), built = buildContextInputV2({ message: msg, context: chat, snapshot: state, observation: observation(withNotes(), msg) });
    if (built.status !== "READY") throw new Error(built.reason);
    const current = { kind: "USER_QUOTE", turn: built.input.currentTurn, quote: msg.text, occurrence: 1 };
    const old = source.endsWith("fact") ? { kind: "CONTEXT_FACT", ref: built.input.facts.find(f => f.field === "notes")!.alias } : { kind: "USER_QUOTE", turn: 0, quote: "mang giấy tờ", occurrence: 1 };
    const evidence = source === "current" ? [current] : source.startsWith("mixed") ? [current, old] : [old];
    const semantic = SemanticPatchProposalV3Schema.parse({ schemaVersion: "calenote-context-3", intent: "CREATE_REMINDER", requestTarget: { kind: "NEW", evidence: [current] }, changes: [{ field: "title", operation: "SET", value: "gọi mẹ", evidence: [current] }], query: null, uncertainties: [{ field: "notes", reason: "AMBIGUOUS", alternatives: [{ value: "mang giấy tờ", evidence }] }] });
    const result = validateEvidenceV3(semantic, built);
    if (source === "current") {
      expect(result.status).toBe("VALID");
      if (result.status === "VALID") expect(result.patch.alternativeEvidence[0].sources.map(s => s.sourceTurnId)).toEqual([msg.id]);
    } else expect(result).toEqual({ status: "REFUSED", reason: "NEW_REQUEST_FACT_REUSE" });
  });
  it.each(["source", "occurrence", "role", "target-old", "alternative-old"])("invalid_%s_rejects_whole_patch", variant => {
    const state = ContextSnapshotV2Schema.parse({ ...snapshot(), schemaVersion: "calenote-context-state-2", pendingSemanticCandidate: null });
    if (variant === "role") state.transcript[0] = { ...turn("nhắc tôi"), role: "ASSISTANT", kind: "NOTICE", deliveryState: "SENT" };
    const msg = message("nhắc mới"), built = buildContextInputV2({ message: msg, context: chat, snapshot: state, observation: observation(snapshot(), msg) });
    if (built.status !== "READY") throw new Error(built.reason);
    const current = { kind: "USER_QUOTE", turn: built.input.currentTurn, quote: "nhắc mới", occurrence: 1 };
    const bad = variant === "source" ? { ...current, quote: "bịa" } : variant === "occurrence" ? { ...current, occurrence: 2 } : { ...current, turn: 0, quote: "nhắc tôi" };
    const proposal = SemanticPatchProposalV3Schema.parse({ schemaVersion: "calenote-context-3", intent: "CREATE_REMINDER", requestTarget: { kind: "CURRENT", evidence: [variant === "target-old" ? bad : current] }, changes: [{ field: "title", operation: "SET", value: "mới", evidence: [variant === "alternative-old" || variant === "target-old" ? current : bad] }], query: null, uncertainties: variant === "alternative-old" ? [{ field: "operation", reason: "AMBIGUOUS", alternatives: [{ value: "NEW", evidence: [bad] }] }] : [] });
    expect(validateEvidenceV3(proposal, built).status).toBe("REFUSED");
  });
  it("valid_ref_unsupported_range_clarifies_but_fabricated_ref_rejects", () => {
    const msg = message("những lời nhắc"), built = buildContextInputV2({ message: msg, context: chat, snapshot: null, observation: observation(null, msg) });
    if (built.status !== "READY") throw new Error(built.reason);
    for (const quote of ["những lời nhắc", "tuần sau"]) {
      const semantic = SemanticPatchProposalV3Schema.parse({ schemaVersion: "calenote-context-3", intent: "LIST_REMINDERS", requestTarget: null, changes: [], query: { kind: "LIST", period: { kind: "WEEK", offset: 1 }, statusScope: "DEFAULT", evidence: [{ kind: "USER_QUOTE", turn: built.input.currentTurn, quote, occurrence: 1 }] }, uncertainties: [] });
      const result = validateEvidenceV3(semantic, built);
      expect(result.status).toBe(quote === "tuần sau" ? "REFUSED" : "VALID");
      if (result.status === "VALID") expect(result.patch).toMatchObject({ resolvedQuery: { period: null }, resolvedUncertainties: [{ field: "queryRange", reason: "MISSING" }] });
    }
  });
  it("query_inheritance_needs_scope_and_original_range_source", () => {
    const msg = message("lời nhắc tuần sau"), first = buildContextInputV2({ message: msg, context: chat, snapshot: null, observation: observation(null, msg) });
    if (first.status !== "READY") throw new Error(first.reason);
    const proposal = SemanticPatchProposalV3Schema.parse({ schemaVersion: "calenote-context-3", intent: "LIST_REMINDERS", requestTarget: null, changes: [], query: { kind: "LIST", period: { kind: "WEEK", offset: 1 }, statusScope: "DEFAULT", evidence: [{ kind: "USER_QUOTE", turn: first.input.currentTurn, quote: "lời nhắc tuần sau", occurrence: 1 }] }, uncertainties: [] });
    const checked = validateEvidenceV3(proposal, first);
    if (checked.status !== "VALID") throw new Error(checked.reason);
    const merged = mergePatchV3(null, checked.patch);
    if (merged.status !== "MERGED") throw new Error("query merge refused");
    for (const hasQueryQuestion of [true, false]) {
      const state = structuredClone(merged.candidate);
      if (hasQueryQuestion) state.pendingQueryQuestion = { questionId: "query-question", text: "Bạn muốn xem khoảng này?", scope: "QUERY", field: "queryRange", decisionKind: null, reason: "MISSING", noProgressCount: 0, deliveryState: "SENT", issuedAfterOrder: { receivedAt: state.inbound.receivedAt, rowid: state.inbound.rowid } };
      const current = { ...message("có"), id: "answer", receivedAt: msg.receivedAt + 60000 };
      const context = { ...chat, inboundRowId: 3 }, observed = observation(null, current, context);
      const built = buildContextInputV2({ message: current, context, snapshot: state, observation: { ...observed, observed: { presence: "PRESENT", contextId: state.id, contextRevision: state.contextRevision } } });
      if (built.status !== "READY") throw new Error(built.reason);
      const query = built.input.facts.find(f => f.scope === "QUERY")!;
      const semantic = SemanticPatchProposalV3Schema.parse({ ...proposal, query: { ...query.value, evidence: [{ kind: "CONTEXT_FACT", ref: query.alias }, { kind: "USER_QUOTE", turn: built.input.currentTurn, quote: "có", occurrence: 1 }] } });
      const result = validateEvidenceV3(semantic, built);
      expect(result.status).toBe("VALID");
      if (result.status === "VALID") {
        expect(result.patch.resolvedQuery).toMatchObject({ period: hasQueryQuestion ? { kind: "WEEK", offset: 1 } : null });
        expect(result.patch.queryReferenceTime).toBe(new Date(msg.receivedAt).toISOString());
      }
    }
  });
});

function build(text: string, state: ContextSnapshotV1 | null = null, receivedAt = message().receivedAt): ReadyContext {
  const msg = { ...message(text), receivedAt }, result = buildContextInput({ message: msg, context: chat, snapshot: state, observation: observation(state, msg) });
  expect(result.status, JSON.stringify(result)).toBe("READY");
  if (result.status !== "READY") throw new Error(result.reason);
  return result;
}
const quote = (quote: string, turn = 0, occurrence = 1) => ({ kind: "USER_QUOTE", quote, turn, occurrence });
const proposal = (value: unknown, evidence: unknown[], field = "notes", dialogueAct = "EDIT") => ({ schemaVersion: "calenote-context-2", intent: "CREATE_REMINDER", dialogueAct, continuation: "YES", changes: [{ field, operation: "SET", value, evidence }], query: null, uncertainties: [], controlEvidence: [] });
describe("atomic source evidence", () => {
  it("invalid_directive_does_not_erase_grounded_patch", () => {
    const built = build("nhắc thi");
    const raw = { ...proposal("thi", [quote("thi")], "title", "NEW_REQUEST"), schemaVersion: "calenote-context-2", conversationDirective: { kind: "SAVE" }, replyProposal: { text: "Đã lưu lịch cho bạn." } };
    const parsed = parseInterpretationSections(raw);
    expect(parsed.status).toBe("PARSED");
    if (parsed.status !== "PARSED") throw new Error("sections refused");
    const checked = validateEvidence(parsed.value.semantic, built);
    expect(checked.status).toBe("VALID");
    if (checked.status === "VALID") {
      expect(checked.patch.resolvedChanges[0]).toMatchObject({ field: "title", value: "thi" });
      expect(checked.patch.proposal).not.toHaveProperty("replyProposal");
      expect(checked.patch.proposal).not.toHaveProperty("conversationDirective");
    }
    expect(parsed.value.fullSchemaValid).toBe(false);
  });
  it("reply_controls_rejected_not_redacted_for_send_and_all_guidance_strings_checked", () => {
    const built = build("nhắc thi");
    for (const text of ["CN-AbC123", "CN%2DAbC123", "\\u0043N-AbC123", "https://example.test/action", "owner-id-abc", "550e8400-e29b-41d4-a716-446655440000", "sk-SENTINELcredential", "[CONTROL]"]) {
      for (const raw of [{ replyProposal: { text } }, { conversationDirective: { extra: { text } } }]) {
        const before = JSON.stringify(raw);
        expect(validateGuidancePrivacy(raw, built)).toEqual({ status: "REFUSED", reason: "GUIDANCE_PRIVACY" });
        expect(JSON.stringify(raw)).toBe(before);
      }
    }
    expect(validateGuidancePrivacy({ replyProposal: { text: "Bạn muốn được nhắc lúc mấy giờ?" } }, built)).toEqual({ status: "VALID" });
  });
  it("opaque_decision_and_receipt_ids_are_private_even_without_identifier_syntax", () => {
    const state = snapshot();
    state.pendingDecision = { decisionId: "opaquePrivate", kind: "RESUME_PENDING", target: { ownerId: "owner", chatIdentityId: "identity", chatId: "chat", requestId: "request", proposalId: null }, questionId: "opaqueQuestion", previewId: null, draftRevision: 1, contextRevision: 1, issuedAfterInbound: { receivedAt: state.createdAt, rowid: 1 }, deliveryState: "SENT", expiresAt: state.draftExpiresAt!, acceptedReplies: ["có"], replyReference: "opaqueReceipt", tokenHandle: null, candidate: null };
    const built = build("tiếp tục", state);
    for (const text of ["opaquePrivate", "opaqueQuestion", "opaqueReceipt", "opaque%50rivate", "opaque\\u0050rivate"]) expect(validateGuidancePrivacy({ replyProposal: { text } }, built)).toEqual({ status: "REFUSED", reason: "GUIDANCE_PRIVACY" });
  });
  it("exact_fact_anchor_survives_incidental_current_quotes_in_any_order", () => {
    const state = withNotes(), built = build("giữ như cũ", state);
    const fact = { kind: "CONTEXT_FACT", ref: "f1" }, current = quote("giữ như cũ", 1);
    for (const refs of [[fact, current], [current, fact]]) {
      const result = validateEvidence(proposal("mang giấy tờ", refs), built);
      expect(result.status).toBe("VALID");
      if (result.status === "VALID") expect(result.patch.changeEvidence[0].referenceTime).toBe("2026-09-28T03:00:00.000Z");
    }
  });
  it("conflicting_retained_relative_date_anchors_refuse_independent_of_order", () => {
    const state = snapshot();
    state.createdAt = state.draftCreatedAt = "2026-09-28T16:59:00.000Z";
    state.inbound.receivedAt = "2026-09-28T17:01:00.000Z";
    state.draftExpiresAt = "2026-09-28T17:09:00.000Z"; state.idleExpiresAt = "2026-09-28T17:31:00.000Z"; state.absoluteExpiresAt = "2026-09-28T18:59:00.000Z";
    state.transcript = [ { ...turn("mai", "before"), receivedAt: state.createdAt }, { ...turn("mai", "after"), receivedAt: state.inbound.receivedAt } ];
    const built = build("9h", state, Date.parse("2026-09-28T17:02:00.000Z"));
    for (const refs of [[quote("mai", 0), quote("mai", 1)], [quote("mai", 1), quote("mai", 0)]]) {
      const result = validateEvidence(proposal({ kind: "RELATIVE_DAY", offsetDays: 1 }, refs, "eventDate"), built);
      expect(result).toEqual({ status: "REFUSED", reason: "EVIDENCE_ANCHOR_CONFLICT" });
    }
    const correction = build("đổi sang mai", state, Date.parse("2026-09-28T17:02:00.000Z"));
    const result = validateEvidence(proposal({ kind: "RELATIVE_DAY", offsetDays: 1 }, [quote("đổi sang mai", 2)], "eventDate"), correction);
    expect(result.status).toBe("VALID");
    if (result.status === "VALID") expect(result.patch.changeEvidence[0].referenceTime).toBe("2026-09-28T17:02:00.000Z");
    state.slots.eventDate = {
      state: "PROPOSED", value: { kind: "RELATIVE_DAY", offsetDays: 1 }, fact: null,
      evidence: [{ kind: "USER_QUOTE", sourceTurnId: "before", sourceMapTurnId: "before", quote: "mai", occurrence: 1, sourceSpan: { start: 0, end: 3 }, viewSpan: { start: 0, end: 3 }, normalizationVersion: "nfc-codepoint-v1" }],
      provenance: { kind: "EXPLICIT_USER" }, resolution: null, proposalRevision: 1,
    };
    const edit = build("đổi sang ngày kia", state, Date.parse("2026-09-28T17:02:00.000Z"));
    for (const refs of [[quote("mai", 0), quote("đổi sang ngày kia", 2)], [quote("đổi sang ngày kia", 2), quote("mai", 0)]]) {
      const edited = validateEvidence(proposal({ kind: "RELATIVE_DAY", offsetDays: 2 }, refs, "eventDate"), edit);
      expect(edited.status).toBe("VALID");
      if (edited.status === "VALID") expect(edited.patch.changeEvidence[0].referenceTime).toBe("2026-09-28T17:02:00.000Z");
    }
  });
  it.each(["CN-mai123 mai", "CN-mai123 mai rồi mai"])("refreshed_query_fact_keeps_exact_source_identity_%s", text => {
    const state = snapshot(); state.transcript = [turn(text)];
    state.controlRegistry = [{ handle: "CN-mai123", kind: "TOKEN", ownerId: "owner", chatIdentityId: "identity", chatId: "chat", decisionId: "d", contextRevision: 1, draftRevision: 1, expiresAt: "2026-09-28T03:10:00.000Z" }];
    const value = { kind: "LIST" as const, period: { kind: "DAY" as const, date: { kind: "RELATIVE_DAY" as const, offsetDays: 1 } }, statusScope: "DEFAULT" as const, evidence: [{ kind: "USER_QUOTE" as const, turn: 0, quote: "mai", occurrence: 2 }] };
    state.facts = [{ alias: "f9", scope: "QUERY", field: "queryRange", value, provenance: { kind: "EXPLICIT_USER" }, sourceReferenceTime: state.createdAt, dependencies: [], evidenceSlot: null }];
    state.ambiguities = [{ field: "queryRange", reason: "AMBIGUOUS", alternatives: [{ value: value.period, evidence: value.evidence }] }];
    const built = build("giữ khoảng cũ", state);
    const query = { ...proposal("test", []), intent: "LIST_REMINDERS", changes: [], query: { ...value, evidence: [{ kind: "CONTEXT_FACT", ref: "f1" }] } };
    const result = validateEvidence(query, built);
    expect(result.status).toBe("VALID");
    if (result.status === "VALID") expect(result.patch.queryEvidence[0]).toMatchObject({ sourceTurnId: "old", sourceSpan: { start: 10, end: 13 }, occurrence: 1 });
    const fact = built.candidateSnapshot.facts[0];
    if (fact.scope === "QUERY") expect(fact.value.evidence[0]).toMatchObject({ occurrence: 1, turn: 0 });
    expect(built.candidateSnapshot.ambiguities[0].alternatives[0].evidence[0]).toMatchObject({ occurrence: 1, turn: 0 });
    const persisted = decodeContextSnapshot(built.candidateSnapshotJson);
    const nextMessage = { ...message("giữ khoảng cũ"), id: "next", receivedAt: message().receivedAt + 60000 };
    const nextChat = { ...chat, inboundRowId: 3 };
    const next = buildContextInput({ message: nextMessage, context: nextChat, snapshot: persisted, observation: observation(persisted, nextMessage, nextChat) });
    expect(next.status).toBe("READY");
    if (next.status === "READY") {
      const reused = validateEvidence(query, next); expect(reused.status).toBe("VALID");
      if (reused.status === "VALID") expect(reused.patch.queryEvidence[0].sourceSpan).toEqual({ start: 10, end: 13 });
    }
  });
  it("projected_fact_reuse_preserves_internal_value_without_canonicalizing_placeholder", () => {
    const state = withNotes("mang CN-AbC123 giấy tờ");
    state.slots.notes.evidence = [{ ...state.slots.notes.evidence[0], quote: "giấy tờ", sourceSpan: { start: 15, end: 22 }, viewSpan: { start: 15, end: 22 } }];
    state.controlRegistry = [{ handle: "CN-AbC123", kind: "TOKEN", ownerId: "owner", chatIdentityId: "identity", chatId: "chat", decisionId: "d", contextRevision: 1, draftRevision: 1, expiresAt: "2026-09-28T03:10:00.000Z" }];
    const built = build("giữ ghi chú", state), refs = [{ kind: "CONTEXT_FACT", ref: "f1" }];
    const result = validateEvidence(proposal("mang [CONTROL] giấy tờ", refs), built);
    expect(result.status).toBe("VALID");
    if (result.status === "VALID") expect(result.patch).toMatchObject({ resolvedChanges: [{ field: "notes", operation: "SET", value: "mang CN-AbC123 giấy tờ" }] });
    expect(JSON.stringify(built.input)).not.toContain("CN-AbC123");
    expect(validateEvidence(proposal("mang [CONTROL] khác", refs), built).status).toBe("REFUSED");
    expect(validateEvidence(proposal("[CONTROL]", [quote("giữ ghi chú", 1)]), built).status).toBe("REFUSED");
    const alternative = validateEvidence({
      ...proposal("unused", []), changes: [],
      uncertainties: [{ field: "notes", reason: "AMBIGUOUS", alternatives: [{ value: "mang [CONTROL] giấy tờ", evidence: refs }] }],
    }, built);
    expect(alternative.status).toBe("VALID");
    if (alternative.status === "VALID") expect(alternative.patch).toMatchObject({ resolvedUncertainties: [{ field: "notes", alternatives: [{ value: "mang CN-AbC123 giấy tờ" }] }] });
  });
  it("retained_candidate_operands_and_alternatives_refresh_occurrences_together", () => {
    const state = snapshot(); state.transcript = [turn("CN-mai123 mai rồi mai")];
    state.controlRegistry = [{ handle: "CN-mai123", kind: "TOKEN", ownerId: "owner", chatIdentityId: "identity", chatId: "chat", decisionId: "d", contextRevision: 1, draftRevision: 1, expiresAt: "2026-09-28T03:10:00.000Z" }];
    const evidence = [{ kind: "USER_QUOTE" as const, turn: 0, quote: "mai", occurrence: 2 }];
    const source = { kind: "USER_QUOTE" as const, sourceTurnId: "old", sourceMapTurnId: "old", quote: "mai", occurrence: 2, sourceSpan: { start: 10, end: 13 }, viewSpan: { start: 10, end: 13 }, normalizationVersion: "nfc-codepoint-v1" as const };
    state.pendingDecision = {
      decisionId: "d", kind: "REPLACE_PENDING", target: { ownerId: "owner", chatIdentityId: "identity", chatId: "chat", requestId: "request", proposalId: "candidate" }, questionId: "question", previewId: null,
      draftRevision: 1, contextRevision: 1, issuedAfterInbound: { receivedAt: state.createdAt, rowid: 1 }, deliveryState: "SENT", expiresAt: state.draftExpiresAt!, acceptedReplies: ["có"], replyReference: null, tokenHandle: null,
      candidate: { proposalId: "candidate", proposalRevision: 1, createdAt: state.createdAt, expiresAt: state.draftExpiresAt!, sourceEvidence: [source], evidenceIndex: [{ field: "title", evidence: [source] }], proposal: {
        schemaVersion: "calenote-context-2", intent: "CREATE_REMINDER", dialogueAct: "NEW_REQUEST", continuation: "NO", changes: [{ field: "title", operation: "SET", value: "mai", evidence }], query: null,
        uncertainties: [{ field: "title", reason: "AMBIGUOUS", alternatives: [{ value: "mai", evidence }] }], controlEvidence: [],
      } },
    };
    const built = build("giữ như cũ", state);
    const candidate = built.candidateSnapshot.pendingDecision!.candidate!;
    expect(candidate.proposal.changes[0].evidence[0]).toMatchObject({ occurrence: 1 });
    expect(candidate.proposal.uncertainties[0].alternatives[0].evidence[0]).toMatchObject({ occurrence: 1 });
    expect(candidate.sourceEvidence[0]).toMatchObject({ occurrence: 1, sourceSpan: { start: 10, end: 13 } });
  });
  it("quote_matches_exact_supplied_user_view", () => {
    const built = build("e\u0301😀 đổi 9h, đổi 9h");
    const valid = validateEvidence(proposal({ hour: 9, minute: 0, qualifier: "H24" }, [quote("đổi 9h", 0, 2)], "reminderTime"), built);
    expect(valid.status).toBe("VALID");
    if (valid.status === "VALID") expect(valid.patch.changeEvidence[0].sources[0]).toMatchObject({ quote: "đổi 9h", sourceTurnId: "current", sourceSpan: { start: 12, end: 18 }, viewSpan: { start: 11, end: 17 } });
    for (const ref of [quote("Đổi 9h"), quote("doi 9h"), quote("đổi 9h", 0, 3), quote("đổi 9h", 1), quote("e\u0301")]) expect(validateEvidence(proposal("test", [ref]), built).status).toBe("REFUSED");
    expect(validateEvidence(proposal("é😀", [quote("é😀")]), built).status).toBe("VALID");
  });
  it("facts_are_payload_scoped", () => {
    const built = build("giữ ghi chú", withNotes());
    expect(built.input.facts[0].alias).toBe("f1");
    expect(validateEvidence(proposal("mang giấy tờ", [{ kind: "CONTEXT_FACT", ref: "f1" }]), built).status).toBe("VALID");
    for (const ref of ["f9", "f2"]) expect(validateEvidence(proposal("mang giấy tờ", [{ kind: "CONTEXT_FACT", ref }]), built).status).toBe("REFUSED");
    expect(validateEvidence(proposal("thay đổi", [{ kind: "CONTEXT_FACT", ref: "f1" }]), built).status).toBe("REFUSED");
    expect(validateEvidence(proposal("mang giấy tờ", [{ kind: "CONTEXT_FACT", ref: "f1" }], "title"), built).status).toBe("REFUSED");
  });
  it("old_quotes_cannot_undo_current_value_and_clear_requires_current_quote", () => {
    const built = build("giữ ghi chú", withNotes());
    expect(validateEvidence(proposal("khác", [quote("mang giấy tờ", 0)]), built).status).toBe("REFUSED");
    const clear = { ...proposal(null, [quote("mang giấy tờ", 0)]), changes: [{ field: "notes", operation: "CLEAR", value: null, evidence: [quote("mang giấy tờ", 0)] }] };
    expect(validateEvidence(clear, built).status).toBe("REFUSED");
    const current = build("xóa ghi chú", withNotes());
    clear.changes[0].evidence = [quote("xóa ghi chú", 1)];
    expect(validateEvidence(clear, current).status).toBe("VALID");
  });
  it("explicit_note_replacement_works_but_unexplained_detail_loss_clarifies", () => {
    const built = build("thay toàn bộ ghi chú bằng mang bút", withNotes());
    const patch = proposal("mang bút", [quote("thay toàn bộ ghi chú bằng mang bút", 1)]);
    expect(validateEvidence(patch, built).status).toBe("VALID");
    expect(validateEvidence({ ...patch, dialogueAct: "CONTINUE" }, built)).toEqual({ status: "REFUSED", reason: "NOTES_LOSS_REQUIRES_CLARIFICATION" });
    expect(validateEvidence(proposal("mang giấy tờ; mang bút", patch.changes[0].evidence, "notes", "CONTINUE"), built).status).toBe("VALID");
  });
  it("assistant_text_and_control_placeholder_cannot_be_user_evidence", () => {
    const state = snapshot(); state.controlRegistry = [{ handle: "CN-AbC123", kind: "TOKEN", ownerId: "owner", chatIdentityId: "identity", chatId: "chat", decisionId: "d", contextRevision: 1, draftRevision: 1, expiresAt: "2026-09-28T03:10:00.000Z" }];
    state.transcript.push({ ...turn("đổi 9h", "assistant"), role: "ASSISTANT", kind: "PREVIEW", deliveryState: "SENT" });
    const built = build("đổi CN-AbC123 sang 9h", state);
    for (const ref of [quote("đổi 9h", 1), quote("[CONTROL]", 2), quote("đổi [CONTROL] sang 9h", 2)]) expect(validateEvidence(proposal("x", [ref]), built).status).toBe("REFUSED");
    expect(validateEvidence(proposal({ hour: 9, minute: 0, qualifier: "H24" }, [quote("sang 9h", 2)], "reminderTime"), built).status).toBe("VALID");
  });
  it("one_invalid_alternative_rejects_entire_patch_and_no_partial_patch_escapes", () => {
    const built = build("mang bút");
    const patch = proposal("mang bút", [quote("mang bút")]);
    expect(validateEvidence({ ...patch, uncertainties: [{ field: "location", reason: "AMBIGUOUS", alternatives: [{ value: "Quang Trung", evidence: [quote("invented")] }] }] }, built)).toMatchObject({ status: "REFUSED" });
    expect(validateEvidence(patch, { ...built }).status).toBe("REFUSED");
  });
  it("query_fact_cannot_supply_reminder_and_new_query_range_requires_current_source", () => {
    const state = snapshot(); state.transcript = [turn("tháng này")];
    state.facts = [{ alias: "f9", scope: "QUERY", field: "queryRange", value: { kind: "LIST", period: { kind: "MONTH", offset: 0 }, statusScope: "DEFAULT", evidence: [{ kind: "USER_QUOTE", turn: 0, quote: "tháng này", occurrence: 1 }] }, provenance: { kind: "EXPLICIT_USER" }, sourceReferenceTime: state.createdAt, dependencies: [], evidenceSlot: null }];
    const built = build("giữ khoảng cũ", state);
    const query = { ...proposal("test", []), intent: "LIST_REMINDERS", changes: [], query: { ...state.facts[0].value as object, evidence: [{ kind: "CONTEXT_FACT", ref: "f1" }] } };
    expect(validateEvidence(query, built).status).toBe("VALID");
    expect(validateEvidence({ ...query, query: { ...query.query, period: { kind: "MONTH", offset: 1 } } }, built).status).toBe("REFUSED");
    expect(validateEvidence(proposal("giữ", [{ kind: "CONTEXT_FACT", ref: "f1" }]), built).status).toBe("REFUSED");
  });
  it("inferred_year_is_not_promoted_to_explicit_evidence", () => {
    const built = build("ngày 11/10");
    const patch = proposal({ kind: "CIVIL_DATE", calendar: "GREGORIAN", day: 11, month: 10, year: 2026, leapMonth: null }, [quote("ngày 11/10")], "eventDate");
    expect(validateEvidence(patch, built)).toEqual({ status: "REFUSED", reason: "YEAR_NOT_EXPLICIT" });
    patch.changes[0].value = { ...patch.changes[0].value as object, year: null };
    expect(validateEvidence(patch, built).status).toBe("VALID");
  });
  it("validated_patch_is_module_created_frozen_and_not_a_cast_proposal", () => {
    const result = validateEvidence(proposal("mang bút", [quote("mang bút")]), build("mang bút"));
    expect(result.status).toBe("VALID");
    if (result.status === "VALID") { expect(isValidatedPatch(result.patch)).toBe(true); expect(isValidatedPatch({ ...result.patch })).toBe(false); expect(Object.isFrozen(result.patch.proposal.changes)).toBe(true); }
  });
  it("source_receipt_survives_midnight_and_fact_reuse", () => {
    const state = withNotes();
    state.createdAt = state.inbound.receivedAt = state.transcript[0].receivedAt = state.facts[0].sourceReferenceTime = state.draftCreatedAt = "2026-09-28T16:59:00.000Z";
    state.draftExpiresAt = "2026-09-28T17:09:00.000Z"; state.idleExpiresAt = "2026-09-28T17:29:00.000Z"; state.absoluteExpiresAt = "2026-09-28T18:59:00.000Z";
    const msg = { ...message("giữ ghi chú"), receivedAt: Date.parse("2026-09-28T17:01:00.000Z") };
    const built = buildContextInput({ message: msg, context: chat, snapshot: state, observation: observation(state, msg) }); expect(built.status).toBe("READY");
    if (built.status === "READY") { expect(built.input.reference.localDate).toBe("2026-09-29"); const result = validateEvidence(proposal("mang giấy tờ", [{ kind: "CONTEXT_FACT", ref: "f1" }]), built); expect(result.status).toBe("VALID"); if (result.status === "VALID") expect(result.patch.changeEvidence[0].referenceTime).toBe("2026-09-28T16:59:00.000Z"); }
  });
  it("accepted_fact_provenance_is_not_overwritten_by_an_incidental_current_quote", () => {
    const state = snapshot();
    state.slots.calendar = { state: "RESOLVED", value: "GREGORIAN", fact: "f9", evidence: [], provenance: { kind: "DERIVED_POLICY", policyVersion: "gregorian-default-1", referenceTime: state.createdAt, dependencies: [] }, resolution: { method: "POLICY_DEFAULT", version: "r1", referenceTime: state.createdAt, timezone: "Asia/Ho_Chi_Minh", dependencies: [] }, proposalRevision: 1 };
    state.facts = [{ alias: "f9", scope: "REMINDER", field: "calendar", value: "GREGORIAN", provenance: { kind: "DERIVED_POLICY", policyVersion: "gregorian-default-1", referenceTime: state.createdAt, dependencies: [] }, sourceReferenceTime: state.createdAt, dependencies: [], evidenceSlot: "calendar" }];
    const built = build("giữ như cũ", state);
    const result = validateEvidence(proposal("GREGORIAN", [{ kind: "CONTEXT_FACT", ref: "f1" }, quote("giữ như cũ", 1)], "calendar"), built);
    expect(result.status).toBe("VALID"); if (result.status === "VALID") expect(result.patch.changeEvidence[0].provenance.kind).toBe("DERIVED_POLICY");
  });
});
