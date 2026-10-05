/** Closed structural descriptors. No user/model values or issue prose enter
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
export function canonicalConstraint(constraintId: CanonicalConstraintId, message: string) {
  return {message, params:{constraintId}};
}
export function projectCanonicalConstraint(params: unknown) {
  if(!params || typeof params!=="object" || !Object.hasOwn(params,"constraintId")) return {};
  const id=(params as {constraintId:unknown}).constraintId;
  if(typeof id!=="string" || !Object.hasOwn(canonicalConstraints,id)) return {};
  const descriptor=canonicalConstraints[id as CanonicalConstraintId];
  return {constraintId:id as CanonicalConstraintId,participatingFields:[...descriptor.participatingFields],expectedCategory:descriptor.expectedCategory,actualCategory:descriptor.actualCategory};
}
