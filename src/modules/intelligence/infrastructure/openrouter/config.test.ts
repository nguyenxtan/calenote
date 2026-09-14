import { describe, expect, it } from "vitest";
import { parseOpenRouterRuntimeConfig } from "./config";
describe("OpenRouter runtime configuration", () => {
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
