import { describe, expect, it } from "vitest";
import { resolveQuery } from "./query";
import { lunarCalendar } from "../lunar-calendar";
import { date, now } from "./resolution-test-support";
import type { QueryOperand } from "./contracts";
import vectors from "../../../../tools/calendar/reference-vectors.json";
import artifact from "../lunar-vn-months.json";

const list = (period: Extract<QueryOperand, { kind: "LIST" }>["period"]): QueryOperand => ({ kind: "LIST", period, statusScope: "DEFAULT", evidence: [{ kind: "USER_QUOTE", turn: 0, quote: "query", occurrence: 1 }] });
describe("read-only temporal operands", () => {
  it.each([
    [{ kind: "DAY", date: { kind: "RELATIVE_DAY", offsetDays: 0 } }, "2026-09-28T00:00:00+07:00", "2026-09-29T00:00:00+07:00"],
    [{ kind: "WEEK", offset: 0 }, "2026-09-28T00:00:00+07:00", "2026-10-05T00:00:00+07:00"],
    [{ kind: "WEEK", offset: 1 }, "2026-10-05T00:00:00+07:00", "2026-10-12T00:00:00+07:00"],
    [{ kind: "WEEKEND", offset: 0 }, "2026-10-03T00:00:00+07:00", "2026-10-05T00:00:00+07:00"],
    [{ kind: "MONTH", offset: 0 }, "2026-09-01T00:00:00+07:00", "2026-10-01T00:00:00+07:00"],
    [{ kind: "REST_OF_MONTH" }, "2026-09-28T10:00:00+07:00", "2026-10-01T00:00:00+07:00"],
    [{ kind: "NEXT_7_DAYS" }, "2026-09-28T00:00:00+07:00", "2026-10-05T00:00:00+07:00"],
    [{ kind: "UPCOMING" }, "2026-09-28T10:00:00+07:00", "2026-10-28T10:00:00+07:00"],
    [{ kind: "DATE_BOUNDS", from: date(1, 10, 2026), through: date(31, 10, 2026) }, "2026-10-01T00:00:00+07:00", "2026-11-01T00:00:00+07:00"],
  ])("R01 interval %j", (period, start, end) => {
    expect(resolveQuery(list(period as never), now, lunarCalendar)).toMatchObject({ status: "RANGE", start: Date.parse(start), end: Date.parse(end), scopeLabel: expect.stringContaining("cuộc trò chuyện") });
  });
  it.each([["2026-12-31T23:59:00+07:00", 1, "2027-01-01", "2027-02-01"], ["2024-02-15T10:00:00+07:00", 0, "2024-02-01", "2024-03-01"]] as const)("month boundary %s", (receipt, offset, from, through) => {
    expect(resolveQuery(list({ kind: "MONTH", offset }), Date.parse(receipt), lunarCalendar)).toMatchObject({ status: "RANGE", start: Date.parse(`${from}T00:00:00+07:00`), end: Date.parse(`${through}T00:00:00+07:00`) });
  });
  it.each([null, { kind: "DAY", date: null }, { kind: "DATE_BOUNDS", from: date(), through: null }])("missing query range %j clarifies", period => {
    expect(resolveQuery(list(period as never), now, lunarCalendar).status).toBe("CLARIFY");
  });
  it.each([[date(10), date(9)], [date(1, 1, 2025), date(2, 1, 2025)], [date(1, 10, 2027), date(2, 10, 2027)], [date(28, 9, 2025), date(28, 9, 2027)]])("bad explicit bounds refuse %j %j", (from, through) => {
    expect(resolveQuery(list({ kind: "DATE_BOUNDS", from, through }), now, lunarCalendar).status).toBe("REJECTED");
  });
  it("R09 calendar lookup is actual conversion in both directions", () => {
    const evidence = list(null).evidence;
    expect(resolveQuery({ kind: "CALENDAR_DATE", date: { kind: "RELATIVE_DAY", offsetDays: 0 }, outputCalendar: "LUNAR_VN", evidence }, Date.parse("2004-03-21T10:00:00+07:00"), lunarCalendar)).toMatchObject({ status: "CALENDAR_DATE", solar: "2004-03-21", lunar: { year: 2004, month: 2, day: 1, leap: true }, convention: lunarCalendar.version });
    expect(resolveQuery({ kind: "CALENDAR_DATE", date: { kind: "CIVIL_DATE", calendar: "LUNAR_VN", day: 1, month: 2, year: 2004, leapMonth: true }, outputCalendar: "GREGORIAN", evidence }, now, lunarCalendar)).toMatchObject({ status: "CALENDAR_DATE", solar: "2004-03-21" });
  });
  it.each(vectors.vectors)("R16 reference solar/lunar roundtrip $solarDate", vector => {
    const evidence = list(null).evidence;
    const { solarDate, year, month, day, leap } = vector;
    const a = resolveQuery({ kind: "CALENDAR_DATE", date: date(Number(solarDate.slice(8)), Number(solarDate.slice(5, 7)), Number(solarDate.slice(0, 4))), outputCalendar: "LUNAR_VN", evidence }, now, lunarCalendar);
    expect(a).toMatchObject({ status: "CALENDAR_DATE", solar: solarDate, lunar: { year, month, day, leap } });
    expect(resolveQuery({ kind: "CALENDAR_DATE", date: { kind: "CIVIL_DATE", calendar: "LUNAR_VN", day, month, year, leapMonth: leap }, outputCalendar: "GREGORIAN", evidence }, now, lunarCalendar)).toMatchObject({ status: "CALENDAR_DATE", solar: solarDate });
  });
  it("R16_all_artifact_month_starts_ends_reference_neighbors_and_coverage_edges", () => {
    for (const month of artifact.months) for (const day of [1, month.days]) {
      const solar = new Date(Date.parse(`${month.start}T00:00:00Z`) + (day - 1) * 86400000).toISOString().slice(0, 10);
      const operand = date(Number(solar.slice(8)), Number(solar.slice(5, 7)), Number(solar.slice(0, 4)));
      expect(resolveQuery({ kind: "CALENDAR_DATE", date: operand, outputCalendar: "LUNAR_VN", evidence: list(null).evidence }, now, lunarCalendar)).toMatchObject({ status: "CALENDAR_DATE", solar, lunar: { year: month.year, month: month.month, day, leap: month.leap } });
    }
    for (const vector of vectors.vectors) for (const offset of [-1, 1]) {
      const solar = new Date(Date.parse(vector.solarDate) + offset * 86400000).toISOString().slice(0, 10);
      const operand = date(Number(solar.slice(8)), Number(solar.slice(5, 7)), Number(solar.slice(0, 4)));
      const actual = resolveQuery({ kind: "CALENDAR_DATE", date: operand, outputCalendar: "LUNAR_VN", evidence: list(null).evidence }, now, lunarCalendar), expected = lunarCalendar.toLunar(solar);
      expect(actual).toMatchObject(expected ? { status: "CALENDAR_DATE", solar, lunar: expected } : { status: "REJECTED", reason: "CALENDAR_OUT_OF_RANGE" });
    }
    for (const [solar, status] of [["1900-01-30", "REJECTED"], ["1900-01-31", "CALENDAR_DATE"], ["2101-01-28", "CALENDAR_DATE"], ["2101-01-29", "REJECTED"]]) expect(resolveQuery({ kind: "CALENDAR_DATE", date: date(Number(solar.slice(8)), Number(solar.slice(5, 7)), Number(solar.slice(0, 4))), outputCalendar: "LUNAR_VN", evidence: list(null).evidence }, now, lunarCalendar).status).toBe(status);
  });
  it("weekday_unknown_qualifier_never_guesses_and_leap_February_date_is_valid", () => {
    expect(resolveQuery(list({ kind: "DAY", date: { kind: "WEEKDAY", weekday: 1, qualifier: "UNRESOLVED" } }), now, lunarCalendar)).toMatchObject({ status: "CLARIFY", reason: "AMBIGUOUS_WEEK" });
    expect(resolveQuery(list({ kind: "DAY", date: { kind: "WEEKDAY", weekday: 1, qualifier: "NEXT_WEEK" } }), now, lunarCalendar)).toMatchObject({ status: "RANGE", start: Date.parse("2026-10-05T00:00:00+07:00") });
    expect(resolveQuery(list({ kind: "DAY", date: date(29, 2) }), Date.parse("2024-02-01T00:00:00+07:00"), lunarCalendar)).toMatchObject({ status: "RANGE", start: Date.parse("2024-02-29T00:00:00+07:00"), end: Date.parse("2024-03-01T00:00:00+07:00") });
  });
});
