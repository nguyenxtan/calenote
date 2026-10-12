import type { SourceEvidence, TranscriptEntry } from "./state";

export type EventRelation = "BEFORE_EVENT" | "INCLUDING_EVENT" | "STARTING_ON";

const patterns: ReadonlyArray<[EventRelation, RegExp]> = [
    ["BEFORE_EVENT", /trước (?:ngày thi|hôm thi|sự kiện|đó|(?:\d+|một|hai|ba) ngày)|(?:\d+|một|hai|ba) ngày trước(?: (?:ngày thi|hôm thi|sự kiện|đó))?/gu],
    ["INCLUDING_EVENT", /(?:tính cả|bao gồm|kể cả|nhắc cả) (?:ngày thi|hôm thi|ngày sự kiện|ngày diễn ra|ngày đó)|nhắc (?:hôm đó|ngày đó|đúng ngày thi|cùng ngày)/gu],
    ["STARTING_ON", /(?:bắt đầu (?:(?:từ|kể từ) )?|nhắc(?: (?:tôi|mình|tui))? (?:từ|kể từ) )(?:ngày )?(?:\d{1,2}[/-]\d{1,2}|hôm nay|ngày mai|mai)|ngày \d{1,2}[/-]\d{1,2} bắt đầu nhắc/gu],
  ];

const relationSourceCasefold=(text:string)=>[...text].map(c => {const lower = c.toLocaleLowerCase("vi"); return [...lower].length === 1 ? lower : c;}).join("");
/** Conservative cue presence, not unique value support or execution authority. */
export function hasEventRelationSourceCue(text:string):boolean {
  const folded=relationSourceCasefold(text);
  return patterns.some(([,pattern])=>!folded.matchAll(pattern).next().done);
}

/** Narrow support verifier for an already proposed finite enum, not an intent,
 * date or recurrence parser. Unknown language grants no new relation authority.
 * Uses source-map validated evidence and its surrounding USER turn so a quote
 * cannot hide negation, hypothetical usage or a conflicting relation.
 */
export function supportsEventRelation(value: EventRelation, evidence: readonly SourceEvidence[], turns: readonly Pick<TranscriptEntry, "id" | "role" | "semanticView">[], retainedEventContext = false): boolean {
  let covered = false;
  for (const id of new Set(evidence.map(e => e.sourceTurnId))) {
    const turn = turns.find(t => t.id === id);
    if (!turn || turn.role !== "USER") return false;
    const text = relationSourceCasefold(turn.semanticView);
    // Quoted/hypothetical relation productions are not executable user facts.
    if (/["'“”‘’`]/u.test(text) || /(?:^|[^\p{L}])(?:nếu|ví dụ|giả sử)(?:[^\p{L}]|$)/u.test(text)) return false;
    for (const [relation, pattern] of patterns) for (const match of text.matchAll(pattern)) {
      if (/[\p{L}\p{N}_]/u.test(text[match.index! - 1] ?? "") || /[\p{L}\p{N}_]/u.test(text[match.index! + match[0].length] ?? "")) continue;
      const prefix = text.slice(0,match.index).split(/[;,.!?]/u).at(-1) ?? "";
      const suffix = text.slice(match.index! + match[0].length).replace(/^[\s\p{P}]+/u, "");
      if (/^(?:thì\s+)?(?:không|ko|chẳng|đừng|chưa)(?:[^\p{L}]|$)/u.test(suffix)) continue;
      if (/(?:^|[^\p{L}])(?:cụm từ|từ ngữ|tên|chữ|trích dẫn)(?:[^\p{L}]|$)/u.test(prefix)) continue;
      if (/(?:^|[^\p{L}])(?:không|ko|đừng|chẳng|chưa)(?:[^\p{L}]|$)/u.test(prefix)) continue;
      if (/^(?:\d+|một|hai|ba) ngày trước$/u.test(match[0])) {
        // A bare backward-day fragment is a scoped answer, not authority to
        // reinterpret a historical narrative as a reminder lead relation.
        const explicitReminder = /(?:^|[^\p{L}])nhắc(?:[^\p{L}]|$)/u.test(prefix);
        if ((!explicitReminder && (!retainedEventContext || prefix.trim() !== "")) || !/^(?:lúc \d{1,2}(?:h|:\d{2})(?: (?:sáng|trưa|chiều|tối))?)?\.?$/u.test(suffix)) continue;
      } else if (/^trước (?:\d+|một|hai|ba) ngày$/u.test(match[0])) {
        if (!/(?:^|[^\p{L}])nhắc(?:[^\p{L}]|$)/u.test(prefix)
          && !(retainedEventContext && prefix.trim() === "" && /^(?:lúc \d{1,2}(?:h|:\d{2})(?: (?:sáng|trưa|chiều|tối))?)?\.?$/u.test(suffix))) continue;
      }
      if (relation !== value) return false;
      const start = [...text.slice(0, match.index)].length, end = start + [...match[0]].length;
      if (evidence.some(e => e.sourceTurnId === id && e.viewSpan.start <= start && e.viewSpan.end >= end)) covered = true;
    }
  }
  return covered;
}
