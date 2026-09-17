import { z } from "zod";
import { SemanticInputSchema, semanticReferenceWallClock, type PreparedSemanticAttempt, type SemanticAttemptResult,
  type SemanticFailureCategory, type SemanticGateway, type SemanticTier } from "../intelligence/semantic-gateway";
import type { SemanticBudgetStore } from "./budget-store";
import { validateSemanticPayload, type SemanticValidationResult } from "./validation";

export const SemanticServiceInputSchema = z.object({
  text: SemanticInputSchema.shape.text,
  referenceTime: z.number().int().nonnegative().max(8_639_999_999_000_000),
  timezone: SemanticInputSchema.shape.timezone,
  previousContext: SemanticInputSchema.shape.previousContext,
  ownerId: z.string().min(1).max(200),
  sourceInboundId: z.string().min(1).max(200),
  processingNow: z.number().int().nonnegative().max(8_639_999_999_000_000),
}).strict();
export type SemanticServiceInput = z.infer<typeof SemanticServiceInputSchema>;
export interface SemanticAttemptStore {
  /** Durable one-shot claim for the entire inbound, not an expiring lock. */
  claimInbound(scope: { ownerId: string; sourceInboundId: string }): Promise<boolean>;
}
export type SemanticServiceResult = SemanticValidationResult | {
  kind: "SAFE_HELP";
  code: "AI_DISABLED" | "AI_UNAVAILABLE" | "INVALID_INPUT" | "ALREADY_ATTEMPTED" | "BUDGET_EXHAUSTED";
};
export interface SemanticObservation {
  requestDispatched: boolean;
  tier: SemanticTier;
  model?: string;
  provider?: string;
  latencyMs: number;
  resultCategory: "SUCCESS" | `PRIMARY_${SemanticFailureCategory}` | `FREE_${SemanticFailureCategory}` | `PAID_${SemanticFailureCategory}`;
  schemaValid: boolean | null;
  fallbackUsed: boolean;
  costMicrounits?: number | null;
  promptTokens?: number;
  completionTokens?: number;
}
export interface SemanticServiceDependencies {
  mode: "off" | "semantic" | "privacy";
  paidFallbackEnabled?: boolean;
  gateway: SemanticGateway;
  budgetStore: SemanticBudgetStore;
  attemptStore: SemanticAttemptStore;
  now: () => number;
  observe?: (observation: SemanticObservation) => void;
}
const eligibleFreeFailures = new Set<SemanticFailureCategory>([
  "UNAVAILABLE", "TIMEOUT", "RATE_LIMITED", "PROVIDER_FAILURE", "INVALID_JSON", "SCHEMA_INVALID", "REQUIRED_FEATURE_UNSUPPORTED",
]);
const unavailable = (): SemanticServiceResult => ({ kind: "SAFE_HELP", code: "AI_UNAVAILABLE" });

export function createSemanticService(deps: SemanticServiceDependencies) {
  async function dispatch(attempt: PreparedSemanticAttempt, tier: SemanticTier): Promise<SemanticAttemptResult> {
    const started = deps.now();
    let result: SemanticAttemptResult;
    try { result = attempt.status === "READY" ? await attempt.dispatch() : attempt; } catch {
      result = { status: "FAILURE", category: "PROVIDER_FAILURE" };
    }
    const elapsed = deps.now() - started;
    const observation: SemanticObservation = {
      requestDispatched: attempt.status === "READY", tier,
      ...(attempt.status === "READY" ? { model: attempt.model, provider: attempt.provider } : {}),
      latencyMs: Number.isFinite(elapsed) ? Math.max(0, Math.round(elapsed)) : 0,
      resultCategory: result.status === "SUCCESS" ? "SUCCESS"
        : `${tier === "PRIMARY" ? "PRIMARY" : tier === "FREE_PRIMARY" ? "FREE" : "PAID"}_${result.category}`,
      schemaValid: result.status === "SUCCESS" ? true
        : ["INVALID_JSON", "SCHEMA_INVALID"].includes(result.category) ? false : null,
      fallbackUsed: tier === "CHEAP_PAID_FALLBACK",
      ...(result.usage ? { costMicrounits: result.usage.costMicrounits,
        ...(result.usage.promptTokens === undefined ? {} : { promptTokens: result.usage.promptTokens }),
        ...(result.usage.completionTokens === undefined ? {} : { completionTokens: result.usage.completionTokens }) } : {}),
    };
    try { deps.observe?.(observation); } catch { /* Telemetry never changes the outcome. */ }
    return result;
  }

  return {
    async interpret(rawInput: SemanticServiceInput): Promise<SemanticServiceResult> {
      if (deps.mode === "off") return { kind: "SAFE_HELP", code: "AI_DISABLED" };
      if (deps.mode !== "semantic" && deps.mode !== "privacy") return unavailable();
      const parsed = SemanticServiceInputSchema.safeParse(rawInput);
      if (!parsed.success) return { kind: "SAFE_HELP", code: "INVALID_INPUT" };
      const { ownerId, sourceInboundId, processingNow, referenceTime, ...rawSemanticInput } = parsed.data;
      let input;
      try { input = { ...rawSemanticInput, ...semanticReferenceWallClock(referenceTime) }; } catch { return { kind: "SAFE_HELP", code: "INVALID_INPUT" }; }
      try {
        if (!await deps.attemptStore.claimInbound({ ownerId, sourceInboundId })) {
          return { kind: "SAFE_HELP", code: "ALREADY_ATTEMPTED" };
        }
      } catch { return { kind: "SAFE_HELP", code: "ALREADY_ATTEMPTED" }; }

      if (deps.mode === "privacy") {
        let primary: PreparedSemanticAttempt;
        try { primary = deps.gateway.prepare("PRIMARY", input); } catch { return unavailable(); }
        if (primary.status !== "READY") return unavailable();
        let reservation;
        try { reservation = await deps.budgetStore.reservePaidCall({ ownerId, sourceInboundId, now: deps.now() }); } catch {
          return { kind: "SAFE_HELP", code: "BUDGET_EXHAUSTED" };
        }
        if (reservation.status !== "RESERVED") return { kind: "SAFE_HELP", code: "BUDGET_EXHAUSTED" };
        const scope = { ownerId, reservationId: reservation.reservationId };
        if (!Number.isSafeInteger(reservation.reservedMaximumMicrounits)
          || reservation.reservedMaximumMicrounits < primary.maximumCostMicrounits) {
          try { await deps.budgetStore.releaseOrExpireReservation({ ...scope, reason: "SAFE_FAILURE", now: deps.now() }); } catch { /* expiry reclaims it */ }
          return unavailable();
        }
        try { if (!await deps.budgetStore.markDispatched({ ...scope, now: deps.now() })) return unavailable(); } catch { return unavailable(); }
        const result = await dispatch(primary, "PRIMARY");
        try { await deps.budgetStore.finalizeUsage({ ...scope, actualCostMicrounits: result.usage?.costMicrounits ?? null, now: deps.now() }); } catch { /* expiry preserves the ceiling */ }
        return result.status === "SUCCESS" ? validateSemanticPayload(result.interpretation, Math.max(processingNow, deps.now())) : unavailable();
      }

      let free: PreparedSemanticAttempt;
      try { free = deps.gateway.prepare("FREE_PRIMARY", input); } catch { return unavailable(); }
      const first = await dispatch(free, "FREE_PRIMARY");
      if (first.status === "SUCCESS") return validateSemanticPayload(first.interpretation, Math.max(processingNow, deps.now()));
      if (first.category === "INVALID_INPUT") return { kind: "SAFE_HELP", code: "INVALID_INPUT" };
      if (!eligibleFreeFailures.has(first.category) || deps.paidFallbackEnabled !== true) return unavailable();

      let paid: PreparedSemanticAttempt;
      try { paid = deps.gateway.prepare("CHEAP_PAID_FALLBACK", input); } catch { return unavailable(); }
      if (paid.status !== "READY") return unavailable();
      let reservation;
      try { reservation = await deps.budgetStore.reservePaidCall({ ownerId, sourceInboundId, now: deps.now() }); } catch {
        return { kind: "SAFE_HELP", code: "BUDGET_EXHAUSTED" };
      }
      if (reservation.status !== "RESERVED") return { kind: "SAFE_HELP", code: "BUDGET_EXHAUSTED" };
      const scope = { ownerId, reservationId: reservation.reservationId };
      if (!Number.isSafeInteger(reservation.reservedMaximumMicrounits)
        || reservation.reservedMaximumMicrounits < paid.maximumCostMicrounits) {
        // No dispatch fence was requested, so releasing this mismatch is safe.
        try { await deps.budgetStore.releaseOrExpireReservation({ ...scope, reason: "SAFE_FAILURE", now: deps.now() }); } catch { /* Expiry reclaims an undispatched reservation. */ }
        return unavailable();
      }
      try {
        if (!await deps.budgetStore.markDispatched({ ...scope, now: deps.now() })) return unavailable();
      } catch { return unavailable(); }
      // A fence may have committed even when its acknowledgement was lost. Only
      // a positive acknowledgement dispatches; all uncertainty is left to expiry.
      const second = await dispatch(paid, "CHEAP_PAID_FALLBACK");
      try {
        await deps.budgetStore.finalizeUsage({ ...scope, actualCostMicrounits: second.usage?.costMicrounits ?? null, now: deps.now() });
      } catch { /* Dispatched expiry conservatively finalizes maximum if settlement failed. */ }
      return second.status === "SUCCESS" ? validateSemanticPayload(second.interpretation, Math.max(processingNow, deps.now())) : unavailable();
    },
  };
}
