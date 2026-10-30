import type { ContextInput } from "./contracts";
import type { SourceEvidence } from "./state";
import { supportsCadenceOperand } from "./cadence-count-evidence";
import { isBareRetainedSeriesOffsetAnswer, supportsLeadOffset } from "./lead-offset-evidence";
import { supportsEventRelation, hasEventRelationSourceCue } from "./event-relation-evidence";
import { CONTROL_PLACEHOLDER } from "./projection";
import {resolveDateOperand} from "./resolve";
import {lunarCalendar} from "../../conversation/lunar-calendar";
import { extractTemporalEvidence } from "../../semantic/temporal-evidence";
import { examTitleCoverage, isFirstPersonExamClockAssertion, isInitialIsolatedExamNotesFree, isInitialEventDateOnlySource, isEventDateOnlySourceText, isBoundRetainedSeriesNotesFree, isBareNumericClockAnswer, isBoundReminderClockAnswer } from "./semantic-completeness";

/** Sufficient whole initial reminder source only; no operands or proposal output. */
export function isInitialExplicitReminderIntentKnown(input:ContextInput):boolean {
  if(!isInitialIsolatedExamNotesFree(input))return false;
  const text=input.turns[0].text,subject=/đi thi/iu.exec(text);
  if(!subject)return false;
  // An admitted header or lowercase scheduling clause is a reminder verb;
  // a capitalized/hyphenated venue name such as Nhắc is not that clause.
  return /^\s*nhắc(?:\s+(?:tôi|mình|tui))?\s+đi thi(?=$|[\s,;.!])/iu.test(text)
    || /(?:^|[\s,;])nhắc(?:\s|$)/u.test(text.slice(subject.index+subject[0].length));
}
export { isBoundReminderClockAnswer } from "./semantic-completeness";

/** Whole initial supported finite notification source proves no relation or
 * independent offset. Negative producer bound only; no operand is returned. */
export function isInitialFiniteSeriesWithoutRelationSource(input:ContextInput):boolean {
  if(typeof input.reference?.instant!=="string"||!Number.isFinite(Date.parse(input.reference.instant))
    ||!Array.isArray(input.capabilities?.calendars)||!input.capabilities.calendars.includes("GREGORIAN")
    ||!isInitialExplicitReminderIntentKnown(input)||!isInitialEventDateOnlySource(input)||!isInitialEventDateYearNullRequired(input)
    ||!isInitialSupportedCadenceCount(input))return false;
  const probes=initialCadenceCountProbes(input);
  return !!probes && !(["BEFORE_EVENT","INCLUDING_EVENT","STARTING_ON"] as const)
    .some(value=>supportsEventRelation(value,[probes.source],[probes.turn]));
}

/** The finite whole task grammar uses "trước" for independent distance.
 * Any occurrence, including a venue, conservatively declines silence. The
 * relation verifier is value support, not cue absence; flexible layout also
 * declines. Original source/evidence text is never normalized or rewritten. */
function hasCanonicalWholeSourceLayout(text:string):boolean {
  return !/[^\S ]| {2}/u.test(text);
}
function hasConservativeWholeSourceEligibility(text:string):boolean {
  return hasCanonicalWholeSourceLayout(text)&&!/trước/iu.test(text);
}

/** Complete empty initial source has no independently grounded relation
 * uncertainty candidate or competing fact. Producer language only. */
export function isInitialRelationUncertaintyAbsent(input:ContextInput):boolean {
  return isInitialFiniteSeriesWithoutRelationSource(input)
    &&typeof input.turns[0]?.text==="string"&&hasConservativeWholeSourceEligibility(input.turns[0].text);
}

/** Initial event-owned date cannot ground a producer MISSING notification
 * date marker. Backend readiness can still require that date independently. */
export function isInitialReminderDateMissingExcluded(input:ContextInput):boolean {
  return isInitialRelationUncertaintyAbsent(input)
    &&!deriveGenerationFieldCapability(input).reminderDateProposalAllowed;
}

/** Existing matched-count distance grammar grants relation only, not a new
 * independent offset requirement. Producer exclusion only; no operand output. */
export function isBoundSeriesDistanceOffsetMissingExcluded(input:ContextInput):boolean {
  if(!isBoundRetainedSeriesNotesFree(input)||isBoundReminderClockAnswer(input)
    ||input.currentTurn!==input.turns.length-1||input.turns.length>12
    ||typeof input.reference?.instant!=="string"||!Number.isFinite(Date.parse(input.reference.instant))
    ||input.activeRequest?.lifecycle!=="CLARIFYING"
    ||input.pendingQuestion?.field!=="reminderTime"||input.pendingQuestion.reason!=="MISSING"
    ||!Array.isArray(input.capabilities.calendars)||!input.capabilities.calendars.includes("GREGORIAN"))return false;
  const slots=input.activeRequest.slots,offset=slots.leadOffsetDays;
  if(!offset||offset.state!=="MISSING"||offset.value!==null||offset.fact!==null
    ||input.facts.some(fact=>fact?.field==="leadOffsetDays"))return false;
  for(const field of ["frequency","occurrenceCount","eventDate"] as const){
    const slot=slots[field];if(slot.state!=="RESOLVED"||slot.value===null||typeof slot.fact!=="string")return false;
    const facts=input.facts.filter(fact=>fact?.alias===slot.fact);
    if(facts.length!==1||facts[0].scope!=="REMINDER"||facts[0].field!==field
      ||input.facts.filter(fact=>fact?.scope==="REMINDER"&&fact.field===field).length!==1
      ||JSON.stringify(facts[0].value)!==JSON.stringify(slot.value))return false;
  }
  const date=slots.eventDate.value;
  return !!date&&date.kind==="CIVIL_DATE"&&date.calendar==="GREGORIAN"
    &&!deriveGenerationFieldCapability(input).allowedNumericFields.includes("leadOffsetDays")
    // Negative-only probe of the retained first USER source. This view is
    // never serialized or used as a request, operand, evidence or authority.
    &&!deriveGenerationFieldCapability({...input,currentTurn:0}).allowedNumericFields.includes("leadOffsetDays");
}

/** Exact existing matched-count USER relation support excludes only a
 * contradictory MISSING marker. The support probe returns no operand. */
export function isBoundSeriesDistanceRelationMissingExcluded(input:ContextInput):boolean {
  if(!isBoundSeriesDistanceOffsetMissingExcluded(input))return false;
  const text=input.turns[input.currentTurn].text,length=[...text].length;
  const turn={id:"bound-relation-probe",role:"USER" as const,semanticView:text};
  const source:SourceEvidence={kind:"USER_QUOTE",sourceTurnId:turn.id,sourceMapTurnId:turn.id,quote:text,occurrence:1,sourceSpan:{start:0,end:length},viewSpan:{start:0,end:length},normalizationVersion:"nfc-codepoint-v1"};
  return supportsEventRelation("BEFORE_EVENT",[source],[turn],true);
}

/** Certified source/fact ownership only for the no-slot branch. Neither
 * matching retained relations nor other pending fields gain this bound. */
export function isBoundRelationUncertaintyAbsent(input:ContextInput):boolean {
  if(!isBoundSeriesDistanceRelationMissingExcluded(input))return false;
  const first=input.turns[0],current=input.turns[input.currentTurn],active=input.activeRequest;
  if(!active||first?.role!=="USER"||typeof first.text!=="string"||current?.role!=="USER"||typeof current.text!=="string"
    ||!hasConservativeWholeSourceEligibility(first.text)||!hasCanonicalWholeSourceLayout(current.text)
    ||hasEventRelationSourceCue(first.text)||!isEventDateOnlySourceText(first.text,input.reference.instant))return false;
  for(const field of ["eventRelation","reminderDate","endDate","reminderTime","eventTime","calendar"] as const){
    const slot=active.slots[field];
    if(!slot||slot.state!=="MISSING"||slot.value!==null||slot.fact!==null||input.facts.some(fact=>fact.field===field))return false;
  }
  if(Object.values(active.slots).some(slot=>slot.state==="CONFLICT"))return false;
  const factual=(field:"frequency"|"occurrenceCount"|"eventDate")=>{
    const slot=active.slots[field],facts=input.facts.filter(fact=>fact.field===field);
    return slot.state==="RESOLVED"&&slot.value!==null&&typeof slot.fact==="string"&&facts.length===1
      &&facts[0].scope==="REMINDER"&&facts[0].alias===slot.fact&&JSON.stringify(facts[0].value)===JSON.stringify(slot.value)
      &&facts[0].provenance?.kind==="EXPLICIT_USER"&&facts[0].dependencies?.length===0&&Number.isFinite(Date.parse(facts[0].sourceReferenceTime));
  };
  if(!(["frequency","occurrenceCount","eventDate"] as const).every(factual))return false;
  const frequency=input.facts.find(fact=>fact.field==="frequency")!,count=input.facts.find(fact=>fact.field==="occurrenceCount")!,date=input.facts.find(fact=>fact.field==="eventDate")!;
  if([frequency,count,date].some(fact=>fact.sourceReferenceTime!==date.sourceReferenceTime)||Date.parse(date.sourceReferenceTime)>Date.parse(input.reference.instant))return false;
  const probes=cadenceCountSourceProbes(first.text);
  if(frequency.value!=="DAILY"||probes.frequencies.length!==1||probes.frequencies[0]!=="DAILY"||probes.counts.length!==1||probes.counts[0]!==count.value)return false;
  const value=active.slots.eventDate.value;
  if(!value||value.kind!=="CIVIL_DATE"||value.calendar!=="GREGORIAN"||value.year!==null||value.leapMonth!==null)return false;
  const referenceNow=Date.parse(date.sourceReferenceTime),source=extractTemporalEvidence({text:first.text,referenceNow}).date;
  if(source.state!=="RESOLVED"||source.source!=="DAY_MONTH")return false;
  const resolved=resolveDateOperand(value,referenceNow,lunarCalendar);
  return resolved.status==="RESOLVED"&&resolved.date===source.localDate;
}

/** No independent offset candidate source exists in the whole initial finite
 * source or bound factual series. A clock is unrelated to offset eligibility;
 * reasons remain proposals and no values are emitted. */
export function isWholeSeriesOffsetAlternativeAbsent(input:ContextInput):boolean {
  const initial=typeof input.reference?.instant==="string"&&Number.isFinite(Date.parse(input.reference.instant))
    &&Array.isArray(input.capabilities?.calendars)&&input.capabilities.calendars.includes("GREGORIAN")
    &&isInitialExplicitReminderIntentKnown(input)&&isInitialEventDateOnlySource(input)
    &&isInitialEventDateYearNullRequired(input)&&isInitialSupportedCadenceCount(input);
  return initial||isBoundSeriesDistanceOffsetMissingExcluded(input);
}

/** Full uncertainty absence is stronger than supported candidate absence.
 * Private negative source classification only; no operand/value is returned. */
export function isWholeSeriesOffsetUncertaintyAbsent(input:ContextInput):boolean {
  if(!isWholeSeriesOffsetAlternativeAbsent(input))return false;
  const first=input.turns[0];
  return first?.role==="USER"&&typeof first.text==="string"&&hasConservativeWholeSourceEligibility(first.text);
}

/** Source-grounded contradiction exclusion only, never carrier/value presence. */
export function isBoundExactReminderClockMissingExcluded(input: ContextInput): boolean {
  return Number.isFinite(Date.parse(input.reference.instant))
    && input.activeRequest?.lifecycle === "CLARIFYING"
    && input.pendingQuestion?.scope === "REMINDER"
    && input.pendingQuestion.field === "reminderTime"
    && input.pendingQuestion.reason === "MISSING"
    && isBoundReminderClockAnswer(input);
}
/** Exact current clock plus absence of competing retained/source candidates.
 * Existing whole grammar/history proof is mandatory before domain absence. */
export function isBoundSourceUniqueReminderClock(input: ContextInput): boolean {
  if(!isBoundExactReminderClockMissingExcluded(input)||!isBoundRetainedSeriesNotesFree(input))return false;
  for(const field of CLOCK_PROPOSAL_FIELDS){
    const slot=input.activeRequest?.slots[field];
    if(!slot||slot.state!=="MISSING"||slot.value!==null||slot.fact!==null||input.facts.some(fact=>fact.field===field))return false;
  }
  const referenceNow=Date.parse(input.reference.instant);
  for(const turn of input.turns.slice(0,input.currentTurn))if(turn.role==="USER"&&extractTemporalEvidence({text:turn.text,referenceNow}).time.state!=="MISSING")return false;
  const domain=deriveGenerationFieldCapability(input).allowedClockFields;
  return domain.length===1&&domain[0]==="reminderTime";
}
/** Complete retained finite-relative dependencies, not a READY prediction. */
export function isBoundCompleteFiniteSeriesClockAnswer(input: ContextInput): boolean {
  if(!isBoundSourceUniqueReminderClock(input))return false;
  const slots=input.activeRequest!.slots;
  const factual=(field:keyof typeof slots)=>{
    const slot=slots[field];if(slot.state!=="RESOLVED"||slot.value===null||typeof slot.fact!=="string")return false;
    const facts=input.facts.filter(fact=>fact.alias===slot.fact);
    return facts.length===1&&facts[0].scope==="REMINDER"&&facts[0].field===field
      &&input.facts.filter(fact=>fact.scope==="REMINDER"&&fact.field===field).length===1
      &&JSON.stringify(facts[0].value)===JSON.stringify(slot.value);
  };
  if(!(["title","eventDate","frequency","occurrenceCount","eventRelation"] as const).every(factual))return false;
  const date=slots.eventDate.value;
  if(!date||date.kind!=="CIVIL_DATE"||date.calendar!=="GREGORIAN"||slots.eventRelation.value!=="BEFORE_EVENT")return false;
  for(const field of ["leadOffsetDays","reminderDate","endDate"] as const){const slot=slots[field];if(slot.state!=="MISSING"||slot.value!==null||slot.fact!==null||input.facts.some(fact=>fact.field===field))return false;}
  if(Object.values(slots).some(slot=>slot.state==="CONFLICT"))return false;
  const calendar=slots.calendar;
  return calendar.state==="MISSING"?calendar.value===null&&calendar.fact===null&&!input.facts.some(fact=>fact.field==="calendar")
    :calendar.value==="GREGORIAN"&&factual("calendar");
}

/** Whole scheduling-only source proof precedes candidate-domain absence.
 * Projected slots expose state/value/fact, not retained evidence arrays. */
export function isBoundMissingReminderClockWithoutCandidates(input: ContextInput): boolean {
  if (!isBoundRetainedSeriesNotesFree(input) || isBoundReminderClockAnswer(input)) return false;
  const question = input.pendingQuestion;
  if (question?.scope !== "REMINDER" || question.field !== "reminderTime" || question.reason !== "MISSING") return false;
  for (const field of ["eventTime", "reminderTime"] as const) {
    const slot = input.activeRequest?.slots[field];
    if (!slot || slot.state !== "MISSING" || slot.value !== null || slot.fact !== null) return false;
    if (input.facts.some(fact => fact.field === field)) return false;
  }
  return deriveGenerationFieldCapability(input).allowedClockFields.length === 0;
}

export const NUMERIC_PROPOSAL_FIELDS = ["frequency", "occurrenceCount", "leadOffsetDays"] as const;
export type NumericProposalField = typeof NUMERIC_PROPOSAL_FIELDS[number];
export const CLOCK_PROPOSAL_FIELDS = ["eventTime", "reminderTime"] as const;
export type ClockProposalField = typeof CLOCK_PROPOSAL_FIELDS[number];
export interface GenerationFieldCapability {
  version: "generation-field-capability-16";
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
  return isInitialIsolatedExamNotesFree(input)?cadenceCountSourceProbes(input.turns[0].text):null;
}
/** Existing private source probes; no operand or evidence leaves this module. */
function cadenceCountSourceProbes(text:string) {
  const length=[...text].length;
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
/** Certified continuation plus an independently bound initial title proves
 * only that MISSING operation is unavailable in the producer subset. It does
 * not choose CURRENT/NEW, produce an operand or repair received uncertainty. */
export function isBoundOperationMissingExcluded(input:ContextInput):boolean {
  if(!isBoundRelationUncertaintyAbsent(input))return false;
  const title=input.activeRequest!.slots.title;
  if(title.state!=="RESOLVED"||typeof title.value!=="string"||typeof title.fact!=="string")return false;
  const facts=input.facts.filter(fact=>fact.scope==="REMINDER"&&fact.field==="title"),dates=input.facts.filter(fact=>fact.scope==="REMINDER"&&fact.field==="eventDate");
  return facts.length===1&&dates.length===1&&facts[0].alias===title.fact
    &&input.facts.filter(fact=>fact.alias===title.fact).length===1&&facts[0].value===title.value
    &&facts[0].provenance?.kind==="EXPLICIT_USER"&&facts[0].dependencies?.length===0
    &&facts[0].sourceReferenceTime===dates[0].sourceReferenceTime;
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
  return { version: "generation-field-capability-16", reminderDateProposalAllowed:!isInitialEventDateOnlySource(input), eventDateYearNullRequired:isInitialEventDateYearNullRequired(input), notesProposalAllowed: !(isInitialIsolatedExamNotesFree(input)||isBoundRetainedSeriesNotesFree(input)), titlePresenceRequired: current?.role==="USER" && examTitleCoverage(current.text)!==null && (!input.activeRequest || !isFirstPersonExamClockAssertion(current.text)),
    titleCorrectionAllowed: !!title && ["PROPOSED", "RESOLVED", "CONFLICT"].includes(title.state) && title.value !== null,
    calendarProposalAllowed: !!calendar && ["PROPOSED", "RESOLVED", "CONFLICT"].includes(calendar.state) && calendar.value !== null
      || current?.role === "USER" && hasExplicitCalendarCue(current.text),
    allowedNumericFields: NUMERIC_PROPOSAL_FIELDS.filter(field => allowed.has(field)), allowedClockFields: CLOCK_PROPOSAL_FIELDS.filter(field => clocks.has(field)) };
}
