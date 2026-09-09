import type { OpenRouterConfig } from "./gateway";

export type OpenRouterRuntimeConfig = { status: "OFF" } | { status: "UNAVAILABLE" } | { status: "READY"; config: OpenRouterConfig };
const model = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._:-]+$/u;
export function parseOpenRouterRuntimeConfig(env: Partial<Record<"AI_MODE" | "OPENROUTER_API_KEY" | "OPENROUTER_FREE_MODEL" | "OPENROUTER_ECONOMY_MODEL" | "OPENROUTER_FALLBACK_MODELS" | "AI_TIMEOUT_MS" | "AI_MAX_INPUT_CHARS" | "AI_MAX_OUTPUT_TOKENS", string>>): OpenRouterRuntimeConfig {
  const mode = env.AI_MODE ?? "off";
  if (mode === "off") return { status: "OFF" };
  if (mode !== "free" && mode !== "economy") return { status: "UNAVAILABLE" };
  const number = (value: string | undefined, fallback: number, max: number) => { const parsed = value === undefined ? fallback : Number(value); return Number.isInteger(parsed) && parsed > 0 && parsed <= max ? parsed : null; };
  const timeoutMs = number(env.AI_TIMEOUT_MS, 5_000, 30_000), maxInputChars = number(env.AI_MAX_INPUT_CHARS, 1_800, 10_000), maxOutputTokens = number(env.AI_MAX_OUTPUT_TOKENS, 256, 1_024);
  const primary = mode === "free" ? env.OPENROUTER_FREE_MODEL ?? "openrouter/free" : env.OPENROUTER_ECONOMY_MODEL;
  const fallbackModels = mode === "economy" && env.OPENROUTER_FALLBACK_MODELS ? env.OPENROUTER_FALLBACK_MODELS.split(",").map((item) => item.trim()).filter(Boolean) : [];
  if (!env.OPENROUTER_API_KEY || !primary || !model.test(primary) || timeoutMs === null || maxInputChars === null || maxOutputTokens === null || fallbackModels.some((item) => !model.test(item) || item === primary) || new Set(fallbackModels).size !== fallbackModels.length) return { status: "UNAVAILABLE" };
  return { status: "READY", config: { mode, apiKey: env.OPENROUTER_API_KEY, ...(mode === "free" ? { freeModel: primary } : { economyModel: primary, fallbackModels }), timeoutMs, maxInputChars, maxOutputTokens } };
}
