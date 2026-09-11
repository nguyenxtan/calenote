import { ActionExtractionSchema, ReminderInterpretationSchema, type ActionExtractionInput, type IntelligenceGateway, type ReminderInterpretationInput } from "../../contracts";

export interface OpenRouterConfig { mode: "free" | "economy"; apiKey: string; freeModel?: string; economyModel?: string; fallbackModels?: readonly string[]; maxFallbackAttempts?: number; maxFallbackPrice?: number; timeoutMs: number; maxInputChars: number; maxOutputTokens: number; }
type Fetcher = (input: string, init: RequestInit) => Promise<Response>;
const endpoint = "https://openrouter.ai/api/v1/chat/completions";
const reminderSchema = { type: "object", additionalProperties: false };

function requestBody(config: OpenRouterConfig, model: string, text: string, schema: object, operation: string): object {
  return { model, messages: [{ role: "system", content: `Return only the supported Calenote ${operation} schema.` }, { role: "user", content: text }], max_tokens: config.maxOutputTokens, response_format: { type: "json_schema", json_schema: { name: operation, strict: true, schema } }, provider: { allow_fallbacks: false, data_collection: "deny", zdr: true, require_parameters: true, ...(config.maxFallbackPrice === undefined ? {} : { max_price: { prompt: config.maxFallbackPrice, completion: config.maxFallbackPrice } }) } };
}

function isAvailabilityFailure(status: number): boolean { return status === 408 || status === 429 || status >= 500; }

async function requestModel(config: OpenRouterConfig, fetcher: Fetcher, model: string, text: string, schema: object, operation: string): Promise<{ status: "SUCCESS"; raw: unknown } | { status: "RETRYABLE" | "UNAVAILABLE" }> {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetcher(endpoint, { method: "POST", headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(requestBody(config, model, text, schema, operation)), signal: controller.signal });
    if (!response.ok) return { status: isAvailabilityFailure(response.status) ? "RETRYABLE" : "UNAVAILABLE" };
    const envelope = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = envelope.choices?.[0]?.message?.content;
    if (typeof content !== "string") return { status: "UNAVAILABLE" };
    try { return { status: "SUCCESS", raw: JSON.parse(content) }; } catch { return { status: "UNAVAILABLE" }; }
  } catch { return { status: "RETRYABLE" }; } finally { clearTimeout(timer); }
}

async function call(config: OpenRouterConfig, fetcher: Fetcher, text: string, schema: object, operation: string): Promise<unknown> {
  if (text.length > config.maxInputChars) return { status: "UNAVAILABLE" };
  const primary = config.mode === "free" ? config.freeModel ?? "openrouter/free" : config.economyModel;
  if (!primary) return { status: "UNAVAILABLE" };
  const models = [primary, ...(config.fallbackModels ?? []).slice(0, Math.min(config.maxFallbackAttempts ?? 0, config.fallbackModels?.length ?? 0))];
  for (const model of models) {
    const result = await requestModel(config, fetcher, model, text, schema, operation);
    if (result.status === "SUCCESS") return result.raw;
    if (result.status === "UNAVAILABLE") return { status: "UNAVAILABLE" };
  }
  return { status: "UNAVAILABLE" };
}

export function createOpenRouterGateway(config: OpenRouterConfig, fetcher: Fetcher = fetch): IntelligenceGateway {
  if (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 100 || config.timeoutMs > 30_000 || config.maxInputChars < 1 || config.maxOutputTokens < 1 || (config.maxFallbackAttempts !== undefined && (!Number.isInteger(config.maxFallbackAttempts) || config.maxFallbackAttempts < 0 || config.maxFallbackAttempts > 3)) || (config.maxFallbackPrice !== undefined && (!Number.isFinite(config.maxFallbackPrice) || config.maxFallbackPrice <= 0))) throw new TypeError("Invalid OpenRouter configuration");
  return { interpretReminder: async (input: ReminderInterpretationInput) => { const raw = await call(config, fetcher, input.text, reminderSchema, "reminder_interpretation"); return ReminderInterpretationSchema.safeParse(raw).data ?? { status: "UNAVAILABLE" }; }, extractAction: async (input: ActionExtractionInput) => { const raw = await call(config, fetcher, input.text, reminderSchema, "action_extraction"); return ActionExtractionSchema.safeParse(raw).data ?? { status: "UNAVAILABLE" }; } };
}
