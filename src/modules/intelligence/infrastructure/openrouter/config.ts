import type { OpenRouterConfig } from "./gateway";
import type { ContextRouteAdmission, SemanticGatewayConfig } from "./semantic-gateway";
import type {SemanticBudgetLimits as KeyedBudgetLimits} from '../../../semantic/budget-store';

export const SEMANTIC_BUDGET_CEILINGS = Object.freeze({
  ownerDailyFallbackLimit: 50,
  ownerMonthlyCostMicrounits: 500_000,
  globalDailyCostMicrounits: 2_000_000,
  reservationTtlMs: 300_000,
});
type BudgetEnvironmentKey = "OWNER_DAILY_CALL_LIMIT" | "OWNER_MONTHLY_COST_MICROUNITS" | "GLOBAL_DAILY_COST_MICROUNITS";
type SemanticBudgetLimits = { [K in keyof typeof SEMANTIC_BUDGET_CEILINGS]: number };

export type OpenRouterRuntimeConfig = { status: "OFF" } | { status: "UNAVAILABLE" } | { status: "READY"; config: OpenRouterConfig };
export type SemanticRuntimeConfig = { status: "OFF" } | { status: "UNAVAILABLE" } | {
  status: "READY";
  apiKey: string;
  model: "google/gemini-2.5-flash-lite";
  provider: "google-vertex/eu";
  budgetLimits: SemanticBudgetLimits;
  config: SemanticGatewayConfig;
};
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
  const timeoutMs = number(env.AI_TIMEOUT_MS, 30_000, 30_000), maxInputChars = number(env.AI_MAX_INPUT_CHARS, 1_800, 10_000), maxOutputTokens = number(env.AI_MAX_OUTPUT_TOKENS, 256, 1_024);
  const primary = env.OPENROUTER_PRIVACY_MODEL;
  const privacyPrice = env.AI_MAX_PRIVACY_PRICE === undefined ? undefined : Number(env.AI_MAX_PRIVACY_PRICE);
  const validPrivacyPrice = privacyPrice !== undefined && Number.isFinite(privacyPrice) && privacyPrice > 0;
  if (!env.OPENROUTER_API_KEY || !primary || !model.test(primary) || timeoutMs === null || maxInputChars === null || maxOutputTokens === null || env.OPENROUTER_FALLBACK_MODELS || (mode === "privacy" && (!env.OPENROUTER_PRIVACY_PROVIDER || !provider.test(env.OPENROUTER_PRIVACY_PROVIDER) || !validPrivacyPrice))) return { status: "UNAVAILABLE" };
  return { status: "READY", config: { mode, apiKey: env.OPENROUTER_API_KEY, privacyModel: primary, privacyProvider: env.OPENROUTER_PRIVACY_PROVIDER!, maxPrivacyPrice: privacyPrice!, timeoutMs, maxInputChars, maxOutputTokens } };
}

/** Semantic V1 has exactly one production route: the reviewed ZDR Gemini Vertex endpoint. */
export function parseSemanticRuntimeConfig(env: Partial<Record<BudgetEnvironmentKey | "AI_MODE" | "OPENROUTER_API_KEY" | "OPENROUTER_PRIVACY_MODEL" | "OPENROUTER_PRIVACY_PROVIDER" | "OPENROUTER_FALLBACK_MODELS" | "AI_TIMEOUT_MS" | "AI_MAX_INPUT_CHARS" | "AI_MAX_OUTPUT_TOKENS" | "AI_MAX_PRIVACY_PRICE", string>>): SemanticRuntimeConfig {
  const base = parseOpenRouterRuntimeConfig(env);
  if (base.status === "OFF") return base;
  if (base.status !== "READY" || base.config.mode !== "privacy"
    || base.config.privacyModel !== "google/gemini-2.5-flash-lite"
    || base.config.privacyProvider !== "google-vertex/eu"
    || base.config.maxInputChars > 1_800
    || base.config.maxPrivacyPrice === undefined
    || base.config.maxPrivacyPrice < 0.4) return { status: "UNAVAILABLE" };
  // Config may tighten the approved hard limits, never raise or disable them.
  const limit = (key: BudgetEnvironmentKey, ceiling: number) => {
    const value = env[key] === undefined ? ceiling : Number(env[key]);
    return Number.isSafeInteger(value) && value > 0 && value <= ceiling ? value : null;
  };
  const ownerDailyFallbackLimit = limit("OWNER_DAILY_CALL_LIMIT", SEMANTIC_BUDGET_CEILINGS.ownerDailyFallbackLimit);
  const ownerMonthlyCostMicrounits = limit("OWNER_MONTHLY_COST_MICROUNITS", SEMANTIC_BUDGET_CEILINGS.ownerMonthlyCostMicrounits);
  const globalDailyCostMicrounits = limit("GLOBAL_DAILY_COST_MICROUNITS", SEMANTIC_BUDGET_CEILINGS.globalDailyCostMicrounits);
  if (ownerDailyFallbackLimit === null || ownerMonthlyCostMicrounits === null || globalDailyCostMicrounits === null) return { status: "UNAVAILABLE" };
  return {
    status: "READY",
    apiKey: base.config.apiKey,
    model: "google/gemini-2.5-flash-lite",
    provider: "google-vertex/eu",
    budgetLimits: { ownerDailyFallbackLimit, ownerMonthlyCostMicrounits, globalDailyCostMicrounits, reservationTtlMs: SEMANTIC_BUDGET_CEILINGS.reservationTtlMs },
    config: {
      maxInputChars: base.config.maxInputChars,
      maxInputTokens: 12_000,
      maxOutputTokens: base.config.maxOutputTokens,
      maxResponseBytes: 20_000,
      timeoutMs: base.config.timeoutMs,
      primary: {
        model: "google/gemini-2.5-flash-lite",
        provider: "google-vertex/eu",
        requireZdr: true,
        promptPriceMicrounitsPerMillionTokens: 100_000,
        completionPriceMicrounitsPerMillionTokens: 400_000,
      },
      freePrimary: undefined,
      paidFallback: undefined,
    },
  };
}

export type ContextContractRuntimeConfig = Exclude<SemanticRuntimeConfig, { status: "READY" }>
  | (Extract<SemanticRuntimeConfig, { status: "READY" }> & { routeAdmission: ContextRouteAdmission });
/** Opt-in parser only; no production composition calls it. Reuse route/budget
 * checks with the legacy output default, then apply the separate exact wire cap.
 * READY describes configuration only, never full-route token admission. */
export function parseContextContractRuntimeConfig(env: Parameters<typeof parseSemanticRuntimeConfig>[0]): ContextContractRuntimeConfig {
  if ((env.AI_MODE ?? "off") === "off") return { status: "OFF" };
  if ((env.AI_MAX_OUTPUT_TOKENS !== undefined && env.AI_MAX_OUTPUT_TOKENS !== "1536")
    || (env.AI_TIMEOUT_MS !== undefined && env.AI_TIMEOUT_MS !== "30000")) return { status: "UNAVAILABLE" };
  const legacy = parseSemanticRuntimeConfig({ ...env, AI_MAX_OUTPUT_TOKENS: undefined });
  if (legacy.status !== "READY") return legacy;
  return { ...legacy, routeAdmission: { status: "UNVERIFIED" }, config: {
    ...legacy.config, maxInputTokens: 12000, maxOutputTokens: 1536, maxResponseBytes: 32768, timeoutMs: 30000,
  } };
}

export type KeyedContextRuntimeConfig={status:'OFF'|'UNAVAILABLE'}|{status:'READY';apiKey:string;model:'openai/gpt-5-mini';provider:'azure/swedencentral';budgetLimits:KeyedBudgetLimits};
/** Exact qualified keyed139 route. Other profiles remain unavailable here. */
export function parseKeyedContextRuntimeConfig(env:Parameters<typeof parseSemanticRuntimeConfig>[0]):KeyedContextRuntimeConfig {
 if((env.AI_MODE??'off')==='off')return {status:'OFF'};
 if(env.AI_MODE!=='privacy'||!env.OPENROUTER_API_KEY?.trim()
  ||env.OPENROUTER_PRIVACY_MODEL!=='openai/gpt-5-mini'||env.OPENROUTER_PRIVACY_PROVIDER!=='azure/swedencentral'
  ||env.OPENROUTER_FALLBACK_MODELS||(env.AI_MAX_PRIVACY_PRICE??'2.2')!=='2.2'
  ||(env.AI_TIMEOUT_MS??'45000')!=='45000'||(env.AI_MAX_INPUT_CHARS??'1800')!=='1800'
  ||(env.AI_MAX_OUTPUT_TOKENS??'3072')!=='3072')return {status:'UNAVAILABLE'};
 const limit=(key:BudgetEnvironmentKey,ceiling:number)=>{const value=env[key]===undefined?ceiling:Number(env[key]);return Number.isSafeInteger(value)&&value>0&&value<=ceiling?value:null;};
 const daily=limit('OWNER_DAILY_CALL_LIMIT',50),monthly=limit('OWNER_MONTHLY_COST_MICROUNITS',500000),global=limit('GLOBAL_DAILY_COST_MICROUNITS',2000000);
 if(daily===null||monthly===null||global===null)return {status:'UNAVAILABLE'};
 return {status:'READY',apiKey:env.OPENROUTER_API_KEY,model:'openai/gpt-5-mini',provider:'azure/swedencentral',budgetLimits:{ownerDailyFallbackLimit:daily,ownerMonthlyCostMicrounits:monthly,globalDailyCostMicrounits:global,reservationTtlMs:300000,maxInputTokens:16000,reservationInputTokenExposure:400000,maxOutputTokens:3072,promptPriceMicrounitsPerMillionTokens:275000,completionPriceMicrounitsPerMillionTokens:2200000}};
}
