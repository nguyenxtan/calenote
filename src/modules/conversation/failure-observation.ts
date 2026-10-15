/** Content-free metadata only; this projection never controls business state. */
export const CONVERSATION_FAILURE_STAGES = [
  "PRECONDITION", "ATTEMPT_CLAIM", "CONTEXT_LOAD", "PENDING_LOAD", "CONFIRM", "CANCEL",
  "GATEWAY_PREPARE", "BUDGET_RESERVE", "BUDGET_FUNDING", "DISPATCH_FENCE", "MODEL_RESULT",
  "MODEL_SCHEMA", "RECONCILE", "READ_ONLY_QUERY", "CONTEXT_SAVE", "SERIES_PROPOSE",
  "DRAFT_ENCRYPT", "DRAFT_PERSIST", "UNKNOWN_STAGE",
] as const;
export const CONVERSATION_FAILURE_CATEGORIES = [
  "UNAVAILABLE", "TIMEOUT", "RATE_LIMITED", "PROVIDER_FAILURE", "INVALID_JSON", "SCHEMA_INVALID",
  "REQUIRED_FEATURE_UNSUPPORTED", "INVALID_INPUT", "BUDGET_EXHAUSTED", "RESERVATION_UNDERFUNDED",
  "DISPATCH_FENCE_DENIED", "ATTEMPT_CLAIM_DENIED", "UNSUPPORTED_TIMEZONE", "INVALID_LIFECYCLE",
  "INVALID_RANGE", "PROPOSAL_DENIED", "LOCAL_FAILURE", "UNKNOWN_CATEGORY",
] as const;
export type ConversationFailureStage = typeof CONVERSATION_FAILURE_STAGES[number];
export type ConversationFailureCategory = typeof CONVERSATION_FAILURE_CATEGORIES[number];
export interface ConversationFailureDetails { stage: ConversationFailureStage; category: ConversationFailureCategory }
export interface ConversationFailureObservation extends ConversationFailureDetails { readonly sourceInboundId: string }
export type ConversationFailureObserver = (event: Readonly<ConversationFailureObservation>) => void | Promise<void>;

export function failureDetails(stage: unknown, category: unknown): ConversationFailureDetails {
  return {
    stage: CONVERSATION_FAILURE_STAGES.find(value => value === stage) ?? "UNKNOWN_STAGE",
    category: CONVERSATION_FAILURE_CATEGORIES.find(value => value === category) ?? "UNKNOWN_CATEGORY",
  };
}

/** Called only after the existing bound-inbound completion fence succeeds.
 * Completion already enforces one terminalization per inbound. No new storage,
 * retention, retry or paid authority is introduced for observation.
 */
export function observeConversationFailure(observer: ConversationFailureObserver | undefined,
  sourceInboundId: string, details: ConversationFailureDetails): void {
  try {
    if (!observer || !/^[A-Za-z0-9_-]{1,128}$/u.test(sourceInboundId)) return;
    const safe = Object.freeze({ sourceInboundId, ...failureDetails(details.stage, details.category) });
    void Promise.resolve(observer(safe)).catch(() => {});
  } catch { /* Diagnostics cannot affect replies or state. */ }
}
