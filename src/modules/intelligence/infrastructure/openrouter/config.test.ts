import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseOpenRouterRuntimeConfig, parseSemanticRuntimeConfig } from "./config";
describe("OpenRouter runtime configuration", () => {
  const production = () => JSON.parse(readFileSync("wrangler.jsonc", "utf8"));
  const approved = {
    AI_MODE: "privacy", OPENROUTER_API_KEY: "synthetic-config-test-key",
    OPENROUTER_PRIVACY_MODEL: "google/gemini-2.5-flash-lite",
    OPENROUTER_PRIVACY_PROVIDER: "google-vertex/eu", AI_MAX_PRIVACY_PRICE: "0.4",
  };
  it("loads the canonical production privacy route and approved hard budgets without a secret in vars", () => {
    const config = production();
    expect(config.vars).toMatchObject({
      AI_MODE: "privacy", OPENROUTER_PRIVACY_MODEL: approved.OPENROUTER_PRIVACY_MODEL,
      OPENROUTER_PRIVACY_PROVIDER: approved.OPENROUTER_PRIVACY_PROVIDER,
      OWNER_DAILY_CALL_LIMIT: "50", OWNER_MONTHLY_COST_MICROUNITS: "500000",
      GLOBAL_DAILY_COST_MICROUNITS: "2000000",
    });
    expect(config.vars).not.toHaveProperty("OPENROUTER_API_KEY");
    expect(config.vars).not.toHaveProperty("OPENROUTER_FALLBACK_MODELS");
    expect(config.secrets.required).toContain("OPENROUTER_API_KEY");
    expect(parseSemanticRuntimeConfig(config.vars)).toEqual({ status: "UNAVAILABLE" });
    expect(parseSemanticRuntimeConfig({ ...config.vars, OPENROUTER_API_KEY: approved.OPENROUTER_API_KEY })).toMatchObject({
      status: "READY", model: approved.OPENROUTER_PRIVACY_MODEL, provider: approved.OPENROUTER_PRIVACY_PROVIDER,
      budgetLimits: { ownerDailyFallbackLimit: 50, ownerMonthlyCostMicrounits: 500000, globalDailyCostMicrounits: 2000000 },
      config: { freePrimary: undefined, paidFallback: undefined, primary: { requireZdr: true } },
    });
  });
  it("allows tightening budgets and supplies the approved ceilings when omitted", () => {
    expect(parseSemanticRuntimeConfig(approved)).toMatchObject({ budgetLimits: {
      ownerDailyFallbackLimit: 50, ownerMonthlyCostMicrounits: 500000, globalDailyCostMicrounits: 2000000,
    } });
    expect(parseSemanticRuntimeConfig({ ...approved, OWNER_DAILY_CALL_LIMIT: "1", OWNER_MONTHLY_COST_MICROUNITS: "100", GLOBAL_DAILY_COST_MICROUNITS: "1000" })).toMatchObject({
      status: "READY", budgetLimits: { ownerDailyFallbackLimit: 1, ownerMonthlyCostMicrounits: 100, globalDailyCostMicrounits: 1000 },
    });
  });
  it.each([
    ["OWNER_DAILY_CALL_LIMIT", "51"], ["OWNER_MONTHLY_COST_MICROUNITS", "500001"],
    ["GLOBAL_DAILY_COST_MICROUNITS", "2000001"],
    ...["OWNER_DAILY_CALL_LIMIT", "OWNER_MONTHLY_COST_MICROUNITS", "GLOBAL_DAILY_COST_MICROUNITS"].flatMap((key) =>
      ["0", "-1", "1.5", "NaN", "Infinity", ""].map((value) => [key, value])),
  ])("fails closed for invalid or excessive budget %s=%s", (key, value) => {
    expect(parseSemanticRuntimeConfig({ ...approved, [key]: value })).toEqual({ status: "UNAVAILABLE" });
  });
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
