import { expect, it } from "vitest";
import type { MissingField, PendingRequest } from "./contracts";
import { composeConversationReply } from "./responses";
const request: PendingRequest = { title: "ôn thi", calendar: "GREGORIAN", eventDate: { solarDate: "2026-10-11", calendar: "GREGORIAN", lunar: null, conversionVersion: null, sourceInboundId: "event" }, reminderDate: null, reminderTime: null, count: 3, relation: "BEFORE_EVENT", missing: ["time"] };
it("asks only for time when the exam date is known", () => {
  const text = composeConversationReply({ decision: { kind: "CLARIFY", request, field: "time" }, previousQuestion: null, tone: "friendly", lunarAvailable: true });
  expect(text).toMatch(/mấy giờ|lúc nào/iu);
  expect(text).toContain("11/10/2026");
  expect(text).not.toMatch(/thi ngày nào|đã tạo/iu);
  expect(text.match(/\?/gu)).toHaveLength(1);
});
it.each(["title", "eventDate", "date", "time", "year", "leapMonth", "seriesCount", "seriesRelation", "intent"] satisfies MissingField[])("stable locally composed single question for %s", field => {
  const input = { decision: { kind: "CLARIFY" as const, request, field }, previousQuestion: field, tone: "concise" as const, lunarAvailable: true };
  const text = composeConversationReply(input);
  expect(text).toBe(composeConversationReply(input));
  expect(text.match(/\?/gu)).toHaveLength(1);
  expect(text.length).toBeLessThan(700);
});
it("does not advertise lunar availability before release", () => {
  const input = { decision: { kind: "LUNAR_HELP" as const }, previousQuestion: null, tone: "friendly" as const };
  expect(composeConversationReply({ ...input, lunarAvailable: false })).toMatch(/chưa/iu);
  expect(composeConversationReply({ ...input, lunarAvailable: true })).toMatch(/âm lịch/iu);
});
it("keeps greeting, abandonment and failure honest", () => {
  for (const kind of ["GREET", "ABANDON_PENDING", "PROPOSE"] as const) {
    const text = composeConversationReply({ decision: kind === "PROPOSE" ? { kind, request } : { kind }, previousQuestion: null, tone: "friendly", lunarAvailable: true });
    expect(text).not.toMatch(/đã tạo|đã xoá lời nhắc|đã xóa lời nhắc/iu);
  }
});
