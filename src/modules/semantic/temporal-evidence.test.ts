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
  it.each(["9:/00", "9:-00", "9: /00", "9:./00", "9::/00", "9::./00"])(
    "retains the malformed clock dimension of mixed numeric separators: %s", (fragment) => {
      for (const text of [fragment, `8h rồi ${fragment}`, `${fragment} rồi 8h`, `8h; ${fragment}`, `${fragment}; 8h`]) {
        expect(extractTemporalEvidence({ text, referenceNow }).time, text)
          .toEqual({ state: "AMBIGUOUS", reason: "INVALID_TIME" });
      }
    },
  );

  it("retains both implicated dimensions for finite mixed numeric-starter mutations", () => {
    for (const dateSeparator of ["/", "-"]) {
      for (const clockSeparator of [":", "::", ":."]) {
        for (const gap of ["", " ", "\u00a0"]) {
          for (const run of [`${clockSeparator}${gap}${dateSeparator}`, `${dateSeparator}${gap}${clockSeparator}`]) {
            const fragment = `9${run}00`;
            for (const text of [fragment, `8h; ${fragment}`, `${fragment}; 8h`, `20/09; ${fragment}`, `${fragment}; 20/09`]) {
              expect(extractTemporalEvidence({ text, referenceNow }), text).toMatchObject({
                date: { state: "AMBIGUOUS", reason: "INVALID_DATE" },
                time: { state: "AMBIGUOUS", reason: "INVALID_TIME" },
                range: { state: "AMBIGUOUS" },
              });
            }
          }
        }
      }
    }
  });

  it.each(["20/09 9:00", "9:00 20/09", "2026-09-20; 9h", "9 giờ; 20/09/2026"])(
    "keeps valid numeric date/time ownership separate: %s", (text) => {
      expect(extractTemporalEvidence({ text, referenceNow })).toMatchObject({
        date: { state: "RESOLVED", localDate: "2026-09-20" },
        time: { state: "RESOLVED", localTime: "09:00" },
        range: { state: "RESOLVED", kind: "DATE", localDate: "2026-09-20" },
      });
    },
  );

  it.each(["; ", ", ", ". "])("keeps mixed starter ownership within its own side of %j", (boundary) => {
    for (const text of [`20/09${boundary}:/30`, `:/30${boundary}20/09`]) {
      expect(extractTemporalEvidence({ text, referenceNow }), text).toMatchObject({
        date: { state: "RESOLVED", localDate: "2026-09-20" },
        time: { state: "AMBIGUOUS", reason: "INVALID_TIME" },
        range: { state: "RESOLVED", kind: "DATE", localDate: "2026-09-20" },
      });
    }
  });

  it.each(["8:00::20/09", "8:00:::20/09", "8:00:: 20/09", "8:00 : : 20/09"])(
    "never repairs a malformed separator run with a later date: %s", (text) => {
      expect(extractTemporalEvidence({ text, referenceNow })).toMatchObject({
        time: { state: "AMBIGUOUS", reason: "INVALID_TIME" },
        date: { state: "RESOLVED", localDate: "2026-09-20" },
        range: { state: "RESOLVED", kind: "DATE", localDate: "2026-09-20" },
      });
    },
  );

  it.each([
    ["/09", "date"], ["/ 09", "date"], ["20/", "date"], ["20//", "date"],
    ["20/09/", "date"], ["20/09 /2027", "date"],
    [":30", "time"], [":.30", "time"], [":,30", "time"], [":;30", "time"],
    ["8:", "time"], ["8::", "time"], ["8:00:", "time"], ["8:00::30", "time"],
  ] as const)("retains incomplete starter %s alone and with same-dimension evidence", (fragment, dimension) => {
    const valid = dimension === "date" ? "20/09" : "8h";
    for (const text of [fragment, `${valid} ${fragment}`, `${valid} rồi ${fragment}`, `${fragment} rồi ${valid}`]) {
      const { evidence, diagnostics } = temporalEvidenceModule.inspectTemporalScanner({ text, referenceNow });
      expect(evidence[dimension], text).toMatchObject({ state: "AMBIGUOUS" });
      expect(diagnostics.candidateCount, text).toBeGreaterThan(0);
      if (dimension === "date") expect(evidence.range, text).toEqual({ state: "AMBIGUOUS" });
    }
  });

  it.each(["; ", ", ", ". "])("keeps separator-led fragments on their side of %j", (boundary) => {
    for (const fragment of ["/09", "/ 09", "//09", "/.09"]) {
      for (const text of [`8h${boundary}${fragment}`, `${fragment}${boundary}8h`]) {
        expect(extractTemporalEvidence({ text, referenceNow }), text).toMatchObject({
          time: { state: "RESOLVED", localTime: "08:00" },
          date: { state: "AMBIGUOUS", reason: "INVALID_DATE" },
          range: { state: "AMBIGUOUS" },
        });
      }
    }
    for (const fragment of [":30", ":.30", ":,30", ":;30"]) {
      for (const text of [`20/09${boundary}${fragment}`, `${fragment}${boundary}20/09`]) {
        expect(extractTemporalEvidence({ text, referenceNow }), text).toMatchObject({
          time: { state: "AMBIGUOUS", reason: "INVALID_TIME" },
          date: { state: "RESOLVED", localDate: "2026-09-20" },
          range: { state: "RESOLVED", kind: "DATE", localDate: "2026-09-20" },
        });
      }
    }
  });

  it("rejects finite generated internal-separator continuations without accepting a prefix", () => {
    const expressions = [
      ["8h", "time"], ["8:00", "time"], ["8 giờ", "time"],
      ["20/09", "date"], ["2026-09-20", "date"], ["mai", "date"],
      ["tuần này", "range"], ["7 ngày tới", "range"],
    ] as const;
    const internalSeparators = [":", "/", ".", "-"];
    for (const [expression, dimension] of expressions) {
      expect(extractTemporalEvidence({ text: expression, referenceNow })[dimension].state).toBe("RESOLVED");
      for (const first of internalSeparators) {
        for (const second of internalSeparators) {
          for (const spacing of ["", " ", "\u00a0"]) {
            // No safe sentence boundary inside the continuation: a period
            // followed by whitespace would start a separate fragment.
            const text = `${expression}${spacing}${first}${second}30`;
            expect(extractTemporalEvidence({ text, referenceNow })[dimension].state, text).toBe("AMBIGUOUS");
          }
        }
      }
    }
  });

  it("composes a finite matrix of safe boundaries and valid different dimensions", () => {
    for (const [date, localDate] of [["20/09", "2026-09-20"], ["mai", "2026-09-17"], ["2026-09-20", "2026-09-20"]]) {
      for (const time of ["8h", "8:00", "8 giờ"]) {
        for (const boundary of [" ", "\u00a0", ",", ", ", "; ", ". ", " : "]) {
          for (const text of [`${date}${boundary}${time}`, `${time}${boundary}${date}`]) {
            expect(extractTemporalEvidence({ text, referenceNow }), text).toMatchObject({
              date: { state: "RESOLVED", localDate },
              time: { state: "RESOLVED", localTime: "08:00" },
            });
          }
        }
      }
    }
  });

  it.each([["8h", "time"], ["20/09", "date"], ["tuần này", "range"]] as const)(
    "does not treat an internal colon after %s as a boundary before ordinary text", (expression, dimension) => {
      for (const spacing of [" ", "\u00a0", "\n"]) {
        const text = `${expression}${spacing}:${spacing}gọi khách`;
        expect(extractTemporalEvidence({ text, referenceNow })[dimension].state, text).toBe("AMBIGUOUS");
      }
    },
  );

  it.each(["8:00:", "8:00 :", "8h:", "8 giờ :"])(
    "retains the local malformed clock %s before independent date or range evidence", (clock) => {
      for (const separator of ["; ", ", ", ". ", ";\u00a0"]) {
        for (const [following, expected] of [
          ["20/09", { date: { state: "RESOLVED", localDate: "2026-09-20" },
            range: { state: "RESOLVED", kind: "DATE", localDate: "2026-09-20" } }],
          ["mai", { date: { state: "RESOLVED", localDate: "2026-09-17" },
            range: { state: "RESOLVED", kind: "TOMORROW", localDate: null } }],
          ["tuần này", { date: { state: "MISSING" },
            range: { state: "RESOLVED", kind: "THIS_WEEK", localDate: null } }],
        ] as const) {
          for (const text of [`${clock}${separator}${following}`, `${following}${separator}${clock}`]) {
            expect(extractTemporalEvidence({ text, referenceNow }), text).toMatchObject({
              ...expected, time: { state: "AMBIGUOUS", reason: "INVALID_TIME" },
            });
          }
        }
      }
    },
  );

  it.each([
    ["20/09", "ngày 21", "date"],
    ["tuần này", "8 ngày tới", "range"],
    ["tuần này", "07 ngày tới", "range"],
    ["8h", ":30", "time"],
  ] as const)("collects incomplete or unsupported starters %s / %s in both orders", (
    valid, malformed, dimension,
  ) => {
    for (const text of [malformed, `${valid} rồi ${malformed}`, `${malformed} rồi ${valid}`]) {
      const { evidence, diagnostics } = temporalEvidenceModule.inspectTemporalScanner({ text, referenceNow });
      expect(evidence[dimension].state, text).toBe("AMBIGUOUS");
      expect(diagnostics.candidateCount, text).toBeGreaterThan(0);
      if (dimension === "date") expect(evidence.range, text).toEqual({ state: "AMBIGUOUS" });
    }
  });

  it.each(["ngày 20/09", "ngày 2026-09-20"])(
    "recognizes the complete numeric date after its day introducer: %s", (text) => {
      expect(extractTemporalEvidence({ text, referenceNow })).toMatchObject({
        date: { state: "RESOLVED", localDate: "2026-09-20" },
        range: { state: "RESOLVED", kind: "DATE", localDate: "2026-09-20" },
        time: { state: "MISSING" },
      });
    },
  );

  it("keeps ordinary numbers without temporal productions absent", () => {
    expect(extractTemporalEvidence({ text: "nhắc gọi 21 khách", referenceNow })).toMatchObject({
      date: { state: "MISSING" }, time: { state: "MISSING" }, range: { state: "MISSING" },
    });
  });

  it.each([
    ["8h", "ngày 21", { time: { state: "RESOLVED", localTime: "08:00" },
      date: { state: "AMBIGUOUS" }, range: { state: "AMBIGUOUS" } }],
    ["8h", "8 ngày tới", { time: { state: "RESOLVED", localTime: "08:00" },
      date: { state: "MISSING" }, range: { state: "AMBIGUOUS" } }],
    ["8h", "07 ngày tới", { time: { state: "RESOLVED", localTime: "08:00" },
      date: { state: "MISSING" }, range: { state: "AMBIGUOUS" } }],
    ["20/09", ":30", { date: { state: "RESOLVED", localDate: "2026-09-20" },
      range: { state: "RESOLVED", kind: "DATE" }, time: { state: "AMBIGUOUS" } }],
  ] as const)("keeps %s independent of the malformed starter %s", (valid, malformed, expected) => {
    for (const separator of [" rồi ", "; ", ", ", ". "]) {
      for (const text of [`${valid}${separator}${malformed}`, `${malformed}${separator}${valid}`]) {
        expect(extractTemporalEvidence({ text, referenceNow }), text).toMatchObject(expected);
      }
    }
  });

  it.each(["; ", ", ", ". ", ";\u00a0"])(
    "assigns leading date syntax after %j to the following date in either order", (separator) => {
      for (const clock of ["8h", "8:00", "8 giờ"]) {
        for (const malformed of ["/21/09", "-21/09", "/ 21/09", "--21/09"]) {
          for (const text of [`${clock}${separator}${malformed}`, `${malformed}${separator}${clock}`]) {
            expect(extractTemporalEvidence({ text, referenceNow }), text).toMatchObject({
              time: { state: "RESOLVED", localTime: "08:00" },
              date: { state: "AMBIGUOUS", reason: "INVALID_DATE" },
              range: { state: "AMBIGUOUS" },
            });
          }
        }
      }
    },
  );

  it.each(["8h /21/09", "8h -21/09", "8h/21/09"])(
    "keeps overlapping date syntax without a message delimiter conservative: %s", (text) => {
      expect(extractTemporalEvidence({ text, referenceNow })).toMatchObject({
        time: { state: "AMBIGUOUS", reason: "INVALID_TIME" },
        date: { state: "AMBIGUOUS", reason: "INVALID_DATE" },
      });
    },
  );

  it.each([
    "\u0009", "\u000a", "\u000b", "\u000c", "\u000d", "\u0020", "\u0085",
    "\u00a0", "\u1680", "\u2000", "\u2001", "\u2002", "\u2003", "\u2004",
    "\u2005", "\u2006", "\u2007", "\u2008", "\u2009", "\u200a", "\u2028",
    "\u2029", "\u202f", "\u205f", "\u3000", "\ufeff",
  ])("treats lexical whitespace %j consistently without losing temporal fragments", (space) => {
    for (const text of [`20/09${space}/2027`, `mai${space}mốt`]) {
      const evidence = extractTemporalEvidence({ text, referenceNow });
      expect(evidence.date, text).toEqual({ state: "AMBIGUOUS", reason: "INVALID_DATE" });
      expect(evidence.range, text).toEqual({ state: "AMBIGUOUS" });
    }
    expect(extractTemporalEvidence({ text: `8:00${space}:30`, referenceNow }).time)
      .toEqual({ state: "AMBIGUOUS", reason: "INVALID_TIME" });
    expect(extractTemporalEvidence({ text: `8h rồi 9${space}giờ`, referenceNow }).time)
      .toEqual({ state: "AMBIGUOUS", reason: "MULTIPLE_TIME_EXPRESSIONS" });
    expect(extractTemporalEvidence({ text: `mai${space}8${space}giờ`, referenceNow }))
      .toMatchObject({
        date: { state: "RESOLVED", localDate: "2026-09-17" },
        time: { state: "RESOLVED", localTime: "08:00" },
      });
  });

  it.each([
    "8:00 a.m.", "8:00 a. m.", "8:00 p.m", "8:00 a.m", "8:00 p . m",
    "8:00h", "8:00giờ", "8:00 h", "8:00 giờ", "8:00.30", "8:00 .30",
    "8:00:", "8:00 :", "8:00 a.", "8:00 p.",
    "8:00 a..m.", "8:00 p . m .",
  ])("rejects unsupported clock productions rather than accepting their prefix: %s", (text) => {
    expect(extractTemporalEvidence({ text, referenceNow }).time)
      .toEqual({ state: "AMBIGUOUS", reason: "INVALID_TIME" });
  });

  it.each([
    ["mai--mốt", "date"], ["mai: mốt", "date"], ["mai/2027", "date"],
    ["mai2", "date"], ["mai... / -- mốt", "date"],
    ["tuần này7", "range"], ["tuần này.7", "range"],
    ["7 ngày tới.7", "range"], ["sắp tới7", "range"],
  ] as const)("collects malformed relative and range endings: %s", (text, dimension) => {
    const evidence = extractTemporalEvidence({ text, referenceNow });
    expect(evidence[dimension].state).toBe("AMBIGUOUS");
    expect(evidence.range).toEqual({ state: "AMBIGUOUS" });
  });

  it.each([
    ["20/09", "ngày/21 tháng 9", "date"],
    ["20/09", "21tháng9", "date"],
    ["20/09", "21 tháng /9", "date"],
    ["20/09", "21 tháng 9năm2027", "date"],
    ["tuần này", "tuần/ này", "range"],
    ["tuần này", "tuần / này", "range"],
    ["tuần này", "tuần này/7", "range"],
    ["tuần này", "7ngày tới", "range"],
    ["tuần này", "7 ngày/tới", "range"],
    ["tuần này", "7 ngày tới/7", "range"],
    ["tuần này", "sắp/ tới", "range"],
    ["tuần này", "sắp / tới", "range"],
    ["tuần này", "sắp tới/7", "range"],
    ["8h", "lúc/9 giờ", "time"],
    ["8h", "9: 00", "time"],
    ["8h", "9:00.30", "time"],
  ] as const)("retains malformed %s / %s candidates alone and in both orders", (
    valid, malformed, dimension,
  ) => {
    for (const text of [malformed, `${valid} rồi ${malformed}`, `${malformed} rồi ${valid}`]) {
      const { evidence, diagnostics } = temporalEvidenceModule.inspectTemporalScanner({
        text, referenceNow,
      });
      expect(evidence[dimension].state, text).toBe("AMBIGUOUS");
      expect(diagnostics.candidateCount, text).toBeGreaterThan(0);
      if (dimension === "date") expect(evidence.range, text).toEqual({ state: "AMBIGUOUS" });
    }
  });

  it.each([",", ", ", ". ", "; ", " : "])(
    "uses %j as a boundary between independent temporal expressions in either order", (separator) => {
      for (const text of [`20/09${separator}8h`, `8h${separator}20/09`]) {
        expect(extractTemporalEvidence({ text, referenceNow }), text).toMatchObject({
          date: { state: "RESOLVED", source: "DAY_MONTH", localDate: "2026-09-20" },
          time: { state: "RESOLVED", source: "EXACT_TIME", localTime: "08:00" },
        });
      }
      for (const text of [`20/09${separator}8:00 .30`, `8:00 .30${separator}20/09`]) {
        expect(extractTemporalEvidence({ text, referenceNow }), text).toMatchObject({
          date: { state: "RESOLVED", localDate: "2026-09-20" },
          time: { state: "AMBIGUOUS", reason: "INVALID_TIME" },
        });
      }
      for (const text of [`8h${separator}21tháng9`, `21tháng9${separator}8h`]) {
        expect(extractTemporalEvidence({ text, referenceNow }), text).toMatchObject({
          date: { state: "AMBIGUOUS", reason: "INVALID_DATE" },
          time: { state: "RESOLVED", localTime: "08:00" },
        });
      }
    },
  );

  it.each([
    ["20/09", "21./09", "date"],
    ["20/09", "21, /09", "date"],
    ["20/09", "/21/09", "date"],
    ["8h", "9.:00", "time"],
    ["8h", "9,. :00", "time"],
  ] as const)("collects numeric syntax errors instead of discarding them: %s / %s", (
    valid, malformed, dimension,
  ) => {
    for (const text of [malformed, `${valid} rồi ${malformed}`, `${malformed} rồi ${valid}`]) {
      const evidence = extractTemporalEvidence({ text, referenceNow });
      expect(evidence[dimension], text).toEqual({
        state: "AMBIGUOUS", reason: dimension === "date" ? "INVALID_DATE" : "INVALID_TIME",
      });
    }
  });

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
      `mai${"-. \u00a0".repeat(256)}mốt, 8h`,
      `21${"., ".repeat(256)}/09 rồi 8h`,
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
