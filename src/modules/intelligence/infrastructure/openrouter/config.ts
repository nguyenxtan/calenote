import type { OpenRouterConfig } from "./gateway";

export type OpenRouterRuntimeConfig = { status: "OFF" } | { status: "UNAVAILABLE" } | { status: "READY"; config: OpenRouterConfig };
const model = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._:-]+$/u;
const provider = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._:-]+)+$/u;
export function parseOpenRouterRuntimeConfig(env: Partial<Record<"AI_MODE" | "OPENROUTER_API_KEY" | "OPENROUTER_FREE_MODEL" | "OPENROUTER_PRIVACY_MODEL" | "OPENROUTER_PRIVACY_PROVIDER" | "OPENROUTER_FALLBACK_MODELS" | "AI_TIMEOUT_MS" | "AI_MAX_INPUT_CHARS" | "AI_MAX_OUTPUT_TOKENS" | "AI_MAX_PRIVACY_PRICE", string>>): OpenRouterRuntimeConfig {
  const mode = env.AI_MODE ?? "off";
  if (mode === "off") return { status: "OFF" };
  if (mode !== "free" && mode !== "privacy") return { status: "UNAVAILABLE" };
  // No free route is currently eligible for mandatory ZDR. A future explicit
  // safe/redacted boundary must prove eligibility before this becomes READY.
  if (mode === "free") return { status: "UNAVAILABLE" };
  const number = (value: string | undefined, fallback: number, max: number) => { const parsed = value === undefined ? fallback : Number(value); return Number.isInteger(parsed) && parsed > 0 && parsed <= max ? parsed : null; };
  const timeoutMs = number(env.AI_TIMEOUT_MS, 5_000, 30_000), maxInputChars = number(env.AI_MAX_INPUT_CHARS, 1_800, 10_000), maxOutputTokens = number(env.AI_MAX_OUTPUT_TOKENS, 256, 1_024);
  const primary = env.OPENROUTER_PRIVACY_MODEL;
  const privacyPrice = env.AI_MAX_PRIVACY_PRICE === undefined ? undefined : Number(env.AI_MAX_PRIVACY_PRICE);
  const validPrivacyPrice = privacyPrice !== undefined && Number.isFinite(privacyPrice) && privacyPrice > 0;
  if (!env.OPENROUTER_API_KEY || !primary || !model.test(primary) || timeoutMs === null || maxInputChars === null || maxOutputTokens === null || env.OPENROUTER_FALLBACK_MODELS || (mode === "privacy" && (!env.OPENROUTER_PRIVACY_PROVIDER || !provider.test(env.OPENROUTER_PRIVACY_PROVIDER) || !validPrivacyPrice))) return { status: "UNAVAILABLE" };
  return { status: "READY", config: { mode, apiKey: env.OPENROUTER_API_KEY, privacyModel: primary, privacyProvider: env.OPENROUTER_PRIVACY_PROVIDER!, maxPrivacyPrice: privacyPrice!, timeoutMs, maxInputChars, maxOutputTokens } };
}
