import type { SourceEvidence, TranscriptEntry } from "./state";
import { supportsLeadOffset } from "./lead-offset-evidence";

type Turn = Pick<TranscriptEntry, "id" | "role" | "semanticView">;
const words: Readonly<Record<string, number>> = { một: 1, hai: 2, ba: 3 };
const token = "(\\d+|một|hai|ba)";
const boundary = /[\p{L}\p{M}\p{N}_]/u;
const lower = (s: string) => [...s].map(c => { const l = c.toLocaleLowerCase("vi"); return [...l].length === 1 ? l : c; }).join("");
const cadencePatterns: Readonly<Record<string, RegExp>> = {
  ONCE: /(?:một|1)\s+lần|duy nhất|once/gu,
  DAILY: /(?:mỗi|hàng|hằng)\s+ngày|ngày\s+(?:liên tiếp|liên tục|liền)|(?:liên tiếp|liên tục)\s+(?:\d+|một|hai|ba)\s+ngày|daily/gu,
  WEEKLY: /(?:mỗi|hàng|hằng)\s+tuần|mỗi\s+(?:thứ\s+(?:hai|ba|tư|năm|sáu|bảy|[2-7])|chủ nhật)|weekly/gu,
  MONTHLY: /(?:mỗi|hàng|hằng)\s+tháng|monthly/gu,
  YEARLY: /(?:mỗi|hàng|hằng)\s+năm|yearly|annually/gu,
};

/** Only checks an already-proposed finite field/value. No operand extraction
 * is exposed, and source text/state is never rewritten. Unknown wording does
 * not grant cadence/count authority. */
export function supportsCadenceOperand(field: "frequency" | "occurrenceCount", value: unknown, sources: readonly SourceEvidence[], turns: readonly Turn[], pendingCountTurnId?: string, currentReminderTurnId?: string): boolean {
  const matches = (source: SourceEvidence, pattern: RegExp, accept: (m: RegExpMatchArray, prefix: string, fullAnswer: string, quotePrefix: string) => boolean = () => true): boolean => {
    const turn = turns.find(t => t.id === source.sourceTurnId);
    if (!turn || turn.role !== "USER") return false;
    const text = lower(turn.semanticView), quote = lower(source.quote), view = [...text];
    if (/["'“”‘’`]/u.test(text) || /(?:^|[^\p{L}\p{M}\p{N}_])(?:nếu|ví dụ|giả sử)(?:$|[^\p{L}\p{M}\p{N}_])/u.test(text)) return false;
    for (const match of quote.matchAll(pattern)) {
      const start = source.viewSpan.start + [...quote.slice(0, match.index)].length, end = start + [...match[0]].length;
      if (/[\p{L}\p{M}\p{N}_.,/:+-]/u.test(view[start - 1] ?? "") || boundary.test(view[end] ?? "")) continue;
      const prefix = view.slice(0, start).join("").split(/[;,.!?\n]|\s+(?:và|rồi|xong|sau đó)\s+/u).at(-1) ?? "";
      // A coordinated noun/cadence inherits negation. Only a separately
      // asserted reminder verb can start a positive instruction after it.
      const negationPrefix = view.slice(0, start).join("").split(/[;,.!?\n]|\s+(?:và|rồi)\s+(?=nhắc(?:[^\p{L}\p{M}\p{N}_]|$))/u).at(-1) ?? "";
      const suffix = view.slice(end).join("").replace(/^[\s\p{P}]+/u, "");
      if (/(?:^|[^\p{L}\p{M}\p{N}_])(?:không|ko|đừng|chẳng|chưa|tên|chữ|trích dẫn|cụm từ|từ ngữ)(?:$|[^\p{L}\p{M}\p{N}_])/u.test(negationPrefix)
        || /^(?:thì\s+)?(?:không|ko|đừng|chẳng|chưa)(?:$|[^\p{L}\p{M}\p{N}_])/u.test(suffix)) continue;
      if (accept(match, prefix, text, quote.slice(0, match.index).split(/[;,.!?\n]|\s+(?:và|rồi|xong|sau đó)\s+/u).at(-1) ?? "")) return true;
    }
    return false;
  };
  if (field === "frequency") return typeof value === "string" && !!cadencePatterns[value] && sources.some(s => matches(s, cadencePatterns[value]));
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) return false;
  const sameNumber = (m: RegExpMatchArray) => (words[m[1]] ?? Number(m[1])) === value;
  const reminderOwned = (prefix: string) => /(?:^|[^\p{L}\p{M}\p{N}_])nhắc(?:$|[^\p{L}\p{M}\p{N}_])/u.test(prefix);
  const direct = new RegExp(`${token}\\s+(?:ngày\\s+(?:liên tiếp|liên tục|liền)|lần|lượt)|(?:liên tiếp|liên tục)\\s+${token}\\s+ngày`, "gu");
  if (sources.some(s => matches(s, direct, (m, prefix, fullAnswer) => (words[m[1] ?? m[2]] ?? Number(m[1] ?? m[2])) === value
    && (reminderOwned(prefix) || s.sourceTurnId === currentReminderTurnId && new RegExp(`^\\s*${token}\\s+(?:ngày\\s+(?:liên tiếp|liên tục|liền)|lần|lượt)(?:[,\\s]+(?:đúng|lúc)\\s+\\d{1,2}(?:h|:\\d{2})(?:\\s+(?:sáng|trưa|chiều|tối))?)?\\s*[.!]?\\s*$`, "u").test(fullAnswer))))) return true;
  if (sources.some(s => matches(s, new RegExp(`(?:trong|suốt)\\s+${token}\\s+ngày`, "gu"), (m, prefix, _full, quotePrefix) => sameNumber(m)
    && reminderOwned(prefix) && /(?:mỗi|hàng|hằng)\s+ngày\s*$/u.test(quotePrefix)))) return true;
  // A bare number is only a reply to the application's actual count question;
  // no date, clock, offset, prior question or credential grants this branch.
  const bare = new RegExp(`^\\s*${token}(?:\\s+(?:lần|ngày))?\\s*[.!]?\\s*$`, "u");
  return sources.some(s => s.sourceTurnId === pendingCountTurnId && matches(s, new RegExp(bare.source, "gu"), (m, _prefix, fullAnswer) => {
    const whole = fullAnswer.match(bare);
    return sameNumber(m) && !!whole && sameNumber(whole);
  }));
}

/** Boolean omission obligation for the existing bounded lead verifier. Never
 * returns a derived operand; count/offset contextual ownership is unchanged. */
export function leadDistanceCovered(turn: Turn, changes: readonly { field: string; value: unknown }[], alternatives: readonly { field: string; value: unknown }[], retainedLead: unknown, seriesCount?: number): boolean {
  if (turn.role !== "USER") return true;
  const length = [...turn.semanticView].length;
  const source: SourceEvidence = { kind: "USER_QUOTE", sourceTurnId: turn.id, sourceMapTurnId: turn.id, quote: turn.semanticView, occurrence: 1, sourceSpan: { start: 0, end: length }, viewSpan: { start: 0, end: length }, normalizationVersion: "nfc-codepoint-v1" };
  for (const match of lower(turn.semanticView).matchAll(/\d+|một|hai|ba/gu)) {
    const value = words[match[0]] ?? Number(match[0]);
    if (!supportsLeadOffset(value, [source], [turn], seriesCount)) continue;
    if (retainedLead === value || [...changes, ...alternatives].some(c => c.field === "leadOffsetDays" && c.value === value)) continue;
    return false;
  }
  return true;
}
