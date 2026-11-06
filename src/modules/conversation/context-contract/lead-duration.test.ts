import { describe, expect, it } from "vitest";
import { resolveRequest } from "./resolve";
import { lunarCalendar } from "../lunar-calendar";
import { date, now, request, time } from "./resolution-test-support";
import { supportsLeadDuration, leadDurationCovered } from "./lead-duration-evidence";
import { decodeContextSnapshot, encodeContextSnapshot } from "./state";
import type { SourceEvidence } from "./state";

const turn = (text: string) => ({ id: "t1", role: "USER" as const, semanticView: text });
const whole = (text: string): SourceEvidence => {
  const length = [...text].length;
  return { kind: "USER_QUOTE", sourceTurnId: "t1", sourceMapTurnId: "t1", quote: text, occurrence: 1, sourceSpan: { start: 0, end: length }, viewSpan: { start: 0, end: length }, normalizationVersion: "nfc-codepoint-v1" };
};
const grounded = (unit: "HOUR" | "MINUTE", value: number, text: string) => supportsLeadDuration(unit, value, [whole(text)], [turn(text)]);

describe("lead duration evidence verifies proposed amount/unit only", () => {
  it.each([
    ["HOUR", 3, "Ngày 10/11/2026 lúc 15h họp QA, nhắc một lần trước 3 giờ"],
    ["HOUR", 3, "họp lúc 15h, nhắc tôi trước 3 tiếng"],
    ["HOUR", 3, "họp lúc 15h, nhắc 3 tiếng trước"],
    ["MINUTE", 90, "họp lúc 15h, nhắc trước 90 phút"],
    ["HOUR", 1, "họp lúc 15h, nhắc trước 1 tiếng 30 phút"],
    ["MINUTE", 30, "họp lúc 15h, nhắc trước 1 tiếng 30 phút"],
    ["HOUR", 2, "họp lúc 15h, nhắc trước hai tiếng"],
  ] as const)("accepts %s=%s in %s", (unit, value, text) => expect(grounded(unit, value, text)).toBe(true));
  it.each([
    ["HOUR", 3, "họp lúc 15h, nhắc trước 3 giờ chiều"], // clock usage, not a duration
    ["HOUR", 3, "họp lúc 15h, nhắc trước 3 giờ sáng"],
    ["HOUR", 1, "họp lúc 15h, nhắc trước 1 tiếng rưỡi"],
    ["HOUR", 1, "nhắc trước 1 tiếng 30 phút rưỡi"],
    ["HOUR", 1, "nhắc trước 1 tiếng 30 phút kém 5"], // fractional
    ["HOUR", 3, "họp lúc 15h, không nhắc trước 3 tiếng"], // negated
    ["HOUR", 3, "họp lúc 15h, nếu được thì nhắc trước 3 tiếng"], // hypothetical
    ["HOUR", 3, "ghi chú \"nhắc trước 3 tiếng\" vào lịch"], // quoted
    ["HOUR", 4, "họp lúc 15h, nhắc trước 3 tiếng"], // wrong amount
    ["MINUTE", 3, "họp lúc 15h, nhắc trước 3 tiếng"], // wrong unit
    ["HOUR", 3, "chuyến bay dài 3 tiếng, nhắc tôi trước 1 ngày"], // foreign clause
    ["HOUR", 3, "họp lúc 15h, nhắc trước 3 giờ kém 15"], // to-clock form
    ["HOUR", 0, "họp lúc 15h, nhắc trước 0 tiếng"],
  ] as const)("rejects %s=%s in %s", (unit, value, text) => expect(grounded(unit, value, text)).toBe(false));
  it("an authored duration omitted by the model fails the boolean coverage guard", () => {
    const t = turn("họp lúc 15h ngày 10/11/2026, nhắc trước 90 phút");
    expect(leadDurationCovered(t, [])).toBe(false);
    expect(leadDurationCovered(t, [{ field: "leadOffsetMinutes", value: 90 }])).toBe(true);
    expect(leadDurationCovered(turn("họp lúc 15h, nhắc trước 1 tiếng 30 phút"), [{ field: "leadOffsetHours", value: 1 }])).toBe(false);
    expect(leadDurationCovered(turn("họp lúc 3 giờ chiều"), [])).toBe(true);
    expect(leadDurationCovered(turn("nhắc trước 1 tiếng rưỡi"), [])).toBe(false);
  });
});

const once = (values: Record<string, unknown>) => request({ eventDate: date(10, 11, 2026), eventTime: time(15), reminderTime: null, frequency: null, occurrenceCount: null, eventRelation: "BEFORE_EVENT", leadOffsetDays: null, ...values });
describe("pure duration resolution", () => {
  it.each([
    [{ leadOffsetHours: 3 }, "2026-11-10T12:00:00+07:00"],
    [{ leadOffsetMinutes: 90 }, "2026-11-10T13:30:00+07:00"],
    [{ leadOffsetHours: 1, leadOffsetMinutes: 30 }, "2026-11-10T13:30:00+07:00"],
    [{ eventDate: date(11, 11, 2026), eventTime: time(1), leadOffsetHours: 3 }, "2026-11-10T22:00:00+07:00"],
  ])("%o → %s, with no computed reminder slot", (values, expected) => {
    const r = resolveRequest(once(values), now, lunarCalendar);
    expect(r.status).toBe("READY");
    if (r.status !== "READY") return;
    expect(r.occurrences).toEqual([{ index: 0, scheduledAt: Date.parse(expected), localDate: expected.slice(0, 10) }]);
    expect(r.resolvedSlots.reminderTime.value).toBeNull(); expect(r.resolvedSlots.reminderDate.value).toBeNull();
    expect(r.resolvedFacts.some(f => f.scope === "REMINDER" && (f.field === "reminderTime" || f.field === "reminderDate"))).toBe(false);
  });
  it.each([
    [{ eventTime: null, leadOffsetHours: 3 }, "eventTime", "DURATION_REQUIRES_EVENT_CLOCK"],
    [{ reminderTime: time(9), leadOffsetHours: 3 }, "reminderTime", "CLOCK_DURATION_CONFLICT"],
    [{ leadOffsetDays: 1, leadOffsetHours: 3 }, "leadOffsetHours", "DAY_DURATION_COMBINATION"],
    [{ frequency: "DAILY", occurrenceCount: 2, leadOffsetHours: 3 }, "leadOffsetHours", "COUNT_OFFSET_CONFLICT"],
    [{ frequency: "WEEKLY", occurrenceCount: 2, leadOffsetHours: 3 }, "leadOffsetHours", "COUNT_OFFSET_CONFLICT"],
    [{ occurrenceCount: 3, leadOffsetHours: 3 }, "leadOffsetHours", "COUNT_OFFSET_CONFLICT"],
    [{ eventRelation: "INCLUDING_EVENT", leadOffsetHours: 3 }, "eventRelation", "INCOMPATIBLE_RELATION"],
    [{ eventDate: date(28, 9, 2026), eventTime: time(11), leadOffsetHours: 1 }, "eventDate", "PAST_OCCURRENCE"],
    [{ eventDate: date(10, 11, 2027), leadOffsetHours: 3 }, "eventDate", "HORIZON_LIMIT"],
    [{ leadOffsetHours: 8784, leadOffsetMinutes: 1 }, "leadOffsetMinutes", "LIMIT"],
  ])("%o clarifies %s/%s without occurrences", (values, field, reason) => {
    const r = resolveRequest(once(values), now, lunarCalendar);
    expect(r).toMatchObject({ status: "CLARIFY" });
    if (r.status === "CLARIFY") { expect(r.fields).toContain(field); expect(r.reasons).toContain(reason); }
  });
  it("explicit duration overrides advance defaults (one notification only)", () => {
    const state = { ...once({ leadOffsetHours: 3 }), schemaVersion: "calenote-context-state-2" } as unknown as Parameters<typeof resolveRequest>[0];
    (state as unknown as { advanceReminders: unknown }).advanceReminders = { days: 2, hours: 3 };
    (state as unknown as { pendingSemanticCandidate: null; ambiguities: [] }).pendingSemanticCandidate = null;
    const r = resolveRequest(state, now, lunarCalendar);
    expect(r).toMatchObject({ status: "READY", occurrences: [{ scheduledAt: Date.parse("2026-11-10T12:00:00+07:00") }] });
    if (r.status === "READY") expect(r.details.advanceReminders).toBeUndefined();
  });
  it("editing the event clock recomputes from the same duration", () => {
    const r = resolveRequest(once({ eventTime: time(16), leadOffsetHours: 3 }), now, lunarCalendar);
    expect(r).toMatchObject({ status: "READY", occurrences: [{ scheduledAt: Date.parse("2026-11-10T13:00:00+07:00") }] });
  });
  it("existing integer day offset semantics are unchanged", () => {
    const r = resolveRequest(once({ reminderTime: time(9), leadOffsetDays: 2 }), now, lunarCalendar);
    expect(r).toMatchObject({ status: "READY", occurrences: [{ scheduledAt: Date.parse("2026-11-08T09:00:00+07:00") }] });
  });
});

describe("state codec compatibility", () => {
  it("a snapshot without extension slots round-trips byte-identically and never gains keys", () => {
    const legacy = request();
    const encoded = encodeContextSnapshot(legacy);
    expect(encoded).not.toContain("leadOffsetHours");
    expect(encodeContextSnapshot(decodeContextSnapshot(encoded))).toBe(encoded);
  });
  it("a MISSING extension slot is omitted; a set one round-trips", () => {
    const missing = request(); (missing.slots as Record<string, unknown>).leadOffsetMinutes = { state: "MISSING", value: null, fact: null, evidence: [], provenance: null, resolution: null, proposalRevision: 1 };
    expect(encodeContextSnapshot(missing)).toBe(encodeContextSnapshot(request()));
    const used = once({ leadOffsetHours: 3 });
    const decoded = decodeContextSnapshot(encodeContextSnapshot(used));
    expect(decoded.slots.leadOffsetHours?.value).toBe(3);
    expect(decoded.facts.some(f => f.scope === "REMINDER" && f.field === "leadOffsetHours" && f.value === 3)).toBe(true);
  });
});
