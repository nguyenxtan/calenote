import { describe, expect, it } from "vitest";
import { parseOpenRouterRuntimeConfig } from "./config";
describe("OpenRouter runtime configuration", () => {
  it("keeps off independent of a key", () => expect(parseOpenRouterRuntimeConfig({})).toEqual({ status: "OFF" }));
  it("selects free and bounded explicit economy policies", () => {
    expect(parseOpenRouterRuntimeConfig({ AI_MODE: "free", OPENROUTER_API_KEY: "key", OPENROUTER_FALLBACK_MODELS: "cheap/one,cheap/two", AI_MAX_FALLBACK_ATTEMPTS: "1", AI_MAX_FALLBACK_PRICE: "0.01" })).toMatchObject({ status: "READY", config: { mode: "free", freeModel: "openrouter/free", fallbackModels: ["cheap/one", "cheap/two"], maxFallbackAttempts: 1, maxFallbackPrice: 0.01 } });
    expect(parseOpenRouterRuntimeConfig({ AI_MODE: "economy", OPENROUTER_API_KEY: "key", OPENROUTER_ECONOMY_MODEL: "vendor/model", OPENROUTER_FALLBACK_MODELS: "vendor/fallback" })).toMatchObject({ status: "READY", config: { fallbackModels: ["vendor/fallback"] } });
  });
  it("fails closed when a configured free fallback lacks a bounded price policy", () => expect(parseOpenRouterRuntimeConfig({ AI_MODE: "free", OPENROUTER_API_KEY: "key", OPENROUTER_FALLBACK_MODELS: "cheap/one" })).toEqual({ status: "UNAVAILABLE" }));
  it("fails closed for invalid optional configuration", () => expect(parseOpenRouterRuntimeConfig({ AI_MODE: "economy", OPENROUTER_API_KEY: "key" })).toEqual({ status: "UNAVAILABLE" }));
});
