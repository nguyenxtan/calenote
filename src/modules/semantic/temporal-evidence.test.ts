import { describe, expect, it, vi } from "vitest";
import * as temporalEvidenceModule from "./temporal-evidence";
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

  it.each([
    ["8 giờ 30", "INVALID_TIME"],
    ["8 giờ 60", "INVALID_TIME"],
    ["8 giờ tối", "MULTIPLE_TIME_EXPRESSIONS"],
  ] as const)("fails closed for the unsupported exact-time continuation %s", (text, reason) => {
    expect(extractTemporalEvidence({ text, referenceNow }).time).toEqual({
      state: "AMBIGUOUS",
      reason,
    });
  });

  it.each([
    ["8:00 tối", "MULTIPLE_TIME_EXPRESSIONS"],
    ["lúc 8:00 tối", "MULTIPLE_TIME_EXPRESSIONS"],
    ["8:00 pm", "MULTIPLE_TIME_EXPRESSIONS"],
    ["8:00:30", "INVALID_TIME"],
  ] as const)("fails closed for the unsupported colon-time continuation %s", (text, reason) => {
    expect(extractTemporalEvidence({ text, referenceNow }).time).toEqual({
      state: "AMBIGUOUS",
      reason,
    });
  });

  it.each([
    "20/09/26",
    "ngày 20 tháng 9 năm 20",
  ])("fails closed for the incomplete explicit year %s", (text) => {
    const evidence = extractTemporalEvidence({ text, referenceNow });
    expect(evidence.date).toEqual({ state: "AMBIGUOUS", reason: "INVALID_DATE" });
    expect(evidence.range).toEqual({ state: "AMBIGUOUS" });
  });

  it.each([
    "2026-09-20/7",
    "20/09/2026/7",
    "ngày 20 tháng 9 năm 2026/7",
    "20/09/abcd",
    "ngày 20 tháng 9 năm abc",
  ])("does not resolve a date or range from the malformed continuation %s", (text) => {
    const evidence = extractTemporalEvidence({ text, referenceNow });
    expect(evidence.date).toEqual({ state: "AMBIGUOUS", reason: "INVALID_DATE" });
    expect(evidence.range).toEqual({ state: "AMBIGUOUS" });
  });

  it.each([
    "mai mốt",
    "ngày mai mốt",
  ])("does not resolve tomorrow from the unsupported relative continuation %s", (text) => {
    const evidence = extractTemporalEvidence({ text, referenceNow });
    expect(evidence.date).toEqual({ state: "AMBIGUOUS", reason: "INVALID_DATE" });
    expect(evidence.range).toEqual({ state: "AMBIGUOUS" });
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

describe("bounded temporal grammar scanner", () => {
  it.each([
    ["20/09 /2027", "date"],
    ["8:00 :30", "time"],
    ["8 giờ rưỡi", "time"],
    ["8:00 p.m.", "time"],
    ["mai-mốt", "date"],
    ["ngày mai-mốt", "date"],
  ] as const)("rejects the complete unsupported expression %s", (text, dimension) => {
    const evidence = extractTemporalEvidence({ text, referenceNow });
    if (dimension === "date") {
      expect(evidence.date).toEqual({ state: "AMBIGUOUS", reason: "INVALID_DATE" });
      expect(evidence.range).toEqual({ state: "AMBIGUOUS" });
    } else {
      expect(evidence.time).toEqual({ state: "AMBIGUOUS", reason: "INVALID_TIME" });
    }
  });

  it.each([
    "8 :00",
    "8::00",
    "8h30",
    "8h-30",
    "8h,30",
    "8:00::30",
    "8 h",
    "8giờ",
    "8:00abc",
    "8:00 p. m.",
  ])("rejects adversarial time separators and suffixes in %s", (text) => {
    expect(extractTemporalEvidence({ text, referenceNow }).time).toEqual({
      state: "AMBIGUOUS",
      reason: "INVALID_TIME",
    });
  });

  it.each([
    "20 /09",
    "20//09",
    "20/09//2027",
    "20/09,2027",
    "20/09, 2027",
    "20/09.2027",
    "20/09abc",
    "2026-09-20:7",
    "ngày 20 tháng 9 năm",
  ])("rejects adversarial date separators and suffixes in %s", (text) => {
    const evidence = extractTemporalEvidence({ text, referenceNow });
    expect(evidence.date).toEqual({ state: "AMBIGUOUS", reason: "INVALID_DATE" });
    expect(evidence.range).toEqual({ state: "AMBIGUOUS" });
  });

  it("scans the complete message before resolving a range", () => {
    expect(extractTemporalEvidence({
      text: "tuần này và tuần này/7",
      referenceNow,
    }).range).toEqual({ state: "AMBIGUOUS" });
  });

  it("rejects punctuation-separated relative-date extensions", () => {
    const evidence = extractTemporalEvidence({ text: "mai / mốt", referenceNow });
    expect(evidence.date).toEqual({ state: "AMBIGUOUS", reason: "INVALID_DATE" });
    expect(evidence.range).toEqual({ state: "AMBIGUOUS" });
  });

  it.each([
    ["8h 20/09", "DAY_MONTH", "2026-09-20", "08:00"],
    ["20/09 8h", "DAY_MONTH", "2026-09-20", "08:00"],
    ["mai 8h", "TOMORROW", "2026-09-17", "08:00"],
  ] as const)("resolves independent valid date and time expressions in %s", (
    text,
    source,
    localDate,
    localTime,
  ) => {
    const evidence = extractTemporalEvidence({ text, referenceNow });
    expect(evidence.date).toEqual({ state: "RESOLVED", source, localDate });
    expect(evidence.time).toEqual({ state: "RESOLVED", source: "EXACT_TIME", localTime });
  });

  it("does not cross-poison unrelated dimensions", () => {
    const malformedTime = extractTemporalEvidence({ text: "20/09 8:00 :30", referenceNow });
    expect(malformedTime.date).toEqual({
      state: "RESOLVED",
      source: "DAY_MONTH",
      localDate: "2026-09-20",
    });
    expect(malformedTime.time).toEqual({ state: "AMBIGUOUS", reason: "INVALID_TIME" });

    const malformedDate = extractTemporalEvidence({ text: "8h 20/09 /2027", referenceNow });
    expect(malformedDate.time).toEqual({
      state: "RESOLVED",
      source: "EXACT_TIME",
      localTime: "08:00",
    });
    expect(malformedDate.date).toEqual({ state: "AMBIGUOUS", reason: "INVALID_DATE" });
  });

  it("fails closed when a valid time is followed by a malformed time", () => {
    expect(extractTemporalEvidence({
      text: "8h rồi 8:00 :30",
      referenceNow,
    }).time).toEqual({ state: "AMBIGUOUS", reason: "INVALID_TIME" });
  });

  it("fails closed when a valid date is followed by a malformed date", () => {
    const evidence = extractTemporalEvidence({
      text: "20/09 rồi 21/09 /2027",
      referenceNow,
    });
    expect(evidence.date).toEqual({ state: "AMBIGUOUS", reason: "INVALID_DATE" });
    expect(evidence.range).toEqual({ state: "AMBIGUOUS" });
  });

  it("exposes deterministic bounded-work diagnostics with zero external calls", () => {
    const inspectTemporalScanner = Reflect.get(
      temporalEvidenceModule,
      "inspectTemporalScanner",
    ) as undefined | ((input: { text: string; referenceNow: number }) => {
      evidence: ReturnType<typeof extractTemporalEvidence>;
      diagnostics: {
        strategy: string;
        inputCodeUnits: number;
        lexicalSteps: number;
        tokenCount: number;
        grammarSteps: number;
        candidateCount: number;
        llmCalls: number;
        networkCalls: number;
        dbCalls: number;
      };
    });
    expect(inspectTemporalScanner).toBeTypeOf("function");
    if (inspectTemporalScanner === undefined) return;

    const inputs = [
      "mai 8h nhắc tui gọi khách",
      "8h 20/09 rồi xem tuần này",
      "20//09 8:00 :30 mai-mốt ".repeat(40).slice(0, 1_024),
    ];
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    try {
      for (const text of inputs) {
        const first = inspectTemporalScanner({ text, referenceNow });
        const second = inspectTemporalScanner({ text, referenceNow });
        expect(second).toEqual(first);
        expect(first.evidence).toEqual(extractTemporalEvidence({ text, referenceNow }));
        expect(first.diagnostics).toMatchObject({
          strategy: "SINGLE_LINEAR_LEXICAL_SCAN_BOUNDED_GRAMMAR",
          inputCodeUnits: text.length,
          llmCalls: 0,
          networkCalls: 0,
          dbCalls: 0,
        });
        expect(first.diagnostics.lexicalSteps).toBeLessThanOrEqual(text.length + 1);
        expect(first.diagnostics.grammarSteps).toBeLessThanOrEqual(
          first.diagnostics.tokenCount * 4 + 4,
        );
        expect(first.diagnostics.candidateCount).toBeLessThanOrEqual(
          first.diagnostics.tokenCount + 1,
        );
      }
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
