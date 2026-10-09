import type { ConversationInterpretationV3, EvidenceRef, FieldOperationV3 } from "./contracts";
import type { ContextProtocolV3 } from "./protocol";

export type OutputAuthorityClass = "SEMANTIC_UNTRUSTED" | "ADVISORY" | "APPLICATION_OWNED";
export type OutputAuthorityRule = Readonly<{
  class: OutputAuthorityClass; modelAuthorshipReason: string; evidencePolicy: string; mergePolicy: string;
  canAffectMerge: boolean; canCauseHardReject: boolean; canCauseClarify: boolean;
  canAuthorizeRead: false; canAuthorizeWrite: false; applicationDerivable: boolean;
}>;
type BranchPath<T, P extends string> = T extends { kind: infer K extends string } ? `${P}{kind=${K}}`
  : T extends { field: infer F extends string; operation: infer O extends string } ? `${P}{field=${F};operation=${O}}`
  : T extends { field: infer F extends string } ? `${P}{field=${F}}` : never;
type Paths<T, P extends string = ""> = T extends readonly (infer E)[] ? `${P}[]` | Paths<E, `${P}[]`>
  : T extends object ? BranchPath<T, P> | { [K in keyof T & string]: `${P}${P extends "" ? "" : "."}${K}` | Paths<T[K], `${P}${P extends "" ? "" : "."}${K}`> }[keyof T & string] : never;
type ReminderCarrierRoot = `${"reminderDate" | "reminderTime" | "eventDate" | "eventTime" | "eventRelation"}Change`;
type ReminderCarrierPath = ReminderCarrierRoot | `${ReminderCarrierRoot}.${"index" | "change"}` | `${ReminderCarrierRoot}.change.${"field" | "operation" | "value" | "evidence"}` | `${ReminderCarrierRoot}.change{field=${"reminderDate" | "reminderTime" | "eventDate" | "eventTime" | "eventRelation"};operation=${"SET" | "REPLACE" | "CLEAR"}}` | `${"reminderTime"|"eventTime"}Change.change.value.${"hour" | "minute" | "qualifier"}`;
type SemanticEvidenceSlotPath = `${"query" | "requestTarget" | "changes[]" | "titleChange.change" | `${ReminderCarrierRoot}.change`}.evidence.${"primaryEvidence" | "additionalEvidenceJson"}`;
type CompactDateBranchPath = `${"changes[].value" | "query.date" | "query.period.date" | "query.period.from" | "query.period.through"}{kind=${"C" | "R" | "W"}}`;
export type OutputFieldPathV3 = Paths<ConversationInterpretationV3> | Paths<ContextProtocolV3, "protocol">
  | SemanticEvidenceSlotPath | Paths<EvidenceRef, SemanticEvidenceSlotPath> | CompactDateBranchPath | ReminderCarrierPath
  | "operationCode" | "uncertainties[].fieldCode" | "transport.inactivePadding" | "transport.codebookMapping"
  | "titleChange" | "titleChange.index" | "titleChange.change" | "titleChange.change.field" | "titleChange.change.operation" | "titleChange.change.value" | "titleChange.change.evidence" | "titleChange.change{field=title;operation=SET}";
const semantic: OutputAuthorityRule = Object.freeze({ class: "SEMANTIC_UNTRUSTED", modelAuthorshipReason: "Proposed user meaning, operand, instruction, ambiguity or supporting source selection.", evidencePolicy: "Validate exact scoped source identity; targeting/replacement/removal require current USER_QUOTE evidence.", mergePolicy: "Only validated semantic candidates enter merge; backend derives conflicts, completeness and admission.", canAffectMerge: true, canCauseHardReject: true, canCauseClarify: true, canAuthorizeRead: false, canAuthorizeWrite: false, applicationDerivable: false });
const advisory: OutputAuthorityRule = Object.freeze({ class: "ADVISORY", modelAuthorshipReason: "Optional phrasing associated with one of four compatible backend issues.", evidencePolicy: "No mandatory semantic evidence; validate eligibility independently.", mergePolicy: "Quarantine invalid hints; never affect factual merge or manufacture clarification.", canAffectMerge: false, canCauseHardReject: false, canCauseClarify: false, canAuthorizeRead: false, canAuthorizeWrite: false, applicationDerivable: false });
const owned: OutputAuthorityRule = Object.freeze({ class: "APPLICATION_OWNED", modelAuthorshipReason: "Application selects immutable protocol, fixed supported status and codebook mapping; omit from generation.", evidencePolicy: "Trusted application binding, never a model assertion.", mergePolicy: "Reject unsupported application binding; independently bound constants do not grant execution.", canAffectMerge: false, canCauseHardReject: true, canCauseClarify: false, canAuthorizeRead: false, canAuthorizeWrite: false, applicationDerivable: true });
const padding: OutputAuthorityRule = Object.freeze({ ...owned, modelAuthorshipReason: "Known inactive keys are required only for transport shape and are discarded by the selected branch.", mergePolicy: "Ignore known inactive values; reject unknown keys, missing shape or ambiguous active branch.", canCauseHardReject: false });

// Closed, exact paths: adding a schema property never silently inherits a
// category prefix. Schema inspection checks every branch against this registry.
const entries: Array<[OutputFieldPathV3, OutputAuthorityRule]> = [];
function add(paths: readonly OutputFieldPathV3[], rule: OutputAuthorityRule = semantic) { for (const path of paths) entries.push([path, rule]); }
add(["titleChange","titleChange.index","titleChange.change","titleChange.change.field","titleChange.change.operation","titleChange.change.value","titleChange.change.evidence","titleChange.change{field=title;operation=SET}"]);
for(const field of ["reminderDate","reminderTime","eventDate","eventTime","eventRelation"] as const){
  const root=`${field}Change` as const;
  add([root,`${root}.index`,`${root}.change`,`${root}.change.field`,`${root}.change.operation`,`${root}.change.value`,`${root}.change.evidence`]);
  for(const operation of ["SET","REPLACE","CLEAR"] as const)add([`${root}.change{field=${field};operation=${operation}}`]);
}
add(["reminderTimeChange.change.value.hour","reminderTimeChange.change.value.minute","reminderTimeChange.change.value.qualifier"]);
add(["eventTimeChange.change.value.hour","eventTimeChange.change.value.minute","eventTimeChange.change.value.qualifier"]);
add(["operationCode", "intent", "requestTarget", "requestTarget.kind", "changes", "changes[]", "changes[].field", "changes[].operation", "changes[].value", "query", "query.kind", "query.outputCalendar", "query.topic", "uncertainties", "uncertainties[]", "uncertainties[].field", "uncertainties[].fieldCode", "uncertainties[].reason", "uncertainties[].alternatives", "uncertainties[].alternatives[]", "uncertainties[].alternatives[].value"]);
const dateKeys = ["kind", "calendar", "day", "month", "year", "leapMonth", "offsetDays", "weekday", "qualifier"] as const;
function date(prefix: string) { add(dateKeys.map(key => `${prefix}.${key}` as OutputFieldPathV3)); }
function refs(prefix: string) { add([prefix, `${prefix}[]`, ...["kind", "turn", "quote", "occurrence", "ref"].map(key => `${prefix}[].${key}`), ...["USER_QUOTE", "CONTEXT_FACT"].map(kind => `${prefix}[]{kind=${kind}}`)] as OutputFieldPathV3[]); }
for (const prefix of ["requestTarget.evidence", "changes[].evidence", "query.evidence", "uncertainties[].alternatives[].evidence"]) refs(prefix);
// Provider slots propose the same untrusted refs as canonical evidence arrays.
// Register exact paths; new slots or fields cannot inherit authority silently.
for (const collection of ["query", "requestTarget", "changes[]", "titleChange.change", "reminderDateChange.change", "reminderTimeChange.change", "eventDateChange.change", "eventTimeChange.change", "eventRelationChange.change"] as const) for (const slot of ["primaryEvidence", "additionalEvidenceJson"] as const) {
  const prefix = `${collection}.evidence.${slot}` as const;
  add([prefix, ...["kind", "turn", "quote", "occurrence", "ref"].map(key => `${prefix}.${key}` as OutputFieldPathV3),
    `${prefix}{kind=USER_QUOTE}`, `${prefix}{kind=CONTEXT_FACT}`]);
}
for (const prefix of ["changes[].value", "query.date", "query.period.date", "query.period.from", "query.period.through", "uncertainties[].alternatives[].value", "uncertainties[].alternatives[].value.date", "uncertainties[].alternatives[].value.from", "uncertainties[].alternatives[].value.through"]) date(prefix);
add(["changes[].value.hour", "changes[].value.minute", "uncertainties[].alternatives[].value.hour", "uncertainties[].alternatives[].value.minute", "query.date", "query.period", "query.period.kind", "query.period.offset", "query.period.date", "query.period.from", "query.period.through", "uncertainties[].alternatives[].value.offset", "uncertainties[].alternatives[].value.date", "uncertainties[].alternatives[].value.from", "uncertainties[].alternatives[].value.through"]);
add(["conversationDirective", "conversationDirective.kind", "conversationDirective.field", "conversationDirective.reason", "conversationDirective.issue", "conversationDirective.topic", "replyProposal", "replyProposal.text"], advisory);
add(["schemaVersion", "query.statusScope", "protocol.canonicalVersion", "protocol.promptVersion", "protocol.inputVersion", "protocol.stateVersion", "protocol.wireVersion", "protocol.codebookVersion", "protocol.storageFenceFamily", "transport.codebookMapping"], owned);
add(["transport.inactivePadding"], padding);
const fields = ["title", "location", "notes", "eventDate", "eventTime", "reminderDate", "reminderTime", "calendar", "frequency", "occurrenceCount", "eventRelation", "leadOffsetDays", "endDate"] as const;
for (const field of fields) for (const operation of ["SET", "REPLACE", "CLEAR"] as const satisfies readonly FieldOperationV3[]) add([`changes[]{field=${field};operation=${operation}}`]);
for (const field of [...fields, "intent", "queryRange", "operation"] as const) add([`uncertainties[]{field=${field}}`]);
for (const kind of ["CURRENT", "NEW", "UNRESOLVED"] as const) add([`requestTarget{kind=${kind}}`]);
for (const kind of ["LIST", "CALENDAR_DATE", "CAPABILITY"] as const) add([`query{kind=${kind}}`]);
for (const prefix of ["changes[].value", "query.date", "query.period.date", "query.period.from", "query.period.through", "uncertainties[].alternatives[].value", "uncertainties[].alternatives[].value.date", "uncertainties[].alternatives[].value.from", "uncertainties[].alternatives[].value.through"]) {
  for (const kind of ["CIVIL_DATE", "RELATIVE_DAY", "WEEKDAY"]) add([`${prefix}{kind=${kind}}` as OutputFieldPathV3]);
}
// Compact transport selections have the same untrusted authority as canonical
// date kinds. The fixed mapping itself remains application-owned.
for(const prefix of ["changes[].value","query.date","query.period.date","query.period.from","query.period.through"] as const)for(const kind of ["C","R","W"] as const)add([`${prefix}{kind=${kind}}`]);
for (const prefix of ["query.period", "uncertainties[].alternatives[].value"]) for (const kind of ["DAY", "WEEK", "MONTH", "WEEKEND", "REST_OF_MONTH", "NEXT_7_DAYS", "UPCOMING", "DATE_BOUNDS"]) add([`${prefix}{kind=${kind}}` as OutputFieldPathV3]);
for (const kind of ["ASK_FOR_FIELD", "ASK_FOR_DISAMBIGUATION", "EXPLAIN_UNSUPPORTED", "HELP"] as const) add([`conversationDirective{kind=${kind}}`], advisory);
const registry: Partial<Record<OutputFieldPathV3, OutputAuthorityRule>> = {};
for (const [path, rule] of entries) {
  if (Object.hasOwn(registry, path)) throw new Error(`OUTPUT_AUTHORITY_OVERLAP:${path}`);
  registry[path] = rule;
}
export const OUTPUT_AUTHORITY_REGISTRY_V3 = Object.freeze(registry) as Readonly<Record<OutputFieldPathV3, OutputAuthorityRule>>;
export function classifyOutputPathV3(path: OutputFieldPathV3): OutputAuthorityRule {
  if (!Object.hasOwn(OUTPUT_AUTHORITY_REGISTRY_V3, path)) throw new Error("OUTPUT_AUTHORITY_UNCLASSIFIED");
  return OUTPUT_AUTHORITY_REGISTRY_V3[path];
}
