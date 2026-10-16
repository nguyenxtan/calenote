import { describe, expect, it } from "vitest";
import { lunarCalendar } from "../lunar-calendar";
import { buildLegacyV2ContextInput as buildContextInput } from "./context";
import { at, chat, message, observation, turn } from "./context-test-fixtures";
import { LegacyV2parseInterpretationSections as parseInterpretationSections, type ConversationDirective, type LegacyV2SemanticPatchProposal as SemanticPatchProposal } from "./contracts";
import { validateLegacyV2Evidence as validateEvidence, validateGuidancePrivacy } from "./evidence";
import { computeLegacyV2EffectiveDirective as computeEffectiveDirective, selectGuidance, validateLegacyV2Directive as validateDirective, type EffectiveDirective } from "./guidance";
import { mergeLegacyV2Patch as mergePatch } from "./merge";
import { resolveRequest } from "./resolve";
import { resolveQuery } from "./query";
import { date, now, patch, request, time } from "./resolution-test-support";
import { decodeContextSnapshot, encodeContextSnapshot, type ContextSnapshotV1 } from "./state";
import { buildContextInputV2 } from "./context";
import { parseInterpretationSectionsV3 } from "./contracts";
import { validateEvidenceV3 } from "./evidence";
import { computeEffectiveDirectiveV3, validateDirectiveV3 } from "./guidance";
import { mergePatchV3 } from "./merge";

it("explicit null advice cannot promote independent wording or change backend issue selection", () => {
  const text = "nhắc đi thi ngày mai", msg = { ...message(text), receivedAt: now };
  const built = buildContextInputV2({ message: msg, context: chat, snapshot: null, observation: observation(null, msg) });
  if (built.status !== "READY") throw new Error(built.reason);
  const evidence = [{ kind: "USER_QUOTE", turn: built.input.currentTurn, quote: text, occurrence: 1 }];
  const sections = parseInterpretationSectionsV3({ schemaVersion: "calenote-context-3", intent: "CREATE_REMINDER", requestTarget: { kind: "NEW", evidence }, changes: [{ field: "title", operation: "SET", value: "đi thi", evidence }, { field: "reminderDate", operation: "SET", value: { kind: "RELATIVE_DAY", offsetDays: 1 }, evidence }], query: null, uncertainties: [], conversationDirective: null, replyProposal: { text: "Hãy chọn thông tin khác" } });
  expect(sections).toMatchObject({ status: "PARSED", value: { fullSchemaValid: true, directive: { status: "VALID", value: null }, reply: { status: "VALID" } } });
  if (sections.status !== "PARSED") throw new Error(sections.reason);
  const checked = validateEvidenceV3(sections.value.semantic, built); if (checked.status !== "VALID") throw new Error(checked.reason);
  const merge = mergePatchV3(null, checked.patch); if (merge.status !== "MERGED") throw new Error(merge.status);
  const effective = computeEffectiveDirectiveV3({ semantic: checked.patch, merge, resolution: resolveRequest(merge.candidate, now, lunarCalendar) });
  expect(effective).toEqual({ kind: "ASK_FOR_FIELD", field: "reminderTime" });
  expect(selectGuidance({ effectiveDirective: effective, directiveValidation: validateDirectiveV3(sections.value.directive, effective), replyProposal: sections.value.reply, privacyValidation: { status: "VALID" }, language: "vi" })).toMatchObject({ source: "BACKEND", text: "Bạn muốn được nhắc lúc mấy giờ?" });
  expect(merge.candidate.pendingDecision).toBeNull(); expect(merge.candidate.previewReceipt).toBeNull();
});

it.each([
  [undefined, undefined], [null, null], [{ kind: "ABANDON_PENDING" }, { text: "Đã lưu thành công" }],
  [{ kind: "ASK_FOR_FIELD", field: "location" }, { text: "Địa điểm ở đâu?" }],
  [{ kind: "ASK_FOR_FIELD", field: "reminderTime", extra: true }, { text: "Bạn muốn được nhắc lúc mấy giờ?" }],
  [{ kind: "ASK_FOR_FIELD", field: "reminderTime" }, { text: "Bạn muốn được nhắc lúc mấy giờ?", extra: true }],
] as const)("A4 invalid_guidance_retains_valid_facts (%j)", (directive, reply) => {
  const text = "nhắc đi thi ngày mai", msg = { ...message(text), receivedAt: now };
  const built = buildContextInputV2({ message: msg, context: chat, snapshot: null, observation: observation(null, msg) });
  if (built.status !== "READY") throw new Error(built.reason);
  const evidence = [{ kind: "USER_QUOTE", turn: built.input.currentTurn, quote: text, occurrence: 1 }];
  const sections = parseInterpretationSectionsV3({ schemaVersion: "calenote-context-3", intent: "CREATE_REMINDER", requestTarget: { kind: "NEW", evidence }, changes: [{ field: "title", operation: "SET", value: "đi thi", evidence }, { field: "reminderDate", operation: "SET", value: { kind: "RELATIVE_DAY", offsetDays: 1 }, evidence }], query: null, uncertainties: [], conversationDirective: directive, replyProposal: reply });
  if (sections.status !== "PARSED") throw new Error(sections.reason);
  const checked = validateEvidenceV3(sections.value.semantic, built);
  if (checked.status !== "VALID") throw new Error(checked.reason);
  const merge = mergePatchV3(null, checked.patch);
  if (merge.status !== "MERGED") throw new Error(merge.status);
  const effective = computeEffectiveDirectiveV3({ semantic: checked.patch, merge, resolution: resolveRequest(merge.candidate, now, lunarCalendar) });
  expect(merge.candidate.slots.title.value).toBe("đi thi");
  expect(effective).toEqual({ kind: "ASK_FOR_FIELD", field: "reminderTime" });
  const selected = selectGuidance({ effectiveDirective: effective, directiveValidation: validateDirectiveV3(sections.value.directive, effective), replyProposal: sections.value.reply, privacyValidation: { status: "VALID" }, language: "vi" });
  expect(selected).toMatchObject({ source: "BACKEND", text: question });
  expect(merge.candidate.pendingDecision).toBeNull(); expect(merge.candidate.previewReceipt).toBeNull();
});

const ask = { kind: "ASK_FOR_FIELD", field: "reminderTime" } as const;
const question = "Bạn muốn được nhắc lúc mấy giờ?";
function run(state: ContextSnapshotV1 | null, values: Record<string, unknown>, text: string, directive: unknown = ask, reply: unknown = { text: question }, extra: Partial<SemanticPatchProposal> = {}) {
  const msg = { ...message(text), id: `user-${state?.transcript.length ?? 0}`, receivedAt: state ? Date.parse(state.inbound.receivedAt) + 60000 : now };
  const context = { ...chat, inboundRowId: (state?.inbound.rowid ?? 0) + 1 };
  const built = buildContextInput({ message: msg, context, snapshot: state, observation: observation(state, msg, context) });
  if (built.status !== "READY") throw new Error(built.reason);
  const evidence = [{ kind: "USER_QUOTE", turn: built.input.currentTurn, quote: text, occurrence: 1 }];
  const raw = { schemaVersion: "calenote-context-2", intent: "CREATE_REMINDER", dialogueAct: state ? "CONTINUE" : "NEW_REQUEST", continuation: state ? "YES" : "NO", changes: Object.entries(values).map(([field, value]) => ({ field, operation: "SET", value, evidence })), query: null, uncertainties: [], controlEvidence: [], ...extra, conversationDirective: directive, replyProposal: reply };
  const sections = parseInterpretationSections(raw);
  if (sections.status !== "PARSED") throw new Error(sections.reason);
  const semantic = validateEvidence(sections.value.semantic, built);
  if (semantic.status !== "VALID") throw new Error(semantic.reason);
  const merge = mergePatch(state, semantic.patch);
  if (merge.status !== "MERGED") throw new Error(merge.reason);
  const resolution = resolveRequest(merge.candidate, msg.receivedAt, lunarCalendar);
  const effective = computeEffectiveDirective({ merge, resolution, semantic: semantic.patch });
  const selection = selectGuidance({ effectiveDirective: effective, directiveValidation: validateDirective(sections.value.directive, effective), replyProposal: sections.value.reply, privacyValidation: validateGuidancePrivacy(raw, built), language: "vi" });
  return { sections: sections.value, semantic: semantic.patch, merge, resolution, effective, selection, built };
}

describe("post-merge guidance ownership (pure T0–T3 path, not T7 dispatch proof)", () => {
  it("I2_terminal_ids_plain_percent_and_json_escaped_reject_reply_but_keep_semantic_core", () => {
    const terminal = { outcomeId: "opaqueTerminal", contextId: "opaquePreviousContext", inboundId: "opaquePreviousInbound", status: "COMPLETED" as const, contextRevision: 1, order: { receivedAt: at, rowid: 1 } };
    const state = request({ reminderTime: null });
    state.lastTerminalOutcome = terminal;
    const msg = message("đổi nội dung thành thi");
    const observedTerminal = { ...terminal, outcomeId: "observationTerminal", contextId: "observationPreviousContext", inboundId: "observationPreviousInbound" };
    const observed = { ...observation(state, msg), lastTerminalOutcome: observedTerminal };
    const built = buildContextInput({ message: msg, context: chat, snapshot: state, observation: observed });
    expect(built.status).toBe("READY");
    if (built.status !== "READY") throw new Error(built.reason);
    expect(built.candidateSnapshot.lastTerminalOutcome).toEqual(terminal);
    expect(built.observation.lastTerminalOutcome).toEqual(observedTerminal);
    for (const source of [terminal, observedTerminal]) for (const id of [source.outcomeId, source.contextId, source.inboundId]) for (const text of [id, `%${id.charCodeAt(0).toString(16)}${id.slice(1)}`, `\\u${id.charCodeAt(0).toString(16).padStart(4, "0")}${id.slice(1)}`]) {
      const raw = { schemaVersion: "calenote-context-2", intent: "CREATE_REMINDER", dialogueAct: "EDIT", continuation: "YES", query: null, uncertainties: [], controlEvidence: [], changes: [{ field: "title", operation: "SET", value: "thi", evidence: [{ kind: "USER_QUOTE", turn: 1, quote: "thi", occurrence: 1 }] }], conversationDirective: ask, replyProposal: { text } };
      const sections = parseInterpretationSections(raw);
      if (sections.status !== "PARSED") throw new Error(sections.reason);
      const privacy = validateGuidancePrivacy(raw, built);
      expect(privacy, text).toEqual({ status: "REFUSED", reason: "GUIDANCE_PRIVACY" });
      const checked = validateEvidence(sections.value.semantic, built);
      expect(checked.status).toBe("VALID");
      if (checked.status !== "VALID") throw new Error(checked.reason);
      const merge = mergePatch(state, checked.patch);
      if (merge.status !== "MERGED") throw new Error(merge.reason);
      expect(merge.candidate.slots.title.value).toBe("thi");
      expect(checked.patch.proposal).not.toHaveProperty("replyProposal");
      const effective = computeEffectiveDirective({ semantic: checked.patch, merge, resolution: resolveRequest(merge.candidate, msg.receivedAt, lunarCalendar) });
      expect(effective).toEqual(ask);
      expect(selectGuidance({ effectiveDirective: effective, directiveValidation: validateDirective(sections.value.directive, effective), replyProposal: sections.value.reply, privacyValidation: privacy, language: "vi" })).toEqual({ source: "BACKEND", reason: "REPLY_FORBIDDEN", text: question });
    }
  });
  it.each(["operation", "intent"] as const)("I1_complete_reminder_keeps_unresolved_%s_before_preview", field => {
    const result = run(request(), {}, "tiếp tục", { kind: "PRESENT_PREVIEW" }, null, { uncertainties: [{ field, reason: "AMBIGUOUS", alternatives: [] }] });
    expect(result.resolution.status).toBe("READY");
    expect(result.effective).toEqual({ kind: "ASK_FOR_DISAMBIGUATION", field, reason: "AMBIGUOUS" });
    expect(result.selection).toMatchObject({ source: "BACKEND", reason: "DIRECTIVE_MISMATCH" });
    expect(result.merge.candidate.previewReceipt).toBeNull();
  });
  it.each(["AMBIGUOUS", "UNSUPPORTED_COMBINATION"] as const)("I1_ambiguous_intent_honors_uncopied_validated_%s", reason => {
    const text = "nhắc gọi mẹ rồi xem lịch";
    const result = run(request(), {}, text, { kind: "PRESENT_PREVIEW" }, null, { intent: "AMBIGUOUS", dialogueAct: "AMBIGUOUS", uncertainties: [{ field: "operation", reason, alternatives: [] }], controlEvidence: [{ kind: "USER_QUOTE", turn: 1, quote: text, occurrence: 1 }] });
    expect(result.merge.candidate.ambiguities).toEqual([]);
    expect(result.semantic.resolvedUncertainties).toMatchObject([{ field: "operation", reason }]);
    expect(result.effective).toEqual({ kind: "ASK_FOR_DISAMBIGUATION", field: "operation", reason });
  });
  it("I1_query_retains_its_own_range_ambiguity_before_resolution_or_answer", () => {
    const text = "tháng này hay tháng sau", state = request();
    const evidence = [{ kind: "USER_QUOTE" as const, turn: 1, quote: text, occurrence: 1 }];
    const semantic = patch(state, {}, { text, query: { kind: "LIST", period: { kind: "MONTH", offset: 0 }, statusScope: "DEFAULT", evidence }, uncertainties: [{ field: "queryRange", reason: "AMBIGUOUS", alternatives: [{ value: { kind: "MONTH", offset: 0 }, evidence }, { value: { kind: "MONTH", offset: 1 }, evidence }] }] });
    const merge = mergePatch(state, semantic);
    const queryResolution = resolveQuery(semantic.resolvedQuery!, now, lunarCalendar);
    expect(merge.status).toBe("MERGED");
    expect(queryResolution).toEqual({ status: "CLARIFY", reason: "MISSING_RANGE" });
    const base = { merge, semantic, queryResolution };
    for (const queryResult of [undefined, { status: "RESULTS" as const, rows: [], hasMore: false, partialNotice: null, scopeLabel: "scope", calendarNotice: "Gregorian" }]) expect(computeEffectiveDirective({ ...base, queryResult })).toEqual({ kind: "ASK_FOR_DISAMBIGUATION", field: "queryRange", reason: "AMBIGUOUS" });
    expect(computeEffectiveDirective({ ...base, queryResult: { status: "UNAUTHORIZED", reason: "scope" } })).toEqual({ kind: "BACKEND_ONLY", reason: "FAILURE" });
    expect(computeEffectiveDirective({ ...base, queryResolution: { status: "CLARIFY", reason: "UNKNOWN_REASON" } })).toEqual({ kind: "BACKEND_ONLY", reason: "FAILURE" });
    expect(computeEffectiveDirective({ ...base, backendOnly: "CONTROL" })).toEqual({ kind: "BACKEND_ONLY", reason: "CONTROL" });
  });
  it("I1_side_query_and_reminder_uncertainties_stay_in_their_own_scope", () => {
    const state = request();
    state.ambiguities = [{ field: "reminderTime", reason: "AMBIGUOUS", alternatives: [] }, { field: "operation", reason: "AMBIGUOUS", alternatives: [] }];
    const semantic = patch(state, {}, { text: "tháng này", query: { kind: "LIST", period: { kind: "MONTH", offset: 0 }, statusScope: "DEFAULT", evidence: [{ kind: "USER_QUOTE", turn: 1, quote: "tháng này", occurrence: 1 }] } });
    const merge = mergePatch(state, semantic), queryResolution = resolveQuery(semantic.resolvedQuery!, now, lunarCalendar);
    const queryResult = { status: "RESULTS" as const, rows: [], hasMore: false, partialNotice: null, scopeLabel: "scope", calendarNotice: "Gregorian" };
    expect(computeEffectiveDirective({ merge, semantic, queryResolution, queryResult })).toEqual({ kind: "ANSWER_QUERY", queryKind: "LIST" });
    if (merge.status === "MERGED") expect(merge.candidate.ambiguities).toEqual(state.ambiguities);
    const reminder = request();
    reminder.ambiguities = [{ field: "queryRange", reason: "AMBIGUOUS", alternatives: [] }];
    expect(run(reminder, {}, "tiếp tục", { kind: "PRESENT_PREVIEW" }, null).effective).toEqual({ kind: "PRESENT_PREVIEW" });
  });
  it("CO_A_matching_missing_time_selects_natural_guidance", () => {
    const result = run(request({ reminderTime: null }), {}, "tiếp tục");
    expect(result.effective).toEqual(ask);
    expect(result.selection).toEqual({ source: "MODEL_GUIDANCE", text: question });
    expect(result.semantic.proposal).not.toHaveProperty("replyProposal");
  });
  it("CO_B_wrong_field_retains_facts_and_selects_effective_fallback", () => {
    const result = run(request({ reminderTime: null }), { notes: "nhớ mang giấy tờ và bút" }, "nhớ mang giấy tờ và bút", { kind: "ASK_FOR_FIELD", field: "eventDate" }, { text: "Bạn thi ngày nào?" }, { dialogueAct: "EDIT" });
    expect(result.merge.candidate.slots.notes.value).toBe("nhớ mang giấy tờ và bút");
    expect(result.effective).toEqual(ask);
    expect(result.selection).toEqual({ source: "BACKEND", reason: "DIRECTIVE_MISMATCH", text: question });
    expect(result.merge.candidate.previewReceipt).toBeNull();
  });
  it("CO_C_premature_preview_cannot_remove_missing_field_or_mint_authority", () => {
    const result = run(request({ reminderTime: null }), {}, "tiếp tục", { kind: "PRESENT_PREVIEW" }, { text: "Xem lịch của bạn nhé." });
    expect(result.selection).toEqual({ source: "BACKEND", reason: "DIRECTIVE_MISMATCH", text: question });
    expect(result.merge.candidate.lifecycle).toBe("CLARIFYING");
    expect(result.merge.candidate.pendingDecision).toBeNull();
    expect(result.merge.candidate.previewReceipt).toBeNull();
  });
  it.each(["Đã lưu lịch cho bạn.", "SAVED successfully", "Mình sẽ tạo lịch.", "Lịch thành công rồi.", "Xác nhận nhé.", "Nhắc lúc 8h nhé.", "Đã\u200b lưu.", "\\u0111ã lưu.", "%C4%90%C3%A3 lưu."])("CO_D_transactional_or_encoded_reply_never_selected: %s", text => {
    const result = run(request({ reminderTime: null }), {}, "tiếp tục", ask, { text });
    expect(result.selection).toEqual({ source: "BACKEND", reason: "REPLY_FORBIDDEN", text: question });
    expect(result.merge.candidate.pendingDecision).toBeNull();
    expect(result.merge.candidate.lifecycle).toBe("CLARIFYING");
  });
  it("CO_E_mixed_correction_invalidates_previous_preview_and_hands_off_to_backend", () => {
    const state = request();
    state.lifecycle = "AWAITING_CONFIRMATION";
    state.previewReceipt = { previewId: "preview", requestId: state.requestId!, draftRevision: 1, draftHash: "a".repeat(64), ownerId: "owner", chatIdentityId: "identity", chatId: "chat", issuedAfterOrder: { receivedAt: at, rowid: 1 }, expiresAt: state.draftExpiresAt!, deliveryState: "SENT", channel: "ZALO", replyReference: "receipt" };
    const result = run(state, { reminderTime: time(9) }, "Có, nhưng đổi sang 9h.", { kind: "PRESENT_PREVIEW" }, { text: "Đã lưu lịch cho bạn." }, { dialogueAct: "EDIT" });
    expect(result.merge.candidate.previewReceipt).toBeNull();
    expect(result.merge.candidate.pendingDecision).toBeNull();
    expect(result.merge.candidate.lifecycle).toBe("CLARIFYING");
    expect(result.resolution.status).toBe("READY");
    if (result.resolution.status === "READY") expect(result.resolution.occurrences.map(o => o.scheduledAt)).toEqual([Date.parse("2026-10-09T09:00:00+07:00"), Date.parse("2026-10-10T09:00:00+07:00")]);
    expect(result.effective).toEqual({ kind: "PRESENT_PREVIEW" });
    expect(result.selection).toEqual({ source: "BACKEND", reason: "BACKEND_SURFACE", text: null });
  });
  it("CO_F_exact_progressive_inputs_preserve_facts_without_inventing_count_or_exactness", () => {
    const first = run(null, { title: "thi", location: "Quang Trung", eventDate: date(), eventRelation: "BEFORE_EVENT" }, "11/10 tui thi ở Quang Trung, nhắc tui trước đó nha.");
    const second = run(first.merge.candidate, {}, "2 ngày.", { kind: "ASK_FOR_DISAMBIGUATION", field: "frequency", reason: "AMBIGUOUS" }, { text: "Bạn muốn nhắc một lần hay liên tiếp mỗi ngày?" }, { uncertainties: [{ field: "frequency", reason: "AMBIGUOUS", alternatives: [] }] });
    expect(second.effective).toEqual({ kind: "ASK_FOR_DISAMBIGUATION", field: "frequency", reason: "AMBIGUOUS" });
    expect(second.selection.source).toBe("MODEL_GUIDANCE");
    expect(second.merge.candidate.slots.occurrenceCount.value).toBeNull();
    const third = run(second.merge.candidate, { reminderTime: time(8) }, "sáng, khoảng 8h.", ask, null, { uncertainties: [{ field: "reminderTime", reason: "AMBIGUOUS", alternatives: [] }] });
    expect(third.resolution.status).toBe("CLARIFY");
    expect(third.merge.candidate.slots.eventDate.value).toEqual(date());
    expect(third.merge.candidate.slots.title.value).toBe("thi");
    expect(third.merge.candidate.slots.location.value).toBe("Quang Trung");
    const explicit = run(third.merge.candidate, { frequency: "DAILY", occurrenceCount: 2, reminderTime: time(8) }, "Nhắc hai ngày liên tiếp trước hôm thi, đúng 8h sáng.", { kind: "PRESENT_PREVIEW" }, null, { dialogueAct: "EDIT" });
    expect(explicit.resolution.status).toBe("READY");
    if (explicit.resolution.status === "READY") {
      expect(explicit.resolution.occurrences.map(o => [o.localDate, o.scheduledAt])).toEqual([["2026-10-09", Date.parse("2026-10-09T08:00:00+07:00")], ["2026-10-10", Date.parse("2026-10-10T08:00:00+07:00")]]);
      expect(explicit.resolution.details.eventDate).toBe("2026-10-11");
    }
    expect(explicit.selection).toEqual({ source: "BACKEND", reason: "BACKEND_SURFACE", text: null });
  });
  it("null_invalid_oversize_and_controls_fall_back_without_losing_patch", () => {
    for (const [reply, reason] of [[null, "REPLY_ABSENT"], [{ text: "ế".repeat(401) }, "REPLY_TOO_LONG"], [{ text: "" }, "REPLY_INVALID"], [{ text: "CN-AbC123" }, "REPLY_FORBIDDEN"], [{ text: "owner-id-abc" }, "REPLY_FORBIDDEN"], [{ text: question, extra: true }, "REPLY_INVALID"]] as const) {
      const result = run(request({ reminderTime: null }), {}, "tiếp tục", ask, reply);
      expect(result.selection).toEqual({ source: "BACKEND", reason, text: question });
      expect(result.semantic.resolvedChanges).toEqual([]);
    }
    const exactly = run(request({ reminderTime: null }), {}, "tiếp tục", ask, { text: "ế".repeat(400) });
    expect(exactly.selection.source).toBe("MODEL_GUIDANCE");
    expect(run(request({ reminderTime: null }), {}, "tiếp tục", { kind: "SAVE" }).selection).toMatchObject({ reason: "DIRECTIVE_INVALID" });
  });
  it("selected_assistant_text_roundtrips_then_is_sanitized_and_never_user_evidence", () => {
    const result = run(request({ reminderTime: null }), {}, "tiếp tục", ask, { text: "Đã lưu lịch cho bạn." });
    const state = result.merge.candidate;
    const selected = `${result.selection.text} CN-Test123`;
    state.transcript.push({ ...turn(selected, "selected"), role: "ASSISTANT", kind: "CLARIFICATION", deliveryState: "SENT", messageRef: "sent", receivedAt: state.inbound.receivedAt });
    state.controlRegistry = [{ handle: "CN-Test123", kind: "TOKEN", ownerId: "owner", chatIdentityId: "identity", chatId: "chat", decisionId: "d", contextRevision: state.contextRevision, draftRevision: state.draftRevision!, expiresAt: state.draftExpiresAt! }];
    const encoded = encodeContextSnapshot(state);
    expect(encoded).not.toContain("Đã lưu lịch cho bạn.");
    const retained = decodeContextSnapshot(encoded);
    const msg = { ...message("sáng"), id: "next", receivedAt: now + 120000 };
    const context = { ...chat, inboundRowId: 3 };
    const built = buildContextInput({ message: msg, context, snapshot: retained, observation: observation(retained, msg, context) });
    expect(built.status).toBe("READY");
    if (built.status !== "READY") throw new Error(built.reason);
    expect(built.input.turns.find(t => t.role === "ASSISTANT")?.text).toBe(`${question} [CONTROL]`);
    expect(JSON.stringify(built.input)).not.toContain("CN-Test123");
    const semantic = { ...result.semantic.proposal, changes: [{ field: "title", operation: "SET", value: "mấy giờ", evidence: [{ kind: "USER_QUOTE", turn: 2, quote: "mấy giờ", occurrence: 1 }] }] };
    expect(validateEvidence(semantic, built)).toEqual({ status: "REFUSED", reason: "EVIDENCE_NOT_USER" });
  });
  it("backend_outcomes_and_unknown_mappings_fail_closed", () => {
    const result = run(request(), {}, "tiếp tục", { kind: "PRESENT_PREVIEW" }, null);
    for (const reason of ["CONTROL", "RECOVERY", "FAILURE", "MUTATION", "DELIVERY"] as const) {
      const effective = computeEffectiveDirective({ merge: result.merge, resolution: result.resolution, semantic: result.semantic, backendOnly: reason });
      expect(effective).toEqual({ kind: "BACKEND_ONLY", reason });
      expect(selectGuidance({ effectiveDirective: effective, directiveValidation: { status: "VALID" }, replyProposal: { status: "VALID", value: { text: question } }, privacyValidation: { status: "VALID" }, language: "vi" })).toMatchObject({ source: "BACKEND", reason: "BACKEND_SURFACE", text: null });
    }
    expect(computeEffectiveDirective({ merge: result.merge, resolution: { status: "CLARIFY", fields: ["newField"], reasons: ["MISSING"] }, semantic: result.semantic })).toEqual({ kind: "BACKEND_ONLY", reason: "FAILURE" });
    expect(computeEffectiveDirective({ merge: result.merge, resolution: { status: "CLARIFY", fields: ["reminderTime"], reasons: ["NEW_REASON"] }, semantic: result.semantic })).toEqual({ kind: "BACKEND_ONLY", reason: "FAILURE" });
  });
  it("resolved_query_requires_authorized_results_and_remains_backend_only", () => {
    const state = request();
    const semantic = patch(state, {}, { text: "tháng này", query: { kind: "LIST", period: { kind: "MONTH", offset: 0 }, statusScope: "DEFAULT", evidence: [{ kind: "USER_QUOTE", turn: 0, quote: "tháng này", occurrence: 1 }] } });
    const merge = mergePatch(state, semantic);
    const queryResolution = resolveQuery(semantic.resolvedQuery!, now, lunarCalendar);
    expect(computeEffectiveDirective({ merge, semantic, queryResolution })).toEqual({ kind: "BACKEND_ONLY", reason: "FAILURE" });
    const effective = computeEffectiveDirective({ merge, semantic, queryResolution, queryResult: { status: "RESULTS", rows: [], hasMore: false, partialNotice: null, scopeLabel: "scope", calendarNotice: "Gregorian" } });
    expect(effective).toEqual({ kind: "ANSWER_QUERY", queryKind: "LIST" });
    expect(selectGuidance({ effectiveDirective: effective, directiveValidation: { status: "VALID" }, replyProposal: { status: "VALID", value: { text: question } }, privacyValidation: { status: "VALID" }, language: "vi" })).toMatchObject({ source: "BACKEND", reason: "BACKEND_SURFACE", text: null });
  });
  it("directive_compatibility_checks_every_typed_parameter", () => {
    const pairs: [ConversationDirective, EffectiveDirective][] = [[{ kind: "HELP", topic: "LUNAR" }, { kind: "HELP", topic: "GENERAL" }], [{ kind: "ASK_FOR_DISAMBIGUATION", field: "frequency", reason: "AMBIGUOUS" }, { kind: "ASK_FOR_DISAMBIGUATION", field: "frequency", reason: "CONFLICT" }], [{ kind: "EXPLAIN_UNSUPPORTED", issue: "CAPABILITY" }, { kind: "EXPLAIN_UNSUPPORTED", issue: "DOMAIN_LIMIT" }], [{ kind: "ANSWER_QUERY", queryKind: "LIST" }, { kind: "ANSWER_QUERY", queryKind: "CALENDAR_DATE" }]];
    for (const [model, effective] of pairs) expect(validateDirective({ status: "VALID", value: model }, effective)).toEqual({ status: "INVALID", reason: "DIRECTIVE_MISMATCH" });
  });
  it("ambiguity_priority_never_attaches_a_later_reason_to_an_earlier_missing_field", () => {
    const result = run(request({ title: null, reminderTime: { hour: 8, minute: 0, qualifier: "UNKNOWN" } }), {}, "tiếp tục", { kind: "ASK_FOR_DISAMBIGUATION", field: "reminderTime", reason: "AMBIGUOUS" });
    expect(result.effective).toEqual({ kind: "ASK_FOR_DISAMBIGUATION", field: "reminderTime", reason: "AMBIGUOUS" });
    const conflict = run(request({ reminderTime: null, frequency: "ONCE" }), {}, "tiếp tục");
    expect(conflict.effective).toEqual({ kind: "ASK_FOR_DISAMBIGUATION", field: "occurrenceCount", reason: "CONFLICT" });
  });
  it("annual_capability_explanation_and_noncovered_language_have_safe_fallbacks", () => {
    const result = run(request({ frequency: "YEARLY" }), {}, "tiếp tục", { kind: "EXPLAIN_UNSUPPORTED", issue: "CAPABILITY" }, { text: "Bạn có muốn chọn một cách nhắc khác?" });
    expect(result.effective).toEqual({ kind: "EXPLAIN_UNSUPPORTED", issue: "CAPABILITY" });
    expect(result.selection.source).toBe("MODEL_GUIDANCE");
    expect(selectGuidance({ effectiveDirective: ask, directiveValidation: { status: "VALID" }, replyProposal: { status: "VALID", value: { text: "Bonjour" } }, privacyValidation: { status: "VALID" }, language: "fr" })).toEqual({ source: "BACKEND", reason: "REPLY_FORBIDDEN", text: question });
  });
});
