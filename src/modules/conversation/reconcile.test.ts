import { describe, expect, it } from "vitest";
import type { ConversationModel, ConversationSnapshot, PendingRequest } from "./contracts";
import { lunarCalendar } from "./lunar-calendar";
import { extractConversationTemporalEvidence } from "./temporal";
import { reconcileConversation } from "./reconcile";

const now = Date.UTC(2026, 8, 25, 3);
const model: ConversationModel = { intent: "CREATE_REMINDER", title: "gọi mẹ", titleState: "RESOLVED", targetIntent: null,
  dialogueAct: "NEW_REQUEST", continuation: "NO", capability: null };
const empty: PendingRequest = { title: null, calendar: "GREGORIAN", eventDate: null, reminderDate: null,
  reminderTime: null, count: null, relation: null, missing: [] };
const date = (solarDate: string) => ({ solarDate, calendar: "GREGORIAN" as const, lunar: null, conversionVersion: null, sourceInboundId: "prior" });
function snapshot(request: Partial<PendingRequest>): ConversationSnapshot {
  return { id: "context", revision: 1, status: "CLARIFYING", createdAt: now - 1000, expiresAt: now + 60_000,
    request: { ...empty, ...request }, turns: [] };
}
function decide(text: string, previous: ConversationSnapshot | null = null, overrides: Partial<ConversationModel> = {}) {
  return reconcileConversation({ model: { ...model, ...overrides }, previous, now,
    editRequested: /^(?:đổi|sửa)\b/u.test(text),
    temporal: extractConversationTemporalEvidence({ text, receivedAt: now, sourceInboundId: "current", currentCalendar: previous?.request.calendar ?? "GREGORIAN", previousRequest: previous?.request }, lunarCalendar) });
}
const continuation = { dialogueAct: "CONTINUE" as const, continuation: "YES" as const, title: null, titleState: "MISSING" as const };

describe("deterministic conversation reconciliation", () => {
  it("proposes a draft without any mutation instruction", () => {
    expect(decide("mai 8h nhắc gọi mẹ")).toMatchObject({ kind: "PROPOSE", request: { reminderDate: { solarDate: "2026-09-26" }, reminderTime: "08:00", count: null } });
  });
  it.each([
    ["9h nhắc gọi mẹ", "date", {}], ["mai nhắc gọi mẹ", "time", {}],
    ["mai 8h nhắc", "title", { title: null, titleState: "MISSING" }],
    ["mai 8h nhắc", "title", { title: null, titleState: "AMBIGUOUS" }],
    ["âm lịch 1/1 8h nhắc gọi mẹ", "year", {}],
    ["âm lịch 1/2/2023 8h nhắc gọi mẹ", "leapMonth", {}],
    ["mai 8h nhắc liên tục 3 ngày", "seriesRelation", {}],
  ] as const)("clarifies %s through %s", (text, field, overrides) => {
    expect(decide(text, null, overrides)).toMatchObject({ kind: "CLARIFY", field });
  });
  it("retains a known exam date and asks only for time", () => {
    expect(decide("nhắc", snapshot({ title: "ôn thi", eventDate: date("2026-10-11"), count: 3, relation: "BEFORE_EVENT" }), continuation))
      .toMatchObject({ kind: "CLARIFY", field: "time", request: { eventDate: date("2026-10-11") } });
  });
  it("fills a missing time without re-inferring prior date or title", () => {
    expect(decide("9h", snapshot({ title: "gọi khách", reminderDate: date("2026-09-26") }), continuation))
      .toMatchObject({ kind: "PROPOSE", request: { title: "gọi khách", reminderDate: date("2026-09-26"), reminderTime: "09:00" } });
  });
  it("fills a missing date", () => {
    expect(decide("mai", snapshot({ title: "gọi khách", reminderTime: "09:00" }), continuation)).toMatchObject({ kind: "PROPOSE" });
  });
  it.each(["mai 10h", "ngày kia 9h", "/:30"])("does not overwrite conflict %s", text => {
    expect(decide(text, snapshot({ title: "gọi khách", reminderDate: date("2026-09-26"), reminderTime: "09:00" }), continuation))
      .toEqual({ kind: "SAFE_REJECT", code: "CONFLICT" });
  });
  it("requires both explicit edit and valid new evidence", () => {
    const previous = snapshot({ title: "gọi khách", reminderDate: date("2026-09-26"), reminderTime: "09:00" });
    expect(decide("10h", previous, { ...continuation, dialogueAct: "EDIT" })).toMatchObject({ kind: "SAFE_REJECT" });
    expect(decide("đổi 10h", previous, { ...continuation, dialogueAct: "EDIT" })).toMatchObject({ kind: "PROPOSE", request: { reminderTime: "10:00" } });
  });
  it.each(["GREET", "CAPABILITY", "ABANDON"] as const)("handles %s without proposing a reminder", dialogueAct => {
    const previous = snapshot({ title: "gọi mẹ", missing: ["time"] });
    const original = structuredClone(previous);
    expect(decide("chào", previous, { intent: "HELP", title: null, titleState: "NOT_APPLICABLE", dialogueAct,
      capability: dialogueAct === "CAPABILITY" ? "LUNAR" : null, continuation: "YES" }).kind)
      .toBe(dialogueAct === "GREET" ? "GREET" : dialogueAct === "CAPABILITY" ? "LUNAR_HELP" : "ABANDON_PENDING");
    expect(previous).toEqual(original);
  });
  it("ambiguous abandonment asks about intent, not the old missing time", () => {
    expect(decide("thế thôi", snapshot({ title: "gọi mẹ", missing: ["time"] }), {
      intent: "HELP", title: null, titleState: "NOT_APPLICABLE", dialogueAct: "ABANDON", continuation: "UNCERTAIN",
    })).toMatchObject({ kind: "CLARIFY", field: "intent" });
  });
  it.each(["HELP", "LIST_REMINDERS", "UNSUPPORTED"] as const)("does not inherit pending request for %s", intent => {
    expect(decide("mai", snapshot({ title: "gọi mẹ" }), { intent, title: null, titleState: "NOT_APPLICABLE", ...{ dialogueAct: "CONTINUE", continuation: "YES" } }).kind)
      .toBe(intent === "HELP" ? "HELP" : intent === "LIST_REMINDERS" ? "READ_ONLY_LIST" : "SAFE_REJECT");
  });
  it("new request never inherits resolved prior fields", () => {
    expect(decide("9h nhắc", snapshot({ title: "cũ", reminderDate: date("2026-09-26") }))).toMatchObject({ kind: "CLARIFY", field: "date", request: { title: "gọi mẹ", reminderDate: null } });
  });
  it.each(["COMPLETED", "CANCELLED", "EXPIRED", "INVALID"] as const)("does not load terminal %s", status => {
    expect(decide("9h", { ...snapshot({ title: "cũ", reminderDate: date("2026-09-26") }), status }, continuation)).toMatchObject({ kind: "CLARIFY", field: "title" });
  });
  it("does not load expired context", () => {
    expect(decide("9h", { ...snapshot({ title: "cũ", reminderDate: date("2026-09-26") }), expiresAt: now }, continuation)).toMatchObject({ kind: "CLARIFY", field: "title" });
  });
  it("does not infer cadence from urgency or default an unknown count", () => {
    expect(decide("nhắc mỗi ngày lúc 9h")).toMatchObject({ kind: "CLARIFY", field: "seriesCount" });
  });
  it("unknown or conflicting calendar fails closed", () => {
    expect(decide("âm lịch dương lịch 1/1/2027 8h")).toMatchObject({ kind: "SAFE_REJECT", code: "CONFLICT" });
  });
  it("does not recalculate received-at tomorrow at later processing time", () => {
    const temporal = extractConversationTemporalEvidence({ text: "mai 8h", receivedAt: now, sourceInboundId: "current", currentCalendar: "GREGORIAN" }, lunarCalendar);
    expect(reconcileConversation({ temporal, model, previous: null, now: now + 86_400_000, editRequested: false }))
      .toMatchObject({ kind: "PROPOSE", request: { reminderDate: { solarDate: "2026-09-26" } } });
  });
  it("ambiguous target intent never silently creates", () => {
    expect(decide("mai 8h", null, { intent: "AMBIGUOUS", targetIntent: "CREATE_REMINDER" })).toMatchObject({ kind: "CLARIFY", field: "intent" });
  });
  it("completes an explicitly lunar request with a year-only follow-up", () => {
    const first = decide("âm lịch 1/1 lúc 8h nhắc gọi mẹ");
    expect(first.kind).toBe("CLARIFY");
    if (first.kind !== "CLARIFY") return;
    const second = decide("2027", snapshot(first.request), continuation);
    expect(second).toMatchObject({ kind: "PROPOSE", request: { calendar: "LUNAR_VN", reminderTime: "08:00",
      reminderDate: { solarDate: "2027-02-06", lunar: { year: 2027, month: 1, day: 1, leap: false } } } });
  });
  it("asks year then leap month without losing lunar operands", () => {
    const first = decide("âm lịch 1/2 lúc 8h nhắc gọi mẹ");
    if (first.kind !== "CLARIFY") throw new Error("Expected clarification");
    const second = decide("2023", snapshot(first.request), continuation);
    expect(second).toMatchObject({ kind: "CLARIFY", field: "leapMonth" });
    if (second.kind !== "CLARIFY") return;
    expect(decide("tháng nhuận", snapshot(second.request), continuation)).toMatchObject({ kind: "PROPOSE", request: {
      reminderDate: { solarDate: "2023-03-22", lunar: { leap: true } }, missing: [] } });
  });
  it("retains a pending cadence count question across a time-only answer", () => {
    expect(decide("9h", snapshot({ title: "gọi mẹ", missing: ["seriesCount"] }), continuation)).toMatchObject({ kind: "CLARIFY", field: "seriesCount" });
  });
  it("accepts a count-only clarification as cadence rather than date", () => {
    expect(decide("3 ngày", snapshot({ title: "gọi mẹ", missing: ["seriesCount"], reminderTime: "09:00", eventDate: date("2026-10-11"), relation: "BEFORE_EVENT" }), continuation))
      .toMatchObject({ kind: "PROPOSE", request: { count: 3 } });
  });
  it("a title marked ambiguous cannot become resolved merely by answering time", () => {
    const first = decide("mai", snapshot({ title: "cũ", reminderDate: date("2026-09-26") }), { ...continuation, titleState: "AMBIGUOUS" });
    if (first.kind !== "CLARIFY") throw new Error("Expected clarification");
    expect(decide("9h", snapshot(first.request), continuation)).toMatchObject({ kind: "CLARIFY", field: "title", request: { title: null } });
  });
  it("an ambiguous replacement cannot discard active facts", () => {
    expect(decide("9h", snapshot({ title: "cũ", reminderDate: date("2026-09-26") }), { ...continuation, continuation: "UNCERTAIN" }))
      .toMatchObject({ kind: "CLARIFY", field: "intent", request: { title: "cũ", reminderDate: date("2026-09-26") } });
  });
});
