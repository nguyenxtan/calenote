/** Frozen declarative offline proposals. These describe provider output only;
 * the actual service decides state, reply selection, persistence and API data.
 * Evidence is copied from the real projected input on the same turn. */
import type { ContextInput } from "../../src/modules/conversation/context-contract/contracts";
import type { PlannedContextCase } from "./context-contract";

type Spec = { changes?: Record<string, unknown>; intent?: string; act?: string; query?: Record<string, unknown>;
  uncertainties?: Array<{ field: string; reason: string; alternatives: unknown[] }>;
  directive?: Record<string, unknown>; reply?: unknown; evidenceQuotes?: Record<string, string> } | null;
const date = (day: number, month = 10, year: number | null = null, calendar = "GREGORIAN") => ({ kind: "CIVIL_DATE", calendar, day, month, year, leapMonth: calendar === "GREGORIAN" ? null : false });
const clock = (hour: number) => ({ hour, minute: 0, qualifier: "H24" });
const month = { kind: "LIST", period: { kind: "MONTH", offset: 0 }, statusScope: "DEFAULT" };
const lunarToday = { kind: "CALENDAR_DATE", date: { kind: "RELATIVE_DAY", offsetDays: 0 }, outputCalendar: "LUNAR_VN" };
const basic = (title: string, day: number, hour: number) => ({ title, reminderDate: date(day), reminderTime: clock(hour) });
export const contextOfflineProposals: Readonly<Record<string, readonly Spec[]>> = {
  R01: [{ intent: "LIST_REMINDERS", query: { kind: "LIST", period: null, statusScope: "DEFAULT" },
    uncertainties: [{ field: "queryRange", reason: "MISSING", alternatives: [] }], directive: { kind: "ASK_FOR_FIELD", field: "queryRange" } },
    { intent: "LIST_REMINDERS", act: "CONTINUE", query: month, directive: { kind: "ANSWER_QUERY", queryKind: "LIST" } }],
  R02: [{ changes: { title: "đi thi", location: "Quang Trung", eventDate: date(11), frequency: "DAILY", occurrenceCount: 2 } },
    { act: "CONTINUE", changes: { eventRelation: "BEFORE_EVENT" } },
    { act: "CONTINUE", changes: { reminderTime: clock(8) }, directive: { kind: "PRESENT_PREVIEW" } }],
  R03: [{ changes: { title: "đi thi", eventDate: date(11), reminderTime: clock(8), frequency: "DAILY", occurrenceCount: 2 } },
    { act: "CONTINUE", changes: { eventRelation: "BEFORE_EVENT" }, directive: { kind: "PRESENT_PREVIEW" } }],
  R04: [{ changes: { title: "đi thi", eventDate: date(11), eventTime: clock(8) } },
    { act: "CONTINUE", changes: { frequency: "ONCE", leadOffsetDays: 2, eventRelation: "BEFORE_EVENT" } },
    { act: "CONTINUE", changes: { reminderTime: clock(8) }, directive: { kind: "PRESENT_PREVIEW" } },
    { changes: { title: "đi thi", eventDate: date(11), eventTime: clock(8) } },
    { act: "CONTINUE", changes: { frequency: "DAILY", occurrenceCount: 2, eventRelation: "BEFORE_EVENT" } },
    { act: "CONTINUE", changes: { reminderTime: clock(8) }, directive: { kind: "PRESENT_PREVIEW" } }],
  R05: [{ changes: { title: "đi thi", eventDate: date(11), leadOffsetDays: 2, eventRelation: "BEFORE_EVENT" } }, null,
    { changes: { title: "gọi mẹ", reminderDate: { kind: "RELATIVE_DAY", offsetDays: 1 }, reminderTime: clock(8) }, directive: { kind: "PRESENT_PREVIEW" } }],
  R06: [{ changes: { title: "đi thi", eventDate: date(11), leadOffsetDays: 2, eventRelation: "BEFORE_EVENT" } },
    { act: "CONTINUE", changes: {} }, { act: "CONTINUE", changes: { notes: "đừng bỏ quên giấy tờ" } }],
  R07: [{ changes: { title: "đi thi", location: "Quang Trung", notes: "nhớ mang giấy tờ", eventDate: date(11) } },
    { act: "CONTINUE", changes: { frequency: "DAILY", occurrenceCount: 2, eventRelation: "BEFORE_EVENT" } },
    { act: "CONTINUE", changes: { reminderTime: clock(8) }, directive: { kind: "PRESENT_PREVIEW" } },
    { act: "EDIT", changes: { reminderTime: clock(9) }, directive: { kind: "PRESENT_PREVIEW" } }],
  R08: [{ changes: { title: "đi thi", eventDate: date(11), leadOffsetDays: 2, eventRelation: "BEFORE_EVENT", reminderTime: clock(8) }, directive: { kind: "PRESENT_PREVIEW" } },
    { act: "EDIT", changes: { reminderTime: clock(9) }, directive: { kind: "PRESENT_PREVIEW" } }],
  R09: [{ intent: "CALENDAR_QUERY", query: lunarToday, directive: { kind: "ANSWER_QUERY", queryKind: "CALENDAR_DATE" } }],
  R10: [{ changes: { title: "ngày giỗ người thân", eventDate: date(15, 6, null, "LUNAR_VN"), frequency: "YEARLY" }, directive: { kind: "EXPLAIN_UNSUPPORTED", issue: "CAPABILITY" } }],
  R11: [{ changes: { title: "đi thi", eventDate: date(11), leadOffsetDays: 2, eventRelation: "BEFORE_EVENT", reminderTime: clock(8) }, directive: { kind: "PRESENT_PREVIEW" } },
    { intent: "LIST_REMINDERS", query: month, directive: { kind: "ANSWER_QUERY", queryKind: "LIST" } },
    { act: "CONTINUE", changes: {} }],
  R12: [{ changes: { title: "gọi mẹ", reminderDate: { kind: "RELATIVE_DAY", offsetDays: 1 }, reminderTime: clock(8) }, directive: { kind: "PRESENT_PREVIEW" } }],
  R13: [{ changes: { title: "đi thi", eventDate: date(11), leadOffsetDays: 2, eventRelation: "BEFORE_EVENT" } },
    { act: "CONTINUE", changes: { reminderTime: clock(8) }, directive: { kind: "PRESENT_PREVIEW" } }, null],
  R14: [{ changes: { title: "gọi mẹ", location: "ở nhà", notes: "hỏi thăm sức khỏe", reminderDate: { kind: "RELATIVE_DAY", offsetDays: 1 }, reminderTime: clock(8) }, directive: { kind: "PRESENT_PREVIEW" } }, null],
  R15: [null],
  R16: [{ intent: "CALENDAR_QUERY", query: lunarToday, directive: { kind: "ANSWER_QUERY", queryKind: "CALENDAR_DATE" } }],
  D01: [{ changes: { title: "gọi mẹ", reminderDate: { kind: "RELATIVE_DAY", offsetDays: 1 }, reminderTime: clock(8) }, directive: { kind: "PRESENT_PREVIEW" } },
    { changes: basic("đi thi", 11, 9), directive: { kind: "PRESENT_PREVIEW" } }, null],
  D02: [{ changes: { title: "gọi mẹ", reminderDate: { kind: "RELATIVE_DAY", offsetDays: 1 }, reminderTime: clock(8) }, directive: { kind: "PRESENT_PREVIEW" } },
    { changes: { title: "ngày giỗ người thân", eventDate: date(15, 6, null, "LUNAR_VN"), frequency: "YEARLY" }, directive: { kind: "EXPLAIN_UNSUPPORTED", issue: "CAPABILITY" } },
    null, null, { act: "EDIT", changes: { eventDate: date(15, 6, 2027, "LUNAR_VN"), reminderTime: clock(8), reminderDate: date(15, 6, 2027, "LUNAR_VN") }, directive: { kind: "PRESENT_PREVIEW" } }],
  D03: [{ intent: "CALENDAR_QUERY", query: { kind: "CALENDAR_DATE", date: date(15, 6, 2027, "LUNAR_VN"), outputCalendar: "GREGORIAN" }, directive: { kind: "ANSWER_QUERY", queryKind: "CALENDAR_DATE" } }],
  D04: [{ changes: { title: "ngày giỗ", reminderDate: date(15, 6, 2027, "LUNAR_VN"), reminderTime: clock(8) } },
    { intent: "LIST_REMINDERS", query: month, directive: { kind: "ANSWER_QUERY", queryKind: "LIST" } }],
  D05: [{ changes: { title: "đi thi", eventDate: date(11), leadOffsetDays: 2, eventRelation: "BEFORE_EVENT" } },
    { intent: "CALENDAR_QUERY", query: lunarToday, directive: { kind: "ANSWER_QUERY", queryKind: "CALENDAR_DATE" } }],
  D06: [{ changes: { title: "đi thi", eventDate: date(11), eventTime: clock(8), leadOffsetDays: 2, eventRelation: "BEFORE_EVENT" } },
    { act: "CONTINUE", changes: { reminderTime: clock(8) }, directive: { kind: "PRESENT_PREVIEW" } },
    { act: "EDIT", changes: { reminderTime: clock(9) }, evidenceQuotes: { reminderTime: "đổi sang 9h." }, directive: { kind: "PRESENT_PREVIEW" } }],
  D07: [{ changes: { title: "đi thi", eventDate: date(11), leadOffsetDays: 2, eventRelation: "BEFORE_EVENT", reminderTime: clock(8) }, directive: { kind: "PRESENT_PREVIEW" } },
    { intent: "LIST_REMINDERS", query: month, directive: { kind: "ANSWER_QUERY", queryKind: "LIST" } },
    { act: "AMBIGUOUS", changes: {} }, null],
  D08: [{ changes: { title: "đi thi", eventDate: date(11), leadOffsetDays: 2, eventRelation: "BEFORE_EVENT" } },
    { act: "CONTINUE", changes: {} }, { act: "CONTINUE", changes: {} }, { act: "CONTINUE", changes: {} }, null],
  D09: [{ changes: { title: "đi thi", location: "Quang Trung", eventDate: date(11), leadOffsetDays: 2, eventRelation: "BEFORE_EVENT" },
    directive: { kind: "ASK_FOR_FIELD", field: "reminderTime" }, reply: { text: "Bạn muốn mình nhắc lúc mấy giờ?" } },
    { intent: "UNSUPPORTED", directive: { kind: "EXPLAIN_UNSUPPORTED", issue: "ASSISTANT_SCOPE" }, reply: { text: "Bạn có thể chọn một yêu cầu về lịch hoặc lời nhắc." } },
    { act: "CONTINUE", changes: { reminderTime: clock(8) }, directive: { kind: "PRESENT_PREVIEW" } }],
  D10: [{ changes: { title: "đi thi", location: "Quang Trung", eventDate: date(11), eventRelation: "BEFORE_EVENT" } },
    { act: "CONTINUE", changes: {}, uncertainties: [{ field: "occurrenceCount", reason: "AMBIGUOUS", alternatives: [] }],
      directive: { kind: "ASK_FOR_DISAMBIGUATION", field: "occurrenceCount", reason: "AMBIGUOUS" },
      reply: { text: "Bạn muốn nhắc một lần trước ngày thi hay nhắc liên tiếp mỗi ngày?" } },
    { act: "CONTINUE", changes: {}, uncertainties: [{ field: "reminderTime", reason: "AMBIGUOUS", alternatives: [] }] },
    { act: "CONTINUE", changes: { frequency: "DAILY", occurrenceCount: 2, reminderTime: clock(8) }, directive: { kind: "PRESENT_PREVIEW" } }],
  D11: [{ changes: { title: "nộp hồ sơ", reminderDate: { kind: "RELATIVE_DAY", offsetDays: 2 }, reminderTime: clock(8) }, directive: { kind: "PRESENT_PREVIEW" } }],
  D12: [{ changes: { title: "gọi mẹ", reminderDate: { kind: "RELATIVE_DAY", offsetDays: 1 }, reminderTime: clock(8) }, directive: { kind: "PRESENT_PREVIEW" } }],
  D13: [{ intent: "LIST_REMINDERS", query: { kind: "LIST", period: { kind: "MONTH", offset: 1 }, statusScope: "DEFAULT" }, directive: { kind: "ANSWER_QUERY", queryKind: "LIST" } }],
  D14: [{ intent: "CALENDAR_QUERY", query: lunarToday, directive: { kind: "ANSWER_QUERY", queryKind: "CALENDAR_DATE" } }],
  D15: [{ changes: { title: "đi họp", reminderDate: date(30, 9), reminderTime: clock(9) }, directive: { kind: "PRESENT_PREVIEW" } }],
  D16: [{ changes: basic("mua thuốc", 1, 19), directive: { kind: "PRESENT_PREVIEW" } }],
  H01: [{ changes: { title: "mang máy tính đi làm", reminderDate: { kind: "WEEKDAY", weekday: 3, qualifier: "THIS_WEEK" }, reminderTime: clock(8) }, directive: { kind: "PRESENT_PREVIEW" } }],
  H02: [{ changes: basic("đóng tiền điện", 2, 18), directive: { kind: "PRESENT_PREVIEW" } }],
  H03: [{ changes: { ...basic("đem hồ sơ", 3, 9), location: "bưu điện" }, directive: { kind: "PRESENT_PREVIEW" } }],
  H04: [{ changes: { ...basic("đi khám", 4, 7), location: "Bạch Mai" }, directive: { kind: "PRESENT_PREVIEW" } }],
  H05: [{ intent: "LIST_REMINDERS", query: { kind: "LIST", period: { kind: "WEEKEND", offset: 0 }, statusScope: "DEFAULT" }, directive: { kind: "ANSWER_QUERY", queryKind: "LIST" } }],
  H06: [{ intent: "LIST_REMINDERS", query: { kind: "LIST", period: { kind: "WEEK", offset: 1 }, statusScope: "DEFAULT" }, directive: { kind: "ANSWER_QUERY", queryKind: "LIST" } }],
  H07: [{ intent: "CALENDAR_QUERY", query: { kind: "CALENDAR_DATE", date: { kind: "RELATIVE_DAY", offsetDays: -1 }, outputCalendar: "LUNAR_VN" }, directive: { kind: "ANSWER_QUERY", queryKind: "CALENDAR_DATE" } }],
  H08: [{ intent: "CALENDAR_QUERY", query: { kind: "CALENDAR_DATE", date: date(1, 10, 2026, "LUNAR_VN"), outputCalendar: "GREGORIAN" }, directive: { kind: "ANSWER_QUERY", queryKind: "CALENDAR_DATE" } }],
  H09: [{ changes: { title: "mua hoa", frequency: "YEARLY" }, directive: { kind: "EXPLAIN_UNSUPPORTED", issue: "CAPABILITY" } }],
  H10: [{ changes: { title: "gọi khách hàng", frequency: "WEEKLY" }, directive: { kind: "EXPLAIN_UNSUPPORTED", issue: "CAPABILITY" } }],
  H11: [{ changes: { title: "uống thuốc", reminderDate: { kind: "RELATIVE_DAY", offsetDays: 1 }, reminderTime: clock(7), frequency: "DAILY", occurrenceCount: 2, eventRelation: "STARTING_ON" }, directive: { kind: "PRESENT_PREVIEW" } }],
  H12: [{ changes: { title: "đi bộ", reminderDate: date(6), reminderTime: clock(6), frequency: "DAILY", occurrenceCount: 3, eventRelation: "STARTING_ON" }, directive: { kind: "PRESENT_PREVIEW" } }],
  H13: [{ changes: basic("chuẩn bị bài thuyết trình", 8, 20), directive: { kind: "PRESENT_PREVIEW" } }],
  H14: [{ changes: { ...basic("mang quà cho chị", 9, 8), location: "Cầu Giấy" }, directive: { kind: "PRESENT_PREVIEW" } }],
  H15: [{ changes: { title: "nộp bản thảo", reminderDate: { kind: "RELATIVE_DAY", offsetDays: 1 } } }],
  H16: [{ changes: { title: "đi ga tàu", reminderDate: date(10), reminderTime: { hour: 8, minute: 0, qualifier: "UNKNOWN" } } }],
  H17: [{ changes: { title: "chuẩn bị giấy tờ", eventDate: date(11), location: "Quang Trung" } },
    { act: "CONTINUE", changes: { leadOffsetDays: 2, eventRelation: "BEFORE_EVENT", reminderTime: clock(8) } }],
  H18: [{ changes: { title: "đi hẹn", eventDate: date(12), location: "thư viện", leadOffsetDays: 1, eventRelation: "BEFORE_EVENT" } },
    { act: "CONTINUE", changes: { reminderTime: clock(9) }, directive: { kind: "PRESENT_PREVIEW" } }],
  H19: [{ changes: basic("mua vé tàu", 13, 8), directive: { kind: "PRESENT_PREVIEW" } },
    { act: "EDIT", changes: { reminderTime: clock(9) }, directive: { kind: "PRESENT_PREVIEW" } }],
  H20: [{ changes: basic("gửi thư", 14, 10), directive: { kind: "PRESENT_PREVIEW" } }, null],
  H21: [{ changes: basic("họp nhóm", 15, 15), directive: { kind: "PRESENT_PREVIEW" } }],
  H22: [{ changes: { ...basic("đón con", 16, 17), location: "trường" }, directive: { kind: "PRESENT_PREVIEW" } }],
  H23: [{ changes: basic("mang giày chạy bộ", 17, 6), directive: { kind: "PRESENT_PREVIEW" } }],
  H24: [{ intent: "LIST_REMINDERS", query: { kind: "LIST", period: { kind: "MONTH", offset: 1 }, statusScope: "DEFAULT" }, directive: { kind: "ANSWER_QUERY", queryKind: "LIST" } }],
  H25: [{ intent: "LIST_REMINDERS", query: { kind: "LIST", period: { kind: "NEXT_7_DAYS" }, statusScope: "DEFAULT" }, directive: { kind: "ANSWER_QUERY", queryKind: "LIST" } }],
  H26: [{ changes: { ...basic("đóng học phí", 18, 10), notes: "mang biên lai" }, directive: { kind: "PRESENT_PREVIEW" } }],
  H27: [{ changes: { ...basic("đi khám", 19, 14), location: "phòng khám số 3" }, directive: { kind: "PRESENT_PREVIEW" } }],
  H28: [{ changes: basic("gọi cho bà ngoại", 20, 9), directive: { kind: "PRESENT_PREVIEW" } }],
  H29: [{ changes: { title: "hẹn gặp bạn", eventDate: date(21), location: "công viên" } }],
  H30: [{ changes: basic("nộp báo cáo", 22, 8), directive: { kind: "PRESENT_PREVIEW" } }],
  H31: [{ changes: { ...basic("mua quà", 23, 19), location: "siêu thị" }, directive: { kind: "PRESENT_PREVIEW" } }],
  H32: [{ changes: basic("kiểm tra hộp thư", 24, 8), directive: { kind: "PRESENT_PREVIEW" } }],
};

export function validateContextFixtureCoverage(planned: readonly PlannedContextCase[]) {
  const unique = new Map(planned.map(script => [script.id, script]));
  if (unique.size !== Object.keys(contextOfflineProposals).length) throw new Error("FIXTURE_SCRIPT_COVERAGE");
  for (const [id, script] of unique) {
    const fixture = contextOfflineProposals[id];
    if (!fixture || fixture.length !== script.turns.length) throw new Error(`FIXTURE_TURN_COVERAGE:${id}`);
    for (const [index, turn] of script.turns.entries()) {
      const expectedDispatch = turn.model === "HEALTHY";
      if (Boolean(fixture[index]) !== expectedDispatch) throw new Error(`FIXTURE_DISPATCH_COVERAGE:${id}:${index}`);
    }
  }
  return { scripts: unique.size, plannedExecutions: planned.length, plannedTurns: planned.reduce((n, c) => n + c.turns.length, 0) };
}

export function frozenContextProposal(input: ContextInput, executionId: string, turnIndex: number): unknown {
  const id = executionId.replace(/#[23]$/u, "");
  const frozen = contextOfflineProposals[id]?.[turnIndex];
  if (!frozen) throw new Error(`UNPLANNED_FIXTURE_DISPATCH:${id}:${turnIndex}`);
  const evidence = [{ kind: "USER_QUOTE", turn: input.currentTurn, quote: input.turns[input.currentTurn].text, occurrence: 1 }];
  const act = frozen.act ?? "NEW_REQUEST";
  return { schemaVersion: "calenote-context-2", intent: frozen.intent ?? "CREATE_REMINDER", dialogueAct: act,
    continuation: act === "NEW_REQUEST" ? "NO" : "YES",
    changes: Object.entries(frozen.changes ?? {}).map(([field, value]) => ({ field, operation: "SET", value,
      evidence: frozen.evidenceQuotes?.[field] ? [{ kind: "USER_QUOTE", turn: input.currentTurn, quote: frozen.evidenceQuotes[field], occurrence: 1 }] : evidence })),
    query: frozen.query ? { ...frozen.query, evidence } : null, uncertainties: frozen.uncertainties ?? [], controlEvidence: [],
    conversationDirective: frozen.directive ?? { kind: "ASK_FOR_FIELD", field: "reminderTime" }, replyProposal: frozen.reply ?? null };
}
