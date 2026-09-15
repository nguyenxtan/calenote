import type { ConversationIntent } from "./contracts";

function normalize(text: string): string {
  return text.normalize("NFC").replace(/\s+/gu, " ").trim().toLocaleLowerCase("vi-VN");
}

export function routeConversationIntent(text: string): ConversationIntent {
  const normalized = normalize(text);
  if (normalized.length === 0) return "UNKNOWN";

  if (
    normalized === "lịch"
    || /^lịch\s+\d{1,2}\/\d{1,2}(?:\/\d{4})?$/u.test(normalized)
    || /^(?:lịch(?: hôm nay)?|hôm nay có gì\??|mai có gì\??|trên calenote có lịch gì\??|nhắc gì sắp tới\??)$/u.test(normalized)
  ) {
    return "LIST_REMINDERS";
  }
  if (/^(?:có|ok|xác nhận)$/u.test(normalized)) return "CONFIRM_PENDING";
  if (/^(?:hủy|huỷ|không)$/u.test(normalized)) return "CANCEL_PENDING";
  if (/^(?:giúp|giúp tôi|help|hướng dẫn)$/u.test(normalized)) return "HELP";

  if (/(?:hôm nay|mai|ngày kia|\d{1,2}\/\d{1,2}|thứ .+ tuần sau|\d{1,2}(?:h|:\d{2})|sáng|trưa|chiều|tối|nhắc)/u.test(normalized)) {
    return "CREATE_REMINDER";
  }
  return "UNKNOWN";
}
