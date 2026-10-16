import { describe, expect, it } from "vitest";
import { ReminderListResponseV2Schema } from "./reminders-v2";

const reminder = { publicId: "A".repeat(22), title: "🙂".repeat(1800), scheduledAt: 1_800_000_000_000,
  timezone: "Asia/Ho_Chi_Minh", status: "PENDING", details: null };

describe("reminders-2 public contract", () => {
  it("accepts the semantic title bound and rejects unknown success fields", () => {
    const response = { data: { schemaVersion: "reminders-2", reminders: [reminder], hasMore: false, scope: "OWNER" } };
    expect(ReminderListResponseV2Schema.safeParse(response).success).toBe(true);
    expect(ReminderListResponseV2Schema.safeParse({ data: { ...response.data, transcript: "private" } }).success).toBe(false);
    expect(ReminderListResponseV2Schema.safeParse({ data: { ...response.data, reminders: [{ ...reminder, title: "🙂".repeat(1801) }] } }).success).toBe(false);
  });
});
