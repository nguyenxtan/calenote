import { z } from "zod";
import { IssueFieldSchema } from "./contracts";

// Diagnostic-only lexical measurements, never evidence or semantic authority.
export const QuoteClassificationSchema = z.strictObject({
  classification: z.enum(["EXACT_WRONG_SOURCE", "NORMALIZATION_VARIANT", "FORMATTING_VARIANT", "PARAPHRASED_QUOTE", "UNRELATED_QUOTE", "SOURCE_MAP_DEFECT", "UNKNOWN"]),
  confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  exactMatchIntendedUser: z.boolean(), exactMatchOtherUser: z.boolean(), exactMatchAssistant: z.boolean(),
  nfcMatch: z.boolean(), caseFoldedMatch: z.boolean(), whitespaceNormalizedMatch: z.boolean(), punctuationNormalizedMatch: z.boolean(),
  strictSubstringAfterNormalization: z.boolean(),
  longestCommonContiguousSpanLength: z.number().int().min(0).max(2000),
  tokenOverlapRatio: z.number().min(0).max(1),
  tokenOverlapBucket: z.enum(["NONE", "LOW", "MEDIUM", "HIGH"]),
  editDistanceBucket: z.enum(["EXACT", "NEAR", "PARAPHRASE_LIKE", "UNRELATED", "NOT_MEASURED"]),
  sourceMapStatus: z.enum(["VALID", "INVALID", "UNAVAILABLE"]),
  retainedUserBindingValid: z.boolean(), removedControlSpanNearby: z.boolean(), sourceChangedUnderNfc: z.boolean(),
  normalizationOnlyDifference: z.boolean(), similarityMeasured: z.boolean(), semanticParaphraseConfirmed: z.literal(false),
});
export type QuoteClassification = z.infer<typeof QuoteClassificationSchema>;

export const EvidenceFailureDiagnosticSchema = z.strictObject({
  field: IssueFieldSchema,
  path: z.array(z.union([z.enum(["changes", "query", "uncertainties", "alternatives", "evidence", "controlEvidence"]), z.number().int().min(0).max(31)])).max(6),
  referenceOrdinal: z.number().int().min(0).max(2),
  sourceAlias: z.string().regex(/^(?:t(?:[0-9]|1[01])|f[1-9][0-9]*)$/u).max(16),
  expectedSourceRole: z.enum(["USER", "CONTEXT_FACT"]),
  resolvedSourceRole: z.enum(["USER", "ASSISTANT", "CONTEXT_FACT", "UNKNOWN"]),
  sourceTurnOrdinal: z.number().int().min(0).max(11).nullable(),
  requestedOccurrence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).nullable(),
  matchCount: z.number().int().min(0).max(10000).nullable(),
  quoteBytes: z.number().int().min(0).max(8000).nullable(),
  quoteCodePoints: z.number().int().min(0).max(2000).nullable(),
  quoteSha256: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
  sourceViewSha256: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
  sourceMapStatus: z.enum(["NOT_CHECKED", "VALID", "INVALID", "REMOVED_CONTROL_SPAN", "NORMALIZATION_BOUNDARY"]),
  quoteClassification: QuoteClassificationSchema.optional(),
  reason: z.enum(["SOURCE_ALIAS_UNKNOWN", "SOURCE_SCOPE_MISMATCH", "SOURCE_ROLE_NOT_USER", "QUOTE_NOT_FOUND", "QUOTE_OCCURRENCE_OUT_OF_RANGE", "QUOTE_NORMALIZATION_MISMATCH", "QUOTE_SOURCE_MAP_INVALID", "QUOTE_REMOVED_CONTROL_SPAN", "EVIDENCE_TARGET_MISMATCH"]),
});
export type EvidenceFailureDiagnostic = z.infer<typeof EvidenceFailureDiagnosticSchema>;

// Closed vocabulary only: never persist an exception message or operand value.
export const DownstreamDiagnosticSchema = z.strictObject({
  stage: z.enum(["CANONICAL", "EVIDENCE", "LIST_RANGE", "PATCH", "MERGE", "QUERY_RESOLUTION", "QUERY_RANGE", "DIRECTIVE", "TRANSITION", "REPLY"]),
  result: z.enum(["PASS", "QUARANTINED_GUIDANCE", "REJECTED", "CLARIFY", "SUPPORTED", "UNSUPPORTED", "AMBIGUOUS", "UNSPECIFIED", "NOT_APPLICABLE"]),
  reason: z.enum(["NONE", "CONTEXT_NOT_BUILT", "PROPOSAL_SCHEMA_INVALID", "CONTROL_IN_PROPOSAL", "EVIDENCE_NOT_USER", "EVIDENCE_QUOTE_NOT_FOUND", "EVIDENCE_REMOVED_SPAN", "EVIDENCE_NORMALIZATION_BOUNDARY", "EVIDENCE_SOURCE_MISMATCH", "EVIDENCE_FACT_SCOPE_OR_VALUE", "EVIDENCE_FACT_VALUE_CONFLICT", "EVIDENCE_PLACEHOLDER_VALUE", "EVIDENCE_FACT_INVALID", "EVIDENCE_ANCHOR_CONFLICT", "EVIDENCE_SOURCE_LIMIT", "YEAR_NOT_EXPLICIT", "CURRENT_USER_EVIDENCE_REQUIRED", "NOTES_LOSS_REQUIRES_CLARIFICATION", "EVIDENCE_INVALID", "MISSING_RANGE", "INVALID_QUERY", "QUERY_RANGE_AMBIGUOUS", "RESOLUTION_REJECTED", "PATCH_REJECTED", "TRANSITION_REJECTED", "DIRECTIVE_MISMATCH", "DIRECTIVE_INVALID",
    "UNVALIDATED_PATCH", "STALE_BASE", "UNCERTAINTY_EVIDENCE_UNAVAILABLE", "UNCERTAINTY_INVALID", "UNCERTAINTY_FACT_INVALIDATED", "MERGED_STATE_INVALID", "CONTEXT_SNAPSHOT_TOO_LARGE", "UNCERTAINTY_LIMIT", "REPLACEMENT_REQUIRED", "AMBIGUOUS_OPERATION",
    "MISSING_TOPIC", "MISSING_CALENDAR_OPERAND", "LUNAR_YEAR_REQUIRED", "AMBIGUOUS_WEEK", "LUNAR_LEAP_CHOICE_REQUIRED", "INVALID_DATE", "YEAR_REQUIRED_INVALID_DATE", "CALENDAR_OUT_OF_RANGE", "ENDPOINT_LIMIT", "REVERSED_RANGE", "SPAN_LIMIT",
    "CONTEXT", "EXPIRED", "SEMANTIC", "STALE", "CANDIDATE_EVIDENCE", "UNKNOWN_DIRECTIVE", "CONFIG", "PREVIEW_CHANNEL_REQUIRED", "SIZE", "TRANSITION_STATE_INVALID", "SCHEMA_INVALID", "PROVIDER", "BUDGET"]),
  field: IssueFieldSchema.optional(),
  evidenceFailure: EvidenceFailureDiagnosticSchema.optional(),
  candidateRange: z.enum(["DAY", "DATE_BOUNDS", "WEEK", "WEEKEND", "MONTH", "REST_OF_MONTH", "NEXT_7_DAYS", "UPCOMING"]).optional(),
  directive: z.enum(["ASK_FOR_FIELD", "ASK_FOR_DISAMBIGUATION", "EXPLAIN_UNSUPPORTED", "HELP", "PRESENT_PREVIEW", "ANSWER_QUERY", "BACKEND_ONLY"]).optional(),
  transition: z.enum(["REPLY_ONLY", "STORED", "CONFIRMATION"]).optional(),
  replySource: z.enum(["BACKEND", "MODEL_GUIDANCE"]).optional(),
  replyKind: z.enum(["CLARIFICATION", "PREVIEW", "DECISION", "QUERY_RESULT", "RECOVERY", "NOTICE"]).optional(),
});
export type DownstreamDiagnostic = z.infer<typeof DownstreamDiagnosticSchema>;
export const DownstreamTraceSchema = z.array(DownstreamDiagnosticSchema).max(24);
export type DownstreamObserver = (diagnostic: DownstreamDiagnostic) => void;
export function observeDownstream(observer: DownstreamObserver | undefined, diagnostic: DownstreamDiagnostic): void {
  try { const safe = DownstreamDiagnosticSchema.safeParse(diagnostic); if (safe.success) observer?.(safe.data); } catch { /* non-authoritative */ }
}
export function evidenceReason(reason: string, fallback: DownstreamDiagnostic["reason"] = "EVIDENCE_INVALID"): DownstreamDiagnostic["reason"] {
  const safe = DownstreamDiagnosticSchema.shape.reason.safeParse(reason);
  return safe.success ? safe.data : fallback;
}
