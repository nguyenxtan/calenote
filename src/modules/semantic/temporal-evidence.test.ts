import { describe, expect, it } from "vitest";
import { extractTemporalEvidence, mergeTemporalEvidence } from "./temporal-evidence";

const referenceNow = Date.UTC(2026, 8, 16, 2);

describe("extractTemporalEvidence", () => {
  it.each([
    ["hôm nay", "TODAY", "2026-09-16"],
    ["mai", "TOMORROW", "2026-09-17"],
    ["ngày mai", "TOMORROW", "2026-09-17"],
  ] as const)("resolves the reviewed relative date %s", (text, source, localDate) => {
    expect(extractTemporalEvidence({ text, referenceNow })).toMatchObject({
      timezone: "Asia/Ho_Chi_Minh",
      referenceLocalDate: "2026-09-16",
      referenceLocalTime: "09:00",
      date: { state: "RESOLVED", source, localDate },
    });
  });

  it.each([
    ["2026-09-20", "EXPLICIT_DATE", "2026-09-20"],
    ["ngày 20 tháng 9 năm 2026", "EXPLICIT_DATE", "2026-09-20"],
    ["ngày 20 tháng 9", "DAY_MONTH", "2026-09-20"],
    ["ngày 10 tháng 9", "DAY_MONTH", "2027-09-10"],
    ["20/09/2026", "EXPLICIT_DATE", "2026-09-20"],
    ["20/09", "DAY_MONTH", "2026-09-20"],
    ["10/09", "DAY_MONTH", "2027-09-10"],
  ] as const)("resolves the reviewed explicit date %s", (text, source, localDate) => {
    expect(extractTemporalEvidence({ text, referenceNow }).date).toEqual({
      state: "RESOLVED",
      source,
      localDate,
    });
  });

  it.each([
    ["08:00", "08:00"],
    ["8:00", "08:00"],
    ["8h", "08:00"],
    ["8 giờ", "08:00"],
    ["lúc 8 giờ", "08:00"],
  ] as const)("normalizes the reviewed exact time %s", (text, localTime) => {
    expect(extractTemporalEvidence({ text, referenceNow }).time).toEqual({
      state: "RESOLVED",
      source: "EXACT_TIME",
      localTime,
    });
  });

  it.each([
    ["nhắc việc hôm nay", "TODAY", null],
    ["xem lịch ngày mai", "TOMORROW", null],
    ["xem lịch 2026-09-20", "DATE", "2026-09-20"],
    ["xem lịch tuần này", "THIS_WEEK", null],
    ["xem lịch 7 ngày tới", "NEXT_7_DAYS", null],
    ["xem lịch sắp tới", "UPCOMING", null],
  ] as const)("resolves the reviewed list range in %s", (text, kind, localDate) => {
    expect(extractTemporalEvidence({ text, referenceNow }).range).toEqual({
      state: "RESOLVED",
      kind,
      localDate,
    });
  });

  it("keeps absent temporal fields missing", () => {
    expect(extractTemporalEvidence({ text: "nhắc tui gọi khách", referenceNow })).toEqual({
      timezone: "Asia/Ho_Chi_Minh",
      referenceLocalDate: "2026-09-16",
      referenceLocalTime: "09:00",
      date: { state: "MISSING" },
      time: { state: "MISSING" },
      range: { state: "MISSING" },
    });
  });

  it.each(["sáng", "chiều", "tối"])("does not guess an exact time for daypart %s", (text) => {
    expect(extractTemporalEvidence({ text, referenceNow }).time).toEqual({
      state: "AMBIGUOUS",
      reason: "DAYPART_WITHOUT_EXACT_TIME",
    });
  });

  it("distinguishes repeated, conflicting, and invalid date evidence", () => {
    expect(extractTemporalEvidence({ text: "hôm nay hôm nay", referenceNow }).date).toEqual({
      state: "AMBIGUOUS",
      reason: "MULTIPLE_DATE_EXPRESSIONS",
    });
    expect(extractTemporalEvidence({ text: "hôm nay mai", referenceNow }).date).toEqual({
      state: "AMBIGUOUS",
      reason: "CONFLICTING_DATE_EXPRESSIONS",
    });
    expect(extractTemporalEvidence({ text: "2026-02-30", referenceNow }).date).toEqual({
      state: "AMBIGUOUS",
      reason: "INVALID_DATE",
    });
  });

  it("distinguishes repeated and invalid time evidence", () => {
    expect(extractTemporalEvidence({ text: "8h 8 giờ", referenceNow }).time).toEqual({
      state: "AMBIGUOUS",
      reason: "MULTIPLE_TIME_EXPRESSIONS",
    });
    expect(extractTemporalEvidence({ text: "25:00", referenceNow }).time).toEqual({
      state: "AMBIGUOUS",
      reason: "INVALID_TIME",
    });
  });

  it("does not finalize conflicting list ranges", () => {
    expect(extractTemporalEvidence({ text: "tuần này và 7 ngày tới", referenceNow }).range).toEqual({
      state: "AMBIGUOUS",
    });
  });
});

describe("mergeTemporalEvidence", () => {
  it("fills a missing time while preserving an already-resolved tomorrow date", () => {
    const previous = extractTemporalEvidence({
      text: "mai nhắc tui gọi khách",
      referenceNow,
    });
    const next = extractTemporalEvidence({ text: "9h", referenceNow });

    expect(mergeTemporalEvidence(previous, next)).toEqual({
      kind: "MERGED",
      evidence: {
        ...next,
        date: { state: "RESOLVED", source: "TOMORROW", localDate: "2026-09-17" },
        time: { state: "RESOLVED", source: "EXACT_TIME", localTime: "09:00" },
        range: { state: "RESOLVED", kind: "TOMORROW", localDate: null },
      },
    });
  });

  it("signals conflicts and never overwrites resolved prior evidence", () => {
    const previous = extractTemporalEvidence({
      text: "mai lúc 8 giờ",
      referenceNow,
    });
    const next = extractTemporalEvidence({
      text: "hôm nay lúc 9 giờ",
      referenceNow,
    });

    expect(mergeTemporalEvidence(previous, next)).toEqual({
      kind: "CONFLICT",
      conflicts: ["date", "time", "range"],
      evidence: previous,
    });
  });
});
