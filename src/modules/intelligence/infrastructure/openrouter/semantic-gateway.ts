import { z } from "zod";
import { SemanticInterpretationJsonSchema, SemanticInterpretationSchema } from "../../../semantic/contracts";
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
  response_format: { type: "json_schema"; json_schema: { name: string; strict: true; schema: typeof SemanticInterpretationJsonSchema } };
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

function decodeResponse(response: { status: number; body: string; oversized?: boolean }, config: SemanticGatewayConfig,
  maximum: number): SemanticAttemptResult {
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
  const usage = safeUsage(envelope.data.usage, config, maximum);
  let payload: unknown;
  try { payload = JSON.parse(envelope.data.choices[0].message.content); } catch {
    return { status: "FAILURE", category: "INVALID_JSON", usage };
  }
  const semantic = SemanticInterpretationSchema.safeParse(payload);
  return semantic.success ? { status: "SUCCESS", interpretation: semantic.data, usage }
    : { status: "FAILURE", category: "SCHEMA_INVALID", usage };
}

export function createSemanticGateway(rawConfig: SemanticGatewayConfig, transport: SemanticTransport): SemanticGateway {
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
      const parsedInput = SemanticInputSchema.safeParse(rawInput);
      if (!parsedInput.success || parsedInput.data.text.length > config.maxInputChars
        || containsSensitiveInput(parsedInput.data.text)
        || (parsedInput.data.previousContext && "title" in parsedInput.data.previousContext
          && containsSensitiveInput(parsedInput.data.previousContext.title ?? ""))) {
        return { status: "FAILURE", category: "INVALID_INPUT" };
      }
      const route = tier === "PRIMARY" ? config.primary : tier === "FREE_PRIMARY" ? config.freePrimary : config.paidFallback;
      if (!route) return { status: "FAILURE", category: "UNAVAILABLE" };
      const request: SemanticJsonRequest = {
        model: route.model,
        stream: false,
        messages: [{ role: "system", content: CANONICAL_SEMANTIC_PROMPT },
          { role: "user", content: JSON.stringify(parsedInput.data) }],
        max_tokens: config.maxOutputTokens,
        response_format: { type: "json_schema", json_schema: { name: "semantic_interpretation", strict: true, schema: structuredClone(SemanticInterpretationJsonSchema) } },
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
            const timeout = new Promise<SemanticAttemptResult>((resolve) => {
              timer = setTimeout(() => {
                controller.abort();
                resolve({ status: "FAILURE", category: "TIMEOUT" });
              }, config.timeoutMs);
            });
            return await Promise.race([
              Promise.resolve().then(() => transport(request, { signal: controller.signal }))
                .then((response) => decodeResponse(response, config, maximumCostMicrounits)),
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
