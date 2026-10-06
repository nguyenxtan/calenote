import type { SemanticPatchProposalV3, UncertaintyV3, QueryOperand } from "./contracts";

/** Closed structural descriptors. No arbitrary user/model values or issue prose enter
 * diagnostics. IDs are attached by the actual rejecting predicate, never
 * inferred by a second implementation of that predicate. */
const rule = (participatingFields: string[], expectedCategory: string, actualCategory: string) => ({participatingFields, expectedCategory, actualCategory});
export const canonicalConstraints = {
  DUPLICATE_CHANGE_FIELD: rule(["changes"], "UNIQUE_FIELDS", "DUPLICATE_FIELDS"),
  QUERY_INTENT_OWNERSHIP: rule(["intent","query","changes"], "MATCHING_QUERY_BRANCH_WITHOUT_CHANGES", "OWNERSHIP_MISMATCH"),
  NON_MUTATING_CHANGES: rule(["intent","changes"], "NO_EXECUTABLE_CHANGES", "CHANGES_PRESENT"),
  LEGACY_NON_MUTATING_CHANGES: rule(["intent","changes","dialogueAct"], "NO_EXECUTABLE_CHANGES", "CHANGES_PRESENT"),
  REQUEST_TARGET_INTENT_OWNERSHIP: rule(["intent","requestTarget","uncertainties"], "TARGET_MATCHES_INTENT", "OWNERSHIP_MISMATCH"),
  REQUEST_TARGET_USER_EVIDENCE: rule(["requestTarget","evidence"], "USER_QUOTE_ONLY", "NON_USER_REFERENCE"),
  MUTATING_OPERATION_USER_EVIDENCE: rule(["changes","operation","evidence"], "USER_QUOTE_PRESENT", "USER_QUOTE_ABSENT"),
  OPERATION_ALTERNATIVE_USER_EVIDENCE: rule(["uncertainties","evidence"], "USER_QUOTE_PRESENT", "USER_QUOTE_ABSENT"),
  UNRESOLVED_QUERY_TARGETED_UNCERTAINTY: rule(["query","uncertainties"], "TARGETED_UNCERTAINTY_PRESENT", "INCOMPLETE_QUERY_WITHOUT_TARGETED_UNCERTAINTY"),
  COMBINED_ACTIONS_NON_EXECUTABLE: rule(["intent","changes","requestTarget","uncertainties"], "AMBIGUOUS_UNRESOLVED_NON_EXECUTABLE", "COMBINED_ACTION_STATE_MISMATCH"),
  LEGACY_COMBINED_ACTIONS_NON_EXECUTABLE: rule(["intent","changes","uncertainties","controlEvidence"], "AMBIGUOUS_GROUNDED_NON_EXECUTABLE", "COMBINED_ACTION_STATE_MISMATCH"),
  GREGORIAN_LEAP_MONTH: rule(["calendar","leapMonth"], "GREGORIAN_LEAP_MONTH_NULL", "GREGORIAN_LEAP_MONTH_NON_NULL"),
  CLOCK_QUALIFIER_HOUR: rule(["hour","qualifier"], "AM_PM_HOUR_1_TO_12", "AM_PM_HOUR_OUTSIDE_1_TO_12"),
  SLOT_STATE_VALUE_FACT: rule(["value","fact","state"], "SLOT_VALUE_FACT_MATCH_STATE", "SLOT_STATE_MISMATCH"),
  CONTEXT_CURRENT_USER_TURN: rule(["turns","currentTurn"], "LATEST_USER_WITHIN_ROLE_BOUNDS", "CURRENT_TURN_OR_ROLE_BOUNDS_INVALID"),
  CONTEXT_UNIQUE_FACT_ALIAS: rule(["facts"], "UNIQUE_ALIASES", "DUPLICATE_ALIASES"),
  NFC_SCALAR_TEXT: rule(["text"], "NONBLANK_NFC_SCALARS_WITHIN_LIMIT", "TEXT_CONSTRAINT_VIOLATED"),
  CONTEXT_NFC_SCALAR_TEXT: rule(["text"], "NFC_SCALAR_SEMANTIC_VIEW", "TEXT_CONSTRAINT_VIOLATED"),
} as const;
export type CanonicalConstraintId = keyof typeof canonicalConstraints;
export interface OwnershipControlState {
  intent: SemanticPatchProposalV3["intent"];
  requestTargetKind: NonNullable<SemanticPatchProposalV3["requestTarget"]>["kind"] | null;
  queryKind: QueryOperand["kind"] | null;
  changeCount: number;
  uncertaintyCount: number;
  uncertainties: Array<{field: UncertaintyV3["field"]; reason: UncertaintyV3["reason"]; alternativeCount: number}>;
}
// Issue params are otherwise untrusted. Only an actual local rejecting
// predicate can attach a snapshot by identity; copied/forged/serialized params
// never acquire that provenance. Never capture alternatives, evidence or text.
const ownershipStates = new WeakMap<object, OwnershipControlState>();
const ownershipIds = new Set<CanonicalConstraintId>(["REQUEST_TARGET_INTENT_OWNERSHIP", "QUERY_INTENT_OWNERSHIP", "COMBINED_ACTIONS_NON_EXECUTABLE"]);
const intents = new Set(["CREATE_REMINDER", "LIST_REMINDERS", "CALENDAR_QUERY", "CAPABILITY_QUERY", "HELP", "UNSUPPORTED", "AMBIGUOUS"]);
const targets = new Set(["CURRENT", "NEW", "UNRESOLVED"]);
const queryKinds = new Set(["LIST", "CALENDAR_DATE", "CAPABILITY"]);
const fields = new Set(["title", "location", "notes", "eventDate", "eventTime", "reminderDate", "reminderTime", "calendar", "frequency", "occurrenceCount", "eventRelation", "leadOffsetDays", "endDate", "intent", "queryRange", "operation"]);
const reasons = new Set(["MISSING", "AMBIGUOUS", "CONFLICT", "UNSUPPORTED_COMBINATION"]);
const count = (n: number, max: number) => Number.isSafeInteger(n) && n >= 0 && n <= max;
export function canonicalConstraint(constraintId: CanonicalConstraintId, message: string, state?: OwnershipControlState) {
  const params = Object.freeze({constraintId});
  if (state && ownershipIds.has(constraintId) && intents.has(state.intent)
    && (state.requestTargetKind === null || targets.has(state.requestTargetKind))
    && (state.queryKind === null || queryKinds.has(state.queryKind)) && count(state.changeCount, 13)
    && count(state.uncertaintyCount, 4) && state.uncertainties.length === state.uncertaintyCount
    && state.uncertainties.every(u => fields.has(u.field) && reasons.has(u.reason) && count(u.alternativeCount, 2))) {
    // Construct a closed fresh shape, even if a caller has added extra keys.
    ownershipStates.set(params, {intent: state.intent, requestTargetKind: state.requestTargetKind, queryKind: state.queryKind,
      changeCount: state.changeCount, uncertaintyCount: state.uncertaintyCount,
      uncertainties: state.uncertainties.map(u => ({field: u.field, reason: u.reason, alternativeCount: u.alternativeCount}))});
  }
  return {message, params};
}
export function projectCanonicalConstraint(params: unknown) {
  if(!params || typeof params!=="object" || !Object.hasOwn(params,"constraintId")) return {};
  const id=(params as {constraintId:unknown}).constraintId;
  if(typeof id!=="string" || !Object.hasOwn(canonicalConstraints,id)) return {};
  const descriptor=canonicalConstraints[id as CanonicalConstraintId];
  const state = ownershipStates.get(params);
  return {constraintId:id as CanonicalConstraintId,participatingFields:[...descriptor.participatingFields],expectedCategory:descriptor.expectedCategory,actualCategory:descriptor.actualCategory,
    ...(state ? {ownershipState: {...state, uncertainties: state.uncertainties.map(u => ({...u}))}} : {})};
}
