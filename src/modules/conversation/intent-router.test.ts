import { describe, expect, it } from "vitest";
import { routeConversationIntent } from "./intent-router";

describe("routeConversationIntent", () => {
  it.each([
    ["lịch hôm nay", "LIST_REMINDERS"],
    ["hôm nay có gì?", "LIST_REMINDERS"],
    ["mai có gì?", "LIST_REMINDERS"],
    ["trên Calenote có lịch gì?", "LIST_REMINDERS"],
    ["nhắc gì sắp tới?", "LIST_REMINDERS"],
    ["có", "CONFIRM_PENDING"],
    ["ok", "CONFIRM_PENDING"],
    ["xác nhận", "CONFIRM_PENDING"],
    ["hủy", "CANCEL_PENDING"],
    ["huỷ", "CANCEL_PENDING"],
    ["không", "CANCEL_PENDING"],
    ["mai 8h gọi mẹ", "CREATE_REMINDER"],
    ["giúp tôi", "HELP"],
    ["xin chào", "UNKNOWN"],
  ] as const)("routes %s as %s", (text, intent) => {
    expect(routeConversationIntent(text)).toBe(intent);
  });
});
