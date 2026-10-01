import { expect, it } from "vitest";
import { verifyListRangeEvidence } from "./list-range-evidence";
import { buildContextInput } from "./context";
import { validateEvidence } from "./evidence";
import { chat, message, observation, snapshot, turn, withNotes } from "./context-test-fixtures";
import type { QueryOperand } from "./contracts";
import type { ContextSnapshotV1, SourceEvidence } from "./state";
type Period = NonNullable<Extract<QueryOperand, { kind: "LIST" }>["period"]>;

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

it.each(civilModifierNegatives)("civil production/endpoint cannot discard attached qualifier: $text", ({ text, period }) => {
  expect(verifyListRangeEvidence({ candidateRange: period!, ...proof(text) })).not.toBe("SUPPORTED");
});
it.each(completeCivilPositives)("complete inline civil production/endpoint retains exact evidence: $text", ({ text, period }) => {
  expect(verifyListRangeEvidence({ candidateRange: period!, ...proof(text) })).toBe("SUPPORTED");
});

const listRangeBoundaryNegatives: { text: string; period: Period; family: string }[] = [
  ...["Có lịch nhưng", "Có lịch, nhưng", "Có lịch còn", "Có lịch tuy nhiên", "Có lịch từ lạ", "Có lịch,"].flatMap(prefix => ["không", "ko"].map(negator => ({ text: `${prefix} ${negator} trong tháng này`, period: { kind: "MONTH", offset: 0 } as Period, family: "UNKNOWN_OR_CONTRASTIVE_PREFIX" }))),
  ...separators.flatMap(({ open, close }) => ["không", "ko", "chẳng", "đừng"].map(negator => ({ text: `tháng này${open}${negator} xem${close}`, period: { kind: "MONTH", offset: 0 } as Period, family: "ATTACHED_NEGATIVE_SUFFIX" }))),
  ...separators.flatMap(({ open, close }) => ["năm 26", "năm", "âm lịch", "dương", "nhuận", "không nhuận", "lịch âm"].map(qualifier => ({ text: `tháng 10${open}${qualifier}${close}`, period: { kind: "MONTH", offset: 1 } as Period, family: "ATTACHED_UNSUPPORTED_MONTH_QUALIFIER" }))),
];
const listRangeBoundaryPositives: { text: string; period: Period }[] = [
  ...["Có lịch gì không trong tháng này?", "Có lịch nào ko trong tháng này?", "Có việc gì không trong tháng này?", "Có buổi hẹn nào không trong tháng này?", "Có lời nhắc gì ko trong tháng này?", "Tháng này có lịch gì không?"].map(text => ({ text, period: { kind: "MONTH", offset: 0 } as Period })),
  ...["tháng 10", "tháng 10 năm 2026", "tháng 10 năm 2026 dương lịch", "tháng 10?"].map(text => ({ text, period: { kind: "MONTH", offset: 1 } as Period })),
  { text: "ngày 5/10/2026 dương lịch", period: { kind: "DAY", date: { kind: "CIVIL_DATE", calendar: "GREGORIAN", day: 5, month: 10, year: 2026, leapMonth: null } } },
];
it.each(listRangeBoundaryNegatives)("production boundary denies $family / $text", ({ text, period }) => {
  expect(verifyListRangeEvidence({ candidateRange: period, ...proof(text), referenceTime: "2026-09-28T03:00:00.000Z" })).not.toBe("SUPPORTED");
});
it.each(listRangeBoundaryPositives)("positive bounded wrapper preserves $text", ({ text, period }) => {
  expect(verifyListRangeEvidence({ candidateRange: period, ...proof(text), referenceTime: "2026-09-28T03:00:00.000Z" })).toBe("SUPPORTED");
});
const civil = (day: number, month: number, year: number | null = null, calendar: "GREGORIAN" | "LUNAR_VN" = "GREGORIAN", leapMonth: boolean | null = null) => ({ kind: "CIVIL_DATE" as const, calendar, day, month, year, leapMonth });
const positives: { text: string; period: Period }[] = [
  ...([-1, 0, 1] as const).flatMap(offset => ["WEEK", "MONTH", "WEEKEND"].map(kind => ({ text: `${kind === "WEEK" ? "tuần" : kind === "MONTH" ? "tháng" : "cuối tuần"} ${offset === -1 ? "trước" : offset === 0 ? "này" : "sau"}`, period: { kind, offset } as Period }))),
  { text: "từ giờ đến cuối tháng này", period: { kind: "REST_OF_MONTH" } },
  { text: "phần còn lại của tháng này", period: { kind: "REST_OF_MONTH" } },
  { text: "7 ngày tới", period: { kind: "NEXT_7_DAYS" } },
  { text: "bảy ngày kể từ hôm nay", period: { kind: "NEXT_7_DAYS" } },
  { text: "sắp tới", period: { kind: "UPCOMING" } },
  { text: "có việc gì sắp tới không?", period: { kind: "UPCOMING" } },
  ...[[-2, "hôm kia"], [-1, "hôm qua"], [0, "hôm nay"], [1, "ngày mai"], [2, "ngày kia"], [15, "15 ngày nữa"], [-15, "15 ngày trước"]].map(([offsetDays, text]) => ({ text: String(text), period: { kind: "DAY", date: { kind: "RELATIVE_DAY", offsetDays: Number(offsetDays) } } as Period })),
  { text: "ngày 5/10/2026", period: { kind: "DAY", date: civil(5, 10, 2026) } },
  { text: "2026-10-05", period: { kind: "DAY", date: civil(5, 10, 2026) } },
  { text: "ngày 5 tháng 10", period: { kind: "DAY", date: civil(5, 10) } },
  { text: "5/10 âm lịch", period: { kind: "DAY", date: civil(5, 10, null, "LUNAR_VN") } },
  { text: "5/10/2026 âm lịch tháng nhuận", period: { kind: "DAY", date: civil(5, 10, 2026, "LUNAR_VN", true) } },
  { text: "5/10/2026 âm lịch không nhuận", period: { kind: "DAY", date: civil(5, 10, 2026, "LUNAR_VN", false) } },
  { text: "thứ 2 tuần này", period: { kind: "DAY", date: { kind: "WEEKDAY", weekday: 1, qualifier: "THIS_WEEK" } } },
  { text: "chủ nhật tuần sau", period: { kind: "DAY", date: { kind: "WEEKDAY", weekday: 7, qualifier: "NEXT_WEEK" } } },
  { text: "thứ 6", period: { kind: "DAY", date: { kind: "WEEKDAY", weekday: 5, qualifier: "UNRESOLVED" } } },
  { text: "từ 5/10/2026 đến 7/10/2026", period: { kind: "DATE_BOUNDS", from: civil(5, 10, 2026), through: civil(7, 10, 2026) } },
  { text: "từ hôm nay tới ngày mai", period: { kind: "DATE_BOUNDS", from: { kind: "RELATIVE_DAY", offsetDays: 0 }, through: { kind: "RELATIVE_DAY", offsetDays: 1 } } },
];
function proof(text: string, quote = text): { turns: ReturnType<typeof turn>[]; evidence: SourceEvidence[] } {
  const start = [...text.slice(0, text.indexOf(quote))].length, end = start + [...quote].length;
  return { turns: [turn(text)], evidence: [{ kind: "USER_QUOTE", sourceTurnId: "old", sourceMapTurnId: "old", quote, occurrence: 1, viewSpan: { start, end }, sourceSpan: { start, end }, normalizationVersion: "nfc-codepoint-v1" }] };
}
it.each(positives)("bounded LIST grammar supports $text / $period.kind", ({ text, period }) => {
  expect(verifyListRangeEvidence({ candidateRange: period, ...proof(text) })).toBe("SUPPORTED");
});
it.each([
  ["không phải tháng này", "tháng này", "AMBIGUOUS"], ['chữ "tháng này"', "tháng này", "AMBIGUOUS"], ["nếu tháng này thì sao?", "tháng này", "AMBIGUOUS"],
  ["tháng này hoặc tuần này", "tháng này", "AMBIGUOUS"], ["tuần này", "tuần này", "UNSUPPORTED"], ["hôm nay và tháng này", "tháng này", "AMBIGUOUS"],
  ["xem lịch tháng này", "xem lịch", "UNSUPPORTED"], ["cuối tháng này", "tháng này", "AMBIGUOUS"], ["atháng nàyb", "tháng này", "UNSUPPORTED"],
  ["𝒂tháng này", "tháng này", "UNSUPPORTED"],
  ["tháng này thì không", "tháng này", "AMBIGUOUS"], ["tháng này chỉ là ví dụ", "tháng này", "AMBIGUOUS"], ["tháng này nếu được", "tháng này", "AMBIGUOUS"],
  ["ko phải tháng này", "tháng này", "AMBIGUOUS"], ["tháng này không cần xem", "tháng này", "AMBIGUOUS"],
  ["Có lịch gì không trong tháng này?", "tháng này", "SUPPORTED"], ["Có lịch gì ko trong tháng này?", "tháng này", "SUPPORTED"], ["Tháng này có lịch gì không?", "Tháng này", "SUPPORTED"],
])("a quote cannot conceal source context: %s", (text, quote, want) => {
  expect(verifyListRangeEvidence({ candidateRange: { kind: "MONTH", offset: 0 }, ...proof(text, quote) })).toBe(want);
});
it("case normalization preserves mapped code-point coverage after a non-Vietnamese expanding letter", () => {
  expect(verifyListRangeEvidence({ candidateRange: { kind: "MONTH", offset: 0 }, ...proof("İ THÁNG NÀY", "THÁNG NÀY") })).toBe("SUPPORTED");
});
function validate(text: string, period: Period, state: ContextSnapshotV1 | null = null, fact = false, continuation = "YES") {
  const msg = message(text), built = buildContextInput({ message: msg, context: chat, snapshot: state, observation: observation(state, msg) });
  expect(built.status).toBe("READY"); if (built.status !== "READY") throw Error(built.reason);
  const result = validateEvidence({ schemaVersion: "calenote-context-2", intent: "LIST_REMINDERS", dialogueAct: fact ? "CONTINUE" : "NEW_REQUEST", continuation, changes: [], query: { kind: "LIST", period, statusScope: "DEFAULT", evidence: fact ? [{ kind: "CONTEXT_FACT", ref: "f1" }] : [{ kind: "USER_QUOTE", turn: built.input.currentTurn, quote: built.input.turns[built.input.currentTurn].text, occurrence: 1 }] }, uncertainties: [], controlEvidence: [] }, built);
  expect(result.status).toBe("VALID"); if (result.status !== "VALID") throw Error(result.reason);
  return result.patch;
}
function retained(text: string) {
  const state = snapshot(); state.transcript = [turn(text)];
  state.pendingQueryQuestion = { scope: "QUERY", field: "queryRange", questionId: "question", text: "Chọn khoảng nào?", decisionKind: null, reason: "AMBIGUOUS", noProgressCount: 0, deliveryState: "SENT", issuedAfterOrder: { receivedAt: state.createdAt, rowid: 1 } };
  state.facts = [{ alias: "f9", scope: "QUERY", field: "queryRange", value: { kind: "LIST", period: { kind: "MONTH", offset: 0 }, statusScope: "DEFAULT", evidence: [{ kind: "USER_QUOTE", turn: 0, quote: text, occurrence: 1 }] }, provenance: { kind: "EXPLICIT_USER" }, sourceReferenceTime: state.createdAt, dependencies: [], evidenceSlot: null }];
  return state;
}
it("old EXPLICIT_USER stamps are re-proved rather than inherited as authority", () => {
  const period: Period = { kind: "MONTH", offset: 0 };
  expect(validate("giữ khoảng cũ", period, retained("Có lịch nào ko?"), true).resolvedQuery).toMatchObject({ period: null });
  const valid = validate("giữ khoảng cũ", period, retained("tháng này"), true);
  expect(valid.resolvedQuery).toMatchObject({ period });
  expect(valid.queryReferenceTime).toBe("2026-09-28T03:00:00.000Z");
  expect(valid.queryEvidence[0]).toMatchObject({ sourceTurnId: "old", sourceSpan: { start: 0, end: 9 } });
});
it("QUERY context cannot cross a new request or unrelated reminder scope", () => {
  const state = retained("tháng này"), period: Period = { kind: "MONTH", offset: 0 };
  expect(validate("giữ khoảng cũ", period, state, true, "NO").resolvedQuery).toMatchObject({ period: null });
  state.pendingQueryQuestion = null;
  expect(validate("giữ khoảng cũ", period, state, true).resolvedQuery).toMatchObject({ period: null });
  const reminder = withNotes("tháng này");
  const msg = message("giữ khoảng cũ"), built = buildContextInput({ message: msg, context: chat, snapshot: reminder, observation: observation(reminder, msg) });
  if (built.status !== "READY") throw Error(built.reason);
  expect(validateEvidence({ schemaVersion: "calenote-context-2", intent: "LIST_REMINDERS", dialogueAct: "CONTINUE", continuation: "YES", changes: [], query: { kind: "LIST", period, statusScope: "DEFAULT", evidence: [{ kind: "CONTEXT_FACT", ref: "f1" }] }, uncertainties: [], controlEvidence: [] }, built)).toEqual({ status: "REFUSED", reason: "EVIDENCE_FACT_SCOPE_OR_VALUE" });
});
it("current source conflicting with inherited range cannot be hidden", () => {
  expect(validate("tuần này", { kind: "MONTH", offset: 0 }, retained("tháng này"), true).resolvedQuery).toMatchObject({ period: null });
});
it.each(["5/10/26", "5/10/20261", "5/10 năm 2026", "5/10 âm lịch tháng thường"])("partial malformed or unsupported date cannot become an implicit-year date: %s", text => {
  expect(verifyListRangeEvidence({ candidateRange: { kind: "DAY", date: civil(5, 10) }, ...proof(text) })).not.toBe("SUPPORTED");
});
it("Gregorian dates cannot discard a stated leap-month modifier", () => {
  expect(verifyListRangeEvidence({ candidateRange: { kind: "DAY", date: civil(5, 10, 2026) }, ...proof("5/10/2026 dương lịch tháng nhuận") })).not.toBe("SUPPORTED");
});
it.each([
  ["Tháng 10 còn buổi hẹn nào?", 1, "SUPPORTED"], ["tháng 9", 0, "SUPPORTED"], ["tháng 8 năm 2026", -1, "SUPPORTED"],
  ["tháng 10 năm 2027", 1, "AMBIGUOUS"], ["tháng 10 âm lịch", 1, "AMBIGUOUS"], ["tháng 10", 0, "UNSUPPORTED"],
  ["tháng 10 năm 26", 1, "AMBIGUOUS"], ["tháng 10 nhuận", 1, "AMBIGUOUS"], ["tháng 10 không nhuận", 1, "AMBIGUOUS"], ["tháng 10 âm", 1, "AMBIGUOUS"],
])("numeric month verifies the candidate against its authoritative receipt: %s", (text, offset, want) => {
  expect(verifyListRangeEvidence({ candidateRange: { kind: "MONTH", offset: offset as -1 | 0 | 1 }, ...proof(String(text)), referenceTime: "2026-09-28T03:00:00.000Z" })).toBe(want);
});
