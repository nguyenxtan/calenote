import type { QueryOperand } from "./contracts";
import { QueryOperandSchema } from "./contracts";
import type { LunarCalendarAdapter } from "../lunar-calendar";
import type { LunarDate } from "../contracts";
import type { SemanticReminderQuery, QueriedReminder } from "@/modules/reminders/semantic-query";
import { DAY_MS, VN_OFFSET_MS, localMidnight, resolveDateOperand } from "./resolve";

export const CONTEXT_QUERY_SCOPE = "Lời nhắc trong cuộc trò chuyện đã liên kết này";
export const CONTEXT_QUERY_PARTIAL = "5 kết quả đầu; còn kết quả khác";
export type ContextReminderStatus = "PENDING" | "CLAIMED" | "RETRYABLE" | "SENT" | "FAILED" | "UNCERTAIN";
export const CONTEXT_STATUS_LABELS: Record<ContextReminderStatus, string> = { PENDING: "Chờ gửi", CLAIMED: "Đang gửi", RETRYABLE: "Chờ gửi lại", SENT: "Đã gửi", FAILED: "Gửi thất bại", UNCERTAIN: "Chưa rõ kết quả gửi" };
export type ContextReminderQuery = SemanticReminderQuery & { referenceTime: number };
export type ContextQueryResult = { status: "RESULTS"; rows: (QueriedReminder & { status: ContextReminderStatus; statusLabel: string })[]; hasMore: boolean; partialNotice: string | null; scopeLabel: string; calendarNotice: string }
  | { status: "INVALID" | "UNAUTHORIZED" | "STALE" | "UNAVAILABLE"; reason: string };
export type QueryResolution = { status: "RANGE"; start: number; end: number; label: string; scopeLabel: string }
  | { status: "CALENDAR_DATE"; solar: string; lunar: LunarDate; outputCalendar: "GREGORIAN" | "LUNAR_VN"; convention: string }
  | { status: "CAPABILITY"; topic: "LUNAR" | "FINITE_SERIES" | "ANNUAL"; supported: boolean }
  | { status: "CLARIFY" | "REJECTED"; reason: string };

export function resolveQuery(query: QueryOperand, receipt: number, calendar: LunarCalendarAdapter): QueryResolution {
  const parsed = QueryOperandSchema.safeParse(query);
  if (!parsed.success || !Number.isSafeInteger(receipt) || !Number.isFinite(new Date(receipt).getTime())) return { status: "REJECTED", reason: "INVALID_QUERY" };
  query = parsed.data;
  if (query.kind === "CAPABILITY") return query.topic === null ? { status: "CLARIFY", reason: "MISSING_TOPIC" } : { status: "CAPABILITY", topic: query.topic, supported: query.topic !== "ANNUAL" };
  if (query.kind === "CALENDAR_DATE") {
    if (!query.date || !query.outputCalendar) return { status: "CLARIFY", reason: "MISSING_CALENDAR_OPERAND" };
    const resolved = resolveDateOperand(query.date, receipt, calendar);
    if (resolved.status !== "RESOLVED") return resolved;
    const lunar = calendar.toLunar(resolved.date);
    return lunar ? { status: "CALENDAR_DATE", solar: resolved.date, lunar, outputCalendar: query.outputCalendar, convention: calendar.version } : { status: "REJECTED", reason: "CALENDAR_OUT_OF_RANGE" };
  }
  const period = query.period;
  if (!period) return { status: "CLARIFY", reason: "MISSING_RANGE" };
  const today = localMidnight(receipt), local = new Date(today + VN_OFFSET_MS);
  let start: number, end: number, label: string;
  switch (period.kind) {
    case "DAY": case "DATE_BOUNDS": {
      const from = period.kind === "DAY" ? period.date : period.from, through = period.kind === "DAY" ? period.date : period.through;
      if (!from || !through) return { status: "CLARIFY", reason: "MISSING_RANGE" };
      const a = resolveDateOperand(from, receipt, calendar), b = resolveDateOperand(through, receipt, calendar);
      if (a.status !== "RESOLVED") return a;
      if (b.status !== "RESOLVED") return b;
      start = Date.parse(`${a.date}T00:00:00+07:00`);
      const inclusiveEnd = Date.parse(`${b.date}T00:00:00+07:00`);
      if (Math.abs(start - today) > 366 * DAY_MS || Math.abs(inclusiveEnd - today) > 366 * DAY_MS) return { status: "REJECTED", reason: "ENDPOINT_LIMIT" };
      end = inclusiveEnd + DAY_MS; label = `${a.date} – ${b.date}`; break;
    }
    case "WEEK": case "WEEKEND": {
      const monday = today - ((local.getUTCDay() + 6) % 7) * DAY_MS + period.offset * 7 * DAY_MS;
      start = monday + (period.kind === "WEEKEND" ? 5 : 0) * DAY_MS; end = monday + 7 * DAY_MS; label = period.kind === "WEEKEND" ? "Cuối tuần đã chọn" : "Tuần đã chọn"; break;
    }
    case "MONTH": {
      start = Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + period.offset, 1) - VN_OFFSET_MS;
      end = Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + period.offset + 1, 1) - VN_OFFSET_MS;
      label = `Tháng ${new Date(start + VN_OFFSET_MS).toISOString().slice(0, 7)} (gồm cả những ngày đã qua)`; break;
    }
    case "REST_OF_MONTH": start = receipt; end = Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1) - VN_OFFSET_MS; label = "Từ lúc nhận yêu cầu đến cuối tháng"; break;
    case "NEXT_7_DAYS": start = today; end = today + 7 * DAY_MS; label = "7 ngày kể từ hôm nay"; break;
    case "UPCOMING": start = receipt; end = receipt + 30 * DAY_MS; label = "30 ngày kể từ lúc nhận yêu cầu"; break;
  }
  if (end <= start) return { status: "REJECTED", reason: "REVERSED_RANGE" };
  if (end - start > 366 * DAY_MS) return { status: "REJECTED", reason: "SPAN_LIMIT" };
  return { status: "RANGE", start, end, label, scopeLabel: CONTEXT_QUERY_SCOPE };
}
