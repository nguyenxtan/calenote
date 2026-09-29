import { describe, expect, it } from "vitest";
import { renderReminderDetails, DELIVERY_PREFIX } from "./detail-presentation";
import type { CanonicalDetailsV1 } from "@/modules/conversation/context-contract/state";
const details: CanonicalDetailsV1 = { schemaVersion: "calenote-reminder-details-1", location: "Quang Trung <script>", notes: "nhớ mang giấy tờ & bút", eventDate: "2026-10-11", eventTime: null, calendarProvenance: { calendar: "GREGORIAN", sourceDate: null, provenance: { kind: "EXPLICIT_USER" } }, resolutionVersion: "context-resolution-1" };
const schedule = [{ index: 0, localDate: "2026-10-09", scheduledAt: Date.parse("2026-10-09T01:00:00Z") }, { index: 1, localDate: "2026-10-10", scheduledAt: Date.parse("2026-10-10T01:00:00Z") }];
describe("complete reminder detail projection", () => {
  it("event_time_without_event_date_is_still_rejected_at_the_render_boundary", () => {
    expect(renderReminderDetails("gọi mẹ", { ...details, eventDate: null, eventTime: "10:00", notes: null }, schedule)).toEqual({ status: "INVALID" });
  });
  it("preserves distinct event and every notification, location, notes and safe markup", () => {
    const result = renderReminderDetails("đi thi <b>", details, schedule);
    expect(result.status).toBe("COMPLETE"); if (result.status !== "COMPLETE") return;
    for (const value of ["đi thi &lt;b&gt;", "Quang Trung &lt;script&gt;", "nhớ mang giấy tờ &amp; bút", "Sự kiện: 2026-10-11", "2026-10-09 08:00", "2026-10-10 08:00"]) expect(result.text).toContain(value);
    expect(result.text).not.toContain("2026-10-11 08:00");
  });
  it("exactly_2000_UTF16_including_delivery_prefix_then_one_over_never_clips", () => {
    const base = renderReminderDetails("x", { ...details, notes: null }, schedule);
    expect(base.status).toBe("COMPLETE"); if (base.status !== "COMPLETE") return;
    const title = "x".repeat(2000 - DELIVERY_PREFIX.length - base.text.length + 1);
    const exact = renderReminderDetails(title, { ...details, notes: null }, schedule);
    expect(exact.status).toBe("COMPLETE"); if (exact.status === "COMPLETE") expect(exact.text.length + DELIVERY_PREFIX.length).toBe(2000);
    expect(renderReminderDetails(title + "x", { ...details, notes: null }, schedule).status).toBe("TOO_LONG");
    expect(renderReminderDetails(title.slice(2) + "😀", { ...details, notes: null }, schedule).status).toBe("COMPLETE");
  });
  it("full occurrence set cannot be clipped to make preview fit", () => {
    expect(renderReminderDetails("x".repeat(1700), details, Array.from({ length: 30 }, (_, index) => ({ index, scheduledAt: schedule[0].scheduledAt + index * 86400000, localDate: new Date(schedule[0].scheduledAt + index * 86400000).toISOString().slice(0, 10) }))).status).toBe("TOO_LONG");
    expect(renderReminderDetails("test", details, []).status).toBe("INVALID");
    expect(renderReminderDetails("test", details, [{ ...schedule[0], localDate: "2026-10-11" }]).status).toBe("INVALID");
  });
  it("preview_control_instructions_are_budgeted_and_explicit_event_time_is_separate", () => {
    const result = renderReminderDetails("đi thi", { ...details, eventTime: "13:30" }, schedule);
    expect(result.status).toBe("COMPLETE"); if (result.status !== "COMPLETE") return;
    expect(result.text).toContain("Sự kiện: 2026-10-11 13:30");
    const remaining = 2000 - DELIVERY_PREFIX.length - result.text.length;
    expect(renderReminderDetails("đi thi", { ...details, eventTime: "13:30" }, schedule, remaining).status).toBe("COMPLETE");
    expect(renderReminderDetails("đi thi", { ...details, eventTime: "13:30" }, schedule, remaining + 1).status).toBe("TOO_LONG");
  });
});
