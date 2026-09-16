import { describe, expect, it } from "vitest";
import { semanticQueryRange } from "./semantic-query";

const reference = Date.UTC(2026, 8, 16, 8); // Wednesday, 15:00 in Vietnam.
describe("backend semantic query ranges", () => {
  it.each([
    ["TODAY", null, "2026-09-15T17:00:00Z", "2026-09-16T17:00:00Z"],
    ["TOMORROW", null, "2026-09-16T17:00:00Z", "2026-09-17T17:00:00Z"],
    ["THIS_WEEK", null, "2026-09-13T17:00:00Z", "2026-09-20T17:00:00Z"],
    ["NEXT_7_DAYS", null, "2026-09-15T17:00:00Z", "2026-09-22T17:00:00Z"],
    ["UPCOMING", null, "2026-09-16T08:00:00Z", "2026-10-16T08:00:00Z"],
    ["DATE", "2026-10-01", "2026-09-30T17:00:00Z", "2026-10-01T17:00:00Z"],
  ] as const)("owns the bounded %s range", (rangeKind, localDate, start, end) => {
    expect(semanticQueryRange({ kind: "QUERY", rangeKind, localDate }, reference))
      .toEqual({ start: Date.parse(start), end: Date.parse(end) });
  });

  it("rejects an out-of-horizon or invalid calendar date instead of normalizing it", () => {
    for (const localDate of ["2028-01-01", "2026-02-30", "2026-13-01", null]) {
      expect(semanticQueryRange({ kind: "QUERY", rangeKind: "DATE", localDate }, reference)).toBeNull();
    }
  });
});
