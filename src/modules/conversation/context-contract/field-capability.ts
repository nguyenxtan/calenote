import type { ContextInput } from "./contracts";
import type { SourceEvidence } from "./state";
import { supportsCadenceOperand } from "./cadence-count-evidence";
import { isBareRetainedSeriesOffsetAnswer, supportsLeadOffset } from "./lead-offset-evidence";
import { supportsEventRelation } from "./event-relation-evidence";
import { CONTROL_PLACEHOLDER } from "./projection";
import { extractTemporalEvidence } from "../../semantic/temporal-evidence";
import { examTitleCoverage, isFirstPersonExamClockAssertion, isInitialIsolatedExamNotesFree, isInitialEventDateOnlySource, isBoundRetainedSeriesNotesFree } from "./semantic-completeness";

export const NUMERIC_PROPOSAL_FIELDS = ["frequency", "occurrenceCount", "leadOffsetDays"] as const;
export type NumericProposalField = typeof NUMERIC_PROPOSAL_FIELDS[number];
export const CLOCK_PROPOSAL_FIELDS = ["eventTime", "reminderTime"] as const;
export type ClockProposalField = typeof CLOCK_PROPOSAL_FIELDS[number];
export interface GenerationFieldCapability {
  version: "generation-field-capability-13";
  reminderDateProposalAllowed: boolean;
  /** Sufficient source-year checkpoint only; model still authors every slot. */
  eventDateYearNullRequired: boolean;
  /** False only for sufficient initial or bound scheduling-only source contexts. */
  notesProposalAllowed: boolean;
  allowedNumericFields: readonly NumericProposalField[];
  allowedClockFields: readonly ClockProposalField[];
  titlePresenceRequired: boolean;
  /** Availability from the application-bound occupied CURRENT slot only. */
  titleCorrectionAllowed: boolean;
  /** Calendar slot availability, independent of date/query calendar operands. */
  calendarProposalAllowed: boolean;
}
/** Finite existing calendar cues only; no default, conversion or value output.
 * Whole USER guards prevent a control split from hiding unsafe context. */
function hasExplicitCalendarCue(text: string): boolean {
  if (/["'“”‘’`]/u.test(text) || /(?:^|[^\p{L}\p{M}\p{N}_])(?:không|khong|ko|đừng|dung|chẳng|chang|chưa|chua|nếu|neu|ví dụ|vi du|giả sử|gia su|tên|ten|chữ|chu|trích dẫn|trich dan|cụm từ|cum tu|từ ngữ|tu ngu)(?:$|[^\p{L}\p{M}\p{N}_])/iu.test(text)) return false;
  return text.split(CONTROL_PLACEHOLDER).some(segment => /(?:^|[^\p{L}\p{M}\p{N}_])(?:âm lịch|lịch âm|ngày âm|dương lịch|lịch dương|am lich|lich am|ngay am|duong lich|lich duong)(?:$|[^\p{L}\p{M}\p{N}_])/iu.test(segment));
}
/** Whole numeric clock answer only; the scanner validates existing clock
 * grammar, but its parsed value is never returned or used as a proposal. */
function isBareNumericClockAnswer(text: string, reference: string): boolean {
  if (!/^\s*(?:\d{1,2}h(?:\d{1,2})?|\d{1,2}:\d{2})(?:\s+(?:sáng|trưa|chiều|tối))?\s*[.!]?\s*$/iu.test(text)) return false;
  const time = extractTemporalEvidence({ text, referenceNow: Date.parse(reference) }).time;
  return time.state === "RESOLVED" && time.source === "EXACT_TIME";
}
/** Sufficient generation context only; no value, target or evidence output. */
export function isBoundReminderClockAnswer(input: ContextInput): boolean {
  const current = input.turns[input.currentTurn];
  return !!input.activeRequest && input.pendingQuestion?.scope === "REMINDER"
    && input.pendingQuestion.field === "reminderTime" && current?.role === "USER"
    && isBareNumericClockAnswer(current.text, input.reference.instant);
}
/** Finite notification clause owns its single clock, not an event clock.
 * Cadence/count and full-context checks remain existing predicate probes;
 * neither the candidate count nor the parsed clock is returned as a value. */
function isExplicitNotificationClockSource(text: string, reference: string): boolean {
  if (text.includes(CONTROL_PLACEHOLDER)) return false;
  const match = /(?:^|[,;])\s*(nhắc(?:\s+(?:tôi|mình|tui))?\s+(\d+|một|hai|ba)\s+ngày\s+liên tiếp\s+lúc\s+(.+?))\s*[.!]?\s*$/iu.exec(text);
  if (!match || !isBareNumericClockAnswer(match[3], reference)) return false;
  const time = extractTemporalEvidence({ text, referenceNow: Date.parse(reference) }).time;
  if (time.state !== "RESOLVED" || time.source !== "EXACT_TIME") return false;
  const words: Readonly<Record<string, number>> = { một: 1, hai: 2, ba: 3 };
  const count = words[match[2].toLocaleLowerCase("vi")] ?? Number(match[2]);
  const clause = { id: "notification-clause", role: "USER" as const, semanticView: match[1] };
  const full = { id: "notification-user", role: "USER" as const, semanticView: text };
  const length = [...match[1]].length, start = [...text.slice(0, match.index + match[0].indexOf(match[1]))].length;
  const source: SourceEvidence = { kind: "USER_QUOTE", sourceTurnId: clause.id, sourceMapTurnId: clause.id, quote: match[1], occurrence: 1,
    sourceSpan: { start: 0, end: length }, viewSpan: { start: 0, end: length }, normalizationVersion: "nfc-codepoint-v1" };
  const contextual: SourceEvidence = { ...source, sourceTurnId: full.id, sourceMapTurnId: full.id,
    sourceSpan: { start, end: start + length }, viewSpan: { start, end: start + length } };
  return supportsCadenceOperand("frequency", "DAILY", [source], [clause])
    && supportsCadenceOperand("occurrenceCount", count, [source], [clause])
    && supportsCadenceOperand("frequency", "DAILY", [contextual], [full])
    && supportsCadenceOperand("occurrenceCount", count, [contextual], [full]);
}
/** Sufficient initial source-grounded lower bound, not clock availability. */
export function isInitialExplicitReminderClockRequired(input: ContextInput): boolean {
  const current = input.turns[input.currentTurn];
  return !input.activeRequest && current?.role === "USER" && examTitleCoverage(current.text) !== null
    && isExplicitNotificationClockSource(current.text, input.reference.instant);
}
export function isInitialExplicitEventClockRequired(input:ContextInput):boolean {
  const current=input.turns[input.currentTurn];
  return !input.activeRequest&&current?.role==="USER"&&isFirstPersonExamClockAssertion(current.text);
}
export function isInitialEventDateYearNullRequired(input:ContextInput):boolean {
  if(!isInitialIsolatedExamNotesFree(input))return false;
  const date=extractTemporalEvidence({text:input.turns[0].text,referenceNow:Date.parse(input.reference.instant)}).date;
  return date.state==="RESOLVED"&&date.source==="DAY_MONTH";
}
/** Unique source support is a sufficient lower bound, not availability or an
 * extracted proposal. Candidate values stay private to existing probes. */
function initialCadenceCountProbes(input:ContextInput) {
  if(!isInitialIsolatedExamNotesFree(input))return null;
  const text=input.turns[0].text,length=[...text].length;
  const turn={id:"initial-user",role:"USER" as const,semanticView:text};
  const source:SourceEvidence={kind:"USER_QUOTE",sourceTurnId:turn.id,sourceMapTurnId:turn.id,quote:text,occurrence:1,sourceSpan:{start:0,end:length},viewSpan:{start:0,end:length},normalizationVersion:"nfc-codepoint-v1"};
  const frequencies=["ONCE","DAILY","WEEKLY","MONTHLY","YEARLY"].filter(value=>supportsCadenceOperand("frequency",value,[source],[turn]));
  const words:Readonly<Record<string,number>>={một:1,hai:2,ba:3};
  const candidates=new Set([...text.toLocaleLowerCase("vi").matchAll(/\d+|một|hai|ba/gu)].map(match=>words[match[0]]??Number(match[0])));
  const counts=[...candidates].filter(value=>supportsCadenceOperand("occurrenceCount",value,[source],[turn]));
  return {frequencies,counts,candidates,source,turn};
}
export function isInitialUniqueCadenceCountRequired(input:ContextInput):boolean {
  const probes=initialCadenceCountProbes(input);
  return !!probes&&probes.frequencies.length===1&&probes.counts.length===1;
}
/** Numeric-domain support only, never complete schedule readiness or an
 * authored value. All candidates remain private existing entailment probes. */
export function isInitialSupportedCadenceCount(input:ContextInput):boolean {
  const probes=initialCadenceCountProbes(input);
  if(!probes||!Array.isArray(input.capabilities?.supported)||!input.capabilities.supported.includes("FINITE_DAILY")||input.capabilities.limits?.dailyCount!==30)return false;
  return probes.frequencies.length===1&&probes.frequencies[0]==="DAILY"
    && probes.counts.length===1&&Number.isSafeInteger(probes.counts[0])&&probes.counts[0]>=2&&probes.counts[0]<=input.capabilities.limits.dailyCount
    && ![...probes.candidates].some(value=>supportsLeadOffset(value,[probes.source],[probes.turn]));
}
/** Numeric/clock generation upper bounds plus bounded title presence. Probing support predicates
 * never supplies a proposed operand, evidence, or permission to mutate state.
 * CURRENT retained slots and NEW proposals still require downstream ownership.
 */
export function deriveGenerationFieldCapability(input: ContextInput): GenerationFieldCapability {
  const allowed = new Set<NumericProposalField>();
  const clocks = new Set<ClockProposalField>();
  const current = input.turns[input.currentTurn];
  const reminderClockAnswer = isBoundReminderClockAnswer(input);
  const reminderClockSource = current?.role === "USER" && isExplicitNotificationClockSource(current.text, input.reference.instant);
  for (const field of CLOCK_PROPOSAL_FIELDS) {
    const slot = input.activeRequest?.slots[field];
    if (slot && ["PROPOSED", "RESOLVED", "CONFLICT"].includes(slot.state) && slot.value !== null) clocks.add(field);
  }
  // CURRENT SET may cite an earlier immutable USER source; NEW and edits
  // still require current/scoped evidence downstream. Excluding all previous
  // sources here would remove existing legal re-proposal behavior.
  for (const [index, turn] of input.turns.slice(0, input.currentTurn + 1).entries()) {
    if (turn.role !== "USER") continue;
    for (const text of turn.text.split(CONTROL_PLACEHOLDER)) {
      const temporal = extractTemporalEvidence({ text, referenceNow: Date.parse(input.reference.instant) }).time;
      const named = /(?:^|[^\p{L}\p{M}\p{N}_])(?:nửa\s+đêm|midnight|noon)(?:$|[^\p{L}\p{M}\p{N}_])/iu.test(text);
      if (named || (temporal.state !== "MISSING" && !(temporal.state === "AMBIGUOUS" && temporal.reason === "DAYPART_WITHOUT_EXACT_TIME"))) {
        // Bound bare answers and finite notification clauses grant only their notification clock.
        // Occupied slots and earlier eligible sources keep their upper bounds.
        const fields = (reminderClockAnswer || reminderClockSource) && index === input.currentTurn ? ["reminderTime"] as const : CLOCK_PROPOSAL_FIELDS;
        fields.forEach(field => clocks.add(field));
      }
    }
  }
  for (const field of NUMERIC_PROPOSAL_FIELDS) {
    const slot = input.activeRequest?.slots[field];
    if (slot && ["PROPOSED", "RESOLVED", "CONFLICT"].includes(slot.state) && slot.value !== null) allowed.add(field);
  }
  const frequency = input.activeRequest?.slots.frequency, count = input.activeRequest?.slots.occurrenceCount;
  const seriesCount = frequency && count && ["PROPOSED", "RESOLVED"].includes(frequency.state)
    && ["PROPOSED", "RESOLVED"].includes(count.state) && frequency.value === "DAILY" && typeof count.value === "number" ? count.value : undefined;
  if (current?.role === "USER") {
    const segments = current.text.split(CONTROL_PLACEHOLDER);
    const fullTurn = { id: "current-user", role: "USER" as const, semanticView: current.text };
    let nextStart = 0;
    for (const [index, text] of segments.entries()) {
      const length = [...text].length, start = nextStart;
      nextStart += length + [...CONTROL_PLACEHOLDER].length;
      if (!text.trim()) continue;
      const turn = { id: `current-segment-${index}`, role: "USER" as const, semanticView: text };
      const source: SourceEvidence = { kind: "USER_QUOTE", sourceTurnId: turn.id, sourceMapTurnId: turn.id, quote: text, occurrence: 1,
        sourceSpan: { start: 0, end: length }, viewSpan: { start: 0, end: length }, normalizationVersion: "nfc-codepoint-v1" };
      // Predicate probes only, never canonical SourceEvidence output. Pair
      // exact segment support with its complete immutable USER context so a
      // control boundary cannot hide a surrounding negation or hypothetical.
      const contextual: SourceEvidence = { ...source, sourceTurnId: fullTurn.id, sourceMapTurnId: fullTurn.id,
        sourceSpan: { start, end: start + length }, viewSpan: { start, end: start + length } };
      const pendingCount = input.activeRequest && input.pendingQuestion?.scope === "REMINDER" && input.pendingQuestion.field === "occurrenceCount" && segments.length === 1 ? turn.id : undefined;
      // Lexical candidates are private predicate probes, never returned values.
      const words: Readonly<Record<string, number>> = { một: 1, hai: 2, ba: 3 };
      const numbers = [...text.toLocaleLowerCase("vi").matchAll(/\d+|một|hai|ba/gu)].map(m => words[m[0]] ?? Number(m[0]));
      for (const value of ["ONCE", "DAILY", "WEEKLY", "MONTHLY", "YEARLY"]) {
        if (supportsCadenceOperand("frequency", value, [source], [turn]) && supportsCadenceOperand("frequency", value, [contextual], [fullTurn])) allowed.add("frequency");
      }
      for (const value of numbers) {
        if (supportsCadenceOperand("occurrenceCount", value, [source], [turn], pendingCount, input.activeRequest ? turn.id : undefined)
          && supportsCadenceOperand("occurrenceCount", value, [contextual], [fullTurn], pendingCount ? fullTurn.id : undefined, input.activeRequest ? fullTurn.id : undefined)) allowed.add("occurrenceCount");
        // The lead verifier accepts a bare scoped answer. A segment separated
        // by a control cannot borrow a reminder verb from another segment.
        const leadScope = segments.length === 1 || !!input.activeRequest;
        // This root schema spans both targets. An explicit independently
        // grounded lead instruction may propose NEW even while CURRENT holds
        // a series. Bare CURRENT answers retain the series-count restriction;
        // the validator still checks the model's chosen target and value.
        const bareSeriesAnswer = !allowed.has("leadOffsetDays") && isBareRetainedSeriesOffsetAnswer(value, [contextual], [fullTurn], seriesCount);
        const newLead = !bareSeriesAnswer && supportsEventRelation("BEFORE_EVENT", [source], [turn], false) && supportsLeadOffset(value, [source], [turn])
          && supportsEventRelation("BEFORE_EVENT", [contextual], [fullTurn], false) && supportsLeadOffset(value, [contextual], [fullTurn]);
        const currentLead = leadScope && supportsLeadOffset(value, [source], [turn], seriesCount) && supportsLeadOffset(value, [contextual], [fullTurn], seriesCount);
        if (currentLead || newLead) allowed.add("leadOffsetDays");
      }
    }
  }
  const title = input.activeRequest?.slots.title;
  const calendar = input.activeRequest?.slots.calendar;
  return { version: "generation-field-capability-13", reminderDateProposalAllowed:!isInitialEventDateOnlySource(input), eventDateYearNullRequired:isInitialEventDateYearNullRequired(input), notesProposalAllowed: !(isInitialIsolatedExamNotesFree(input)||isBoundRetainedSeriesNotesFree(input)), titlePresenceRequired: current?.role==="USER" && examTitleCoverage(current.text)!==null && (!input.activeRequest || !isFirstPersonExamClockAssertion(current.text)),
    titleCorrectionAllowed: !!title && ["PROPOSED", "RESOLVED", "CONFLICT"].includes(title.state) && title.value !== null,
    calendarProposalAllowed: !!calendar && ["PROPOSED", "RESOLVED", "CONFLICT"].includes(calendar.state) && calendar.value !== null
      || current?.role === "USER" && hasExplicitCalendarCue(current.text),
    allowedNumericFields: NUMERIC_PROPOSAL_FIELDS.filter(field => allowed.has(field)), allowedClockFields: CLOCK_PROPOSAL_FIELDS.filter(field => clocks.has(field)) };
}
