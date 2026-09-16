import { describe, expect, it } from "vitest";
import {
  MAX_SEMANTIC_SCHEDULE_AHEAD_MS,
  validateSemanticPayload,
} from "./validation";

const processingNow = Date.UTC(2026, 8, 16, 3, 15); // 10:15 in Asia/Ho_Chi_Minh

function createReminder(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    intent: "CREATE_REMINDER",
    title: "Gọi đội thiết kế",
    localDate: "2026-09-17",
    localTime: "09:30",
    timezone: "Asia/Ho_Chi_Minh",
    needsClarification: false,
    ...overrides,
  };
}

describe("validateSemanticPayload", () => {
  it("converts a valid Vietnam-local create into an application-owned UTC timestamp", () => {
    expect(validateSemanticPayload(createReminder(), processingNow)).toEqual({
      kind: "CREATE",
      candidate: {
        title: "Gọi đội thiết kế",
        scheduledAt: Date.UTC(2026, 8, 17, 2, 30),
        timezone: "Asia/Ho_Chi_Minh",
      },
    });
  });

  it.each([
    ["an impossible calendar date", createReminder({ localDate: "2026-02-29" })],
    ["an out-of-range hour", createReminder({ localTime: "24:00" })],
    ["an out-of-range minute", createReminder({ localTime: "09:60" })],
  ])("turns %s into a local clarification", (_label, payload) => {
    expect(validateSemanticPayload(payload, processingNow)).toEqual({
      kind: "SAFE_CLARIFICATION",
      code: "INVALID_DATE_OR_TIME",
    });
  });

  it("rejects a schema-valid create which became past while queued", () => {
    expect(validateSemanticPayload(createReminder({ localDate: "2026-09-16", localTime: "10:15" }), processingNow)).toEqual({
      kind: "SAFE_CLARIFICATION",
      code: "PAST_TIME",
    });
  });

  it("enforces the exact create horizon from processing time", () => {
    const exactHorizon = processingNow + MAX_SEMANTIC_SCHEDULE_AHEAD_MS;
    expect(validateSemanticPayload(createReminder({ localDate: "2027-09-17", localTime: "10:15" }), processingNow)).toMatchObject({
      kind: "CREATE",
      candidate: { scheduledAt: exactHorizon },
    });

    expect(validateSemanticPayload(createReminder({ localDate: "2027-09-17", localTime: "10:16" }), processingNow)).toEqual({
      kind: "SAFE_CLARIFICATION",
      code: "TOO_FAR",
    });
  });

  it("retains the contract title limit when validating an accepted create", () => {
    const title = "a".repeat(1_798) + "💊";
    expect(title).toHaveLength(1_800);
    expect(validateSemanticPayload(createReminder({ title }), processingNow)).toMatchObject({
      kind: "CREATE",
      candidate: { title },
    });
    expect(validateSemanticPayload(createReminder({ title: `${title}a` }), processingNow)).toEqual({
      kind: "SAFE_HELP",
      code: "INVALID_SEMANTIC_INTERPRETATION",
    });
  });

  it.each([
    ["TODAY", null],
    ["TOMORROW", null],
    ["DATE", "2026-09-22"],
    ["THIS_WEEK", null],
    ["NEXT_7_DAYS", null],
    ["UPCOMING", null],
  ] as const)("accepts the permitted %s query range", (rangeKind, localDate) => {
    expect(validateSemanticPayload({ intent: "LIST_REMINDERS", rangeKind, localDate }, processingNow)).toEqual({
      kind: "QUERY",
      rangeKind,
      localDate,
    });
  });

  it("keeps invalid list date combinations local", () => {
    expect(validateSemanticPayload({ intent: "LIST_REMINDERS", rangeKind: "DATE", localDate: null }, processingNow)).toEqual({
      kind: "SAFE_HELP",
      code: "INVALID_SEMANTIC_INTERPRETATION",
    });
    expect(validateSemanticPayload({ intent: "LIST_REMINDERS", rangeKind: "DATE", localDate: "2026-02-29" }, processingNow)).toEqual({
      kind: "SAFE_CLARIFICATION",
      code: "INVALID_DATE_OR_TIME",
    });
    expect(validateSemanticPayload({ intent: "LIST_REMINDERS", rangeKind: "TODAY", localDate: "2026-09-16" }, processingNow)).toEqual({
      kind: "SAFE_CLARIFICATION",
      code: "INVALID_RANGE",
    });
  });

  it("passes an accepted clarification through without granting it mutation authority", () => {
    expect(validateSemanticPayload({
      intent: "NEEDS_CLARIFICATION",
      targetIntent: "CREATE_REMINDER",
      missingFields: ["time"],
      question: "Bạn muốn nhắc vào lúc nào?",
    }, processingNow)).toEqual({
      kind: "CLARIFICATION",
      clarification: {
        targetIntent: "CREATE_REMINDER",
        missingFields: ["time"],
        question: "Bạn muốn nhắc vào lúc nào?",
      },
    });
  });

  it.each(["modelEpoch", "scheduledAt", "ownerId", "sql", "provider", "identifier"])("rejects a payload carrying %s before it reaches validation", (forbiddenField) => {
    expect(validateSemanticPayload(createReminder({ [forbiddenField]: "untrusted" }), processingNow)).toEqual({
      kind: "SAFE_HELP",
      code: "INVALID_SEMANTIC_INTERPRETATION",
    });
  });
});
