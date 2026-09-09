import { ActionExtractionSchema, ReminderInterpretationSchema, type IntelligenceGateway, type ReminderInterpretationInput, type ActionExtractionInput } from "../../contracts";

export interface OpenRouterConfig { mode: "free" | "economy"; apiKey: string; freeModel?: string; economyModel?: string; fallbackModels?: readonly string[]; timeoutMs: number; maxInputChars: number; maxOutputTokens: number; }
type Fetcher = (input: string, init: RequestInit) => Promise<Response>;
const endpoint = "https://openrouter.ai/api/v1/chat/completions";

function body(config: OpenRouterConfig, text: string, schema: object, operation: string): object {
  const model = config.mode === "free" ? config.freeModel ?? "openrouter/free" : config.economyModel;
  if (!model) throw new TypeError("Economy model required");
  return { model, ...(config.mode === "economy" && config.fallbackModels?.length ? { models: [model, ...config.fallbackModels] } : {}), messages: [{ role: "system", content: `Return only the supported Calenote ${operation} schema.` }, { role: "user", content: text }], max_tokens: config.maxOutputTokens, response_format: { type: "json_schema", json_schema: { name: operation, strict: true, schema } }, provider: { allow_fallbacks: config.mode !== "free" ? false : false, data_collection: "deny", zdr: true, require_parameters: true } };
}
async function call(config: OpenRouterConfig, fetcher: Fetcher, text: string, schema: object, operation: string): Promise<unknown> {
  if (text.length > config.maxInputChars) return { status: "UNAVAILABLE" };
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try { const response = await fetcher(endpoint, { method: "POST", headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body(config, text, schema, operation)), signal: controller.signal }); if (!response.ok) return { status: "UNAVAILABLE" }; const envelope = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> }; const content = envelope.choices?.[0]?.message?.content; return typeof content === "string" ? JSON.parse(content) : { status: "UNAVAILABLE" }; } catch { return { status: "UNAVAILABLE" }; } finally { clearTimeout(timer); }
}
const reminderSchema = { type: "object", additionalProperties: false };
export function createOpenRouterGateway(config: OpenRouterConfig, fetcher: Fetcher = fetch): IntelligenceGateway {
  if (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 100 || config.timeoutMs > 30_000 || config.maxInputChars < 1 || config.maxOutputTokens < 1) throw new TypeError("Invalid OpenRouter configuration");
  return { interpretReminder: async (input: ReminderInterpretationInput) => { const raw = await call(config, fetcher, input.text, reminderSchema, "reminder_interpretation"); return ReminderInterpretationSchema.safeParse(raw).data ?? { status: "UNAVAILABLE" }; }, extractAction: async (input: ActionExtractionInput) => { const raw = await call(config, fetcher, input.text, reminderSchema, "action_extraction"); return ActionExtractionSchema.safeParse(raw).data ?? { status: "UNAVAILABLE" }; } };
}
