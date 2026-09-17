import { z } from "zod";
import { SEMANTIC_TIMEZONE, type SemanticInterpretation } from "../semantic/contracts";
import { SemanticContextSlotsSchema } from "../semantic/context-store";

export const SemanticInputSchema = z.object({
  text: z.string().min(1).max(1_800),
  interpretationReferenceTime: z.number().int().nonnegative().max(8_639_999_999_000_000),
  timezone: z.literal(SEMANTIC_TIMEZONE),
  previousContext: SemanticContextSlotsSchema.optional(),
}).strict();
export type SemanticInput = z.infer<typeof SemanticInputSchema>;
export type SemanticTier = "PRIMARY" | "FREE_PRIMARY" | "CHEAP_PAID_FALLBACK";
export type SemanticFailureCategory = "UNAVAILABLE" | "TIMEOUT" | "RATE_LIMITED" | "PROVIDER_FAILURE"
  | "INVALID_JSON" | "SCHEMA_INVALID" | "REQUIRED_FEATURE_UNSUPPORTED" | "INVALID_INPUT";
export interface SemanticUsage {
  costMicrounits: number | null;
  promptTokens?: number;
  completionTokens?: number;
}
export type SemanticAttemptResult = {
  status: "SUCCESS";
  interpretation: SemanticInterpretation;
  usage: SemanticUsage;
} | { status: "FAILURE"; category: SemanticFailureCategory; usage?: SemanticUsage };
export type PreparedSemanticAttempt = {
  status: "READY";
  model: string;
  provider: string;
  maximumCostMicrounits: number;
  /** One shot. No adapter retry or hidden provider fallback is permitted. */
  dispatch(): Promise<SemanticAttemptResult>;
} | { status: "FAILURE"; category: SemanticFailureCategory };
export interface SemanticGateway {
  /** Validates and prepares without performing any external side effect. */
  prepare(tier: SemanticTier, input: SemanticInput): PreparedSemanticAttempt;
}
