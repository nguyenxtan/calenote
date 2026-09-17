import { describe, expect, it } from "vitest";
import { parseOpenRouterRuntimeConfig, parseSemanticRuntimeConfig } from "./config";
describe("OpenRouter runtime configuration", () => {
  it("enables Semantic V1 only for the exact pinned privacy route", () => {
    expect(parseSemanticRuntimeConfig({
      AI_MODE: "privacy",
      OPENROUTER_API_KEY: "key",
      OPENROUTER_PRIVACY_MODEL: "google/gemini-2.5-flash-lite",
      OPENROUTER_PRIVACY_PROVIDER: "google-vertex/eu",
      AI_MAX_PRIVACY_PRICE: "0.4",
    })).toMatchObject({
      status: "READY",
      model: "google/gemini-2.5-flash-lite", provider: "google-vertex/eu", config: { primary: { requireZdr: true } },
    });
  });

  it.each([
    { AI_MODE: "off" },
    { AI_MODE: "free", OPENROUTER_API_KEY: "key" },
    { AI_MODE: "privacy", OPENROUTER_API_KEY: "key", OPENROUTER_PRIVACY_MODEL: "google/gemini-2.5-flash-lite", OPENROUTER_PRIVACY_PROVIDER: "google-vertex", AI_MAX_PRIVACY_PRICE: "0.4" },
    { AI_MODE: "privacy", OPENROUTER_API_KEY: "key", OPENROUTER_PRIVACY_MODEL: "google/gemini-2.5-flash-lite", OPENROUTER_PRIVACY_PROVIDER: "google-vertex/eu", AI_MAX_PRIVACY_PRICE: "0.4", OPENROUTER_FALLBACK_MODELS: "other/model" },
    { AI_MODE: "privacy", OPENROUTER_API_KEY: "key", OPENROUTER_PRIVACY_MODEL: "google/gemini-2.5-flash-lite", OPENROUTER_PRIVACY_PROVIDER: "google-vertex/eu", AI_MAX_PRIVACY_PRICE: "0.05" },
    { AI_MODE: "privacy", OPENROUTER_API_KEY: "key", OPENROUTER_PRIVACY_MODEL: "google/gemini-2.5-flash-lite", OPENROUTER_PRIVACY_PROVIDER: "google-vertex/eu", AI_MAX_PRIVACY_PRICE: "0.4", AI_MAX_INPUT_CHARS: "1801" },
  ])("keeps Semantic V1 unavailable outside the approved privacy route", (env) => {
    expect(parseSemanticRuntimeConfig(env)).not.toMatchObject({ status: "READY" });
  });

  it("keeps off independent of a key", () => expect(parseOpenRouterRuntimeConfig({})).toEqual({ status: "OFF" }));
  it("selects an explicitly pinned, price-capped privacy route", () => {
    expect(parseOpenRouterRuntimeConfig({ AI_MODE: "privacy", OPENROUTER_API_KEY: "key", OPENROUTER_PRIVACY_MODEL: "google/gemini-3.5-flash-lite", OPENROUTER_PRIVACY_PROVIDER: "google-vertex/global/flex", AI_MAX_PRIVACY_PRICE: "1.5" })).toMatchObject({ status: "READY", config: { mode: "privacy", privacyModel: "google/gemini-3.5-flash-lite", privacyProvider: "google-vertex/global/flex", maxPrivacyPrice: 1.5, timeoutMs: 30_000 } });
  });
  it("fails closed when a privacy route is missing its model, endpoint, ceiling, or contains a fallback", () => {
    for (const env of [
      { AI_MODE: "privacy", OPENROUTER_API_KEY: "key", OPENROUTER_PRIVACY_PROVIDER: "google-vertex/global/flex", AI_MAX_PRIVACY_PRICE: "1.5" },
      { AI_MODE: "privacy", OPENROUTER_API_KEY: "key", OPENROUTER_PRIVACY_MODEL: "google/gemini-3.5-flash-lite", AI_MAX_PRIVACY_PRICE: "1.5" },
      { AI_MODE: "privacy", OPENROUTER_API_KEY: "key", OPENROUTER_PRIVACY_MODEL: "google/gemini-3.5-flash-lite", OPENROUTER_PRIVACY_PROVIDER: "google-vertex/global/flex" },
      { AI_MODE: "privacy", OPENROUTER_API_KEY: "key", OPENROUTER_PRIVACY_MODEL: "google/gemini-3.5-flash-lite", OPENROUTER_PRIVACY_PROVIDER: "google-vertex/global/flex", AI_MAX_PRIVACY_PRICE: "1.5", OPENROUTER_FALLBACK_MODELS: "other/model" },
    ]) expect(parseOpenRouterRuntimeConfig(env)).toEqual({ status: "UNAVAILABLE" });
  });
  it("fails closed for deprecated economy or paid fallback configuration", () => {
    expect(parseOpenRouterRuntimeConfig({ AI_MODE: "economy", OPENROUTER_API_KEY: "key" })).toEqual({ status: "UNAVAILABLE" });
    expect(parseOpenRouterRuntimeConfig({ AI_MODE: "free", OPENROUTER_API_KEY: "key", OPENROUTER_FALLBACK_MODELS: "vendor/model" })).toEqual({ status: "UNAVAILABLE" });
    expect(parseOpenRouterRuntimeConfig({ AI_MODE: "free", OPENROUTER_API_KEY: "key" })).toEqual({ status: "UNAVAILABLE" });
  });
});
