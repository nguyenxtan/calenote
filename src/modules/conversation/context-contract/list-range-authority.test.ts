// @vitest-environment node
import { expect, it } from "vitest";
import { harness, type Proposal } from "./service-test-support";
import type { QueryOperand } from "./contracts";

type Period = Extract<QueryOperand, { kind: "LIST" }>["period"];

const separators = [{ open: " ", close: "" }, { open: ", ", close: "" }, { open: ": ", close: "" }, { open: "; ", close: "" }, { open: " — ", close: "" }, { open: " (", close: ")" }, { open: " [", close: "]" }, { open: ". ", close: "" }, { open: "\n", close: "" }];
const civilDate = (day: number, calendar: "GREGORIAN" | "LUNAR_VN" = "GREGORIAN") => ({ kind: "CIVIL_DATE" as const, calendar, day, month: 1, year: 2026, leapMonth: calendar === "LUNAR_VN" ? false : null });
const civilForms = [
  (day: number) => `${day}/1/2026`,
  (day: number) => `2026-01-${String(day).padStart(2, "0")}`,
  (day: number) => `ngày ${day} tháng 1 năm 2026`,
];
const civilModifierNegatives = civilForms.flatMap(form => separators.flatMap(({ open, close }) =>
  ["năm 2027", "năm 26", "âm lịch", "dương", "tháng nhuận", "tháng thường", "không nhuận", "lịch âm"].flatMap(qualifier => {
    const attached = `${open}${qualifier}${close}`;
    return [
      { text: form(1) + attached, period: { kind: "DAY", date: civilDate(1) } as Period },
      { text: `từ ${form(1)}${attached} đến ${form(2)}`, period: { kind: "DATE_BOUNDS", from: civilDate(1), through: civilDate(2) } as Period },
      { text: `từ ${form(1)} đến ${form(2)}${attached}`, period: { kind: "DATE_BOUNDS", from: civilDate(1), through: civilDate(2) } as Period },
    ];
  })));
const completeCivilPositives = civilForms.flatMap(form => (["GREGORIAN", "LUNAR_VN"] as const).flatMap(calendar => {
  const qualifier = calendar === "GREGORIAN" ? " dương lịch" : " âm lịch không nhuận";
  // Literal civil boundaries: Gregorian New Year and Vietnamese Tết 2026.
  const start = calendar === "GREGORIAN" ? "2026-01-01" : "2026-02-17";
  const next = calendar === "GREGORIAN" ? "2026-01-02" : "2026-02-18";
  const throughEnd = calendar === "GREGORIAN" ? "2026-01-03" : "2026-02-19";
  return [
    { text: form(1) + qualifier, period: { kind: "DAY", date: civilDate(1, calendar) } as Period, start: start + "T00:00:00+07:00", end: next + "T00:00:00+07:00" },
    { text: `từ ${form(1)}${qualifier} đến ${form(2)}${qualifier}`, period: { kind: "DATE_BOUNDS", from: civilDate(1, calendar), through: civilDate(2, calendar) } as Period, start: start + "T00:00:00+07:00", end: throughEnd + "T00:00:00+07:00" },
  ];
}));

it.each(civilModifierNegatives)("civil modifier ownership clarifies before zero actual reads: $text", async ({ text, period }) => {
  const h = await harness([list(period)]); let executions = 0; const actualList = h.deps.list;
  h.deps.list = input => { executions++; return actualList(input); };
  const result = await h.turn(0, text);
  expect(executions, "DATABASE_QUERY_WITHOUT_RANGE").toBe(0);
  expect(result).toEqual({ status: "CLARIFICATION_REQUESTED" });
  expect((await h.read(1))?.pendingQueryQuestion?.field).toBe("queryRange");
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});
it.each(completeCivilPositives)("complete inline civil evidence executes literal bounds: $text", async ({ text, period, start, end }) => {
  const h = await harness([list(period)]); const ranges: unknown[] = []; const actualList = h.deps.list;
  h.deps.list = input => { ranges.push(input.range); return actualList(input); };
  expect(await h.turn(0, text)).toEqual({ status: "REMINDERS_LISTED" });
  expect(ranges).toEqual([{ start: Date.parse(start), end: Date.parse(end) }]);
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});

const listRangeBoundaryNegatives: { text: string; period: Period; family: string }[] = [
  ...["Có lịch nhưng", "Có lịch, nhưng", "Có lịch còn", "Có lịch tuy nhiên", "Có lịch từ lạ", "Có lịch,"].flatMap(prefix => ["không", "ko"].map(negator => ({ text: `${prefix} ${negator} trong tháng này`, period: { kind: "MONTH", offset: 0 } as Period, family: "UNKNOWN_OR_CONTRASTIVE_PREFIX" }))),
  ...separators.flatMap(({ open, close }) => ["không", "ko", "chẳng", "đừng"].map(negator => ({ text: `tháng này${open}${negator} xem${close}`, period: { kind: "MONTH", offset: 0 } as Period, family: "ATTACHED_NEGATIVE_SUFFIX" }))),
  ...separators.flatMap(({ open, close }) => ["năm 26", "năm", "âm lịch", "dương", "nhuận", "không nhuận", "lịch âm"].map(qualifier => ({ text: `tháng 10${open}${qualifier}${close}`, period: { kind: "MONTH", offset: 1 } as Period, family: "ATTACHED_UNSUPPORTED_MONTH_QUALIFIER" }))),
];
const listRangeBoundaryPositives: { text: string; period: Period; start: string; end: string }[] = [
  ...["Có lịch gì không trong tháng này?", "Có lịch nào ko trong tháng này?", "Có việc gì không trong tháng này?", "Có buổi hẹn nào không trong tháng này?", "Có lời nhắc gì ko trong tháng này?", "Tháng này có lịch gì không?"].map(text => ({ text, period: { kind: "MONTH", offset: 0 } as Period, start: "2026-09-01T00:00:00+07:00", end: "2026-10-01T00:00:00+07:00" })),
  ...["tháng 10", "tháng 10 năm 2026", "tháng 10 năm 2026 dương lịch", "tháng 10?"].map(text => ({ text, period: { kind: "MONTH", offset: 1 } as Period, start: "2026-10-01T00:00:00+07:00", end: "2026-11-01T00:00:00+07:00" })),
  { text: "ngày 5/10/2026 dương lịch", period: { kind: "DAY", date: { kind: "CIVIL_DATE", calendar: "GREGORIAN", day: 5, month: 10, year: 2026, leapMonth: null } }, start: "2026-10-05T00:00:00+07:00", end: "2026-10-06T00:00:00+07:00" },
];
const list = (period: Period): Proposal => input => ({ schemaVersion: "calenote-context-3", intent: "LIST_REMINDERS", requestTarget: null, changes: [], query: { kind: "LIST", period, statusScope: "DEFAULT", evidence: [{ kind: "USER_QUOTE", turn: input.currentTurn, quote: input.turns[input.currentTurn].text, occurrence: 1 }] }, uncertainties: period ? [] : [{ field: "queryRange", reason: "MISSING", alternatives: [] }], conversationDirective: period ? null : { kind: "ASK_FOR_FIELD", field: "queryRange" }, replyProposal: null });
it.each(listRangeBoundaryNegatives)("production boundary makes zero actual reads: $family / $text", async ({ text, period }) => {
  const h = await harness([list(period)]); let executions = 0; const actualList = h.deps.list;
  h.deps.list = input => { executions++; return actualList(input); };
  const result = await h.turn(0, text);
  expect(executions, "DATABASE_QUERY_WITHOUT_RANGE").toBe(0);
  expect(result).toEqual({ status: "CLARIFICATION_REQUESTED" });
  expect((await h.read(1))?.pendingQueryQuestion?.field).toBe("queryRange");
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});
it.each(listRangeBoundaryPositives)("positive bounded production executes only exact requested bounds: $text", async ({ text, period, start, end }) => {
  const h = await harness([list(period)]); const ranges: unknown[] = []; const actualList = h.deps.list;
  h.deps.list = input => { ranges.push(input.range); return actualList(input); };
  expect(await h.turn(0, text)).toEqual({ status: "REMINDERS_LISTED" });
  expect(ranges).toEqual([{ start: Date.parse(start), end: Date.parse(end) }]);
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});
const attempted: Period[] = [{ kind: "DAY", date: { kind: "RELATIVE_DAY", offsetDays: 0 } }, { kind: "MONTH", offset: 0 }, { kind: "REST_OF_MONTH" }, { kind: "NEXT_7_DAYS" }, { kind: "UPCOMING" }, { kind: "WEEK", offset: 0 }];
const negatives = ["Có lịch nào ko?", "xem lịch giúp tui", "tui có lịch gì không?", "arbitrary non-temporal utterance"].flatMap(text => attempted.map(period => ({ text, period })));
it.each(negatives)("MODEL_INVENTED_RANGE_REJECTED: $text / $period.kind", async ({ text, period }) => {
  const h = await harness([list(period)]);
  let executions = 0; const actualList = h.deps.list;
  h.deps.list = input => { executions++; return actualList(input); };
  expect(await h.turn(0, text)).toEqual({ status: "CLARIFICATION_REQUESTED" });
  expect(executions, "DATABASE_QUERY_WITHOUT_RANGE").toBe(0);
  expect((await h.read(1))?.pendingQueryQuestion?.field, "GENERIC_QUERY_WITHOUT_RANGE").toBe("queryRange");
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});
const positive: { text: string; period: Period; start: string; end: string }[] = [
  { text: "hôm nay", period: attempted[0], start: "2026-09-28T00:00:00+07:00", end: "2026-09-29T00:00:00+07:00" },
  { text: "ngày mai", period: { kind: "DAY", date: { kind: "RELATIVE_DAY", offsetDays: 1 } }, start: "2026-09-29T00:00:00+07:00", end: "2026-09-30T00:00:00+07:00" },
  { text: "tuần này", period: { kind: "WEEK", offset: 0 }, start: "2026-09-28T00:00:00+07:00", end: "2026-10-05T00:00:00+07:00" },
  { text: "Tháng này có lịch gì ko?", period: { kind: "MONTH", offset: 0 }, start: "2026-09-01T00:00:00+07:00", end: "2026-10-01T00:00:00+07:00" },
  { text: "7 ngày tới", period: { kind: "NEXT_7_DAYS" }, start: "2026-09-28T00:00:00+07:00", end: "2026-10-05T00:00:00+07:00" },
  { text: "ngày 5/10/2026", period: { kind: "DAY", date: { kind: "CIVIL_DATE", calendar: "GREGORIAN", day: 5, month: 10, year: 2026, leapMonth: null } }, start: "2026-10-05T00:00:00+07:00", end: "2026-10-06T00:00:00+07:00" },
];
const reviewNegatives: { text: string; period: Period }[] = [
  ...["ko phải tháng này", "ko xem tháng này", "tháng này không cần xem", "tháng này ko cần xem", "tháng này không muốn xem", "tháng này không phải khoảng tôi chọn", "có lịch gì không nhưng đừng xem tháng này", "tháng này không nên xem", "tháng này không xem", "tháng này ko dùng", "tháng này chẳng chọn"].map(text => ({ text, period: { kind: "MONTH", offset: 0 } as Period })),
  ...["tháng 10 năm 26", "tháng 10 năm", "tháng 10 nhuận", "tháng 10 không nhuận", "tháng 10 âm", "tháng 10 dương", "tháng 10 lịch âm", "tháng 10 năm 2026 nhuận"].map(text => ({ text, period: { kind: "MONTH", offset: 1 } as Period })),
];
it.each(reviewNegatives)("review correction rejects incomplete/negative production before actual read: $text", async ({ text, period }) => {
  const h = await harness([list(period)]); let executions = 0; const actualList = h.deps.list;
  h.deps.list = input => { executions++; return actualList(input); };
  const result = await h.turn(0, text);
  expect(executions, "DATABASE_QUERY_WITHOUT_RANGE").toBe(0);
  expect(result).toEqual({ status: "CLARIFICATION_REQUESTED" });
  expect((await h.read(1))?.pendingQueryQuestion?.field).toBe("queryRange");
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});
const reviewPositive: { text: string; period: Period; start: string; end: string }[] = [
  ...["Có lịch gì không trong tháng này?", "Có lịch gì ko trong tháng này?", "Có lịch nào không vào tuần này?", "Tháng này có lịch gì không?"].map(text => ({ text, period: { kind: text.includes("tuần") ? "WEEK" : "MONTH", offset: 0 } as Period, start: text.includes("tuần") ? "2026-09-28T00:00:00+07:00" : "2026-09-01T00:00:00+07:00", end: text.includes("tuần") ? "2026-10-05T00:00:00+07:00" : "2026-10-01T00:00:00+07:00" })),
  ...["tháng 10", "tháng 10 năm 2026", "tháng 10 năm 2026 dương lịch"].map(text => ({ text, period: { kind: "MONTH", offset: 1 } as Period, start: "2026-10-01T00:00:00+07:00", end: "2026-11-01T00:00:00+07:00" })),
];
it.each(reviewPositive)("review correction preserves actual authorized bounds: $text", async ({ text, period, start, end }) => {
  const h = await harness([list(period)]); const ranges: unknown[] = []; const actualList = h.deps.list;
  h.deps.list = input => { ranges.push(input.range); return actualList(input); };
  expect(await h.turn(0, text)).toEqual({ status: "REMINDERS_LISTED" });
  expect(ranges).toEqual([{ start: Date.parse(start), end: Date.parse(end) }]);
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});
it("pending LIST numeric Gregorian month answer uses source receipt before one read", async () => {
  const h = await harness([list(null), list({ kind: "MONTH", offset: 1 })]); const ranges: unknown[] = []; const actualList = h.deps.list;
  h.deps.list = input => { ranges.push(input.range); return actualList(input); };
  expect(await h.turn(0, "Có lịch nào ko?")).toEqual({ status: "CLARIFICATION_REQUESTED" }); expect(ranges).toEqual([]);
  expect(await h.turn(1, "Tháng 10 năm 2026.")).toEqual({ status: "REMINDERS_LISTED" });
  expect(ranges).toEqual([{ start: Date.parse("2026-10-01T00:00:00+07:00"), end: Date.parse("2026-11-01T00:00:00+07:00") }]);
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});
it.each(positive)("explicit range executes hand-checked bounds: $text", async ({ text, period, start, end }) => {
  const h = await harness([list(period)]); const ranges: unknown[] = []; const actualList = h.deps.list;
  h.deps.list = input => { ranges.push(input.range); return actualList(input); };
  expect(await h.turn(0, text)).toEqual({ status: "REMINDERS_LISTED" });
  expect(ranges).toEqual([{ start: Date.parse(start), end: Date.parse(end) }]);
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});
it("pending LIST followed by range-only answer authorizes only the second read", async () => {
  const h = await harness([list({ kind: "UPCOMING" }), list({ kind: "MONTH", offset: 0 })]);
  let executions = 0; const actualList = h.deps.list;
  h.deps.list = input => { executions++; return actualList(input); };
  expect(await h.turn(0, "Có lịch nào ko?")).toEqual({ status: "CLARIFICATION_REQUESTED" });
  expect(executions).toBe(0);
  expect(await h.turn(1, "Tháng này.")).toEqual({ status: "REMINDERS_LISTED" });
  expect(executions).toBe(1);
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});
it.each(["không phải tháng này", 'chữ "tháng này"', "tháng này hoặc tuần này", "ngày mai", "cuối tháng này"])("ambiguous/negated/mismatched month must clarify before reading: %s", async text => {
  const h = await harness([list({ kind: "MONTH", offset: 0 })]);
  let executions = 0; const actualList = h.deps.list;
  h.deps.list = input => { executions++; return actualList(input); };
  expect(await h.turn(0, text)).toEqual({ status: "CLARIFICATION_REQUESTED" });
  expect(executions).toBe(0);
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});
