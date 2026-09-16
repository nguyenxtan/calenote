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

export interface MarkPaidCallDispatchedInput {
  ownerId: string;
  reservationId: string;
  now: number;
}

export interface ReleaseReservationInput {
  ownerId: string;
  reservationId: string;
  /** Only undispatched reservations can be refunded, including SAFE_FAILURE. */
  reason: "SAFE_FAILURE" | "EXPIRED";
  now: number;
}

export interface SemanticBudgetStore {
  /** Acquires capacity. A successful markDispatched is also required before a paid request. */
  reservePaidCall(input: ReservePaidCallInput): Promise<PaidCallReservation>;
  /** One-shot durable dispatch fence. A replay/false/error must never send a paid request. */
  markDispatched(input: MarkPaidCallDispatchedInput): Promise<boolean>;
  finalizeUsage(input: FinalizeUsageInput): Promise<boolean>;
  releaseOrExpireReservation(input: ReleaseReservationInput): Promise<boolean>;
  reapExpiredReservations(now: number, limit?: number): Promise<number>;
}
