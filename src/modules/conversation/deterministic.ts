import {
  parseVietnameseReminder,
  VIETNAM_TIMEZONE,
  type ReminderParseFailureCode,
} from "../reminders/parse-vietnamese";
import type {
  DeterministicConversationInput,
  DeterministicConversationResult,
  ReminderQueryRangeKind,
} from "./contracts";
import { routeConversationIntent } from "./intent-router";

const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1_000;

function normalize(text: string): string {
  return text.normalize("NFC").replace(/\s+/gu, " ").trim();
}

function localDate(timestamp: number): string | undefined {
  if (!Number.isFinite(timestamp)) return undefined;
  const local = new Date(timestamp + VIETNAM_OFFSET_MS);
  if (Number.isNaN(local.getTime())) return undefined;
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, "0")}-${String(local.getUTCDate()).padStart(2, "0")}`;
}

function relativeLocalDate(text: string, receivedAt: number): string | undefined {
  const normalized = text.toLocaleLowerCase("vi-VN");
  const days = normalized.includes("ngày kia") ? 2 : normalized.includes("mai") ? 1 : normalized.includes("hôm nay") ? 0 : undefined;
  return days === undefined ? undefined : localDate(receivedAt + days * 24 * 60 * 60 * 1_000);
}

function queryRange(text: string): ReminderQueryRangeKind {
  const normalized = text.toLocaleLowerCase("vi-VN");
  if (/\d{1,2}\/\d{1,2}(?:\/\d{4})?/u.test(normalized)) return "DATE";
  if (normalized.includes("sắp tới")) return "UPCOMING";
  if (normalized.includes("mai")) return "TOMORROW";
  return "TODAY";
}

function explicitQueryLocalDate(text: string, receivedAt: number): string | undefined {
  const match = text.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/u);
  if (!match) return undefined;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const reference = new Date(receivedAt + VIETNAM_OFFSET_MS);
  let year = match[3] === undefined ? reference.getUTCFullYear() : Number(match[3]);
  if (match[3] === undefined && (month < reference.getUTCMonth() + 1 || (month === reference.getUTCMonth() + 1 && day < reference.getUTCDate()))) year += 1;
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day
    ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    : undefined;
}

function clarificationContext(text: string, receivedAt: number): { localDate?: string; localTime?: string; title?: string } {
  const tokens = normalize(text).split(" ");
  const remove = new Set<number>();
  let date: string | undefined;
  let localTime: string | undefined;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index].toLocaleLowerCase("vi-VN");
    if (token === "sáng" || token === "trưa" || token === "chiều" || token === "tối") remove.add(index);
    if (token === "hôm" && tokens[index + 1]?.toLocaleLowerCase("vi-VN") === "nay") {
      date = localDate(receivedAt); remove.add(index); remove.add(index + 1);
    } else if (token === "ngày" && tokens[index + 1]?.toLocaleLowerCase("vi-VN") === "kia") {
      date = localDate(receivedAt + 2 * 86_400_000); remove.add(index); remove.add(index + 1);
    } else if (token === "mai") {
      date = localDate(receivedAt + 86_400_000); remove.add(index);
    } else if (/^\d{1,2}\/\d{1,2}(?:\/\d{4})?$/u.test(token)) {
      date = explicitQueryLocalDate(token, receivedAt); remove.add(index);
    }
    const clock = token.match(/^(\d{1,2})(?:h|:(\d{2}))$/u);
    if (clock) {
      let hour = Number(clock[1]);
      const minute = clock[2] === undefined ? 0 : Number(clock[2]);
      const next = tokens[index + 1]?.toLocaleLowerCase("vi-VN");
      if ((next === "chiều" || next === "tối") && hour < 12) hour += 12;
      localTime = hour <= 23 && minute <= 59 ? `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}` : undefined;
      remove.add(index);
      if (next === "trưa" || next === "sáng" || next === "chiều" || next === "tối") remove.add(index + 1);
    }
  }
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index].toLocaleLowerCase("vi-VN");
    const next = tokens[index + 1]?.toLocaleLowerCase("vi-VN");
    if (token === "nhắc") { remove.add(index); if (next === "tôi" || next === "tui" || next === "mình") remove.add(index + 1); }
    if (token === "nhớ" && next === "nhắc") remove.add(index);
    if (token === "vào" && (remove.has(index + 1) || ["mai", "hôm", "ngày"].includes(next ?? ""))) remove.add(index);
    if (token === "lúc" && remove.has(index + 1)) remove.add(index);
  }
  const title = tokens.filter((_, index) => !remove.has(index)).join(" ").trim();
  return { localDate: date, localTime, title: title || undefined };
}

function replyForFailure(code: ReminderParseFailureCode): string {
  switch (code) {
    case "PAST_TIME": return "Thời gian đó đã qua, bạn cho mình một giờ trong tương lai nhé.";
    case "INVALID_TIME": return "Giờ bạn cung cấp chưa hợp lệ, bạn kiểm tra lại nhé.";
    case "INVALID_DATE": return "Ngày bạn cung cấp chưa hợp lệ, bạn kiểm tra lại nhé.";
    case "TOO_FAR": return "Ngày nhắc đang quá xa, bạn chọn một ngày gần hơn nhé.";
    case "TITLE_TOO_LONG": return "Nội dung nhắc quá dài, bạn rút gọn lại nhé.";
    default: return "Mình chưa hiểu lịch nhắc này.";
  }
}

function missingField(code: ReminderParseFailureCode): "date" | "time" | "title" | undefined {
  if (code === "MISSING_DATE" || code === "AMBIGUOUS_DATE") return "date";
  if (code === "MISSING_TIME" || code === "AMBIGUOUS_TIME") return "time";
  if (code === "MISSING_TITLE") return "title";
  return undefined;
}

export function interpretDeterministically(
  inbound: DeterministicConversationInput,
): DeterministicConversationResult {
  const normalizedText = normalize(inbound.text);
  const intent = routeConversationIntent(normalizedText);
  if (intent === "LIST_REMINDERS") {
    const rangeKind = queryRange(normalizedText);
    const date = rangeKind === "DATE" ? explicitQueryLocalDate(normalizedText, inbound.receivedAt) : undefined;
    if (rangeKind === "DATE" && date === undefined) return { kind: "QUERY_REJECTED", intent, code: "INVALID_DATE", reply: "Ngày bạn cung cấp chưa hợp lệ, bạn kiểm tra lại nhé." };
    return { kind: "LIST_QUERY", intent, rangeKind, localDate: rangeKind === "TODAY" ? localDate(inbound.receivedAt) : rangeKind === "TOMORROW" ? relativeLocalDate(normalizedText, inbound.receivedAt) : date };
  }
  if (intent === "CONFIRM_PENDING" || intent === "CANCEL_PENDING") return { kind: "PENDING_ACTION", intent };
  if (intent === "HELP") return { kind: "HELP", intent, reply: "Bạn có thể nói: mai 8h gọi mẹ." };
  if (intent !== "CREATE_REMINDER") return { kind: "HELP", intent: "HELP", reply: "Bạn có thể nói: mai 8h gọi mẹ." };

  const parsed = parseVietnameseReminder(
    normalizedText,
    inbound.receivedAt,
    inbound.timezone ?? VIETNAM_TIMEZONE,
  );
  if (parsed.ok) {
    if (parsed.candidate.scheduledAt <= inbound.processingNow) {
      return { kind: "REJECTED", intent: "CREATE_REMINDER", code: "PAST_TIME", reply: replyForFailure("PAST_TIME") };
    }
    return { kind: "CREATE_CANDIDATE", intent: "CREATE_REMINDER", candidate: parsed.candidate };
  }

  if (["PAST_TIME", "INVALID_TIME", "INVALID_DATE", "TOO_FAR", "TITLE_TOO_LONG"].includes(parsed.code)) {
    return { kind: "REJECTED", intent: "CREATE_REMINDER", code: parsed.code as Extract<ReminderParseFailureCode, "PAST_TIME" | "INVALID_TIME" | "INVALID_DATE" | "TOO_FAR" | "TITLE_TOO_LONG">, reply: replyForFailure(parsed.code) };
  }
  if (/(?:thứ\s+\S+(?:\s+tuần\s+sau)?|tầm\s+\S+\s+giờ|(?:một|hai|ba|bốn|năm|sáu|bảy|tám|chín|mười)\s+giờ)/u.test(normalizedText.toLocaleLowerCase("vi-VN"))) {
    return { kind: "AI_ELIGIBLE", intent: "UNKNOWN" };
  }

  const missing = missingField(parsed.code);
  if (missing) {
    return {
      kind: "CLARIFICATION",
      intent: "CREATE_REMINDER",
      target: "CREATE_REMINDER",
      missingFields: [missing],
      context: clarificationContext(normalizedText, inbound.receivedAt),
      reply: missing === "time" ? "Bạn muốn nhắc vào mấy giờ?" : missing === "date" ? "Bạn muốn nhắc vào ngày nào?" : "Bạn muốn nhắc việc gì?",
    };
  }
  return { kind: "HELP", intent: "HELP", reply: "Bạn có thể nói: mai 8h gọi mẹ." };
}
