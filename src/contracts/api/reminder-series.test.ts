import { describe, expect, it } from "vitest";
import { SeriesDecisionRequestSchema, PublicSeriesViewSchema } from "./reminder-series";
describe("public series boundary", () => {
  it("accepts revision-bound decisions but rejects client authority and noncanonical identifiers", () => {
    const decision = { publicId: "AAAAAAAAAAAAAAAAAAAAAA", revision: 1, action: "CONFIRM" };
    expect(SeriesDecisionRequestSchema.safeParse(decision).success).toBe(true);
    for (const extra of [{ ownerId: "someone" }, { scheduledAt: 1 }, { revision: 0 }, { publicId: "not-an-id" }, { action: "CANCEL" }]) {
      expect(SeriesDecisionRequestSchema.safeParse({ ...decision, ...extra }).success).toBe(false);
    }
  });
  it("does not accept partial or unbounded occurrence previews or unknown states", () => {
    const view = { publicId: "AAAAAAAAAAAAAAAAAAAAAA", revision: 1, title: "Ôn thi", state: "PROPOSED", action: "CREATE",
      calendarLabel: "Dương lịch", eventLabel: null, occurrences: Array.from({ length: 30 }, () => ({ localDate: "2026-10-10", localTime: "12:00", status: "PROPOSED" })) };
    expect(PublicSeriesViewSchema.safeParse(view).success).toBe(true);
    expect(PublicSeriesViewSchema.safeParse({ ...view, state: "MADE_UP" }).success).toBe(false);
    expect(PublicSeriesViewSchema.safeParse({ ...view, occurrences: [...view.occurrences, view.occurrences[0]] }).success).toBe(false);
  });
});
