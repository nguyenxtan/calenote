import type { SourceEvidence, TranscriptEntry } from "./state";

type Turn = Pick<TranscriptEntry, "id" | "role" | "semanticView">;
const number = "(?:\\d+|một|hai|ba)";
const period = "(?:ngày|tuần|tháng)";
const multiplier = new RegExp(`(?:mỗi|hàng|hằng)\\s+${period}\\s+(${number})\\s+(?:lần|lượt)|(${number})\\s+(?:lần|lượt)\\s*(?:(?:mỗi|hàng|hằng)\\s+|/\\s*)${period}`, "gu");
const weekdays = ["chủ\\s+nhật", "thứ\\s+(?:hai|2)", "thứ\\s+(?:ba|3)", "thứ\\s+(?:tư|4)", "thứ\\s+(?:năm|5)", "thứ\\s+(?:sáu|6)", "thứ\\s+(?:bảy|7)"].map(s => new RegExp(`(?:^|[^\\p{L}\\p{M}\\p{N}_])${s}(?=$|[^\\p{L}\\p{M}\\p{N}_])`, "u"));
export function hasCadenceCue(text: string, frequency: unknown): boolean {
  if (frequency === "DAILY") return /(?:mỗi|hàng|hằng)\s+ngày/u.test(text);
  if (frequency === "WEEKLY") return /(?:mỗi|hàng|hằng)\s+tuần|mỗi\s+(?:thứ\s+(?:hai|ba|tư|năm|sáu|bảy|[2-7])|chủ\s+nhật)|weekly/u.test(text);
  if (frequency === "MONTHLY") return /(?:mỗi|hàng|hằng)\s+tháng|monthly/u.test(text);
  return false;
}
export function countIsPerPeriod(prefix: string, suffix: string): boolean {
  return /(?:mỗi|hàng|hằng)\s+(?:ngày|tuần|tháng)\s*$/u.test(prefix)
    || /^\s*(?:(?:mỗi|hàng|hằng)\s+|\/\s*)(?:ngày|tuần|tháng)(?=$|[^\p{L}\p{M}\p{N}_])/u.test(suffix);
}

/** Reject-only checks on an already proposed cadence and resolved start date.
 * No date, count or weekday operand is manufactured from this source scan. */
export function recurrenceSourceProblem(frequency: unknown, startDate: string | null, evidence: readonly SourceEvidence[], turns: readonly Turn[]): "MULTIPLE_PER_PERIOD" | "MULTIPLE_WEEKDAYS" | "WEEKDAY_START_CONFLICT" | "MONTHLY_WEEKDAY_PATTERN" | null {
  for (const source of evidence) {
    const turn = turns.find(t => t.id === source.sourceTurnId && t.role === "USER");
    if (!turn) continue;
    const text = turn.semanticView.toLocaleLowerCase("vi");
    for (const clause of text.split(/[;.!?\n]|\s+(?:và|rồi|nhưng)\s+(?=nhắc(?:$|[^\p{L}]))/u)) {
      if (!hasCadenceCue(clause, frequency) || /(?:^|[^\p{L}])(?:không|ko|đừng|chưa|nếu|ví dụ|giả sử)(?=$|[^\p{L}])/u.test(clause)) continue;
      for (const m of clause.matchAll(multiplier)) {
        const token = m[1] ?? m[2], n = ({ một: 1, hai: 2, ba: 3 } as Record<string, number>)[token] ?? Number(token);
        if (n > 1) return "MULTIPLE_PER_PERIOD";
      }
      const mentioned = weekdays.flatMap((pattern, day) => pattern.test(clause) ? [day] : []);
      if (frequency === "MONTHLY" && mentioned.length) return "MONTHLY_WEEKDAY_PATTERN";
      if (frequency !== "WEEKLY") continue;
      if (mentioned.length > 1) return "MULTIPLE_WEEKDAYS";
      if (mentioned.length && startDate && !weekdays[new Date(`${startDate}T00:00:00Z`).getUTCDay()].test(clause)) return "WEEKDAY_START_CONFLICT";
    }
  }
  return null;
}
