import { describe, expect, it } from "vitest";
import { parseOpenRouterRuntimeConfig } from "./config";
describe("OpenRouter runtime configuration", () => {
  it("keeps off independent of a key", () => expect(parseOpenRouterRuntimeConfig({})).toEqual({ status: "OFF" }));
  it("selects free and bounded explicit economy policies", () => {
    expect(parseOpenRouterRuntimeConfig({ AI_MODE: "free", OPENROUTER_API_KEY: "key" })).toMatchObject({ status: "READY", config: { mode: "free", freeModel: "openrouter/free" } });
    expect(parseOpenRouterRuntimeConfig({ AI_MODE: "economy", OPENROUTER_API_KEY: "key", OPENROUTER_ECONOMY_MODEL: "vendor/model", OPENROUTER_FALLBACK_MODELS: "vendor/fallback" })).toMatchObject({ status: "READY", config: { fallbackModels: ["vendor/fallback"] } });
  });
  it("fails closed for invalid optional configuration", () => expect(parseOpenRouterRuntimeConfig({ AI_MODE: "economy", OPENROUTER_API_KEY: "key" })).toEqual({ status: "UNAVAILABLE" }));
});
