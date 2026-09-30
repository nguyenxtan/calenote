import { z } from "zod";

const safeCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const reason = z.enum(["AUTH_INVALID", "CONTEXT_INVALID", "DUPLICATE", "DISABLED", "UNAVAILABLE", "BUDGET_EXHAUSTED",
  "LOCAL_CONTROL", "GREETING", "HELP", "CALENDAR_GRID", "EXPLICIT_API_RANGE", "ARITHMETIC", "INVALID_INPUT",
  "ROUTE_ADMISSION_UNVERIFIED", "TIMEOUT", "RATE_LIMITED", "PROVIDER_FAILURE", "INVALID_JSON", "SCHEMA_INVALID",
  "EVIDENCE_INVALID", "REQUIRED_FEATURE_UNSUPPORTED", "STALE", "EXPIRED", "INVALID", "UNCERTAIN", "UNSUPPORTED",
  "SEMANTIC_INPUT_TOO_LONG", "CONTEXT_SNAPSHOT_TOO_LARGE", "NO_PROGRESS", "DELIVERY_FAILED"]);
const base = { traceId: z.uuidv4(), sourceSha: z.string().regex(/^[0-9a-f]{40}$/u),
  contractVersion: z.literal("calenote-context-2"), promptVersion: z.literal("calenote-context-2"),
  mode: z.enum(["OFFLINE_FIXTURE", "LIVE"]),
  contextRevisionBefore: safeCount.nullable().optional(), contextRevisionAfter: safeCount.nullable().optional(),
  draftRevisionBefore: safeCount.nullable().optional(), draftRevisionAfter: safeCount.nullable().optional(),
};
const event = <K extends string, S extends z.ZodRawShape>(kind: K, fields: S) => z.strictObject({ ...base, event: z.literal(kind), ...fields });
const directive = z.enum(["ASK_FOR_FIELD", "ASK_FOR_DISAMBIGUATION", "EXPLAIN_UNSUPPORTED", "HELP", "PRESENT_PREVIEW", "ANSWER_QUERY", "BACKEND_ONLY"]);
const schema = z.discriminatedUnion("event", [
  event("INBOUND_ACCEPTED", {}), event("CONTEXT_LOADED", { presence: z.enum(["PRESENT", "ABSENT", "INVALID", "EXPIRED", "UNAVAILABLE"]) }),
  event("MODEL_REQUIRED", {}), event("MODEL_BYPASSED", { reason }), event("REQUEST_REJECTED", { reason }),
  event("REQUEST_PREPARED", { configuredModel: z.literal("google/gemini-2.5-flash-lite"), configuredProvider: z.literal("google-vertex/eu"), routeAdmission: z.enum(["UNVERIFIED", "OFFLINE_FIXTURE", "OBSERVABLE_CANARY"]) }),
  // Protected reservation IDs/owner mappings belong to the budget store. The
  // trace ID links that protected mapping without exposing identifiers here.
  event("BUDGET_RESERVED", { maximumCostMicrounits: safeCount }), event("REQUEST_DISPATCHED", {}),
  event("RESPONSE_RECEIVED", { outcome: z.enum(["SUCCESS", "FAILURE"]), latencyMs: safeCount,
    observedModel: z.enum(["UNKNOWN", "google/gemini-2.5-flash-lite"]), observedProvider: z.enum(["UNKNOWN", "Google", "google-vertex", "google-vertex/eu"]),
    promptTokens: safeCount.nullable(), completionTokens: safeCount.nullable(), costMicrounits: safeCount.nullable(), reason: reason.optional() }),
  event("STRUCTURE_VALIDATED", { fullSchemaValid: z.boolean(), semanticPatchValidation: z.enum(["VALID", "INVALID"]),
    directiveValidation: z.enum(["VALID", "INVALID", "NOT_EVALUATED"]), replyEligibility: z.enum(["VALID", "INVALID", "NOT_EVALUATED"]) }),
  event("PROVENANCE_DOMAIN_VALIDATED", { result: z.enum(["VALID", "INVALID"]), reason: reason.optional() }),
  event("TRANSITION_ACCEPTED", {}), event("TRANSITION_REJECTED", { reason }),
  event("SCHEDULE_RESOLVED", { result: z.enum(["READY", "CLARIFY", "UNSUPPORTED"]) }),
  event("QUERY_EXECUTED", { result: z.enum(["SUCCESS", "PARTIAL", "FAILURE"]), hasMore: z.boolean().nullable() }),
  event("CONFIRMATION_VALIDATED", { result: z.enum(["VALID", "INVALID"]) }),
  event("MUTATION_COMMITTED", {}), event("MUTATION_IDEMPOTENT_SKIP", {}),
  event("EFFECTIVE_DIRECTIVE_COMPUTED", { kind: directive }),
  event("DIRECTIVE_VALIDATED", { result: z.enum(["MATCH", "DIRECTIVE_INVALID", "DIRECTIVE_MISMATCH", "BACKEND_SURFACE"]) }),
  event("REPLY_ELIGIBILITY_EVALUATED", { result: z.enum(["ELIGIBLE", "REPLY_ABSENT", "REPLY_INVALID", "REPLY_TOO_LONG", "REPLY_FORBIDDEN", "DIRECTIVE_INVALID", "DIRECTIVE_MISMATCH", "BACKEND_SURFACE"]) }),
  event("REPLY_SELECTED", { source: z.enum(["MODEL_GUIDANCE", "BACKEND"]) }), event("REPLY_DISPATCHED", {}),
  event("REPLY_SENT", {}), event("REPLY_FAILED", { reason }), event("REPLY_UNCERTAIN", { reason }),
]).superRefine((value, ctx) => {
  if ((value.event === "RESPONSE_RECEIVED" && value.outcome === "FAILURE"
    || value.event === "PROVENANCE_DOMAIN_VALIDATED" && value.result === "INVALID") && value.reason === undefined) {
    ctx.addIssue({ code: "custom", message: "Failure requires categorical reason" });
  }
  if (value.event === "STRUCTURE_VALIDATED" && value.fullSchemaValid
    && (value.semanticPatchValidation !== "VALID" || value.directiveValidation !== "VALID" || value.replyEligibility !== "VALID")) {
    ctx.addIssue({ code: "custom", message: "Invalid section cannot pass full schema" });
  }
});
export type ContextObservationEvent = z.infer<typeof schema>;
export function createContextTraceId(): string { return crypto.randomUUID(); }
/** Closed, content-free event union; never serialize an invalid event or error.
 * Telemetry failure cannot affect the application transition. Mode distinguishes
 * synthetic exercise from live invocation. No event asserts semantic accuracy. */
export function observeContextEvent(event: ContextObservationEvent): void {
  try {
    const parsed = schema.safeParse(event);
    if (parsed.success) console.info("context_contract", parsed.data);
  } catch { /* no exception body enters telemetry */ }
}
