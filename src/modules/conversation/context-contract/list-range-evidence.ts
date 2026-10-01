import type { DateOperand, QueryOperand } from "./contracts";
import type { SourceEvidence, TranscriptEntry } from "./state";

type Period = NonNullable<Extract<QueryOperand, { kind: "LIST" }>["period"]>;
export type ListRangeSupport = "SUPPORTED" | "UNSUPPORTED" | "AMBIGUOUS";
type Match = { start: number; end: number; value: Period | null };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
// Ordinary punctuation does not sever an immediately attached modifier or
// negator. This inspects usage only; source-map offsets are never transformed.
const attachedTail = (text: string) => text.replace(/^[\s\p{P}]+/u, "");
// Every civil production must consume its attached numeric/year/calendar/leap
// modifiers. Punctuation cannot give a shorter match authority to discard them.
// Unsupported forms clarify; this neither infers a year nor computes lunar dates.
const incompleteCivil = (candidate: Period | null, tail: string) =>
  (candidate?.kind === "MONTH" || (candidate?.kind === "DAY" && candidate.date?.kind === "CIVIL_DATE"))
  && /^(?:\d|(?:năm|âm|dương|lịch|nhuận|tháng (?:nhuận|thường)|không nhuận)(?:[^\p{L}]|$))/u.test(attachedTail(tail));

/** Bounded LIST-only productions. These never extract reminder fields or intent.
 * The model already supplied a candidate; unrecognized language grants no range.
 * Longest productions own their nested words (e.g. weekend, date bounds).
 */
function temporalMatches(text: string, referenceTime?: string): Match[] {
  const matches: Match[] = [];
  const add = (pattern: RegExp, value: (m: RegExpExecArray) => Period | null) => {
    for (const m of text.matchAll(pattern)) {
      const start = m.index!, end = start + m[0].length;
      if (/[\p{L}\p{N}_]/u.test([...text.slice(0, start)].at(-1) ?? "") || /[\p{L}\p{N}_]/u.test([...text.slice(end)][0] ?? "")) continue;
      const candidate = value(m);
      matches.push({ start, end, value: incompleteCivil(candidate, text.slice(end)) ? null : candidate });
    }
  };
  const day = (date: DateOperand): Period => ({ kind: "DAY", date });
  add(/hôm nay|ngày mai|mai|ngày kia|hôm qua|hôm kia/gu, m => day({ kind: "RELATIVE_DAY", offsetDays: ({ "hôm nay": 0, "ngày mai": 1, mai: 1, "ngày kia": 2, "hôm qua": -1, "hôm kia": -2 } as Record<string, number>)[m[0]] }));
  add(/(\d+) ngày (nữa|trước)/gu, m => day({ kind: "RELATIVE_DAY", offsetDays: Number(m[1]) * (m[2] === "trước" ? -1 : 1) }));
  const offsets: Record<string, -1 | 0 | 1> = { trước: -1, này: 0, sau: 1, tới: 1 };
  add(/(cuối tuần|tuần|tháng) (trước|này|sau|tới)/gu, m => ({ kind: m[1] === "tháng" ? "MONTH" : m[1] === "tuần" ? "WEEK" : "WEEKEND", offset: offsets[m[2]] }));
  add(/tháng (\d{1,2})(?: năm (\d{4}))?(?: (âm lịch|dương lịch))?/gu, m => {
    if (!referenceTime || m[3] === "âm lịch") return null;
    const local = new Date(Date.parse(referenceTime) + 7 * 3600000);
    for (const offset of [-1, 0, 1] as const) {
      const month = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + offset, 1));
      if (Number(m[1]) === month.getUTCMonth() + 1 && (!m[2] || Number(m[2]) === month.getUTCFullYear())) return { kind: "MONTH", offset };
    }
    return null;
  });
  add(/(?:phần còn lại của tháng này|từ (?:bây giờ|giờ|lúc này) (?:đến|tới) cuối tháng(?: này)?)/gu, () => ({ kind: "REST_OF_MONTH" }));
  // End-of-month alone does not mean the remaining month or the whole month.
  add(/cuối tháng(?: (?:này|sau|tới|trước))?/gu, () => null);
  add(/(?:7|bảy) ngày (?:tới|tiếp theo|kể từ hôm nay)/gu, () => ({ kind: "NEXT_7_DAYS" }));
  add(/sắp tới/gu, () => ({ kind: "UPCOMING" }));
  add(/(?:thứ ([2-7])|chủ nhật)(?: (tuần này|tuần sau|tuần tới))?/gu, m => day({ kind: "WEEKDAY", weekday: m[1] ? Number(m[1]) - 1 : 7, qualifier: m[2] ? m[2] === "tuần này" ? "THIS_WEEK" : "NEXT_WEEK" : "UNRESOLVED" }));
  const civil = (d: number, mo: number, y: number | null, calendar: "GREGORIAN" | "LUNAR_VN", leap: string | undefined) => calendar === "GREGORIAN" && leap ? null : day({ kind: "CIVIL_DATE", calendar, day: d, month: mo, year: y, leapMonth: leap ? leap === "tháng nhuận" : null });
  add(/(?:ngày )?(\d{1,2})[\/-](\d{1,2})(?:(?:[\/-]| năm )(\d{4}))?(?: (âm lịch|dương lịch))?(?: (tháng nhuận|không nhuận))?/gu, m => civil(Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : null, m[4] === "âm lịch" ? "LUNAR_VN" : "GREGORIAN", m[5]));
  add(/(\d{4})-(\d{2})-(\d{2})(?: (âm lịch|dương lịch))?(?: (tháng nhuận|không nhuận))?/gu, m => civil(Number(m[3]), Number(m[2]), Number(m[1]), m[4] === "âm lịch" ? "LUNAR_VN" : "GREGORIAN", m[5]));
  add(/ngày (\d{1,2}) tháng (\d{1,2})(?: năm (\d{4}))?(?: (âm lịch|dương lịch))?(?: (tháng nhuận|không nhuận))?/gu, m => civil(Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : null, m[4] === "âm lịch" ? "LUNAR_VN" : "GREGORIAN", m[5]));
  const maximal = () => matches.filter(m => !matches.some(other => other !== m && other.start <= m.start && other.end >= m.end && (other.start < m.start || other.end > m.end))).sort((a, b) => a.start - b.start);
  const dates = maximal().filter(m => m.value?.kind === "DAY");
  for (let i = 0; i + 1 < dates.length; i++) {
    const from = dates[i], through = dates[i + 1];
    const prefix = text.slice(0, from.start).match(/từ\s*$/u);
    if (prefix && /^\s*(?:đến|tới)\s*$/u.test(text.slice(from.end, through.start))) {
      matches.push({ start: from.start - prefix[0].length, end: through.end, value: { kind: "DATE_BOUNDS", from: from.value?.kind === "DAY" ? from.value.date : null, through: through.value?.kind === "DAY" ? through.value.date : null } });
    }
  }
  return maximal();
}

function unsafeUsage(text: string, match: Match): boolean {
  // Source surrounding the selected quote remains authoritative. A model cannot
  // hide negation/quotation by citing only the temporal words inside it.
  const quotePairs = [["\"", "\""], ["'", "'"], ["“", "”"], ["‘", "’"], ["`", "`"]];
  for (const [open, close] of quotePairs) {
    let at = 0;
    while (at < text.length) {
      const a = text.indexOf(open, at); if (a < 0) break;
      const b = text.indexOf(close, a + open.length);
      if (a < match.end && (b < 0 || b >= match.start)) return true;
      at = b < 0 ? text.length : b + close.length;
    }
  }
  const prefix = text.slice(0, match.start);
  const suffix = attachedTail(text.slice(match.end));
  // A bounded yes/no wrapper may end in an interrogative particle immediately
  // before the temporal production (optionally bridged by a preposition).
  // Remove only that terminal particle; earlier negators still veto support.
  // The interrogative exception is a positively bounded nominal construction,
  // not có + arbitrary words. Unknown/contrastive words or punctuation never
  // cause removal of a negator. No LIST intent is inferred from this production.
  const safeInterrogative = /^\s*có (?:lịch|việc|buổi hẹn|lời nhắc) (?:gì|nào) (?:không|ko) (?:(?:trong|vào|cho) )?$/u.test(prefix);
  const usagePrefix = safeInterrogative ? "" : prefix;
  return /(?:^|[^\p{L}])(?:không|ko|chẳng|đừng|chưa|nếu|ví dụ|giả sử|tên|chữ|trích dẫn)(?:[^\p{L}]|$)/u.test(usagePrefix)
    // A terminal bare không/ko remains an interrogative particle. A following
    // lexical operand makes the adjacent negation non-authoritative without
    // interpreting that operand as a verb, reminder field or general intent.
    || /^\s*(?:thì\s+(?:không|ko|chẳng)(?:[^\p{L}]|$)|(?:không|ko|chẳng)\s+\S|(?:đừng|chưa)(?:[^\p{L}]|$))/u.test(suffix)
    || /(?:^|[^\p{L}])(?:nếu|ví dụ|giả sử)(?:[^\p{L}]|$)/u.test(suffix);
}

/** Requires already source-map validated evidence; no model-owned authority bit.
 * Full cited turns expose conflicting/quoted/negated ranges, but only a range
 * fully covered by the accepted quote spans can authorize this candidate.
 */
export function verifyListRangeEvidence(args: { candidateRange: Period; evidence: readonly SourceEvidence[]; turns: readonly TranscriptEntry[]; currentTurnId?: string; referenceTime?: string }): ListRangeSupport {
  const found: Match[] = [];
  let covered = false;
  for (const id of new Set([...args.evidence.map(e => e.sourceTurnId), ...(args.currentTurnId ? [args.currentTurnId] : [])])) {
    const turn = args.turns.find(t => t.id === id);
    if (!turn || turn.role !== "USER") return "UNSUPPORTED";
    // Preserve source-map code-point positions even for unrelated Unicode
    // letters whose lowercase expands (Vietnamese casing itself is 1:1).
    const text = [...turn.semanticView].map(c => { const lower = c.toLocaleLowerCase("vi"); return [...lower].length === 1 ? lower : c; }).join("");
    for (const match of temporalMatches(text, args.referenceTime)) {
      found.push(match);
      if (unsafeUsage(text, match)) return "AMBIGUOUS";
      const start = [...text.slice(0, match.start)].length, end = [...text.slice(0, match.end)].length;
      if (args.evidence.some(e => e.sourceTurnId === id && e.viewSpan.start <= start && e.viewSpan.end >= end && same(match.value, args.candidateRange))) covered = true;
    }
  }
  if (found.some(m => m.value === null) || new Set(found.map(m => JSON.stringify(m.value))).size > 1) return "AMBIGUOUS";
  return covered ? "SUPPORTED" : "UNSUPPORTED";
}
