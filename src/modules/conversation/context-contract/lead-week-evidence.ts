import type { SourceEvidence, TranscriptEntry } from "./state";

type Turn = Pick<TranscriptEntry, "id" | "role" | "semanticView">;
const words: Readonly<Record<string, number>> = { một: 1, hai: 2, ba: 3 };
const token = "(\\d{1,6}|một|hai|ba)";
const pattern = new RegExp(`trước\\s+${token}\\s+tuần|${token}\\s+tuần\\s+trước`, "gu");
const boundary = /[\p{L}\p{M}\p{N}_]/u;
const lower = (text: string) => [...text].map(c => { const normalized = c.toLocaleLowerCase("vi"); return [...normalized].length === 1 ? normalized : c; }).join("");
const hypothetical = /(?:^|[^\p{L}\p{M}\p{N}_])(?:nếu|ví dụ|giả sử|chẳng hạn)(?:$|[^\p{L}\p{M}\p{N}_])/u;
const unowned = /(?:^|[^\p{L}\p{M}\p{N}_])(?:không|ko|đừng|chẳng|chưa|bỏ|tên|chữ|trích dẫn|cụm từ|từ ngữ)(?:$|[^\p{L}\p{M}\p{N}_])/u;
const reminder = /(?:^|[^\p{L}\p{M}\p{N}_])nhắc(?:$|[^\p{L}\p{M}\p{N}_])/u;

/** Verifies an already-authored week amount. Never converts units, extracts a
 * proposal, or chooses a request action/target. Bare answers require retained
 * event ownership supplied by the application. */
export function supportsLeadWeekOffset(value: unknown, sources: readonly SourceEvidence[], turns: readonly Turn[], retainedEvent = false): boolean {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > 52) return false;
  return sources.some(source => {
    const turn = turns.find(candidate => candidate.id === source.sourceTurnId);
    if (!turn || turn.role !== "USER" || source.kind !== "USER_QUOTE") return false;
    const text = lower(turn.semanticView), quote = lower(source.quote), view = [...text];
    if (view.slice(source.viewSpan.start, source.viewSpan.end).join("") !== quote || /["'“”‘’`?]/u.test(text) || hypothetical.test(text)) return false;
    for (const match of quote.matchAll(pattern)) {
      const start = source.viewSpan.start + [...quote.slice(0, match.index)].length, end = start + [...match[0]].length;
      if (boundary.test(view[start - 1] ?? "") || /[.,/:+-]/u.test(view[start - 1] ?? "") || boundary.test(view[end] ?? "")) continue;
      const prefix = view.slice(0, start).join("").split(/[;,.!?\n]|\s+(?:và|rồi|nhưng|sau đó)\s+/u).at(-1) ?? "";
      const suffix = view.slice(end).join("");
      if (unowned.test(prefix) || /^\s*(?:rưỡi|kém|[.,]\s*\d|\d|liên tiếp|liên tục|liền)(?:$|[^\p{L}\p{M}])/u.test(suffix)
        || /^[\s\p{P}]*(?:thì\s+)?(?:không|ko|đừng|chẳng|chưa)(?:$|[^\p{L}\p{M}\p{N}_])/u.test(suffix)) continue;
      if (!reminder.test(prefix) && !(retainedEvent && !prefix.trim())) continue;
      const amount = words[match[1] ?? match[2]] ?? Number(match[1] ?? match[2]);
      if (amount === value) return true;
    }
    return false;
  });
}

/** Every supported week lead keeps its authored unit and amount. An equal
 * day offset or a computed notification count cannot satisfy this obligation. */
export function leadWeekOffsetCovered(turn: Turn, changes: readonly { field: string; value: unknown }[], alternatives: readonly { field: string; value: unknown }[], retainedWeeks: unknown, retainedEvent = false): boolean {
  if (turn.role !== "USER") return true;
  const length = [...turn.semanticView].length;
  const source: SourceEvidence = { kind: "USER_QUOTE", sourceTurnId: turn.id, sourceMapTurnId: turn.id, quote: turn.semanticView, occurrence: 1,
    sourceSpan: { start: 0, end: length }, viewSpan: { start: 0, end: length }, normalizationVersion: "nfc-codepoint-v1" };
  for (const candidate of new Set(lower(turn.semanticView).match(/\d{1,6}|một|hai|ba/gu) ?? [])) {
    const value = words[candidate] ?? Number(candidate);
    const retained = retainedWeeks === value && !changes.some(change => change.field === "leadOffsetWeeks");
    if (supportsLeadWeekOffset(value, [source], [turn], retainedEvent) && !retained
      && ![...changes, ...alternatives].some(change => change.field === "leadOffsetWeeks" && change.value === value)) return false;
  }
  // Unsupported fractions or excessive amounts still carry week intent and
  // cannot disappear into the backend's optional single-reminder default.
  const text = lower(turn.semanticView), unsafeAmount = "(?:[+-]?\\d+(?:[.,/]\\d+)?|một|hai|ba)";
  if (!/["'“”‘’`?]/u.test(text) && !hypothetical.test(text)) {
    for (const match of text.matchAll(new RegExp(`trước\\s+${unsafeAmount}\\s+tuần|${unsafeAmount}\\s+tuần(?:\\s+rưỡi)?\\s+trước`, "gu"))) {
      const prefix = text.slice(0, match.index).split(/[;,.!?\n]|\s+(?:và|rồi|nhưng|sau đó)\s+/u).at(-1) ?? "";
      if (unowned.test(prefix) || !reminder.test(prefix) && !(retainedEvent && !prefix.trim())) continue;
      const start = [...text.slice(0, match.index)].length, end = start + [...match[0]].length;
      const selected = { ...source, quote: [...turn.semanticView].slice(start, end).join(""), viewSpan: { start, end } };
      if (!hasLeadWeekOffsetEvidence([selected], [turn], retainedEvent)) return false;
    }
  }
  return true;
}

/** Source predicate only; candidate numbers remain private verifier probes. */
export function hasLeadWeekOffsetEvidence(sources: readonly SourceEvidence[], turns: readonly Turn[], retainedEvent = false): boolean {
  return sources.some(source => (lower(source.quote).match(/\d{1,6}|một|hai|ba/gu) ?? [])
    .some(candidate => supportsLeadWeekOffset(words[candidate] ?? Number(candidate), [source], turns, retainedEvent)));
}
