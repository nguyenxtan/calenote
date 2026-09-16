export interface SemanticBudgetLimits {
  ownerDailyFallbackLimit: number;
  ownerMonthlyCostMicrounits: number;
  globalDailyCostMicrounits: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  promptPriceMicrounitsPerMillionTokens: number;
  completionPriceMicrounitsPerMillionTokens: number;
  reservationTtlMs: number;
}

export interface ReservePaidCallInput {
  ownerId: string;
  sourceInboundId: string;
  now: number;
}

export type PaidCallReservation = {
  status: "RESERVED";
  reservationId: string;
  reservedMaximumMicrounits: number;
} | { status: "BUDGET_EXHAUSTED" };

export interface FinalizeUsageInput {
  ownerId: string;
  reservationId: string;
  /** null, invalid or above-ceiling usage conservatively charges the ceiling. */
  actualCostMicrounits: number | null;
  now: number;
}

export interface ReleaseReservationInput {
  ownerId: string;
  reservationId: string;
  /** SAFE_FAILURE requires evidence that no billable request occurred. */
  reason: "SAFE_FAILURE" | "EXPIRED";
  now: number;
}

export interface SemanticBudgetStore {
  /** Only a fresh RESERVED result permits one paid request. Replays never authorize. */
  reservePaidCall(input: ReservePaidCallInput): Promise<PaidCallReservation>;
  finalizeUsage(input: FinalizeUsageInput): Promise<boolean>;
  releaseOrExpireReservation(input: ReleaseReservationInput): Promise<boolean>;
  reapExpiredReservations(now: number, limit?: number): Promise<number>;
}
