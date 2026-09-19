import type { PreparedSemanticAttempt, SemanticAttemptResult, SemanticGateway, SemanticInput, SemanticTier } from "../modules/intelligence/semantic-gateway";
import type { SemanticInterpretation } from "../modules/semantic/contracts";

export type LegacyApplicationOutcome = Exclude<SemanticAttemptResult, { status: "SUCCESS" }>
  | { status: "SUCCESS"; usage: Extract<SemanticAttemptResult, { status: "SUCCESS" }>["usage"]; interpretation: SemanticInterpretation };
export interface LegacyApplicationOutcomeGateway {
  prepare(tier: SemanticTier, input: SemanticInput): Exclude<PreparedSemanticAttempt, { status: "READY" }>
    | (Omit<Extract<PreparedSemanticAttempt, { status: "READY" }>, "dispatch"> & { dispatch(): Promise<LegacyApplicationOutcome> });
}

/**
 * Test-only injection of backend outcomes to preserve downstream lifecycle tests
 * until hybrid reconciliation is composed. It is NOT a provider adapter and
 * proves nothing about model authority. Real gateway tests reject these payloads.
 * The existing backend validator still validates every injected outcome.
 */
export function legacyApplicationOutcomeGatewayForTests(getGateway: () => LegacyApplicationOutcomeGateway): SemanticGateway {
  return { prepare(tier, input) {
    return getGateway().prepare(tier, input) as PreparedSemanticAttempt;
  } };
}
