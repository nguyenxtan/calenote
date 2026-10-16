import { supportsEventRelation } from "./event-relation-evidence";
import type { SourceEvidence, TranscriptEntry } from "./state";

/** Support for an already-proposed day offset only. Never derives an offset
 * from count, an arbitrary number, or a general date expression. */
export function supportsLeadOffset(value: number, evidence: readonly SourceEvidence[], turns: readonly Pick<TranscriptEntry, "id" | "role" | "semanticView">[], seriesCount?: number): boolean {
  if (!Number.isSafeInteger(value) || value < 1 || value > 366) return false;
  const words: Record<string, number> = { một: 1, hai: 2, ba: 3 };
  let supported = false;
  for (const source of evidence) {
    const turn = turns.find(t => t.id === source.sourceTurnId);
    if (!turn || turn.role !== "USER") continue;
    const view = [...turn.semanticView];
    const quote = [...source.quote].map(c => {
      const lower = c.toLocaleLowerCase("vi");
      return [...lower].length === 1 ? lower : c;
    }).join("");
    const pattern = /(?:trước\s+(?:(?:ngày thi|hôm thi|sự kiện|đó)\s+)?(\d+|một|hai|ba)\s+ngày|(\d+|một|hai|ba)\s+ngày\s+trước(?:\s+(?:ngày thi|hôm thi|sự kiện|đó))?)/gu;
    for (const match of quote.matchAll(pattern)) {
      const before = quote[match.index! - 1] ?? "", after = quote[match.index! + match[0].length] ?? "";
      if (/[\p{L}\p{N}_.,/:+-]/u.test(before) || /[\p{L}\p{N}_]/u.test(after)) continue;
      if (/^\s+liên tiếp(?:[^\p{L}]|$)/u.test(quote.slice(match.index! + match[0].length))) return false;
      // A numeric phrase cannot borrow an executable relation from a separate
      // clause. Reuse the existing clause/negation verifier on this exact span.
      const start = source.viewSpan.start + [...quote.slice(0, match.index)].length;
      const end = start + [...match[0]].length;
      if (/[\p{L}\p{N}_.,/:+-]/u.test(view[start - 1] ?? "") || /[\p{L}\p{N}_]/u.test(view[end] ?? "")) continue;
      if (/^\s+liên tiếp(?:[^\p{L}]|$)/u.test(view.slice(end).join("").toLocaleLowerCase("vi"))) return false;
      if (!supportsEventRelation("BEFORE_EVENT", [{ ...source, viewSpan: { start, end } }], turns, true)) continue;
      const token = match[1] ?? match[2], offset = words[token] ?? Number(token);
      if (offset !== value) return false;
      // In a retained DAILY/count-N request the same N-day answer can select
      // the preceding series, not an independent start distance. Require a
      // separately stated start/single-reminder instruction in this exact
      // evidence clause. Count itself never supplies a new operand.
      if (seriesCount === offset) {
        const prefix = quote.slice(0, match.index).split(/[;,.!?]/u).at(-1) ?? "";
        if (!/(?:^|[^\p{L}])(?:bắt đầu nhắc|nhắc (?:một|1) lần)\s*$/u.test(prefix)) return false;
      }
      supported = true;
    }
  }
  return supported;
}

/** Generation-only sufficient exclusion for a complete retained-count answer.
 * Unknown tails/other clauses decline exclusion; never extracts an operand or
 * decides CURRENT versus NEW. Existing field/value ownership stays unchanged. */
export function isBareRetainedSeriesOffsetAnswer(value: number, evidence: readonly SourceEvidence[], turns: readonly Pick<TranscriptEntry, "id" | "role" | "semanticView">[], seriesCount?: number): boolean {
  if (seriesCount !== value || evidence.length !== 1) return false;
  const source = evidence[0], turn = turns.find(t => t.id === source.sourceTurnId);
  if (!turn || turn.role !== "USER" || source.quote !== turn.semanticView || source.viewSpan.start !== 0 || source.viewSpan.end !== [...turn.semanticView].length) return false;
  const text = turn.semanticView.toLocaleLowerCase("vi");
  if (!/^\s*(?:nhắc(?:\s+(?:tôi|mình|tui))?\s+)?(?:trước\s+(?:(?:ngày thi|hôm thi|sự kiện|đó)\s+)?(?:\d+|một|hai|ba)\s+ngày|(?:\d+|một|hai|ba)\s+ngày\s+trước(?:\s+(?:ngày thi|hôm thi|sự kiện|đó))?)\s*[.!]?\s*$/u.test(text)) return false;
  return supportsLeadOffset(value, evidence, turns) && !supportsLeadOffset(value, evidence, turns, seriesCount);
}
