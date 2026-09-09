// All optional AI inputs are absent by default. The API key is set as a
// Cloudflare secret, never via wrangler.jsonc or source control.
interface Env {
  AI_MODE?: "off" | "free" | "economy";
  OPENROUTER_API_KEY?: string;
  OPENROUTER_FREE_MODEL?: string;
  OPENROUTER_ECONOMY_MODEL?: string;
  OPENROUTER_FALLBACK_MODELS?: string;
  AI_TIMEOUT_MS?: string;
  AI_MAX_INPUT_CHARS?: string;
  AI_MAX_OUTPUT_TOKENS?: string;
}
