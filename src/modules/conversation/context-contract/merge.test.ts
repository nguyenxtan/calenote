import { describe, expect, it } from "vitest";
import { mergePatch } from "./merge";
import { resolveRequest } from "./resolve";
import { lunarCalendar } from "../lunar-calendar";
import { date, now, patch, request, time } from "./resolution-test-support";
import { decodeContextSnapshot, encodeContextSnapshot, type ContextSnapshotV1 } from "./state";
import { buildContextInput } from "./context";
import { validateEvidence } from "./evidence";
import { chat, message, observation, turn, withNotes } from "./context-test-fixtures";

function retainedDerived(field: "frequency" | "occurrenceCount"): ContextSnapshotV1 {
  const first = mergePatch(null, patch(null, {
    title: "gọi mẹ", reminderDate: { kind: "RELATIVE_DAY", offsetDays: 1 }, reminderTime: time(),
    ...(field === "occurrenceCount" ? { frequency: "DAILY", eventRelation: "STARTING_ON", endDate: { kind: "RELATIVE_DAY", offsetDays: 3 } } : {}),
  }, { text: "mai 8h gọi mẹ, mỗi ngày đến ngày kia" }));
  expect(first.status).toBe("MERGED"); if (first.status !== "MERGED") throw new Error(first.reason);
  const resolved = resolveRequest(first.candidate, now, lunarCalendar);
  expect(resolved.status).toBe("READY"); if (resolved.status !== "READY") throw new Error("Expected resolved request");
  return decodeContextSnapshot(encodeContextSnapshot({ ...first.candidate, slots: resolved.resolvedSlots, facts: resolved.resolvedFacts }));
}

function alternativePatch(state: ContextSnapshotV1, field: "frequency" | "occurrenceCount", editDependency = false) {
  const msg = { ...message("chưa rõ, đổi ngày kết thúc"), id: `alternative-${state.transcript.length}`, receivedAt: Date.parse(state.inbound.receivedAt) + 60000 };
  const context = { ...chat, inboundRowId: state.inbound.rowid + 1 };
  const built = buildContextInput({ message: msg, context, snapshot: state, observation: observation(state, msg, context) });
  expect(built.status).toBe("READY"); if (built.status !== "READY") throw new Error(built.reason);
  const fact = built.input.facts.find(f => f.scope === "REMINDER" && f.field === field)!;
  const result = validateEvidence({
    schemaVersion: "calenote-context-2", intent: "CREATE_REMINDER", dialogueAct: editDependency ? "EDIT" : "CONTINUE", continuation: "YES",
    changes: editDependency ? [{ field: "endDate", operation: "SET", value: { kind: "RELATIVE_DAY", offsetDays: 4 }, evidence: [{ kind: "USER_QUOTE", turn: built.input.currentTurn, quote: msg.text, occurrence: 1 }] }] : [],
    query: null, controlEvidence: [], uncertainties: [{ field, reason: "AMBIGUOUS", alternatives: [{ value: fact.value, evidence: [{ kind: "CONTEXT_FACT", ref: fact.alias }] }] }],
  }, built);
  expect(result.status).toBe("VALID"); if (result.status !== "VALID") throw new Error(result.reason);
  return result.patch;
}

function factEchoPatch(state: ContextSnapshotV1, field: "frequency" | "occurrenceCount", act: "CONTINUE" | "EDIT", current = false, uncertain = false) {
  const msg = { ...message(current ? "giữ giá trị cũ, bỏ thay đổi" : "ghi chú thêm nhé"), id: `echo-${state.transcript.length}`, receivedAt: Date.parse(state.inbound.receivedAt) + 60000 };
  const context = { ...chat, inboundRowId: state.inbound.rowid + 1 };
  const built = buildContextInput({ message: msg, context, snapshot: state, observation: observation(state, msg, context) });
  expect(built.status).toBe("READY"); if (built.status !== "READY") throw new Error(built.reason);
  const fact = built.input.facts.find(f => f.scope === "REMINDER" && f.field === field)!;
  const result = validateEvidence({
    schemaVersion: "calenote-context-2", intent: "CREATE_REMINDER", dialogueAct: act, continuation: "YES",
    changes: [{ field, operation: "SET", value: fact.value, evidence: [{ kind: "CONTEXT_FACT", ref: fact.alias },
      ...(current ? [{ kind: "USER_QUOTE", turn: built.input.currentTurn, quote: msg.text, occurrence: 1 }] : [])] }],
    query: null, controlEvidence: [], uncertainties: uncertain ? [{ field, reason: "MISSING", alternatives: [] }] : [],
  }, built);
  expect(result.status).toBe("VALID"); if (result.status !== "VALID") throw new Error(result.reason);
  expect(result.patch.changeEvidence[0].current).toBe(current);
  return result.patch;
}

function retainedConflict(field: "frequency" | "occurrenceCount") {
  const state = retainedDerived(field);
  const result = mergePatch(state, patch(state, { [field]: field === "frequency" ? "DAILY" : 4 }, { text: "đổi số lần nhắc" }));
  expect(result.status).toBe("MERGED"); if (result.status !== "MERGED") throw new Error(result.reason);
  return decodeContextSnapshot(encodeContextSnapshot(result.candidate));
}

describe("evidenced merge", () => {
  it.each([
    ["frequency", "CONTINUE"], ["frequency", "EDIT"],
    ["occurrenceCount", "CONTINUE"], ["occurrenceCount", "EDIT"],
  ] as const)("%s_fact_only_%s_echo_cannot_clear_conflict", (field, act) => {
    const original = retainedConflict(field);
    let state = original;
    // Repeat through persisted state and the real next-turn alias projection.
    for (const uncertain of [false, true]) {
      const result = mergePatch(state, factEchoPatch(state, field, act, false, uncertain));
      expect(result.status).toBe("MERGED"); if (result.status !== "MERGED") throw new Error(result.reason);
      expect(result.changedFields).toEqual([]);
      expect(result.candidate.draftRevision).toBe(original.draftRevision);
      expect(result.candidate.ambiguities).toEqual(original.ambiguities);
      expect(result.candidate.slots[field]).toEqual(original.slots[field]);
      expect(result.candidate.facts).toEqual(original.facts);
      expect(resolveRequest(result.candidate, now, lunarCalendar)).toMatchObject({ status: "CLARIFY", fields: [field], reasons: ["CONFLICT"] });
      state = decodeContextSnapshot(encodeContextSnapshot(result.candidate));
    }
  });
  it.each(["frequency", "occurrenceCount"] as const)("%s_current_EDIT_same_fact_resolves_conflict_and_advances_revision", field => {
    const state = retainedConflict(field);
    const result = mergePatch(state, factEchoPatch(state, field, "EDIT", true));
    expect(result.status).toBe("MERGED"); if (result.status !== "MERGED") throw new Error(result.reason);
    expect(result.changedFields).toEqual([field]);
    expect(result.candidate.draftRevision).toBe(state.draftRevision! + 1);
    expect(result.candidate.slots[field].proposalRevision).toBe(result.candidate.draftRevision);
    expect(result.candidate.slots[field].value).toEqual(state.slots[field].value);
    expect(result.candidate.ambiguities).toEqual([]);
    expect(resolveRequest(result.candidate, now, lunarCalendar).status).toBe("READY");
    const stored = decodeContextSnapshot(encodeContextSnapshot(result.candidate));
    const again = mergePatch(stored, factEchoPatch(stored, field, "CONTINUE"));
    expect(again).toMatchObject({ status: "MERGED", changedFields: [], candidate: { draftRevision: result.candidate.draftRevision, ambiguities: [] } });
  });
  it.each(["frequency", "occurrenceCount"] as const)("%s_current_CONTINUE_same_fact_does_not_answer_an_EDIT_conflict", field => {
    const state = retainedConflict(field);
    const result = mergePatch(state, factEchoPatch(state, field, "CONTINUE", true));
    expect(result).toMatchObject({ status: "MERGED", changedFields: [], candidate: { draftRevision: state.draftRevision, ambiguities: state.ambiguities } });
    if (result.status === "MERGED") expect(resolveRequest(result.candidate, now, lunarCalendar).status).toBe("CLARIFY");
  });
  it.each(["frequency", "occurrenceCount"] as const)("%s_uncertainty_replacement_is_not_a_current_answer", field => {
    const state = retainedConflict(field);
    const result = mergePatch(state, alternativePatch(state, field));
    expect(result).toMatchObject({ status: "MERGED", changedFields: [], candidate: { ambiguities: state.ambiguities, draftRevision: state.draftRevision } });
  });
  it.each(["frequency", "occurrenceCount"] as const)("%s_current_EDIT_answer_does_not_erase_new_uncertainty", field => {
    const state = retainedConflict(field);
    const result = mergePatch(state, factEchoPatch(state, field, "EDIT", true, true));
    expect(result).toMatchObject({ status: "MERGED", changedFields: [field], candidate: { draftRevision: state.draftRevision! + 1, ambiguities: [{ field, reason: "MISSING", alternatives: [] }] } });
    if (result.status === "MERGED") expect(resolveRequest(result.candidate, now, lunarCalendar).status).toBe("CLARIFY");
  });
  it("rejects forged patches before reading operands", () => {
    expect(mergePatch(null, {} as never)).toEqual({ status: "REJECTED", reason: "UNVALIDATED_PATCH" });
  });
  it("R02_R03_R07 preserve multi-turn details, compute missing after merge and revise time only", () => {
    const first = mergePatch(null, patch(null, { title: "đi thi", location: "Quang Trung", notes: "nhớ mang giấy tờ", eventDate: date(), frequency: "DAILY", occurrenceCount: 2 }));
    expect(first.status).toBe("MERGED"); if (first.status !== "MERGED") return;
    const second = mergePatch(first.candidate, patch(first.candidate, { eventRelation: "BEFORE_EVENT" }, { text: "Nhắc trước sự kiện." }));
    expect(second.status).toBe("MERGED"); if (second.status !== "MERGED") return;
    expect(resolveRequest(second.candidate, now, lunarCalendar)).toMatchObject({ status: "CLARIFY", fields: ["reminderTime"] });
    const third = mergePatch(second.candidate, patch(second.candidate, { reminderTime: time() }, { text: "8h." }));
    expect(third.status).toBe("MERGED"); if (third.status !== "MERGED") return;
    expect(resolveRequest(third.candidate, now, lunarCalendar)).toMatchObject({ status: "READY", occurrences: [{ localDate: "2026-10-09" }, { localDate: "2026-10-10" }], details: { location: "Quang Trung", notes: "nhớ mang giấy tờ", eventDate: "2026-10-11", eventTime: null } });
    const fourth = mergePatch(third.candidate, patch(third.candidate, { reminderTime: time(9) }, { act: "EDIT", text: "Đổi sang 9h." }));
    expect(fourth.status).toBe("MERGED"); if (fourth.status !== "MERGED") return;
    expect(fourth.candidate.draftRevision).toBe(third.candidate.draftRevision! + 1);
    expect(fourth.changedFields).toEqual(["reminderTime"]);
    expect(fourth.candidate.slots.notes).toEqual(third.candidate.slots.notes);
    expect(fourth.candidate.previewReceipt).toBeNull();
    expect(() => encodeContextSnapshot(fourth.candidate)).not.toThrow();
  });
  it("non_EDIT_conflict retains accepted value and grounded alternatives", () => {
    const state = request(); const original = structuredClone(state);
    const result = mergePatch(state, patch(state, { reminderTime: time(9) }));
    expect(result.status).toBe("MERGED"); if (result.status !== "MERGED") return;
    expect(result.candidate.slots.reminderTime).toMatchObject({ state: "CONFLICT", value: time() });
    expect(result.uncertainties).toMatchObject([{ field: "reminderTime", reason: "CONFLICT", alternatives: [{ value: time() }, { value: time(9) }] }]);
    expect(resolveRequest(result.candidate, now, lunarCalendar).status).toBe("CLARIFY");
    expect(state).toEqual(original);
  });
  it("R11 query_calendar_does_not_inherit_draft or mutate facts, revision, TTL", () => {
    const state = request(); const result = mergePatch(state, patch(state, {}, { query: { kind: "LIST", period: { kind: "MONTH", offset: 0 }, statusScope: "DEFAULT", evidence: [] } }));
    expect(result.status).toBe("MERGED"); if (result.status !== "MERGED") return;
    expect(result.candidate.slots).toEqual(state.slots);
    expect(result.candidate.draftRevision).toBe(state.draftRevision);
    expect(result.candidate.draftExpiresAt).toBe(state.draftExpiresAt);
    expect(result.candidate.idleExpiresAt).toBe(state.idleExpiresAt);
    expect(result.queryReferenceTime).toBe("2026-09-28T03:01:00.000Z");
    const resumed = mergePatch(result.candidate, patch(result.candidate, { reminderTime: time(9) }, { act: "EDIT", text: "Đổi sang 9h" }));
    expect(resumed.status).toBe("MERGED"); if (resumed.status !== "MERGED") return;
    expect(resolveRequest(resumed.candidate, now, lunarCalendar)).toMatchObject({ status: "READY", occurrences: [{ localDate: "2026-10-09", scheduledAt: Date.parse("2026-10-09T02:00:00Z") }, { localDate: "2026-10-10" }], details: { location: "Quang Trung", notes: "nhớ mang giấy tờ" } });
  });
  it("unrelated_new_request_never_inherits_pending_facts", () => {
    const state = request(); const result = mergePatch(state, patch(state, { title: "khác" }, { act: "NEW_REQUEST" }));
    expect(result).toMatchObject({ status: "REJECTED", reason: "REPLACEMENT_REQUIRED" });
  });
  it.each(["title", "location", "notes"])("EDIT %s advances version and CLEAR is explicit", field => {
    const state = request(); const edited = mergePatch(state, patch(state, { [field]: "changed" }, { act: "EDIT" }));
    expect(edited).toMatchObject({ status: "MERGED", candidate: { draftRevision: 2, slots: { [field]: { value: "changed" } } } });
    const cleared = mergePatch(state, patch(state, { [field]: null }, { act: "EDIT" }));
    expect(cleared).toMatchObject({ status: "MERGED", candidate: { draftRevision: 2, slots: { [field]: { state: "MISSING", value: null } } } });
  });
  it("a_new_identical_relative_operand_after_midnight_is_a_material_EDIT", () => {
    const receipt = Date.parse("2026-09-28T16:59:00Z");
    const first = mergePatch(null, patch(null, { title: "gọi mẹ", reminderDate: { kind: "RELATIVE_DAY", offsetDays: 1 }, reminderTime: time() }, { receivedAt: receipt, text: "Mai 8h nhắc gọi mẹ" }));
    expect(first.status).toBe("MERGED"); if (first.status !== "MERGED") return;
    const edited = mergePatch(first.candidate, patch(first.candidate, { reminderDate: { kind: "RELATIVE_DAY", offsetDays: 1 } }, { act: "EDIT", text: "Đổi sang mai", receivedAt: receipt + 120000 }));
    expect(edited).toMatchObject({ status: "MERGED", changedFields: ["reminderDate"], candidate: { draftRevision: 2 } });
    if (edited.status === "MERGED") expect(resolveRequest(edited.candidate, receipt + 120000, lunarCalendar)).toMatchObject({ status: "READY", occurrences: [{ localDate: "2026-09-30" }] });
  });
  it("query_alternatives_use_internal_transcript_indexes_and_keep_pending_reminder_ambiguity", () => {
    const state = request();
    state.transcript.push({ ...turn("failed assistant", "failed"), role: "ASSISTANT", deliveryState: "FAILED", kind: "NOTICE" });
    const uncertainty = { field: "queryRange" as const, reason: "AMBIGUOUS" as const, alternatives: [{ value: { kind: "MONTH" as const, offset: 0 as const }, evidence: [{ kind: "USER_QUOTE" as const, turn: 1, quote: "tháng này", occurrence: 1 }] }] };
    const result = mergePatch(state, patch(state, {}, { text: "tháng này", query: { kind: "LIST", period: null, statusScope: "DEFAULT", evidence: [] }, uncertainties: [uncertainty] }));
    expect(result.status).toBe("MERGED"); if (result.status !== "MERGED") return;
    expect(result.uncertainties[0].alternatives[0].evidence[0]).toMatchObject({ turn: 2 });
    expect(result.query?.evidence[0]).toMatchObject({ turn: 2 });
    expect(() => patch(result.candidate, {}, { text: "tháng này", query: { kind: "LIST", period: { kind: "MONTH", offset: 0 }, statusScope: "DEFAULT", evidence: [] } })).not.toThrow();
  });
  it("canonical_fact_reuse_restores_control_projected_value_and_original_time", () => {
    const state = withNotes("mang CN-AbC123 giấy tờ");
    state.slots.notes.evidence = [{ ...state.slots.notes.evidence[0], quote: "giấy tờ", sourceSpan: { start: 15, end: 22 }, viewSpan: { start: 15, end: 22 } }];
    state.controlRegistry = [{ handle: "CN-AbC123", kind: "TOKEN", ownerId: "owner", chatIdentityId: "identity", chatId: "chat", decisionId: "d", contextRevision: 1, draftRevision: 1, expiresAt: "2026-09-28T03:10:00.000Z" }];
    const msg = message("giữ ghi chú"), built = buildContextInput({ message: msg, context: chat, snapshot: state, observation: observation(state, msg) });
    expect(built.status).toBe("READY"); if (built.status !== "READY") return;
    const validated = validateEvidence({ schemaVersion: "calenote-context-2", intent: "CREATE_REMINDER", dialogueAct: "CONTINUE", continuation: "YES", changes: [{ field: "notes", operation: "SET", value: "mang [CONTROL] giấy tờ", evidence: [{ kind: "CONTEXT_FACT", ref: "f1" }] }], query: null, uncertainties: [], controlEvidence: [] }, built);
    expect(validated.status).toBe("VALID"); if (validated.status !== "VALID") return;
    const merged = mergePatch(state, validated.patch);
    expect(merged).toMatchObject({ status: "MERGED", changedFields: [], candidate: { draftRevision: 1, slots: { notes: { value: "mang CN-AbC123 giấy tờ", resolution: { referenceTime: "2026-09-28T03:00:00.000Z" } } } } });
  });
  it.each(["GREGORIAN", "LUNAR_VN"] as const)("query_calendar_does_not_inherit_draft_%s", sourceCalendar => {
    const state = request(sourceCalendar === "GREGORIAN" ? { calendar: "LUNAR_VN", eventDate: { kind: "CIVIL_DATE", calendar: "LUNAR_VN", year: 2026, month: 8, day: 15, leapMonth: false } } : {});
    const before = structuredClone(state);
    const query = { kind: "CALENDAR_DATE" as const, date: sourceCalendar === "GREGORIAN" ? date(21, 3, 2004) : { kind: "CIVIL_DATE" as const, calendar: "LUNAR_VN" as const, day: 1, month: 2, year: 2004, leapMonth: true }, outputCalendar: sourceCalendar === "GREGORIAN" ? "LUNAR_VN" as const : "GREGORIAN" as const, evidence: [] };
    const result = mergePatch(state, patch(state, {}, { query, text: "tra ngày năm 2004" }));
    expect(result.status).toBe("MERGED"); if (result.status !== "MERGED") return;
    expect(result.query).toMatchObject(sourceCalendar === "GREGORIAN" ? { date: { calendar: "GREGORIAN" }, outputCalendar: "LUNAR_VN" } : { date: { calendar: "LUNAR_VN" }, outputCalendar: "GREGORIAN" });
    expect(result.candidate.slots).toEqual(before.slots);
    expect(result.candidate.draftExpiresAt).toBe(before.draftExpiresAt);
    expect(result.candidate.facts.filter(f => f.scope === "REMINDER")).toEqual(before.facts);
  });
  it("a_side_query_preserves_pending_request_operation_and_intent_uncertainties", () => {
    const state = request();
    state.ambiguities = [{ field: "operation", reason: "AMBIGUOUS", alternatives: [] }, { field: "intent", reason: "AMBIGUOUS", alternatives: [] }];
    const result = mergePatch(state, patch(state, {}, { text: "tháng này", query: { kind: "LIST", period: { kind: "MONTH", offset: 0 }, statusScope: "DEFAULT", evidence: [] } }));
    expect(result.status).toBe("MERGED"); if (result.status !== "MERGED") return;
    expect(result.candidate.ambiguities).toEqual(state.ambiguities);
  });
  it.each(["frequency", "occurrenceCount"] as const)("derived_%s_conflict_preserves_policy_authority_readback_and_later_EDIT_recovery", field => {
    const state = retainedDerived(field), before = encodeContextSnapshot(state), accepted = structuredClone(state.slots[field]);
    expect(accepted.evidence).toEqual([]);
    const changes = field === "frequency" ? { frequency: "DAILY", occurrenceCount: 2, eventRelation: "STARTING_ON" } : { occurrenceCount: 4 };
    const result = mergePatch(state, patch(state, changes, { text: "mỗi ngày, nhắc 4 lần" }));
    expect(result.status).toBe("MERGED"); if (result.status !== "MERGED") return;
    expect(result.candidate.slots[field]).toEqual(accepted);
    expect(result.uncertainties).toMatchObject([{ field, reason: "CONFLICT", alternatives: [{ value: accepted.value, evidence: [{ kind: "CONTEXT_FACT", ref: accepted.fact }] }, { evidence: [{ kind: "USER_QUOTE" }] }] }]);
    expect(resolveRequest(result.candidate, now, lunarCalendar)).toMatchObject({ status: "CLARIFY", fields: expect.arrayContaining([field]), reasons: expect.arrayContaining(["CONFLICT"]) });
    const stored = decodeContextSnapshot(encodeContextSnapshot(result.candidate));
    const rebuilt = mergePatch(stored, patch(stored, {}, { text: "giữ yêu cầu đang chờ" }));
    expect(rebuilt.status).toBe("MERGED"); if (rebuilt.status !== "MERGED") return;
    expect(rebuilt.candidate.ambiguities).toEqual(stored.ambiguities);
    const recovery = field === "frequency" ? { frequency: "DAILY" } : { occurrenceCount: 4, endDate: { kind: "RELATIVE_DAY", offsetDays: 4 } };
    const edited = mergePatch(rebuilt.candidate, patch(rebuilt.candidate, recovery, { act: "EDIT", text: "đổi sang mỗi ngày 4 lần" }));
    expect(edited.status).toBe("MERGED"); if (edited.status !== "MERGED") return;
    expect(edited.candidate.ambiguities).toEqual([]);
    expect(edited.candidate.draftRevision).toBe(rebuilt.candidate.draftRevision! + 1);
    expect(edited.candidate.slots[field].proposalRevision).toBe(edited.candidate.draftRevision);
    expect(edited.candidate.slots[field].provenance).toEqual({ kind: "EXPLICIT_USER" });
    const recovered = resolveRequest(edited.candidate, now, lunarCalendar);
    expect(recovered.status).toBe("READY");
    if (recovered.status === "READY") expect(recovered.occurrences.map(o => o.localDate)).toEqual(field === "frequency" ? ["2026-09-29", "2026-09-30"] : ["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
    expect(encodeContextSnapshot(state)).toBe(before);
  });
  it.each(["frequency", "occurrenceCount"] as const)("supplied_%s_alternative_references_exact_derived_fact_without_fabricating_quotes", field => {
    const state = retainedDerived(field), result = mergePatch(state, alternativePatch(state, field));
    expect(result.status).toBe("MERGED"); if (result.status !== "MERGED") return;
    expect(result.uncertainties[0].alternatives[0].evidence).toEqual([{ kind: "CONTEXT_FACT", ref: state.slots[field].fact }]);
    const stored = decodeContextSnapshot(encodeContextSnapshot(result.candidate));
    const again = mergePatch(stored, alternativePatch(stored, field));
    expect(again.status).toBe("MERGED");
    expect(resolveRequest(stored, now, lunarCalendar).status).toBe("CLARIFY");
  });
  it("alternative_cannot_retain_a_policy_fact_whose_dependency_is_edited_in_the_same_patch", () => {
    const state = retainedDerived("occurrenceCount"), before = encodeContextSnapshot(state);
    expect(mergePatch(state, alternativePatch(state, "occurrenceCount", true))).toEqual({ status: "REJECTED", reason: "UNCERTAINTY_FACT_INVALIDATED" });
    expect(encodeContextSnapshot(state)).toBe(before);
  });
});
