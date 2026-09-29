import { renderReminderDetails } from "@/modules/reminders/detail-presentation";
import type { IssueFieldSchema } from "./contracts";
import type { z } from "zod";
import type { GuidanceSelection } from "./guidance";
import { CONTEXT_QUERY_PARTIAL, CONTEXT_QUERY_SCOPE, CONTEXT_STATUS_LABELS, type ContextQueryResult, type QueryResolution } from "./query";
import type { CanonicalPreview, ConfirmationResult } from "./store";
import type { PendingDecision, TranscriptEntry } from "./state";

export type ReplyReceipt = { status: "SENT"; messageRef: string | null } | { status: "FAILED" | "UNCERTAIN" };
export type ReplySpan = { kind: "QUESTION" | "PREVIEW" | "CONTROL" | "FACT"; start: number; end: number; handle?: string };
export type ReadyReplyPlan = { status: "READY"; text: string; source: "BACKEND" | "MODEL_GUIDANCE"; kind: Extract<TranscriptEntry, { role: "ASSISTANT" }>["kind"]; spans: ReplySpan[] };
/** Span offsets use UTF-16; transcript projection independently maps codepoints. */
export type ReplyPlan = ReadyReplyPlan | { status: "TOO_LONG"; units: number; limit: 2000 } | { status: "INVALID" };
export type FailureReason = "PROVIDER" | "CONFIG" | "BUDGET" | "CONTEXT" | "SIZE" | "SEMANTIC" | "STALE" | "EXPIRED";
export type ReplyOutcome =
  | { kind: "QUESTION"; question: string; facts: string[]; field: z.infer<typeof IssueFieldSchema>; alternatives?: string[] }
  | { kind: "PREVIEW"; preview: CanonicalPreview; token?: string }
  | { kind: "DECISION"; decisionKind: PendingDecision["kind"]; token: string; facts: string[] }
  | { kind: "UNSUPPORTED"; capability: string }
  | { kind: "QUERY"; resolution: QueryResolution; result?: ContextQueryResult; titles?: ReadonlyMap<string, string> }
  | { kind: "RECOVERY"; count: 2 | 3; question: string; facts: string[]; token?: string }
  | { kind: "FAILURE"; reason: FailureReason }
  | { kind: "MUTATION"; result: ConfirmationResult }
  | { kind: "NOTICE"; notice: "DECLINED" | "ABANDONED" | "RESTARTED" | "AMBIGUOUS_TARGET" | "ESCAPE_REQUIRED" | "RESUME" | "CHECKING" | "HELP" };
const escape = (text: string) => text.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
const failures: Record<FailureReason, string> = {
  PROVIDER: "Chưa thể xử lý câu trả lời lúc này. Bản nháp còn hiệu lực được giữ nguyên; bạn có thể thử lại.",
  CONFIG: "Kết nối trợ lý chưa sẵn sàng. Bản nháp còn hiệu lực được giữ nguyên.",
  BUDGET: "Đã chạm giới hạn sử dụng trợ lý. Bản nháp còn hiệu lực được giữ nguyên; bạn có thể quay lại sau.",
  CONTEXT: "Không thể đọc đầy đủ ngữ cảnh. Vui lòng bắt đầu một yêu cầu mới.",
  SIZE: "Nội dung vượt giới hạn. Hãy rút gọn nội dung hoặc bắt đầu lại; chưa có lời nhắc nào được lưu từ yêu cầu này.",
  SEMANTIC: "Chưa hiểu chắc câu trả lời. Bản nháp còn hiệu lực được giữ nguyên; bạn có thể nói lại.",
  STALE: "Câu trả lời không còn khớp câu hỏi hiện tại. Hãy tiếp tục để xem lại bản nháp.",
  EXPIRED: "Bản nháp đã hết hạn. Hãy bắt đầu một yêu cầu mới.",
};
const notices = {
  DECLINED: "Đã từ chối lựa chọn này. Bản nháp còn hiệu lực vẫn được giữ nguyên.",
  ABANDONED: "Đã bỏ yêu cầu chưa lưu.", RESTARTED: "Bạn muốn được nhắc việc gì mới?",
  AMBIGUOUS_TARGET: "Bạn muốn bỏ bản nháp hiện tại hay đề xuất mới? Chưa bỏ yêu cầu nào. Trả lời 2 để từ chối đề xuất mới trước.",
  ESCAPE_REQUIRED: "Để bỏ yêu cầu chưa lưu hiện tại, hãy trả lời riêng Bỏ. Nếu đang có cả bản nháp và đề xuất mới, hãy chọn rõ đối tượng trước.",
  RESUME: "Bản nháp còn hiệu lực được giữ nguyên. Bạn có thể tiếp tục để xem lại câu hỏi.",
  CHECKING: "Đang kiểm tra phiên bản bạn chọn.", HELP: "Bạn có thể mô tả việc cần nhắc và thời điểm mong muốn.",
};
const fieldLabels: Record<string, string> = { title: "Việc cần nhắc", location: "Địa điểm", notes: "Ghi chú", eventDate: "Ngày sự kiện", eventTime: "Giờ sự kiện", reminderDate: "Ngày nhắc", reminderTime: "Giờ nhắc", calendar: "Lịch", frequency: "Tần suất", occurrenceCount: "Số lần", eventRelation: "Quan hệ với sự kiện", leadOffsetDays: "Số ngày trước", endDate: "Ngày kết thúc" };
export function formatPendingFact(field: string, value: unknown): string {
  const label = fieldLabels[field] ?? "Thông tin";
  const labels: Record<string, string> = { ONCE: "một lần", DAILY: "mỗi ngày", WEEKLY: "mỗi tuần", MONTHLY: "mỗi tháng", YEARLY: "hằng năm", UNKNOWN: "chưa rõ", GREGORIAN: "dương lịch", LUNAR_VN: "âm lịch Việt Nam", BEFORE_EVENT: "trước sự kiện", INCLUDING_EVENT: "gồm ngày sự kiện", STARTING_ON: "từ ngày sự kiện" };
  let text: string;
  if (typeof value === "string") text = ["calendar", "frequency", "eventRelation"].includes(field) ? labels[value] ?? value : value;
  else if (typeof value === "number") text = String(value);
  else if (value && typeof value === "object" && "hour" in value && "minute" in value && "qualifier" in value) text = `${String(value.hour).padStart(2, "0")}:${String(value.minute).padStart(2, "0")}${value.qualifier === "UNKNOWN" ? " (chưa rõ sáng/chiều)" : value.qualifier === "AM" ? " sáng" : value.qualifier === "PM" ? " chiều" : ""}`;
  else if (value && typeof value === "object" && "kind" in value) {
    if (value.kind === "CIVIL_DATE" && "day" in value && "month" in value && "year" in value && "calendar" in value && "leapMonth" in value) text = `${value.day}/${value.month}${value.year === null ? " (chưa có năm)" : `/${value.year}`}, ${value.calendar === "LUNAR_VN" ? `âm lịch Việt Nam${value.leapMonth === null ? " (chưa rõ tháng nhuận)" : value.leapMonth ? " (tháng nhuận)" : ""}` : "dương lịch"}`;
    else if (value.kind === "RELATIVE_DAY" && "offsetDays" in value) text = `${value.offsetDays} ngày tính từ ngày nhận yêu cầu`;
    else if (value.kind === "WEEKDAY" && "weekday" in value && "qualifier" in value) text = `${value.weekday === 7 ? "Chủ nhật" : `Thứ ${Number(value.weekday) + 1}`} ${value.qualifier === "THIS_WEEK" ? "tuần này" : value.qualifier === "NEXT_WEEK" ? "tuần sau" : "(chưa rõ tuần)"}`;
    else text = "chưa rõ";
  } else text = "chưa rõ";
  return `${label}: ${text}`;
}
export function decisionQuestion(kind: PendingDecision["kind"]): string {
  return { SAVE_PREVIEW: "Bạn xác nhận lưu bản nháp này?", REPLACE_PENDING: "Bạn muốn thay bản nháp hiện tại bằng đề xuất mới? Đây chưa phải xác nhận lưu.", ACCEPT_ONE_TIME_ALTERNATIVE: "Lặp hằng năm chưa được hỗ trợ. Bạn muốn cân nhắc lời nhắc một lần cho đề xuất này? Đây chưa phải xác nhận lưu.", RESUME_PENDING: "Bạn muốn tiếp tục bản nháp đang giữ?", RESTART_PENDING: "Bạn muốn bỏ bản nháp chưa lưu và bắt đầu lại?" }[kind];
}
/** Every factual/control surface is application-owned. Optional selected prose
 * may replace only an eligible question, and is dropped first on overflow. */
export function composeContextReply(outcome: ReplyOutcome, guidance: GuidanceSelection = { source: "BACKEND", reason: "BACKEND_SURFACE", text: null }): ReplyPlan {
  const parts: { text: string; kind: ReplySpan["kind"]; handle?: string }[] = [];
  let kind: ReadyReplyPlan["kind"] = "NOTICE", source: ReadyReplyPlan["source"] = "BACKEND";
  const add = (text: string, span: ReplySpan["kind"] = "FACT", handle?: string) => { if (text) parts.push({ text, kind: span, ...(handle ? { handle } : {}) }); };
  const facts = (values: string[]) => values.forEach(value => add(escape(value)));
  switch (outcome.kind) {
    case "PREVIEW": {
      const rendered = renderReminderDetails(outcome.preview.title, outcome.preview.details, outcome.preview.occurrences, outcome.preview.prefix.length + outcome.preview.suffix.length);
      if (rendered.status !== "COMPLETE") return rendered;
      const text = outcome.preview.prefix + rendered.text + outcome.preview.suffix;
      const spans: ReplySpan[] = [{ kind: "PREVIEW", start: outcome.preview.prefix.length, end: outcome.preview.prefix.length + rendered.text.length }];
      if (outcome.token) { const start = text.lastIndexOf(outcome.token); if (start < 0) return { status: "INVALID" }; spans.push({ kind: "CONTROL", start, end: start + outcome.token.length, handle: outcome.token }); }
      return text.length <= 2000 ? { status: "READY", text, source, kind: "PREVIEW", spans } : { status: "TOO_LONG", units: text.length, limit: 2000 };
    }
    case "QUESTION": {
      kind = "CLARIFICATION"; facts(outcome.facts);
      if (outcome.alternatives?.length) facts(outcome.alternatives);
      const optional = !outcome.alternatives?.length && guidance.source === "MODEL_GUIDANCE" ? guidance.text : null;
      const selected = optional && [...parts.map(p => p.text), optional].join("\n").length <= 2000 ? optional : outcome.question;
      if (selected === optional) source = "MODEL_GUIDANCE";
      add(selected, "QUESTION"); break;
    }
    case "DECISION":
      kind = "DECISION"; facts(outcome.facts); add(decisionQuestion(outcome.decisionKind), "QUESTION");
      add(`${outcome.decisionKind === "SAVE_PREVIEW" ? "Xác nhận" : "Đồng ý"} ${outcome.token}`, "CONTROL", outcome.token); add("Trả lời 2 để từ chối.", "CONTROL"); break;
    case "UNSUPPORTED": {
      const explanations: Record<string, string> = {
        YEARLY: "Lặp hằng năm chưa được hỗ trợ. Có thể cân nhắc lời nhắc một lần bằng một lựa chọn riêng.",
        DOMAIN_LIMIT: "Lời nhắc phải ở tương lai, trong 366 ngày; chuỗi mỗi ngày có từ 2 đến 30 lần. Nếu nội dung quá dài, hãy rút gọn để hiển thị đầy đủ.",
        ASSISTANT_SCOPE: "Mình hỗ trợ lịch và lời nhắc cá nhân. Yêu cầu này nằm ngoài phạm vi hiện tại.",
        REQUEST_COMBINATION: "Hãy chọn từng yêu cầu để xử lý; chưa thực hiện một phần của yêu cầu kết hợp này.",
      };
      add(explanations[outcome.capability] ?? "Kiểu lặp này chưa được hỗ trợ. Hiện có lời nhắc một lần hoặc mỗi ngày hữu hạn từ 2 đến 30 lần."); break;
    }
    case "RECOVERY":
      kind = "RECOVERY"; facts(outcome.facts); add(outcome.count === 2 ? `Thông tin đang giữ ở trên. ${outcome.question}` : "Bản nháp vẫn được giữ nguyên và không gia hạn. Bạn có thể trả lời Bỏ để hủy yêu cầu chưa lưu, hoặc đồng ý bắt đầu lại.", "QUESTION");
      if (outcome.count === 3 && outcome.token) add(`Đồng ý ${outcome.token}`, "CONTROL", outcome.token); break;
    case "FAILURE": add(failures[outcome.reason]); break;
    case "NOTICE": add(notices[outcome.notice]); break;
    case "MUTATION": add(outcome.result.status === "COMMITTED" || outcome.result.status === "IDEMPOTENT" ? `Đã lưu ${outcome.result.childCount} lời nhắc.` : outcome.result.status === "UNCERTAIN" ? "Chưa xác định được kết quả lưu. Cần kiểm tra lại trước khi thử tiếp." : "Chưa lưu lời nhắc. Hãy xem lại bản nháp hiện tại."); break;
    case "QUERY": {
      kind = "QUERY_RESULT";
      const r = outcome.resolution;
      if (r.status === "RANGE") {
        if (outcome.result?.status !== "RESULTS") return composeContextReply({ kind: "FAILURE", reason: "PROVIDER" });
        add(CONTEXT_QUERY_SCOPE); add(escape(r.label)); add(escape(outcome.result.calendarNotice));
        for (const row of outcome.result.rows) {
          const title = outcome.titles?.get(row.id);
          if (title === undefined || !Number.isFinite(new Date(row.scheduledAt).getTime())) return { status: "INVALID" };
          const local = new Date(row.scheduledAt + 7 * 3600000).toISOString();
          add(`${escape(title)} — ${local.slice(0, 10)} ${local.slice(11, 16)} — ${CONTEXT_STATUS_LABELS[row.status]}`);
        }
        if (!outcome.result.rows.length) add("Không có lời nhắc trong khoảng này.");
        if (outcome.result.hasMore) add(CONTEXT_QUERY_PARTIAL);
      } else if (r.status === "CALENDAR_DATE") add(`Dương lịch: ${r.solar}\nÂm lịch Việt Nam: ${r.lunar.day}/${r.lunar.month}/${r.lunar.year}${r.lunar.leap ? " nhuận" : ""}\n${escape(r.convention)}`);
      else if (r.status === "CAPABILITY") add(r.topic === "ANNUAL" ? "Lặp hằng năm chưa được hỗ trợ." : r.topic === "LUNAR" ? "Có thể dùng ngày âm lịch Việt Nam khi bạn yêu cầu rõ." : "Có thể nhắc mỗi ngày hữu hạn từ 2 đến 30 lần.");
      else return { status: "INVALID" };
      break;
    }
  }
  const text = parts.map(p => p.text).join("\n");
  if (!text || !text.isWellFormed()) return { status: "INVALID" };
  if (text.length > 2000) return { status: "TOO_LONG", units: text.length, limit: 2000 };
  let start = 0;
  const spans = parts.map(part => { const span = { kind: part.kind, start, end: start + part.text.length, ...(part.handle ? { handle: part.handle } : {}) }; start = span.end + 1; return span; });
  return { status: "READY", text, source, kind, spans };
}
