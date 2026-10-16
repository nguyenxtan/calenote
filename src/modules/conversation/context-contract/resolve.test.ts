import { describe, expect, it } from "vitest";
import { resolveRequest } from "./resolve";
import { mergeLegacyV2Patch as mergePatch } from "./merge";
import { lunarCalendar } from "../lunar-calendar";
import { date, now, patch, request, time } from "./resolution-test-support";

describe("structured schedule resolution", () => {
  it.each([
    [{}, ["2026-10-09", "2026-10-10"]],
    [{ eventRelation: "INCLUDING_EVENT" }, ["2026-10-10", "2026-10-11"]],
    [{ eventRelation: "STARTING_ON", reminderDate: date(8) }, ["2026-10-08", "2026-10-09"]],
    [{ frequency: "ONCE", occurrenceCount: null, leadOffsetDays: 2 }, ["2026-10-09"]],
    [{ frequency: "ONCE", occurrenceCount: null, eventRelation: "INCLUDING_EVENT" }, ["2026-10-11"]],
    [{ occurrenceCount: null, eventRelation: "STARTING_ON", reminderDate: date(8), endDate: date(10) }, ["2026-10-08", "2026-10-09", "2026-10-10"]],
  ])("R04 exact relation arithmetic %j", (values, dates) => {
    const result = resolveRequest(request(values), now, lunarCalendar);
    expect(result.status).toBe("READY"); if (result.status === "READY") expect(result.occurrences.map(o => o.localDate)).toEqual(dates);
  });
  it("event_date_is_not_default_notification", () => {
    expect(resolveRequest(request({ frequency: null, occurrenceCount: null, eventRelation: null }), now, lunarCalendar)).toMatchObject({ status: "CLARIFY", fields: ["reminderDate", "eventRelation"] });
  });
  it.each([
    { reminderTime: { hour: 8, minute: 0, qualifier: "UNKNOWN" } },
    { occurrenceCount: 31 }, { occurrenceCount: 1 }, { leadOffsetDays: 367, frequency: "ONCE" },
    { reminderDate: date(8) }, { leadOffsetDays: 2 },
    { eventRelation: "STARTING_ON", reminderDate: date(8), endDate: date(10) },
    { eventDate: date(31, 11) }, { eventDate: date(29, 2) },
    { eventDate: date(1, 1, 2028) }, { eventDate: date(1, 1, 2026) },
  ])("invalid_ambiguous_incompatible_schedule_clarifies %j", values => {
    expect(resolveRequest(request(values), now, lunarCalendar).status).toBe("CLARIFY");
  });
  it.each(["YEARLY", "MONTHLY", "WEEKLY"])("unsupported frequency %s never downgrades", frequency => {
    expect(resolveRequest(request({ frequency }), now, lunarCalendar)).toEqual({ status: "UNSUPPORTED", capability: frequency });
  });
  it("missing_year_current_or_next_by_month_day_only_and_policy_provenance", () => {
    for (const [input, expected] of [[date(1, 10), "2026-10-01"], [date(1, 9), "2027-09-01"]] as const) {
      const result = resolveRequest(request({ frequency: "ONCE", occurrenceCount: null, eventRelation: "INCLUDING_EVENT", eventDate: input }), now, lunarCalendar);
      expect(result).toMatchObject({ status: "READY", details: { eventDate: expected, calendarProvenance: { provenance: { kind: "DERIVED_POLICY" } } } });
    }
  });
  it("R12 midnight_new_turn_and_retry_use_original_fact_receipt", () => {
    const receipt = Date.parse("2026-09-28T16:59:00Z");
    const first = mergePatch(null, patch(null, { title: "gọi mẹ", reminderDate: { kind: "RELATIVE_DAY", offsetDays: 1 }, reminderTime: time() }, { receivedAt: receipt, text: "Mai 8h nhắc gọi mẹ" }));
    expect(first.status).toBe("MERGED"); if (first.status !== "MERGED") return;
    const next = mergePatch(first.candidate, patch(first.candidate, {}, { receivedAt: receipt + 120000, text: "giữ như cũ" }));
    expect(next.status).toBe("MERGED"); if (next.status !== "MERGED") return;
    expect(resolveRequest(next.candidate, receipt + 120000, lunarCalendar)).toMatchObject({ status: "READY", occurrences: [{ localDate: "2026-09-29", scheduledAt: Date.parse("2026-09-29T01:00:00Z") }] });
    expect(resolveRequest(next.candidate, Date.parse("2026-09-29T01:00:00Z"), lunarCalendar)).toMatchObject({ status: "CLARIFY", reasons: expect.arrayContaining(["PAST_OCCURRENCE"]) });
  });
  it.each([null, true, false])("lunar leap choice %s must be explicit when ambiguous", leapMonth => {
    const state = request({ frequency: "ONCE", occurrenceCount: null, eventRelation: "INCLUDING_EVENT", calendar: "LUNAR_VN", eventDate: { kind: "CIVIL_DATE", calendar: "LUNAR_VN", year: 2004, month: 2, day: 1, leapMonth } });
    state.slots.eventDate.resolution!.referenceTime = "2004-03-01T00:00:00.000Z";
    const result = resolveRequest(state, Date.parse("2004-03-01T00:00:00Z"), lunarCalendar);
    expect(result.status).toBe(leapMonth === true ? "READY" : "CLARIFY");
    if (result.status === "READY") expect(result.details.eventDate).toBe("2004-03-21");
  });
  it("default_ONCE_and_Gregorian_and_derived_inclusive_count_are_resolved_policy_facts", () => {
    expect(resolveRequest(request({ frequency: null, occurrenceCount: null, eventRelation: null, reminderDate: date(8), eventDate: null }), now, lunarCalendar)).toMatchObject({ status: "READY", resolvedSlots: { frequency: { value: "ONCE", provenance: { kind: "DERIVED_POLICY" } }, calendar: { value: "GREGORIAN", provenance: { kind: "DERIVED_POLICY" } } } });
    expect(resolveRequest(request({ occurrenceCount: null, eventRelation: "STARTING_ON", reminderDate: date(8), endDate: date(10) }), now, lunarCalendar)).toMatchObject({ status: "READY", resolvedSlots: { occurrenceCount: { value: 3, provenance: { kind: "DERIVED_POLICY" } } } });
  });
  it.each([
    { year: null, month: 6, day: 15, leapMonth: false },
    { year: 2101, month: 1, day: 1, leapMonth: false },
    { year: 2026, month: 1, day: 31, leapMonth: false },
    { year: 2026, month: 1, day: 1, leapMonth: true },
  ])("invalid_lunar_operand_never_substitutes %j", operand => {
    expect(resolveRequest(request({ calendar: "LUNAR_VN", eventDate: { kind: "CIVIL_DATE", calendar: "LUNAR_VN", ...operand } }), now, lunarCalendar).status).toBe("CLARIFY");
  });
  it("one_past_child_rejects_whole_series_at_preview_and_confirmation", () => {
    const state = request();
    expect(resolveRequest(state, Date.parse("2026-10-09T01:00:00Z"), lunarCalendar)).toMatchObject({ status: "CLARIFY", reasons: ["PAST_OCCURRENCE"] });
    expect(resolveRequest(request({ eventDate: date(28, 9, 2026), frequency: "ONCE", occurrenceCount: null, eventRelation: "INCLUDING_EVENT" }), now, lunarCalendar)).toMatchObject({ status: "CLARIFY", reasons: ["PAST_OCCURRENCE"] });
  });
  it("resolved_slots_and_fact_projection_remain_reusable_on_the_next_actual_context_build", () => {
    const state = request({ occurrenceCount: null, eventRelation: "STARTING_ON", reminderDate: date(8), endDate: date(10) });
    const resolved = resolveRequest(state, now, lunarCalendar);
    expect(resolved.status).toBe("READY"); if (resolved.status !== "READY") return;
    expect(resolved.resolvedFacts).toBeDefined();
    expect(() => patch({ ...state, slots: resolved.resolvedSlots, facts: resolved.resolvedFacts }, {}, { text: "giữ như cũ" })).not.toThrow();
    expect(resolved.resolvedFacts.find(f => f.scope === "REMINDER" && f.field === "occurrenceCount")).toMatchObject({ dependencies: expect.any(Array), provenance: { kind: "DERIVED_POLICY" } });
  });
  it("a_changed_end_date_recomputes_derived_count_but_an_explicit_count_must_still_match", () => {
    const state = request({ occurrenceCount: null, eventRelation: "STARTING_ON", reminderDate: date(8), endDate: date(10) });
    const resolved = resolveRequest(state, now, lunarCalendar);
    expect(resolved.status).toBe("READY"); if (resolved.status !== "READY") return;
    const previous = { ...state, slots: resolved.resolvedSlots, facts: resolved.resolvedFacts };
    const edited = mergePatch(previous, patch(previous, { endDate: date(11) }, { act: "EDIT" }));
    expect(edited.status).toBe("MERGED"); if (edited.status !== "MERGED") return;
    expect(resolveRequest(edited.candidate, now, lunarCalendar)).toMatchObject({ status: "READY", resolvedSlots: { occurrenceCount: { value: 4 } }, occurrences: [{ localDate: "2026-10-08" }, { localDate: "2026-10-09" }, { localDate: "2026-10-10" }, { localDate: "2026-10-11" }] });
  });
  it("independent_reminder_date_does_not_move_with_event_date_EDIT", () => {
    const state = request({ frequency: "ONCE", occurrenceCount: null, eventRelation: null, reminderDate: date(8) });
    const edited = mergePatch(state, patch(state, { eventDate: date(12) }, { act: "EDIT" }));
    expect(edited.status).toBe("MERGED"); if (edited.status !== "MERGED") return;
    expect(resolveRequest(edited.candidate, now, lunarCalendar)).toMatchObject({ status: "READY", occurrences: [{ localDate: "2026-10-08" }], details: { eventDate: "2026-10-12" } });
  });
  it("clearing_a_dependency_does_not_leave_a_reusable_stale_derived_fact", () => {
    const state = request({ occurrenceCount: null, eventRelation: "STARTING_ON", reminderDate: date(8), endDate: date(10) });
    const resolved = resolveRequest(state, now, lunarCalendar);
    expect(resolved.status).toBe("READY"); if (resolved.status !== "READY") return;
    const previous = { ...state, slots: resolved.resolvedSlots, facts: resolved.resolvedFacts };
    const edited = mergePatch(previous, patch(previous, { endDate: null }, { act: "EDIT" }));
    expect(edited.status).toBe("MERGED"); if (edited.status !== "MERGED") return;
    expect(edited.candidate.facts.some(f => f.scope === "REMINDER" && f.field === "occurrenceCount")).toBe(false);
    expect(resolveRequest(edited.candidate, now, lunarCalendar)).toMatchObject({ status: "CLARIFY", fields: ["occurrenceCount"] });
    expect(() => patch(edited.candidate, { occurrenceCount: 2 }, { text: "2 ngày", act: "EDIT" })).not.toThrow();
    const explicit = mergePatch(edited.candidate, patch(edited.candidate, { occurrenceCount: 3 }, { text: "3 ngày", act: "EDIT" }));
    expect(explicit.status).toBe("MERGED"); if (explicit.status !== "MERGED") return;
    expect(resolveRequest(explicit.candidate, now, lunarCalendar)).toMatchObject({ status: "READY", resolvedSlots: { occurrenceCount: { value: 3, provenance: { kind: "EXPLICIT_USER" } } } });
  });
  it("366_day_horizon_is_inclusive_and_one_minute_beyond_clarifies", () => {
    const values = { frequency: "ONCE", occurrenceCount: null, eventRelation: "INCLUDING_EVENT", eventDate: date(29, 9, 2027), reminderTime: time(10) };
    expect(resolveRequest(request(values), now, lunarCalendar).status).toBe("READY");
    expect(resolveRequest(request({ ...values, reminderTime: { ...time(10), minute: 1 } }), now, lunarCalendar)).toMatchObject({ status: "CLARIFY", reasons: ["HORIZON_LIMIT"] });
  });
  it("event_time_without_event_date_targets_the_missing_date_then_recovers_after_date_answer", () => {
    const merged = mergePatch(null, patch(null, { title: "gọi mẹ", reminderDate: { kind: "RELATIVE_DAY", offsetDays: 1 }, reminderTime: time(), eventTime: time(10) }, { text: "mai 8h nhắc gọi mẹ, sự kiện lúc 10h" }));
    expect(merged.status).toBe("MERGED"); if (merged.status !== "MERGED") return;
    expect(resolveRequest(merged.candidate, now, lunarCalendar)).toEqual({ status: "CLARIFY", fields: ["eventDate"], reasons: ["MISSING"] });
    const answered = mergePatch(merged.candidate, patch(merged.candidate, { eventDate: { kind: "RELATIVE_DAY", offsetDays: 1 } }, { text: "sự kiện ngày mai" }));
    expect(answered.status).toBe("MERGED"); if (answered.status !== "MERGED") return;
    expect(resolveRequest(answered.candidate, now, lunarCalendar)).toMatchObject({ status: "READY", details: { eventDate: "2026-09-29", eventTime: "10:00", notes: null } });
  });
  it.each([
    { title: "&".repeat(500), location: null, notes: null },
    { title: "gọi mẹ", location: null, notes: "&".repeat(500) },
  ])("plain_text_symbols_that_fit_are_not_rejected_due_to_HTML_expansion", values => {
    expect(resolveRequest(request(values), now, lunarCalendar)).toMatchObject({ status: "READY" });
  });
  it.each([
    [{ title: "&".repeat(1800), location: null, notes: null, occurrenceCount: 30, eventDate: date(11, 11, 2026) }, ["title"]],
    [{ title: "gọi mẹ", location: null, notes: "&".repeat(2000) }, ["title", "notes"]],
  ])("oversize_complete_render_names_present_text_fields_instead_of_absent_notes", (values, fields) => {
    expect(resolveRequest(request(values), now, lunarCalendar)).toMatchObject({ status: "CLARIFY", fields, reasons: ["DETAILS_TOO_LONG"] });
  });
});
