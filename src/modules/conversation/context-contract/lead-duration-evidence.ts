import type { SourceEvidence, TranscriptEntry } from "./state";

type Turn = Pick<TranscriptEntry, "id" | "role" | "semanticView">;
export type LeadDurationUnit = "HOUR" | "MINUTE";
const words: Readonly<Record<string, number>> = { một: 1, hai: 2, ba: 3 };
const N = "(\\d{1,6}|một|hai|ba)";
const letter = /[\p{L}\p{M}\p{N}_]/u;
const lower = (s: string) => [...s].map(c => { const l = c.toLocaleLowerCase("vi"); return [...l].length === 1 ? l : c; }).join("");
// Exact explicit before-event duration phrases. HOUR may be followed only by a
// stated minute component; MINUTE may be preceded by a stated hour component.
const patterns: Readonly<Record<LeadDurationUnit, RegExp>> = {
  HOUR: new RegExp(`trước\\s+${N}\\s+(?:tiếng|giờ)|${N}\\s+(?:tiếng|giờ)\\s+trước|${N}\\s+(?:tiếng|giờ)\\s+${N}\\s+phút\\s+trước`, "gu"),
  MINUTE: new RegExp(`trước\\s+(?:${N}\\s+(?:tiếng|giờ)\\s+)?${N}\\s+phút|${N}\\s+phút\\s+trước`, "gu"),
};
// A clock, fraction or "to" form after the amount is never a duration. The
// suffix is inspected, never trimmed, so a dangerous continuation fails closed.
const unsafeSuffix = /^\s*(?:rưỡi|kém|sáng|trưa|chiều|tối|đêm|khuya|lúc|đúng|[:h]\s*\d|\d|,\s*\d)/u;
const hourThenMinute = new RegExp(`^\\s+${N}\\s+phút(?:\\s+trước)?(?![\\p{L}\\p{N}])`, "u");
const negation = /(?:^|[^\p{L}\p{M}\p{N}_])(?:không|ko|đừng|chẳng|chưa|bỏ)(?:$|[^\p{L}\p{M}\p{N}_])/u;
const hypothetical = /(?:^|[^\p{L}\p{M}\p{N}_])(?:nếu|ví dụ|giả sử|chẳng hạn)(?:$|[^\p{L}\p{M}\p{N}_])/u;
const reminder = /(?:^|[^\p{L}\p{M}\p{N}_])nhắc(?:$|[^\p{L}\p{M}\p{N}_])/u;
const amount = (token: string | undefined) => token === undefined ? null : words[token] ?? Number(token);
const explicitClockSuffix=/^\s*(?:sáng|trưa|chiều|tối|đêm|khuya|[:h]\s*\d)/u;
function ambiguousBeforeHour(value:number|null,suffix:string):boolean {
 return value!==null&&value>=1&&value<=23&&!hourThenMinute.test(suffix)&&!explicitClockSuffix.test(suffix)
  &&!/^\s+(?:so với|trước)(?:$|[^\p{L}\p{M}])/u.test(suffix);
}
/** Reject-only distinction: bare 'trước8giờ' can be a clock deadline. No
 * returned clock, duration, target or evidence is authored by this helper. */
export function hasAmbiguousLeadHourClock(text:string):boolean {
 const normalized=lower(text);
 if(/["'“”‘’`]/u.test(normalized)||hypothetical.test(normalized))return false;
 for(const match of normalized.matchAll(new RegExp(`trước\\s+${N}\\s+giờ`,'gu'))){
  const before=normalized[match.index!-1]??'',end=match.index!+match[0].length;
  if(letter.test(before)||/[.,/:+-]/u.test(before)||letter.test(normalized[end]??''))continue;
  const clause=normalized.slice(0,match.index).split(/[;,.!?\n]|\s+(?:và|rồi|nhưng|sau đó)\s+/u).at(-1)??'';
  if(reminder.test(clause)&&!negation.test(clause)&&ambiguousBeforeHour(amount(match[1]),normalized.slice(end)))return true;
 }
 return false;
}

/** Boolean support for an already-proposed amount/unit. It never returns or
 * authors an operand; unknown wording grants no duration authority. */
export function supportsLeadDuration(unit: LeadDurationUnit, value: unknown, sources: readonly SourceEvidence[], turns: readonly Turn[]): boolean {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > (unit === "HOUR" ? 8784 : 527040)) return false;
  return sources.some(source => {
    const turn = turns.find(t => t.id === source.sourceTurnId);
    if (!turn || turn.role !== "USER" || source.kind !== "USER_QUOTE") return false;
    const text = lower(turn.semanticView), quote = lower(source.quote), view = [...text];
    if (view.slice(source.viewSpan.start, source.viewSpan.end).join("") !== quote) return false;
    if (/["'“”‘’`]/u.test(text) || hypothetical.test(text)) return false;
    for (const match of quote.matchAll(patterns[unit])) {
      const start = source.viewSpan.start + [...quote.slice(0, match.index)].length, end = start + [...match[0]].length;
      if (letter.test(view[start - 1] ?? "") || /[.,/:+-]/u.test(view[start - 1] ?? "") || letter.test(view[end] ?? "")) continue;
      const suffix = view.slice(end).join("");
      if(unit==='HOUR'&&match[1]&&match[0].endsWith('giờ')&&ambiguousBeforeHour(amount(match[1]),suffix))continue;
      const compound = unit === "HOUR" ? hourThenMinute.exec(suffix) : null;
      if (unsafeSuffix.test(compound ? suffix.slice(compound[0].length) : suffix)) continue;
      const clause = view.slice(0, start).join("").split(/[;,.!?\n]|\s+(?:và|rồi|nhưng|sau đó)\s+/u).at(-1) ?? "";
      if (negation.test(clause) || !reminder.test(clause)) continue;
      const stated = unit === "HOUR" ? amount(match[1] ?? match[2] ?? match[3]) : amount(match[2] ?? match[3]);
      if (stated === value) return true;
    }
    return false;
  });
}

/** Boolean omission obligation: every grounded duration in this user turn must
 * be carried by a proposed change with the same unit and amount. */
export function leadDurationCovered(turn: Turn, changes: readonly { field: string; value: unknown }[]): boolean {
  if (turn.role !== "USER") return true;
  const length = [...turn.semanticView].length;
  const source: SourceEvidence = { kind: "USER_QUOTE", sourceTurnId: turn.id, sourceMapTurnId: turn.id, quote: turn.semanticView, occurrence: 1, sourceSpan: { start: 0, end: length }, viewSpan: { start: 0, end: length }, normalizationVersion: "nfc-codepoint-v1" };
  for (const token of new Set(lower(turn.semanticView).match(/\d{1,6}|một|hai|ba/gu) ?? [])) {
    const value = amount(token)!;
    for (const [unit, field] of [["HOUR", "leadOffsetHours"], ["MINUTE", "leadOffsetMinutes"]] as const) {
      if (supportsLeadDuration(unit, value, [source], [turn]) && !changes.some(c => c.field === field && c.value === value)) return false;
    }
  }
  // A duration-looking instruction that this finite verifier cannot fully
  // support must not disappear into a default or an unrelated clock.
  const text=lower(turn.semanticView);
  if (!/["'“”‘’`]/u.test(text) && !hypothetical.test(text)) {
    for (const match of text.matchAll(new RegExp(`trước\\s+${N}\\s+(?:tiếng|giờ|phút)|${N}\\s+(?:tiếng|giờ|phút)\\s+trước`,"gu"))) {
      const clause=text.slice(0,match.index).split(/[;,.!?\n]|\s+(?:và|rồi|nhưng|sau đó)\s+/u).at(-1)??"";
      const start=[...text.slice(0,match.index)].length,end=start+[...match[0]].length;
      const matched={...source,quote:[...turn.semanticView].slice(start,end).join(""),viewSpan:{start,end}};
      if (!negation.test(clause) && reminder.test(clause) && !hasLeadDurationEvidence([matched],[turn])) return false;
    }
  }
  return true;
}

/** Reject-only source cue; candidate numbers are private verifier probes. */
export function hasLeadDurationEvidence(sources:readonly SourceEvidence[],turns:readonly Turn[]):boolean {
 return sources.some(source=>(lower(source.quote).match(/\d{1,6}|một|hai|ba/gu)??[]).some(token=>
  (["HOUR","MINUTE"] as const).some(unit=>supportsLeadDuration(unit,amount(token),[source],turns))));
}
export function hasLeadDurationSourceCue(text:string):boolean {
 const turn:Turn={id:"duration-source-probe",role:"USER",semanticView:text},length=[...text].length;
 return hasLeadDurationEvidence([{kind:"USER_QUOTE",sourceTurnId:turn.id,sourceMapTurnId:turn.id,quote:text,occurrence:1,sourceSpan:{start:0,end:length},viewSpan:{start:0,end:length},normalizationVersion:"nfc-codepoint-v1"}],[turn]);
}
