import { z } from "zod";
import { ContextInputSchema, InterpretationJsonSchema, parseInterpretationSections, type ContextInput, type ParsedInterpretation } from "../../../conversation/context-contract/contracts";
import { serializeContextRequest } from "../../../conversation/context-contract/wire";
import { containsForbiddenControl } from "../../../conversation/context-contract/projection";
import { ConversationModelSchema, ConversationModelJsonSchema, type ConversationModel } from "../../../conversation/contracts";
import { ConversationInputSchema, CONVERSATION_PROMPT } from "../../../conversation/prompt";
import { ModelSemanticInterpretationJsonSchema, ModelSemanticInterpretationSchema } from "../../../semantic/contracts";
import { CANONICAL_SEMANTIC_PROMPT, SemanticInputSchema, type SemanticAttemptResult, type SemanticGateway,
  type SemanticUsage } from "../../semantic-gateway";

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
  response_format: { type: "json_schema"; json_schema: { name: string; strict: true; schema: typeof ModelSemanticInterpretationJsonSchema | typeof InterpretationJsonSchema } };
  provider: { only: [string]; allow_fallbacks: false; require_parameters: true; data_collection: "deny";
    zdr?: true; max_price: { prompt: number; completion: number } };
}
/** Supplied by composition only. This module never creates HTTP or reads credentials. */
export type SemanticTransport = (request: SemanticJsonRequest, options: { signal: AbortSignal }) => Promise<{
  status: number;
  body: string;
  oversized?: boolean;
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

/** No VERIFIED variant exists until B supplies a reviewed Worker-valid method.
 * Configuration readiness is separate from authority to dispatch. */
export type ContextRouteAdmission = { status: "UNVERIFIED" };
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
const contextSectionsSchema = z.unknown().transform((raw, ctx): ParsedInterpretation => {
  const parsed = parseInterpretationSections(raw);
  if (parsed.status === "PARSED") return parsed.value;
  ctx.addIssue({ code: "custom", message: "Invalid context semantic envelope or core" });
  return z.NEVER;
});

/** Dormant successor factory. Callable transports ALWAYS refuse while B is
 * unverified, including functions decorated with forged offline properties.
 * Offline scripts are copied plain data and have no callback/network capability.
 * T7 still owns original-source/snapshot admission, evidence, budgets and events. */
export function createContextContractGateway(rawConfig: SemanticGatewayConfig,
  transport: SemanticTransport | ContextOfflineTransport): SemanticGateway<ParsedInterpretation, ContextInput> {
  const config = configSchema.parse(rawConfig);
  const route = config.primary;
  if (!route || route.model !== "google/gemini-2.5-flash-lite" || route.provider !== "google-vertex/eu" || !route.requireZdr
    || route.promptPriceMicrounitsPerMillionTokens !== 100000 || route.completionPriceMicrounitsPerMillionTokens !== 400000
    || config.freePrimary || config.paidFallback || config.maxInputTokens !== 12000 || config.maxOutputTokens !== 1536
    || config.maxResponseBytes !== 32768 || config.timeoutMs !== 30000) throw new TypeError("Invalid context gateway configuration");
  const offline = typeof transport === "function" ? null : offlineSchema.safeParse(transport);
  let cursor = 0;
  return { prepare(tier, rawInput) {
    if (tier !== "PRIMARY") return { status: "FAILURE", category: "UNAVAILABLE" };
    const input = ContextInputSchema.safeParse(rawInput);
    if (!input.success || input.data.turns[input.data.currentTurn].text.length > config.maxInputChars
      || input.data.turns.some(t => t.role === "USER" && [...t.text].length > 2000)
      || sensitiveValue(input.data) || containsForbiddenControl(input.data, [])) return { status: "FAILURE", category: "INVALID_INPUT" };
    // Fail before exposing a reservation amount. No env flag/caller assertion
    // can convert local token measurements into full-route admission.
    if (!offline?.success) return { status: "FAILURE", category: "ROUTE_ADMISSION_UNVERIFIED" };
    const wire = serializeContextRequest(input.data);
    const request: SemanticJsonRequest = { model: route.model, ...wire,
      response_format: { ...wire.response_format, json_schema: { ...wire.response_format.json_schema, strict: true } }, provider: {
      only: [route.provider], allow_fallbacks: false, require_parameters: true, data_collection: "deny", zdr: true,
      max_price: { prompt: 0.1, completion: 0.4 },
    } };
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
        return decodeResponse(fixture.response, config, maximumCostMicrounits, contextSectionsSchema, true);
      },
    };
  } };
}
