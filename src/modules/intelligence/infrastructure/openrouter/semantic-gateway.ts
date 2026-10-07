import type {ContextGatewayInterpretation} from "../../../conversation/context-contract/list-period-transport";
import { z } from "zod";
import { ContextInputSchema, InterpretationJsonSchema, type ContextInput } from "../../../conversation/context-contract/contracts";
import { serializeContextRequest } from "../../../conversation/context-contract/wire";
import { containsForbiddenControl } from "../../../conversation/context-contract/projection";
import { ConversationModelSchema, ConversationModelJsonSchema, type ConversationModel } from "../../../conversation/contracts";
import { ConversationInputSchema, CONVERSATION_PROMPT } from "../../../conversation/prompt";
import { ModelSemanticInterpretationJsonSchema, ModelSemanticInterpretationSchema } from "../../../semantic/contracts";
import { CANONICAL_SEMANTIC_PROMPT, SemanticInputSchema, type SemanticAttemptResult, type SemanticGateway,
  type SemanticUsage } from "../../semantic-gateway";
import { projectProviderFailure } from "./failure-diagnostics";
import { googleLiteEuContextWireSchemaV3 as googleLiteEuContextWireSchema, decodeGoogleLiteEuContextTransportV3 as parseGoogleLiteEuContextSections } from "./context-provider-wire";
import type { SemanticFailureDiagnostics } from "../../semantic-gateway";
import { projectCanonicalValidation, type CanonicalValidationDiagnostics } from "../../../conversation/context-contract/validation-diagnostics";
import { CONTEXT_PROTOCOL_V3, isContextProtocolV3, type ContextProtocolV3 } from "../../../conversation/context-contract/protocol";
import { projectProviderEnvelope } from "./envelope-diagnostics";

async function decodeContextResponse(response: Awaited<ReturnType<SemanticTransport>>, config: SemanticGatewayConfig, maximum: number,input:ContextInput): Promise<SemanticAttemptResult<ContextGatewayInterpretation>> {
  const version = googleLiteEuContextWireSchema().version;
  if (response.oversized || response.body.length > config.maxResponseBytes || new TextEncoder().encode(response.body).byteLength > config.maxResponseBytes) {
    return { status: "FAILURE", category: "SCHEMA_INVALID", usage: { costMicrounits: null }, canonicalValidationDiagnostics: {
      state: "OVERSIZED", schemaVersion: "calenote-context-3", providerWireSchemaVersion: version,
      payloadByteCount: Number.isSafeInteger(response.rawResponseBytes) && response.rawResponseBytes! >= 0 ? response.rawResponseBytes! : response.body.length,
      payloadByteCountIsLowerBound: true, payloadSha256: null } };
  }
  let validation: CanonicalValidationDiagnostics | undefined, wireValidation: CanonicalValidationDiagnostics | undefined;
  const observe = (value: CanonicalValidationDiagnostics) => { validation = value; };
  const output = z.unknown().transform((raw, ctx): ContextGatewayInterpretation => {
    const parsed = parseGoogleLiteEuContextSections(raw, CONTEXT_PROTOCOL_V3, observe, value => { wireValidation = value; },input);
    if (parsed.status === "PARSED") return parsed.value;
    ctx.addIssue({ code: "custom", message: "Invalid context envelope" }); return z.NEVER;
  });
  const result = decodeResponse(response, config, maximum, output, true);
  if (!validation && !wireValidation) {
    if (response.status === 200 && result.status === "FAILURE" && result.category === "SCHEMA_INVALID") {
      const raw: unknown = JSON.parse(response.body);
      const envelope = envelopeSchema.safeParse(raw);
      if (!envelope.success) {
        const bytes = new TextEncoder().encode(response.body);
        const hash = await crypto.subtle.digest("SHA-256", bytes);
        const providerEnvelope = projectProviderEnvelope(raw);
        // An explicit provider error is still a hard rejection, not malformed
        // semantic output. Preserve usage and bounded diagnostics; never decode
        // or repair its content or grant another dispatch.
        const category = providerEnvelope.choicesCount === 1 && providerEnvelope.firstChoice?.finishReason.token === "error"
          ? "PROVIDER_FAILURE" as const : result.category;
        return { ...result, category, canonicalValidationDiagnostics: { state: "PROVIDER_ENVELOPE_FAILED", schemaVersion: "calenote-context-3",
          providerWireSchemaVersion: version, inputRepresentation: "PROVIDER_ENVELOPE", payloadByteCount: bytes.byteLength,
          payloadSha256: Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join(""),
          validation: projectCanonicalValidation(raw, envelope.error.issues, "calenote-context-3"), providerEnvelope } };
      }
    }
    return result;
  }
  // Outer HTTP bytes are bounded before parsing; hash the original bounded
  // model content, never a recursively serialized model-controlled object.
  const content: string = JSON.parse(response.body).choices[0].message.content;
  const bytes = new TextEncoder().encode(content);
  const hashed = await crypto.subtle.digest("SHA-256", bytes);
  const payloadSha256 = Array.from(new Uint8Array(hashed), byte => byte.toString(16).padStart(2, "0")).join("");
  return { ...result, canonicalValidationDiagnostics: { state: validation ? "VALIDATION_FAILED" : "WIRE_DECODE_FAILED", schemaVersion: "calenote-context-3",
    providerWireSchemaVersion: version, inputRepresentation: validation ? "CANONICAL" : "PROVIDER_WIRE", payloadByteCount: bytes.byteLength, payloadSha256,
    validation: validation ?? wireValidation, ...(validation && wireValidation ? { wireValidation } : {}) } };
}

const routeSchema = z.object({
  model: z.string().max(160).regex(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._:-]+$/u)
    .refine((value) => value !== "openrouter/auto" && value !== "openrouter/free"),
  provider: z.string().min(1).max(160).regex(/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._:-]+)*$/u),
  requireZdr: z.boolean(),
  promptPriceMicrounitsPerMillionTokens: z.number().int().nonnegative().max(1_000_000_000),
  completionPriceMicrounitsPerMillionTokens: z.number().int().nonnegative().max(1_000_000_000),
}).strict();
const configSchema = z.object({
  maxInputChars: z.number().int().min(1).max(1_800),
  maxInputTokens: z.number().int().min(1).max(100_000),
  maxOutputTokens: z.number().int().min(1).max(4_096),
  maxResponseBytes: z.number().int().min(1).max(1_000_000),
  timeoutMs: z.number().int().min(1).max(30_000),
  primary: routeSchema.optional(),
  freePrimary: routeSchema.optional(),
  paidFallback: routeSchema.optional(),
}).strict();
export type SemanticGatewayConfig = z.infer<typeof configSchema>;
export interface SemanticJsonRequest {
  model: string;
  stream: false;
  messages: Array<{ role: "system" | "user"; content: string }>;
  max_tokens: number;
  temperature?: number;
  response_format: { type: "json_schema"; json_schema: { name: string; strict: true; schema: typeof ModelSemanticInterpretationJsonSchema | typeof InterpretationJsonSchema } };
  provider: { only: [string]; allow_fallbacks: false; require_parameters: true; data_collection: "deny";
    zdr?: true; max_price: { prompt: number; completion: number } };
}
/** Supplied by composition. Credentials belong to the HTTP factory's header only. */
export type SemanticTransport = (request: SemanticJsonRequest, options: { signal: AbortSignal }) => Promise<{
  status: number;
  body: string;
  oversized?: boolean;
  rawResponseBytes?: number;
  failureDiagnostics?: SemanticFailureDiagnostics;
}>;

const envelopeSchema = z.object({
  choices: z.array(z.object({
    message: z.object({ content: z.string(), tool_calls: z.never().optional(), function_call: z.never().optional() }),
    finish_reason: z.literal("stop"),
  })).length(1),
  usage: z.unknown().optional(),
});
const usageSchema = z.object({ cost: z.number().finite().nonnegative(),
  prompt_tokens: z.number().int().nonnegative().optional(), completion_tokens: z.number().int().nonnegative().optional() });

function safeUsage(raw: unknown, config: SemanticGatewayConfig, maximum: number): SemanticUsage {
  const parsed = usageSchema.safeParse(raw);
  if (!parsed.success) return { costMicrounits: null };
  const value = parsed.data;
  const amount = Math.ceil(value.cost * 1_000_000);
  if (!Number.isSafeInteger(amount) || amount > maximum
    || (value.prompt_tokens ?? 0) > config.maxInputTokens
    || (value.completion_tokens ?? 0) > config.maxOutputTokens) return { costMicrounits: null };
  return { costMicrounits: amount, ...(value.prompt_tokens === undefined ? {} : { promptTokens: value.prompt_tokens }),
    ...(value.completion_tokens === undefined ? {} : { completionTokens: value.completion_tokens }) };
}

function containsSensitiveInput(value: string): boolean {
  return /\bauthorization\s*:/iu.test(value)
    || /\b(?:api[_ -]?key|secret|password)\s*[:=]/iu.test(value)
    || /__Host-calenote_session=/u.test(value)
    || /\b\d{6,}:[A-Za-z0-9_-]{20,}\b/u.test(value)
    || /(?:^|\s)\/connect\b/iu.test(value);
}

function decodeResponse<T>(response: { status: number; body: string; oversized?: boolean }, config: SemanticGatewayConfig,
  maximum: number, output: z.ZodType<T>, enforceTokenBounds = false): SemanticAttemptResult<T> {
  if (response.status === 408) return { status: "FAILURE", category: "TIMEOUT" };
  if (response.status === 429) return { status: "FAILURE", category: "RATE_LIMITED" };
  if (response.status === 404) return { status: "FAILURE", category: "UNAVAILABLE" };
  if (response.oversized === true || typeof response.body !== "string" || new TextEncoder().encode(response.body).byteLength > config.maxResponseBytes) {
    return { status: "FAILURE", category: "SCHEMA_INVALID" };
  }
  let body: unknown;
  try { body = JSON.parse(response.body); } catch {
    return { status: "FAILURE", category: response.status === 200 ? "INVALID_JSON" : "PROVIDER_FAILURE" };
  }
  if (response.status !== 200) {
    const unsupported = z.object({ error: z.object({ code: z.literal("unsupported_parameters") }) }).safeParse(body).success;
    return { status: "FAILURE", category: unsupported ? "REQUIRED_FEATURE_UNSUPPORTED" : "PROVIDER_FAILURE" };
  }
  const envelope = envelopeSchema.safeParse(body);
  if (!envelope.success) return { status: "FAILURE", category: "SCHEMA_INVALID" };
  if (enforceTokenBounds) {
    // Assess each numeric bound independently: unknown accounting in one field
    // cannot erase a known overflow in the other. safeUsage stays separate.
    const reported = z.object({ prompt_tokens: z.unknown().optional(), completion_tokens: z.unknown().optional() }).safeParse(envelope.data.usage);
    if (reported.success && (typeof reported.data.prompt_tokens === "number" && reported.data.prompt_tokens > config.maxInputTokens
      || typeof reported.data.completion_tokens === "number" && reported.data.completion_tokens > config.maxOutputTokens)) return { status: "FAILURE", category: "SCHEMA_INVALID" };
  }
  const usage = safeUsage(envelope.data.usage, config, maximum);
  let payload: unknown;
  try { payload = JSON.parse(envelope.data.choices[0].message.content); } catch {
    return { status: "FAILURE", category: "INVALID_JSON", usage };
  }
  const semantic = output.safeParse(payload);
  return semantic.success ? { status: "SUCCESS", interpretation: semantic.data, usage }
    : { status: "FAILURE", category: "SCHEMA_INVALID", usage };
}

export function createSemanticGateway(rawConfig: SemanticGatewayConfig, transport: SemanticTransport): SemanticGateway {
  return createContractGateway(rawConfig, transport, { input: SemanticInputSchema,
    admitInput: (input, config) => input.text.length <= config.maxInputChars,
    output: ModelSemanticInterpretationSchema, schema: ModelSemanticInterpretationJsonSchema,
    prompt: CANONICAL_SEMANTIC_PROMPT, name: "model_semantic_interpretation", primaryOnly: false });
}

export function createConversationGateway(rawConfig: SemanticGatewayConfig, transport: SemanticTransport): SemanticGateway<ConversationModel, unknown> {
  if (!rawConfig.primary?.requireZdr || rawConfig.freePrimary || rawConfig.paidFallback) {
    throw new TypeError("Conversation requires a single ZDR primary route");
  }
  return createContractGateway(rawConfig, transport, { input: ConversationInputSchema,
    admitInput: (input, config) => input.text.length <= config.maxInputChars,
    output: ConversationModelSchema, schema: ConversationModelJsonSchema,
    prompt: CONVERSATION_PROMPT, name: "conversation_semantic_interpretation", primaryOnly: true });
}

function sensitiveValue(value: unknown): boolean {
  if (typeof value === "string") return containsSensitiveInput(value);
  if (Array.isArray(value)) return value.some(sensitiveValue);
  return value !== null && typeof value === "object" && Object.values(value).some(sensitiveValue);
}

function createContractGateway<T, Input>(rawConfig: SemanticGatewayConfig,
  transport: SemanticTransport, contract: { input: z.ZodType<Input>; output: z.ZodType<T>;
    admitInput: (input: Input, config: SemanticGatewayConfig) => boolean;
    schema: typeof ModelSemanticInterpretationJsonSchema; prompt: string; name: string; primaryOnly: boolean }): SemanticGateway<T, unknown> {
  const parsed = configSchema.safeParse(rawConfig);
  if (!parsed.success || typeof transport !== "function"
    || (parsed.data.freePrimary && (parsed.data.freePrimary.promptPriceMicrounitsPerMillionTokens !== 0
      || parsed.data.freePrimary.completionPriceMicrounitsPerMillionTokens !== 0))) {
    throw new TypeError("Invalid semantic gateway configuration");
  }
  // Zod copies the configuration; caller mutation cannot swap an approved route.
  const config = parsed.data;
  return {
    prepare(tier, rawInput) {
      if (contract.primaryOnly && tier !== "PRIMARY") return { status: "FAILURE", category: "UNAVAILABLE" };
      const parsedInput = contract.input.safeParse(rawInput);
      if (!parsedInput.success || !contract.admitInput(parsedInput.data, config)
        || sensitiveValue(parsedInput.data)) {
        return { status: "FAILURE", category: "INVALID_INPUT" };
      }
      const route = tier === "PRIMARY" ? config.primary : tier === "FREE_PRIMARY" ? config.freePrimary : config.paidFallback;
      if (!route) return { status: "FAILURE", category: "UNAVAILABLE" };
      const request: SemanticJsonRequest = {
        model: route.model,
        stream: false,
        messages: [{ role: "system", content: contract.prompt },
          { role: "user", content: JSON.stringify(parsedInput.data) }],
        max_tokens: config.maxOutputTokens,
        response_format: { type: "json_schema", json_schema: { name: contract.name, strict: true, schema: structuredClone(contract.schema) } },
        provider: { only: [route.provider], allow_fallbacks: false, require_parameters: true, data_collection: "deny",
          ...(route.requireZdr ? { zdr: true } : {}), max_price: {
            prompt: route.promptPriceMicrounitsPerMillionTokens / 1_000_000,
            completion: route.completionPriceMicrounitsPerMillionTokens / 1_000_000,
          } },
      };
      // UTF-8 bytes provide a conservative token bound for reviewed byte-token
      // models; include schema plus 1024 framing tokens. Eligibility review must
      // verify this bound for the selected tokenizer before enabling a route.
      if (new TextEncoder().encode(JSON.stringify(request)).byteLength + 1_024 > config.maxInputTokens) {
        return { status: "FAILURE", category: "INVALID_INPUT" };
      }
      const numerator = BigInt(config.maxInputTokens) * BigInt(route.promptPriceMicrounitsPerMillionTokens)
        + BigInt(config.maxOutputTokens) * BigInt(route.completionPriceMicrounitsPerMillionTokens);
      const maximumCostMicrounits = Number((numerator + 999_999n) / 1_000_000n);
      let dispatched = false;
      return {
        status: "READY", model: route.model, provider: route.provider, maximumCostMicrounits,
        async dispatch() {
          if (dispatched) return { status: "FAILURE", category: "UNAVAILABLE" };
          dispatched = true;
          const controller = new AbortController();
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            const timeout = new Promise<SemanticAttemptResult<T>>((resolve) => {
              timer = setTimeout(() => {
                controller.abort();
                resolve({ status: "FAILURE", category: "TIMEOUT" });
              }, config.timeoutMs);
            });
            return await Promise.race([
              Promise.resolve().then(() => transport(request, { signal: controller.signal }))
                .then((response) => decodeResponse(response, config, maximumCostMicrounits, contract.output)),
              timeout,
            ]);
          } catch {
            return { status: "FAILURE", category: controller.signal.aborted ? "TIMEOUT" : "PROVIDER_FAILURE" };
          } finally {
            clearTimeout(timer);
          }
        },
      };
    },
  };
}

/** Observable admission permits the first authorized campaign canary. Its
 * result is settled by application/campaign acceptance, not by configuration. */
export type ContextRouteAdmission = { status: "UNVERIFIED" } | { status: "OBSERVABLE_CANARY"; advertisedContextTokens: 1048576 };
/** Financial exposure only. The application still accepts <=12000 input tokens. */
export const CONTEXT_FINANCIAL_RESERVATION_MICROUNITS = 105472;
/** Worker-valid HTTP boundary; credentials never enter request JSON or logs.
 * Model generation is non-SSE; bounded HTTP body streaming is still required. */
export function createContextHttpTransport(apiKey: string,
  fetcher: (url: string, init: RequestInit) => Promise<Response> = fetch): SemanticTransport {
  if (!apiKey || /[\r\n]/u.test(apiKey)) throw new TypeError("Credential unavailable");
  return async (request, { signal }) => {
    const response = await fetcher("https://openrouter.ai/api/v1/chat/completions", { method: "POST", redirect: "error", signal,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(request) });
    const media = response.headers.get("content-type"), failed = response.status !== 200;
    const sensitive = [apiKey, ...request.messages.map(message => message.content)];
    // Known conversation and identifier echoes are denied even when they happen
    // to match a safe diagnostic grammar. Never return the request itself.
    try {
      const user = JSON.parse(request.messages[1].content) as { turns?: Array<{ text?: string }> };
      for (const turn of user.turns ?? []) if (typeof turn.text === "string") sensitive.push(turn.text);
    } catch { /* No request diagnostics. */ }
    const failure = async (length: number, state?: SemanticFailureDiagnostics["bodyState"], bytes?: Uint8Array, oversized = false) => {
      const failureDiagnostics = await projectProviderFailure({ status: response.status, length, media, state, bytes, headers: response.headers, sensitive,
        schema: request.response_format.json_schema.schema });
      // Preserve independently observable numeric accounting without returning
      // provider prose or the raw error body beyond this HTTP boundary.
      let body = "";
      if (bytes && failureDiagnostics.bodyState === "JSON") {
        try {
          const raw = JSON.parse(new TextDecoder().decode(bytes));
          const usage = z.object({ cost: z.unknown().optional(), prompt_tokens: z.unknown().optional(), completion_tokens: z.unknown().optional() }).safeParse(raw?.usage);
          if (usage.success) {
            const numeric: Record<string, number> = {};
            for (const key of ["cost", "prompt_tokens", "completion_tokens"] as const) {
              const value = usage.data[key];
              if (typeof value === "number" && Number.isFinite(value) && value >= 0 && (key === "cost" || Number.isSafeInteger(value))) numeric[key] = value;
            }
            body = JSON.stringify({ usage: numeric });
          }
        } catch { /* Unknown cost remains unknown. */ }
      }
      return { status: response.status, body, rawResponseBytes: length, ...(oversized ? { oversized: true } : {}), failureDiagnostics };
    };
    if (!failed && media?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
      await response.body?.cancel().catch(() => undefined); throw new Error("Invalid provider media type");
    }
    const declared = response.headers.get("content-length");
    if (declared !== null && (!/^\d+$/u.test(declared) || !Number.isSafeInteger(Number(declared)))) {
      await response.body?.cancel().catch(() => undefined);
      if (failed) return failure(0, "INVALID_LENGTH");
      throw new Error("Invalid provider length");
    }
    if (declared !== null && Number(declared) > 32768) {
      await response.body?.cancel().catch(() => undefined);
      return failed ? failure(0, "OVERSIZED", undefined, true) : { status: response.status, body: "", oversized: true, rawResponseBytes: 0 };
    }
    if (!response.body) return failed ? failure(0, "EMPTY") : { status: response.status, body: "", rawResponseBytes: 0 };
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
    const abort = () => { void reader.cancel().catch(() => undefined); };
    signal.addEventListener("abort", abort, { once: true });
    try {
      if (signal.aborted) { abort(); throw new Error("Provider aborted"); }
      while (true) {
        const next = await reader.read();
        if (signal.aborted) throw new Error("Provider aborted");
        if (next.done) break;
        length += next.value.byteLength;
        if (length > 32768) { await reader.cancel().catch(() => undefined); return failed ? failure(length, "OVERSIZED", undefined, true) : { status: response.status, body: "", oversized: true, rawResponseBytes: length }; }
        chunks.push(next.value);
      }
      const bytes = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return failed ? failure(length, undefined, bytes) : { status: response.status, body: new TextDecoder("utf-8", { fatal: true }).decode(bytes), rawResponseBytes: length };
    } catch {
      await reader.cancel().catch(() => undefined);
      if (failed && !signal.aborted) return failure(length, "READ_ERROR");
      throw new Error("Provider body unavailable");
    } finally { signal.removeEventListener("abort", abort); reader.releaseLock(); }
  };
}
async function decodeObservableResponse(response: Awaited<ReturnType<SemanticTransport>>, config: SemanticGatewayConfig,input:ContextInput): Promise<SemanticAttemptResult<ContextGatewayInterpretation>> {
  const maximum = CONTEXT_FINANCIAL_RESERVATION_MICROUNITS;
  if (response.status !== 200 && response.failureDiagnostics) {
    let rawUsage: unknown;
    try { rawUsage = JSON.parse(response.body).usage; } catch { /* Unknown accounting. */ }
    const cost = z.object({ cost: z.number().finite().nonnegative() }).safeParse(rawUsage);
    const amount = cost.success ? Math.ceil(cost.data.cost * 1000000) : null;
    const tokens = z.object({ prompt_tokens: z.number().int().nonnegative(), completion_tokens: z.number().int().nonnegative() }).safeParse(rawUsage);
    return { status: "FAILURE", category: response.status === 408 ? "TIMEOUT" : response.status === 429 ? "RATE_LIMITED" : "PROVIDER_FAILURE",
      usage: { costMicrounits: amount !== null && Number.isSafeInteger(amount) ? amount : null,
        ...(cost.success ? { reportedCostUsd: cost.data.cost } : {}), ...(tokens.success ? { promptTokens: tokens.data.prompt_tokens, completionTokens: tokens.data.completion_tokens } : {}) }, failureDiagnostics: response.failureDiagnostics };
  }
  if (response.oversized || new TextEncoder().encode(response.body).byteLength > config.maxResponseBytes)
    return decodeContextResponse(response, config, maximum,input);
  let raw: unknown;
  try { raw = JSON.parse(response.body); } catch { return { status: "FAILURE", category: response.status === 200 ? "INVALID_JSON" : "PROVIDER_FAILURE" }; }
  const accounting = z.object({ usage: z.unknown().optional() }).safeParse(raw);
  // Cost is independent of token validity: a known overflow must not erase an
  // otherwise known charge, even if it exceeds the financial reservation.
  const cost = z.object({ cost: z.number().finite().nonnegative() }).safeParse(accounting.success ? accounting.data.usage : undefined);
  const amount = cost.success ? Math.ceil(cost.data.cost * 1000000) : null;
  const costMicrounits = amount !== null && Number.isSafeInteger(amount) ? amount : null;
  const tokens = z.object({ prompt_tokens: z.number().int().nonnegative(), completion_tokens: z.number().int().nonnegative() })
    .safeParse(accounting.success ? accounting.data.usage : undefined);
  const usage: SemanticUsage = { costMicrounits, ...(cost.success ? { reportedCostUsd: cost.data.cost } : {}), ...(tokens.success ? { promptTokens: tokens.data.prompt_tokens, completionTokens: tokens.data.completion_tokens } : {}) };
  const fail = (category: import("../../semantic-gateway").SemanticFailureCategory): SemanticAttemptResult<ContextGatewayInterpretation> => ({ status: "FAILURE", category, usage });
  if (response.status !== 200) return fail(response.status === 408 ? "TIMEOUT" : response.status === 429 ? "RATE_LIMITED" : "PROVIDER_FAILURE");
  if (!tokens.success || costMicrounits === null || costMicrounits > maximum || tokens.data.prompt_tokens > 12000 || tokens.data.completion_tokens > 1536) return fail("SCHEMA_INVALID");
  const observed = z.object({ model: z.literal("google/gemini-2.5-flash-lite"), provider: z.enum(["Google", "google-vertex", "google-vertex/eu"]),
    id: z.string().max(160).regex(/^gen-[A-Za-z0-9_-]+$/u).optional(), location: z.literal("eu").optional() }).safeParse(raw);
  if (!observed.success) return fail("SCHEMA_INVALID");
  const evidence = { model: observed.data.model, provider: observed.data.provider,
    location: observed.data.location ?? "UNEXPOSED" as const, generationId: observed.data.id ?? null };
  const parsed = await decodeContextResponse(response, config, maximum,input);
  // Runtime retains independently valid core and quarantines bad guidance (T5).
  // Strict campaign full-schema admission is a separate evaluation gate.
  if (parsed.status !== "SUCCESS") return { ...fail(parsed.category), providerEvidence: evidence, ...(parsed.canonicalValidationDiagnostics ? { canonicalValidationDiagnostics: parsed.canonicalValidationDiagnostics } : {}) };
  return { ...parsed, usage, providerEvidence: evidence };
}
/** Declarative synthetic exchanges, not an executable transport. Request JSON
 * binds the synthetic count to the entire canonical wire including the route.
 * This is never evidence of provider framing, compatibility or current prices. */
export interface ContextOfflineTransport {
  kind: "OFFLINE_FIXTURE";
  exchanges: Array<{
    requestJson: string;
    admission: { fullInputTokens: number; billableOverheadMicrounits: number };
    response: { status: number; body: string; oversized?: boolean };
  }>;
}
const offlineSchema = z.strictObject({ kind: z.literal("OFFLINE_FIXTURE"), exchanges: z.array(z.strictObject({
  requestJson: z.string().max(262144),
  admission: z.strictObject({ fullInputTokens: z.number(), billableOverheadMicrounits: z.number() }),
  response: z.strictObject({ status: z.number().int(), body: z.string().max(131072), oversized: z.boolean().optional() }),
})).max(1000) });

/** Dormant successor factory. Callable transports refuse without the explicit
 * observable method; the campaign owns durable canary acceptance before reuse.
 * Offline scripts are copied plain data and have no callback/network capability.
 * T7 still owns original-source/snapshot admission, evidence, budgets and events. */
export type ContextGatewayConfig = SemanticGatewayConfig & { protocol: ContextProtocolV3 };
export function createContextContractGateway(rawConfig: ContextGatewayConfig,
  transport: SemanticTransport | ContextOfflineTransport, admission: ContextRouteAdmission = { status: "UNVERIFIED" }): SemanticGateway<ContextGatewayInterpretation, ContextInput> {
  const { protocol, ...configuration } = rawConfig;
  if (!isContextProtocolV3(protocol)) throw new TypeError("Selected context protocol required");
  const config = configSchema.parse(configuration);
  const route = config.primary;
  if (!route || route.model !== "google/gemini-2.5-flash-lite" || route.provider !== "google-vertex/eu" || !route.requireZdr
    || route.promptPriceMicrounitsPerMillionTokens !== 100000 || route.completionPriceMicrounitsPerMillionTokens !== 400000
    || config.freePrimary || config.paidFallback || config.maxInputTokens !== 12000 || config.maxOutputTokens !== 1536
    || config.maxResponseBytes !== 32768 || config.timeoutMs !== 30000) throw new TypeError("Invalid context gateway configuration");
  const offline = typeof transport === "function" ? null : offlineSchema.safeParse(transport);
  const observable = typeof transport === "function" && admission.status === "OBSERVABLE_CANARY" && admission.advertisedContextTokens === 1048576;
  let cursor = 0;
  return { prepare(tier, rawInput) {
    if (tier !== "PRIMARY") return { status: "FAILURE", category: "UNAVAILABLE" };
    const input = ContextInputSchema.safeParse(rawInput);
    if (!input.success || input.data.turns[input.data.currentTurn].text.length > config.maxInputChars
      || input.data.turns.some(t => t.role === "USER" && [...t.text].length > 2000)
      || sensitiveValue(input.data) || containsForbiddenControl(input.data, [])) return { status: "FAILURE", category: "INVALID_INPUT" };
    // Fail before exposing a reservation amount. No env flag/caller assertion
    // can convert local token measurements into full-route admission.
    if (!offline?.success && !observable) return { status: "FAILURE", category: "ROUTE_ADMISSION_UNVERIFIED" };
    const wire = serializeContextRequest(input.data);
    const request: SemanticJsonRequest = { model: route.model, ...wire,
      response_format: { ...wire.response_format, json_schema: { ...wire.response_format.json_schema, strict: true } }, provider: {
      only: [route.provider], allow_fallbacks: false, require_parameters: true, data_collection: "deny", zdr: true,
      max_price: { prompt: 0.1, completion: 0.4 },
    } };
    if (observable && typeof transport === "function") {
      const providerRequest: SemanticJsonRequest = { ...request, response_format: { ...request.response_format,
        json_schema: { ...request.response_format.json_schema,
          schema: googleLiteEuContextWireSchema().schema } } };
      let dispatched = false;
      return { status: "READY", model: route.model, provider: route.provider, routeAdmission: "OBSERVABLE_CANARY", maximumCostMicrounits: CONTEXT_FINANCIAL_RESERVATION_MICROUNITS,
        async dispatch() {
          if (dispatched) return { status: "FAILURE", category: "UNAVAILABLE" };
          dispatched = true;
          const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            return await Promise.race([
              Promise.resolve().then(() => transport(structuredClone(providerRequest), { signal: controller.signal })).then(async response => ({
                ...await decodeObservableResponse(response, config,input.data), ...(response.rawResponseBytes !== undefined && Number.isSafeInteger(response.rawResponseBytes)
                  && response.rawResponseBytes >= 0 ? { rawResponseBytes: response.rawResponseBytes } : {}),
              })),
              new Promise<SemanticAttemptResult<ContextGatewayInterpretation>>(resolve => { timer = setTimeout(() => {
                controller.abort(); resolve({ status: "FAILURE", category: "TIMEOUT", usage: { costMicrounits: null } });
              }, config.timeoutMs); }),
            ]);
          } catch { return { status: "FAILURE", category: controller.signal.aborted ? "TIMEOUT" : "PROVIDER_FAILURE", usage: { costMicrounits: null } }; }
          finally { clearTimeout(timer); }
        } };
    }
    if (!offline?.success) return { status: "FAILURE", category: "ROUTE_ADMISSION_UNVERIFIED" };
    const fixture = offline.data.exchanges[cursor];
    if (!fixture || fixture.requestJson !== JSON.stringify(request)) return { status: "FAILURE", category: "INVALID_INPUT" };
    const { fullInputTokens, billableOverheadMicrounits } = fixture.admission;
    if (!Number.isSafeInteger(fullInputTokens) || fullInputTokens <= 0 || fullInputTokens > config.maxInputTokens
      || !Number.isSafeInteger(billableOverheadMicrounits) || billableOverheadMicrounits < 0
      || billableOverheadMicrounits > 2_000_000) return { status: "FAILURE", category: "INVALID_INPUT" };
    const numerator = BigInt(config.maxInputTokens) * BigInt(route.promptPriceMicrounitsPerMillionTokens)
      + BigInt(config.maxOutputTokens) * BigInt(route.completionPriceMicrounitsPerMillionTokens);
    const maximumCostMicrounits = Number((numerator + 999999n) / 1000000n) + billableOverheadMicrounits;
    cursor++;
    let dispatched = false;
    return { status: "READY", model: route.model, provider: route.provider, maximumCostMicrounits,
      async dispatch() {
        if (dispatched) return { status: "FAILURE", category: "UNAVAILABLE" };
        dispatched = true;
        return decodeContextResponse(fixture.response, config, maximumCostMicrounits,input.data);
      },
    };
  } };
}
