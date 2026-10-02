/** Frozen declarative offline proposals. These describe provider output only;
 * the actual service decides state, reply selection, persistence and API data.
 * Evidence is copied from the real projected input on the same turn. */
import type { ContextInput } from "../../src/modules/conversation/context-contract/contracts";
import { ConversationInterpretationV3Schema, ModelDirectiveV3Schema, ReplyProposalSchema } from "../../src/modules/conversation/context-contract/contracts";
import { encodeGoogleLiteEuContextV3 } from "../../src/modules/intelligence/infrastructure/openrouter/context-provider-wire";
import type { PlannedContextCase } from "./context-contract";

type Spec = { changes?: Record<string, unknown>; intent?: string; target?: "CURRENT" | "NEW" | "UNRESOLVED"; targetQuote?: string; replacements?: string[]; query?: Record<string, unknown>;
  uncertainties?: Array<{ field: string; reason: string; alternatives: unknown[] }>;
  directive?: Record<string, unknown> | null; reply?: unknown; evidenceQuotes?: Record<string, string> } | null;
const date = (day: number, month = 10, year: number | null = null, calendar = "GREGORIAN") => ({ kind: "CIVIL_DATE", calendar, day, month, year, leapMonth: calendar === "GREGORIAN" ? null : false });
const clock = (hour: number) => ({ hour, minute: 0, qualifier: "H24" });
const month = { kind: "LIST", period: { kind: "MONTH", offset: 0 }, statusScope: "DEFAULT" };
const lunarToday = { kind: "CALENDAR_DATE", date: { kind: "RELATIVE_DAY", offsetDays: 0 }, outputCalendar: "LUNAR_VN" };
const basic = (title: string, day: number, hour: number) => ({ title, reminderDate: date(day), reminderTime: clock(hour) });
export const contextOfflineProposals: Readonly<Record<string, readonly Spec[]>> = {
  R01: [{ intent: "LIST_REMINDERS", query: { kind: "LIST", period: null, statusScope: "DEFAULT" },
    uncertainties: [{ field: "queryRange", reason: "MISSING", alternatives: [] }], directive: { kind: "ASK_FOR_FIELD", field: "queryRange" } },
    { intent: "LIST_REMINDERS", target: "CURRENT", query: month, directive: null }],
  R02: [{ changes: { title: "đi thi", location: "Quang Trung", eventDate: date(11), frequency: "DAILY", occurrenceCount: 2 } },
    { target: "CURRENT", changes: { eventRelation: "BEFORE_EVENT" } },
    { target: "CURRENT", changes: { reminderTime: clock(8) }, directive: null }],
  R03: [{ changes: { title: "đi thi", eventDate: date(11), reminderTime: clock(8), frequency: "DAILY", occurrenceCount: 2 } },
    { target: "CURRENT", changes: { eventRelation: "BEFORE_EVENT" }, directive: null }],
  R04: [{ changes: { title: "đi thi", eventDate: date(11), eventTime: clock(8) } },
    { target: "CURRENT", changes: { frequency: "ONCE", leadOffsetDays: 2, eventRelation: "BEFORE_EVENT" } },
    { target: "CURRENT", changes: { reminderTime: clock(8) }, directive: null },
    { changes: { title: "đi thi", eventDate: date(11), eventTime: clock(8) } },
    { target: "CURRENT", changes: { frequency: "DAILY", occurrenceCount: 2, eventRelation: "BEFORE_EVENT" } },
    { target: "CURRENT", changes: { reminderTime: clock(8) }, directive: null }],
  R05: [{ changes: { title: "đi thi", eventDate: date(11), leadOffsetDays: 2, eventRelation: "BEFORE_EVENT" } }, null,
    { changes: { title: "gọi mẹ", reminderDate: { kind: "RELATIVE_DAY", offsetDays: 1 }, reminderTime: clock(8) }, directive: null }],
  R06: [{ changes: { title: "đi thi", eventDate: date(11), leadOffsetDays: 2, eventRelation: "BEFORE_EVENT" } },
    { target: "CURRENT", changes: {} }, { target: "CURRENT", changes: { notes: "đừng bỏ quên giấy tờ" } }],
  R07: [{ changes: { title: "đi thi", location: "Quang Trung", notes: "nhớ mang giấy tờ", eventDate: date(11) } },
    { target: "CURRENT", changes: { frequency: "DAILY", occurrenceCount: 2, eventRelation: "BEFORE_EVENT" } },
    { target: "CURRENT", changes: { reminderTime: clock(8) }, directive: null },
    { target: "CURRENT", replacements: ["reminderTime"], changes: { reminderTime: clock(9) }, directive: null }],
  R08: [{ changes: { title: "đi thi", eventDate: date(11), leadOffsetDays: 2, eventRelation: "BEFORE_EVENT", reminderTime: clock(8) }, directive: null },
    { target: "CURRENT", replacements: ["reminderTime"], changes: { reminderTime: clock(9) }, directive: null }],
  R09: [{ intent: "CALENDAR_QUERY", query: lunarToday, directive: null }],
  R10: [{ changes: { title: "ngày giỗ người thân", eventDate: date(15, 6, null, "LUNAR_VN"), frequency: "YEARLY" }, directive: { kind: "EXPLAIN_UNSUPPORTED", issue: "CAPABILITY" } }],
  R11: [{ changes: { title: "đi thi", eventDate: date(11), leadOffsetDays: 2, eventRelation: "BEFORE_EVENT", reminderTime: clock(8) }, directive: null },
    { intent: "LIST_REMINDERS", query: month, directive: null },
    { target: "CURRENT", changes: {} }],
  R12: [{ changes: { title: "gọi mẹ", reminderDate: { kind: "RELATIVE_DAY", offsetDays: 1 }, reminderTime: clock(8) }, directive: null }],
  R13: [{ changes: { title: "đi thi", eventDate: date(11), leadOffsetDays: 2, eventRelation: "BEFORE_EVENT" } },
    { target: "CURRENT", changes: { reminderTime: clock(8) }, directive: null }, null],
  R14: [{ changes: { title: "gọi mẹ", location: "ở nhà", notes: "hỏi thăm sức khỏe", reminderDate: { kind: "RELATIVE_DAY", offsetDays: 1 }, reminderTime: clock(8) }, directive: null }, null],
  R15: [null],
  R16: [{ intent: "CALENDAR_QUERY", query: lunarToday, directive: null }],
  D01: [{ changes: { title: "gọi mẹ", reminderDate: { kind: "RELATIVE_DAY", offsetDays: 1 }, reminderTime: clock(8) }, directive: null },
    { changes: basic("đi thi", 11, 9), directive: null }, null],
  D02: [{ changes: { title: "gọi mẹ", reminderDate: { kind: "RELATIVE_DAY", offsetDays: 1 }, reminderTime: clock(8) }, directive: null },
    { changes: { title: "ngày giỗ người thân", eventDate: date(15, 6, null, "LUNAR_VN"), frequency: "YEARLY" }, directive: { kind: "EXPLAIN_UNSUPPORTED", issue: "CAPABILITY" } },
    null, null, { target: "CURRENT", replacements: ["eventDate"], changes: { eventDate: date(15, 6, 2027, "LUNAR_VN"), reminderTime: clock(8), reminderDate: date(15, 6, 2027, "LUNAR_VN") }, directive: null }],
  D03: [{ intent: "CALENDAR_QUERY", query: { kind: "CALENDAR_DATE", date: date(15, 6, 2027, "LUNAR_VN"), outputCalendar: "GREGORIAN" }, directive: null }],
  D04: [{ changes: { title: "ngày giỗ", reminderDate: date(15, 6, 2027, "LUNAR_VN"), reminderTime: clock(8) } },
    { intent: "LIST_REMINDERS", query: month, directive: null }],
  D05: [{ changes: { title: "đi thi", eventDate: date(11), leadOffsetDays: 2, eventRelation: "BEFORE_EVENT" } },
    { intent: "CALENDAR_QUERY", query: lunarToday, directive: null }],
  D06: [{ changes: { title: "đi thi", eventDate: date(11), eventTime: clock(8), leadOffsetDays: 2, eventRelation: "BEFORE_EVENT" } },
    { target: "CURRENT", changes: { reminderTime: clock(8) }, directive: null },
    { target: "CURRENT", targetQuote: "đổi sang 9h.", replacements: ["reminderTime"], changes: { reminderTime: clock(9) }, evidenceQuotes: { reminderTime: "đổi sang 9h." }, directive: null }],
  D07: [{ changes: { title: "đi thi", eventDate: date(11), leadOffsetDays: 2, eventRelation: "BEFORE_EVENT", reminderTime: clock(8) }, directive: null },
    { intent: "LIST_REMINDERS", query: month, directive: null },
    { target: "UNRESOLVED", changes: {}, uncertainties: [{ field: "operation", reason: "AMBIGUOUS", alternatives: [{ value: "CURRENT" }, { value: "NEW" }] }] }, null],
  D08: [{ changes: { title: "đi thi", eventDate: date(11), leadOffsetDays: 2, eventRelation: "BEFORE_EVENT" } },
    { target: "CURRENT", changes: {} }, { target: "CURRENT", changes: {} }, { target: "CURRENT", changes: {} }, null],
  D09: [{ changes: { title: "đi thi", location: "Quang Trung", eventDate: date(11), leadOffsetDays: 2, eventRelation: "BEFORE_EVENT" },
    directive: { kind: "ASK_FOR_FIELD", field: "reminderTime" }, reply: { text: "Bạn muốn mình nhắc lúc mấy giờ?" } },
    { intent: "UNSUPPORTED", directive: { kind: "EXPLAIN_UNSUPPORTED", issue: "ASSISTANT_SCOPE" }, reply: { text: "Bạn có thể chọn một yêu cầu về lịch hoặc lời nhắc." } },
    { target: "CURRENT", changes: { reminderTime: clock(8) }, directive: null }],
  D10: [{ changes: { title: "đi thi", location: "Quang Trung", eventDate: date(11), eventRelation: "BEFORE_EVENT" } },
    { target: "CURRENT", changes: {}, uncertainties: [{ field: "occurrenceCount", reason: "AMBIGUOUS", alternatives: [] }],
      directive: { kind: "ASK_FOR_DISAMBIGUATION", field: "occurrenceCount", reason: "AMBIGUOUS" },
      reply: { text: "Bạn muốn nhắc một lần trước ngày thi hay nhắc liên tiếp mỗi ngày?" } },
    { target: "CURRENT", changes: {}, uncertainties: [{ field: "reminderTime", reason: "AMBIGUOUS", alternatives: [] }] },
    { target: "CURRENT", changes: { frequency: "DAILY", occurrenceCount: 2, reminderTime: clock(8) }, directive: null }],
  D11: [{ changes: { title: "nộp hồ sơ", reminderDate: { kind: "RELATIVE_DAY", offsetDays: 2 }, reminderTime: clock(8) }, directive: null }],
  D12: [{ changes: { title: "gọi mẹ", reminderDate: { kind: "RELATIVE_DAY", offsetDays: 1 }, reminderTime: clock(8) }, directive: null }],
  D13: [{ intent: "LIST_REMINDERS", query: { kind: "LIST", period: { kind: "MONTH", offset: 1 }, statusScope: "DEFAULT" }, directive: null }],
  D14: [{ intent: "CALENDAR_QUERY", query: lunarToday, directive: null }],
  D15: [{ changes: { title: "đi họp", reminderDate: date(30, 9), reminderTime: clock(9) }, directive: null }],
  D16: [{ changes: basic("mua thuốc", 1, 19), directive: null }],
  H01: [{ changes: { title: "mang máy tính đi làm", reminderDate: { kind: "WEEKDAY", weekday: 3, qualifier: "THIS_WEEK" }, reminderTime: clock(8) }, directive: null }],
  H02: [{ changes: basic("đóng tiền điện", 2, 18), directive: null }],
  H03: [{ changes: { ...basic("đem hồ sơ", 3, 9), location: "bưu điện" }, directive: null }],
  H04: [{ changes: { ...basic("đi khám", 4, 7), location: "Bạch Mai" }, directive: null }],
  H05: [{ intent: "LIST_REMINDERS", query: { kind: "LIST", period: { kind: "WEEKEND", offset: 0 }, statusScope: "DEFAULT" }, directive: null }],
  H06: [{ intent: "LIST_REMINDERS", query: { kind: "LIST", period: { kind: "WEEK", offset: 1 }, statusScope: "DEFAULT" }, directive: null }],
  H07: [{ intent: "CALENDAR_QUERY", query: { kind: "CALENDAR_DATE", date: { kind: "RELATIVE_DAY", offsetDays: -1 }, outputCalendar: "LUNAR_VN" }, directive: null }],
  H08: [{ intent: "CALENDAR_QUERY", query: { kind: "CALENDAR_DATE", date: date(1, 10, 2026, "LUNAR_VN"), outputCalendar: "GREGORIAN" }, directive: null }],
  H09: [{ changes: { title: "mua hoa", frequency: "YEARLY" }, directive: { kind: "EXPLAIN_UNSUPPORTED", issue: "CAPABILITY" } }],
  H10: [{ changes: { title: "gọi khách hàng", frequency: "WEEKLY" }, directive: { kind: "EXPLAIN_UNSUPPORTED", issue: "CAPABILITY" } }],
  H11: [{ changes: { title: "uống thuốc", reminderDate: { kind: "RELATIVE_DAY", offsetDays: 1 }, reminderTime: clock(7), frequency: "DAILY", occurrenceCount: 2, eventRelation: "STARTING_ON" }, directive: null }],
  H12: [{ changes: { title: "đi bộ", reminderDate: date(6), reminderTime: clock(6), frequency: "DAILY", occurrenceCount: 3, eventRelation: "STARTING_ON" }, directive: null }],
  H13: [{ changes: basic("chuẩn bị bài thuyết trình", 8, 20), directive: null }],
  H14: [{ changes: { ...basic("mang quà cho chị", 9, 8), location: "Cầu Giấy" }, directive: null }],
  H15: [{ changes: { title: "nộp bản thảo", reminderDate: { kind: "RELATIVE_DAY", offsetDays: 1 } } }],
  H16: [{ changes: { title: "đi ga tàu", reminderDate: date(10), reminderTime: { hour: 8, minute: 0, qualifier: "UNKNOWN" } } }],
  H17: [{ changes: { title: "chuẩn bị giấy tờ", eventDate: date(11), location: "Quang Trung" } },
    { target: "CURRENT", changes: { leadOffsetDays: 2, eventRelation: "BEFORE_EVENT", reminderTime: clock(8) } }],
  H18: [{ changes: { title: "đi hẹn", eventDate: date(12), location: "thư viện", leadOffsetDays: 1, eventRelation: "BEFORE_EVENT" } },
    { target: "CURRENT", changes: { reminderTime: clock(9) }, directive: null }],
  H19: [{ changes: basic("mua vé tàu", 13, 8), directive: null },
    { target: "CURRENT", replacements: ["reminderTime"], changes: { reminderTime: clock(9) }, directive: null }],
  H20: [{ changes: basic("gửi thư", 14, 10), directive: null }, null],
  H21: [{ changes: basic("họp nhóm", 15, 15), directive: null }],
  H22: [{ changes: { ...basic("đón con", 16, 17), location: "trường" }, directive: null }],
  H23: [{ changes: basic("mang giày chạy bộ", 17, 6), directive: null }],
  H24: [{ intent: "LIST_REMINDERS", query: { kind: "LIST", period: { kind: "MONTH", offset: 1 }, statusScope: "DEFAULT" }, directive: null }],
  H25: [{ intent: "LIST_REMINDERS", query: { kind: "LIST", period: { kind: "NEXT_7_DAYS" }, statusScope: "DEFAULT" }, directive: null }],
  H26: [{ changes: { ...basic("đóng học phí", 18, 10), notes: "mang biên lai" }, directive: null }],
  H27: [{ changes: { ...basic("đi khám", 19, 14), location: "phòng khám số 3" }, directive: null }],
  H28: [{ changes: basic("gọi cho bà ngoại", 20, 9), directive: null }],
  H29: [{ changes: { title: "hẹn gặp bạn", eventDate: date(21), location: "công viên" } }],
  H30: [{ changes: basic("nộp báo cáo", 22, 8), directive: null }],
  H31: [{ changes: { ...basic("mua quà", 23, 19), location: "siêu thị" }, directive: null }],
  H32: [{ changes: basic("kiểm tra hộp thư", 24, 8), directive: null }],
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
  const intent = frozen.intent ?? "CREATE_REMINDER";
  return { schemaVersion: "calenote-context-3", intent,
    requestTarget: intent === "CREATE_REMINDER" ? { kind: frozen.target ?? "NEW", evidence: frozen.targetQuote
      ? [{ kind: "USER_QUOTE", turn: input.currentTurn, quote: frozen.targetQuote, occurrence: 1 }] : evidence } : null,
    changes: Object.entries(frozen.changes ?? {}).map(([field, value]) => ({ field,
      operation: frozen.replacements?.includes(field) ? "REPLACE" : "SET", value,
      evidence: frozen.evidenceQuotes?.[field] ? [{ kind: "USER_QUOTE", turn: input.currentTurn, quote: frozen.evidenceQuotes[field], occurrence: 1 }] : evidence })),
    query: frozen.query ? { ...frozen.query, evidence } : null,
    uncertainties: (frozen.uncertainties ?? []).map(issue => ({ ...issue,
      alternatives: issue.field === "operation" ? issue.alternatives.map(value => ({ ...(value as object), evidence })) : issue.alternatives })),
    conversationDirective: frozen.directive === undefined ? { kind: "ASK_FOR_FIELD", field: "reminderTime" } : frozen.directive,
    replyProposal: frozen.reply ?? null };
}

/** Encode literal V3 fixture semantics through the selected codec. Deliberately
 * invalid advisory sections are injected after encoding; malformed semantic
 * fixtures stay malformed and must fail at the actual gateway boundary. */
export function encodeFixtureV3(value: unknown): unknown {
  const valid = ConversationInterpretationV3Schema.safeParse(value);
  if (valid.success) return encodeGoogleLiteEuContextV3(valid.data);
  if (!value || typeof value !== "object") return value;
  const object = value as Record<string, unknown>;
  const directive = ModelDirectiveV3Schema.safeParse(object.conversationDirective), reply = ReplyProposalSchema.safeParse(object.replyProposal);
  const core = ConversationInterpretationV3Schema.safeParse({ ...object, conversationDirective: directive.success ? directive.data : null, replyProposal: reply.success ? reply.data : null });
  if (!core.success) return value;
  const wire = encodeGoogleLiteEuContextV3(core.data) as Record<string, unknown>;
  if (!directive.success) wire.conversationDirective = object.conversationDirective;
  if (!reply.success) wire.replyProposal = object.replyProposal;
  return wire;
}
