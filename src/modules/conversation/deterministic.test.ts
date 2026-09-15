import { describe, expect, it } from "vitest";
import { interpretDeterministically } from "./deterministic";

const receivedAt = Date.UTC(2026, 8, 2, 3, 15); // 10:15 in Vietnam.

function interpret(text: string, processingNow = receivedAt) {
  return interpretDeterministically({ text, receivedAt, processingNow });
}

describe("interpretDeterministically", () => {
  it.each([
    ["mai 8h gọi mẹ", "gọi mẹ", Date.UTC(2026, 8, 3, 1)],
    ["12h trưa mai đăng ký chữ ký số", "đăng ký chữ ký số", Date.UTC(2026, 8, 3, 5)],
    ["mai 8h tối gọi mẹ", "gọi mẹ", Date.UTC(2026, 8, 3, 13)],
    ["mai 3h chiều họp team", "họp team", Date.UTC(2026, 8, 3, 8)],
  ])("returns a confident candidate for %s", (text, title, scheduledAt) => {
    expect(interpret(text)).toEqual({
      kind: "CREATE_CANDIDATE",
      intent: "CREATE_REMINDER",
      candidate: { title, scheduledAt, timezone: "Asia/Ho_Chi_Minh" },
    });
  });

  it("keeps received-time date interpretation but rejects a queue-delayed past reminder", () => {
    expect(interpret("hôm nay 12h nhắc tôi đăng ký eTax", Date.UTC(2026, 8, 2, 5, 1))).toMatchObject({
      kind: "REJECTED",
      code: "PAST_TIME",
    });
  });

  it.each([
    ["chiều mai gọi mẹ", { localDate: "2026-09-03", title: "gọi mẹ" }],
    ["mai gọi mẹ", { localDate: "2026-09-03", title: "gọi mẹ" }],
  ])("clarifies a missing clock for %s", (text, context) => {
    expect(interpret(text)).toMatchObject({
      kind: "CLARIFICATION",
      target: "CREATE_REMINDER",
      missingFields: ["time"],
      context,
    });
  });

  it("keeps unsupported semantic time local-to-AI eligibility", () => {
    expect(interpret("thứ sáu tuần sau lúc bốn giờ gửi báo cáo")).toEqual({
      kind: "AI_ELIGIBLE",
      intent: "UNKNOWN",
    });
  });

  it.each([
    ["mai tầm 25h gọi mẹ", "INVALID_TIME"],
    [`mai tầm 8h ${"a".repeat(1_801)}`, "TITLE_TOO_LONG"],
  ] as const)("keeps known %s failures local despite semantic language", (text, code) => {
    expect(interpret(text)).toMatchObject({ kind: "REJECTED", code });
  });

  it.each([
    ["mai lúc bốn giờ gửi báo cáo"],
    ["mai sáu giờ gọi mẹ"],
    ["thứ sáu 8h gửi báo cáo"],
  ])("marks unsupported semantic values as AI eligible: %s", (text) => {
    expect(interpret(text)).toEqual({ kind: "AI_ELIGIBLE", intent: "UNKNOWN" });
  });

  it.each([
    ["mai gửi email", ["time"], { localDate: "2026-09-03", title: "gửi email" }],
    ["8h nhắc tôi gọi mẹ", ["date"], { localTime: "08:00", title: "gọi mẹ" }],
    ["10/09 nhắc tôi gọi mẹ", ["time"], { localDate: "2026-09-10", title: "gọi mẹ" }],
  ] as const)("preserves recognized context for %s", (text, missingFields, context) => {
    expect(interpret(text)).toMatchObject({ kind: "CLARIFICATION", missingFields, context });
  });

  it.each([
    ["lịch hôm nay", "TODAY"],
    ["mai có gì?", "TOMORROW"],
    ["nhắc gì sắp tới?", "UPCOMING"],
  ] as const)("resolves %s as a %s query", (text, rangeKind) => {
    expect(interpret(text)).toMatchObject({ kind: "LIST_QUERY", rangeKind });
  });

  it("resolves an explicit calendar query to a local date", () => {
    expect(interpret("lịch 10/09")).toEqual({
      kind: "LIST_QUERY",
      intent: "LIST_REMINDERS",
      rangeKind: "DATE",
      localDate: "2026-09-10",
    });
  });

  it("rejects an invalid explicit calendar query locally", () => {
    expect(interpret("lịch 31/02")).toMatchObject({ kind: "QUERY_REJECTED", code: "INVALID_DATE" });
  });

  it("uses normalized query text consistently", () => {
    expect(interpret("nhắc gì sắp tới?".normalize("NFD").replace(" ", "   "))).toMatchObject({
      kind: "LIST_QUERY",
      rangeKind: "UPCOMING",
    });
  });

  it.each([
    ["có", "CONFIRM_PENDING"],
    ["hủy", "CANCEL_PENDING"],
  ] as const)("preserves pending intent %s", (text, intent) => {
    expect(interpret(text)).toEqual({ kind: "PENDING_ACTION", intent });
  });
});
