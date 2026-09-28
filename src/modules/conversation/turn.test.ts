import { describe, expect, it } from "vitest";
import { evaluateConversationTurn, isExplicitPendingAbandonment } from "./turn";
import { lunarCalendar } from "./lunar-calendar";
import type { ConversationModel, ConversationSnapshot } from "./contracts";

const now = Date.parse("2026-09-25T03:00:00Z");
const model: ConversationModel = { intent: "CREATE_REMINDER", title: "gọi mẹ", titleState: "RESOLVED",
  targetIntent: null, dialogueAct: "CONTINUE", continuation: "YES", capability: null };
const previous: ConversationSnapshot = { id: "prior", revision: 1, status: "CLARIFYING", createdAt: now - 1, expiresAt: now + 60000,
  request: { title: "gọi mẹ", calendar: "LUNAR_VN", eventDate: null, reminderDate: null, reminderTime: "08:00", count: null,
    relation: null, missing: ["year"], lunarInput: { day: 1, month: 1, year: null, leap: null, role: "REMINDER", sourceInboundId: "old" } }, turns: [] };
const evaluate = (text: string, overrides: Partial<ConversationModel> = {}) => evaluateConversationTurn({ text, model: { ...model, ...overrides },
  previous, receivedAt: now, sourceInboundId: "new", now }, lunarCalendar);

describe("application-owned relationship guards", () => {
  it.each(["gọi mẹ ở nhà", "gọi mẹ ngày mai", "ôn thi gọi mẹ", "chuẩn bị gọi mẹ", "ôn toán"])("event summaries cannot be grounded by incidental token overlap: %s", title => {
    expect(evaluateConversationTurn({ text: "thi hết môn ngày 11/10/2026 lúc 9h ở Quang Trung", model: { ...model, title },
      previous: null, now, receivedAt: now, sourceInboundId: "new" }, lunarCalendar).decision)
      .toMatchObject({ kind: "CLARIFY", field: "title" });
  });
  it.each(["ôn thi", "chuẩn bị thi hết môn", "ôn thi ở quang trung"])("permits bounded preparation of a grounded event: %s", title => {
    expect(evaluateConversationTurn({ text: "thi hết môn ngày 11/10/2026 lúc 9h ở Quang Trung", model: { ...model, title },
      previous: null, now, receivedAt: now, sourceInboundId: "new" }, lunarCalendar).decision.kind).toBe("PROPOSE");
  });
  it.each([
    ["mai có lịch họp lúc 9h, nhắc chuẩn bị báo cáo", "chuẩn bị báo cáo"],
    ["mai nhắc gọi lúc 9h cho mẹ", "gọi cho mẹ"],
    ["mai 9h nhắc gọi cho mẹ", "gọi mẹ"],
  ])("preserves substantive task wording across incidental queries and schedule spans: %s", (text, title) => {
    expect(evaluateConversationTurn({ text, model: { ...model, title, dialogueAct: "NEW_REQUEST", continuation: "NO" },
      previous: null, now, receivedAt: now, sourceInboundId: "new" }, lunarCalendar).decision).toMatchObject({ kind: "PROPOSE", request: { title } });
  });
  it.each(["mai 8h việc đó", "mai 8h"])("cannot manufacture a task in a verbless fragment: %s", text => {
    expect(evaluateConversationTurn({ text, model, previous: null, now, receivedAt: now, sourceInboundId: "new" }, lunarCalendar).decision.kind).toBe("CLARIFY");
  });
  it.each(["NO", "UNCERTAIN"] as const)("explicit cancellation does not depend on model continuation=%s", continuation => {
    expect(evaluate("bỏ yêu cầu này nhé", { intent: "HELP", title: null, titleState: "NOT_APPLICABLE", dialogueAct: "ABANDON", continuation }).decision)
      .toEqual({ kind: "ABANDON_PENDING" });
  });
  it.each(["thế thôi", "vậy nhé", "ừm để xem đã", "cảm ơn nhiều"])("requires actual slot evidence before continuing a pending request: %s", text => {
    expect(evaluate(text).decision).toMatchObject({ kind: "CLARIFY", field: "intent", request: { ...previous.request, missing: ["intent", "year"] } });
  });
  it.each(["mai tui có gì?", "hôm nay mình có việc gì?", "tuần này xem lịch", "liệt kê lịch ngày mai"])("keeps an explicit query read-only despite a stale CREATE label: %s", text => {
    const before = structuredClone(previous);
    expect(evaluate(text).decision).toEqual({ kind: "READ_ONLY_LIST" });
    expect(previous).toEqual(before);
  });
  it.each(["việc đó", "cái ấy", "chuyện này", "làm việc đó"])("does not accept an unresolved reference as a resolved task: %s", title => {
    const result = evaluateConversationTurn({ text: `mai 8h nhắc ${title}`, model: { ...model, title }, previous: null,
      now, receivedAt: now, sourceInboundId: "new" }, lunarCalendar);
    expect(result.decision).toMatchObject({ kind: "CLARIFY", field: "title", request: { title: null } });
  });
  it.each(["mai 8h", "ngày 28/09/2026 lúc 10h", "9h"])("a temporal-only request without context clarifies intent: %s", text => {
    expect(evaluateConversationTurn({ text, model: { ...model, title: null, titleState: "MISSING", dialogueAct: "NEW_REQUEST", continuation: "NO" },
      previous: null, now, receivedAt: now, sourceInboundId: "new" }, lunarCalendar).decision).toMatchObject({ kind: "CLARIFY", field: "intent" });
  });
  it("does not promote a model-invented title into a draft", () => {
    expect(evaluateConversationTurn({ text: "mai 8h nhắc việc đó", model, previous: null,
      now, receivedAt: now, sourceInboundId: "new" }, lunarCalendar).decision).toMatchObject({ kind: "CLARIFY", field: "title" });
  });
  it.each(["nhắc xem lịch ngày mai lúc 9h", "mai 9h nhắc kiểm tra xem có gì cần mua"])("does not steal a query phrase inside a reminder title: %s", text => {
    expect(evaluate(text, { title: text.includes("kiểm tra") ? "kiểm tra xem có gì cần mua" : "xem lịch" }).decision.kind).not.toBe("READ_ONLY_LIST");
  });
  it.each(["vậy đổi sang mai 9h nhắc gọi mẹ", "bạn sửa thành mai 9h nhắc gọi mẹ"])("never upgrades an unconfirmed edit into new-request authority: %s", text => {
    const prior: ConversationSnapshot = { ...previous, request: { ...previous.request, calendar: "GREGORIAN", lunarInput: undefined,
      reminderDate: { solarDate: "2026-09-26", calendar: "GREGORIAN", lunar: null, conversionVersion: null, sourceInboundId: "old" },
      count: 3, relation: "STARTING_ON", missing: [] } };
    const result = evaluateConversationTurn({ text, model: { ...model, dialogueAct: "EDIT" }, previous: prior, now, receivedAt: now, sourceInboundId: "new" }, lunarCalendar);
    expect(result.continuing).toBe(true);
    expect(result.decision).toEqual({ kind: "SAFE_REJECT", code: "CONFLICT" });
  });
  it.each(["ABANDON", "AMBIGUOUS"] as const)("retains unresolved lunar operands after %s uncertainty and permits a subsequent answer", dialogueAct => {
    const first = evaluateConversationTurn({ text: "thế thôi", model: { ...model, intent: "HELP", title: null,
      titleState: "NOT_APPLICABLE", dialogueAct: "ABANDON" }, previous, now, receivedAt: now, sourceInboundId: "uncertain" }, lunarCalendar);
    // Also cover generic ambiguous intent independently of abandonment.
    const result = dialogueAct === "ABANDON" ? first : evaluate("thế thôi", { intent: "AMBIGUOUS", title: null,
      titleState: "NOT_APPLICABLE", dialogueAct, continuation: "UNCERTAIN" });
    expect(result.decision).toMatchObject({ kind: "CLARIFY", request: { missing: ["intent", "year"] } });
    if (result.decision.kind !== "CLARIFY") throw new Error("expected clarification");
    const resumed = evaluateConversationTurn({ text: "2027", model, previous: { ...previous, request: result.decision.request }, now, receivedAt: now, sourceInboundId: "answer" }, lunarCalendar);
    expect(resumed.decision).toMatchObject({ kind: "PROPOSE", request: { reminderDate: { solarDate: "2027-02-06" }, missing: [] } });
  });
  it.each(["mai 9h nhắc gọi mẹ.", "MAI 9H NHẮC GỌI MẸ!", "nhắc gọi mẹ, lúc 9h ngày 26/09/2026"])("starts an independent grounded complete request despite model continuation: %s", text => {
    const result = evaluate(text);
    expect(result.continuing).toBe(false);
    expect(result.decision).toMatchObject({ kind: "PROPOSE", request: { calendar: "GREGORIAN", title: "gọi mẹ",
      reminderDate: { solarDate: "2026-09-26", lunar: null }, reminderTime: "09:00" } });
    if (result.decision.kind === "PROPOSE") expect(result.decision.request.lunarInput).toBeUndefined();
  });
  it("retains lunar operands for a short answer instead of forcing Gregorian", () => {
    expect(evaluate("2027").decision).toMatchObject({ kind: "PROPOSE", request: { calendar: "LUNAR_VN",
      reminderDate: { solarDate: "2027-02-06" }, reminderTime: "08:00" } });
  });
  it("keeps the leap-month question through uncertain closure and resolves a later leap answer", () => {
    const prior: ConversationSnapshot = { ...previous, request: { ...previous.request,
      lunarInput: { day: 1, month: 2, year: 2023, leap: null, role: "REMINDER", sourceInboundId: "old" }, missing: ["leapMonth"] } };
    const first = evaluateConversationTurn({ text: "thế thôi", model: { ...model, intent: "HELP", title: null, titleState: "NOT_APPLICABLE", dialogueAct: "ABANDON" },
      previous: prior, now, receivedAt: now, sourceInboundId: "uncertain" }, lunarCalendar);
    expect(first.decision).toMatchObject({ kind: "CLARIFY", request: { missing: ["intent", "leapMonth"] } });
    if (first.decision.kind !== "CLARIFY") throw new Error("expected clarification");
    const next = evaluateConversationTurn({ text: "tháng nhuận", model, previous: { ...prior, request: first.decision.request }, now, receivedAt: now, sourceInboundId: "answer" }, lunarCalendar);
    expect(next.decision).toMatchObject({ kind: "PROPOSE", request: { reminderDate: { solarDate: "2023-03-22" }, missing: [] } });
    // Pure reconciliation can propose this historical conversion; the service
    // still rejects past timestamps before persistence, covered separately.
  });
  it.each(["mai 9h", "mai 9h nhắc liên tục 3 ngày", "đổi mai 9h nhắc gọi mẹ"])("cannot infer a new complete task from a fragment or edit: %s", text => {
    expect(evaluate(text).continuing).toBe(true);
  });
  it("an ungrounded model title cannot establish an independent request", () => {
    expect(evaluate("mai 9h nhắc gọi khách", { title: "gọi mẹ" }).continuing).toBe(true);
  });
  it.each(["bỏ yêu cầu này nhé", "hủy bản nháp đang chờ", "vui lòng huỷ đề xuất đó giúp mình nha!"])("recognizes positive explicit control: %s", text => {
    expect(isExplicitPendingAbandonment(text)).toBe(true);
    expect(evaluate(text, { intent: "HELP", title: null, titleState: "NOT_APPLICABLE", dialogueAct: "ABANDON" }).decision.kind).toBe("ABANDON_PENDING");
  });
  it.each(["thế thôi", "vậy nhé", "đừng bỏ yêu cầu này", "không hủy bản nháp", "nếu bỏ yêu cầu này thì sao?", '"bỏ yêu cầu này"', "bỏ yêu cầu này được không?"])("preserves pending facts for unconfirmed cancellation: %s", text => {
    const result = evaluate(text, { intent: "HELP", title: null, titleState: "NOT_APPLICABLE", dialogueAct: "ABANDON" });
    expect(result.decision).toMatchObject({ kind: "CLARIFY", field: "intent", request: { ...previous.request, missing: ["intent", "year"] } });
    expect(isExplicitPendingAbandonment(text)).toBe(false);
  });
});
