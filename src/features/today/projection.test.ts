import { describe, expect, it } from "vitest";
import type { PublicReminder } from "@/contracts/api/reminders";
import { projectReminders } from "./projection";

const now = Date.parse("2026-09-24T09:00:00+07:00");
function reminder(id: string, at: string, status: PublicReminder["status"]): PublicReminder {
  return { publicId: id, title: id, scheduledAt: Date.parse(at), timezone: "Asia/Ho_Chi_Minh", status };
}
describe("reminder day projection", () => {
  it("separates active today, future days, attention and sent history without mutating input", () => {
    const rows = [reminder("tomorrow", "2026-09-25T08:00:00+07:00", "PENDING"), reminder("sent", "2026-09-24T08:00:00+07:00", "SENT"), reminder("cancelled", "2026-09-24T12:00:00+07:00", "CANCELLED"), reminder("late", "2026-09-23T12:00:00+07:00", "PENDING"), reminder("today", "2026-09-24T12:00:00+07:00", "PENDING"), reminder("failed", "2026-09-24T08:00:00+07:00", "FAILED")];
    const original = [...rows];
    const result = projectReminders(rows, now);
    expect(result.today.map(x => x.publicId)).toEqual(["today"]);
    expect(result.future.map(x => x.publicId)).toEqual(["tomorrow"]);
    expect(result.attention.map(x => x.publicId)).toEqual(["late", "failed"]);
    expect(result.sentToday.map(x => x.publicId)).toEqual(["sent"]);
    expect(rows).toEqual(original);
  });
  it.each(["PENDING", "CLAIMED", "RETRYABLE"] as const)("uses Vietnam midnight and excludes due %s from future", status => {
    const time = Date.parse("2026-09-24T17:00:00Z");
    const rows = [reminder("due", "2026-09-24T17:00:00Z", status), reminder("next", "2026-09-24T17:01:00Z", status), reminder("previous", "2026-09-24T16:59:00Z", "SENT")];
    const result = projectReminders(rows, time);
    expect(result.today.map(x => x.publicId)).toEqual(["next"]);
    expect(result.attention.map(x => x.publicId)).toEqual(["due"]);
    expect(result.sentToday).toEqual([]);
  });
});
