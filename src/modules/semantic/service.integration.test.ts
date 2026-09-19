// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Miniflare } from "miniflare";
import { createSemanticService, type SemanticAttemptStore } from "./service";
import { createSemanticGateway, type SemanticTransport } from "../intelligence/infrastructure/openrouter/semantic-gateway";
import { D1SemanticBudgetStore } from "./infrastructure/d1/budget-store";
import { NOW, seedSemanticRuntime, semanticRuntime } from "./infrastructure/d1/runtime.test-support";

const limits = {
  ownerDailyFallbackLimit: 1, ownerMonthlyCostMicrounits: 6_128, globalDailyCostMicrounits: 6_128,
  maxInputTokens: 12_000, maxOutputTokens: 256,
  promptPriceMicrounitsPerMillionTokens: 500_000, completionPriceMicrounitsPerMillionTokens: 500_000,
  reservationTtlMs: 60_000,
};
let db: D1Database;
let runtime: Miniflare;
let clock: number;
let attempts: SemanticAttemptStore;
beforeEach(async () => {
  ({ db, runtime } = await semanticRuntime());
  await seedSemanticRuntime(db);
  clock = NOW;
  // Shared storage fake survives recreation of router instances. Task 5 must
  // supply the durable inbound lifecycle implementation, never this fake.
  const claimed = new Set<string>();
  attempts = { claimInbound: async ({ sourceInboundId }) => {
    if (claimed.has(sourceInboundId)) return false;
    claimed.add(sourceInboundId);
    return true;
  } };
}, 20_000);
afterEach(async () => { await runtime?.dispose(); });

const input = (index: number) => ({ ownerId: "one", sourceInboundId: `one-${index}`, text: "nhắc việc",
  referenceTime: NOW, processingNow: clock, timezone: "Asia/Ho_Chi_Minh" as const });
function service(transport: SemanticTransport, overrides = {}) {
  const route = { model: "fixture/paid", provider: "fixture-provider", requireZdr: true,
    promptPriceMicrounitsPerMillionTokens: 500_000, completionPriceMicrounitsPerMillionTokens: 500_000 };
  return createSemanticService({ mode: "semantic", paidFallbackEnabled: true, attemptStore: attempts, now: () => clock,
    budgetStore: new D1SemanticBudgetStore(db, { ...limits, ...overrides }),
    gateway: createSemanticGateway({ maxInputChars: 1_800, maxInputTokens: 12_000, maxOutputTokens: 256,
      maxResponseBytes: 20_000, timeoutMs: 1_000, paidFallback: route,
      freePrimary: { ...route, model: "fixture/free", promptPriceMicrounitsPerMillionTokens: 0, completionPriceMicrounitsPerMillionTokens: 0 } }, transport),
  });
}
const success = { status: 200, body: JSON.stringify({ choices: [{ message: { content: '{"intent":"HELP","title":null,"titleState":"NOT_APPLICABLE","targetIntent":null}' }, finish_reason: "stop" }] }) };

describe("semantic router with atomic local D1 budgets", () => {
  it.each([
    { ownerDailyFallbackLimit: 1, ownerMonthlyCostMicrounits: 99_999, globalDailyCostMicrounits: 99_999 },
    { ownerDailyFallbackLimit: 30, ownerMonthlyCostMicrounits: 6_128, globalDailyCostMicrounits: 99_999 },
    { ownerDailyFallbackLimit: 30, ownerMonthlyCostMicrounits: 99_999, globalDailyCostMicrounits: 6_128 },
  ])("dispatches only one paid request among concurrent fallbacks at hard limit %j", async (override) => {
    let freeCalls = 0, paidCalls = 0;
    const transport: SemanticTransport = async (request) => {
      if (request.model === "fixture/free") { freeCalls++; return { status: 503, body: "" }; }
      paidCalls++;
      return success;
    };
    const outcomes = await Promise.all(Array.from({ length: 12 }, (_, index) => service(transport, override).interpret(input(index))));
    expect(freeCalls).toBe(12);
    expect(paidCalls).toBe(1);
    expect(outcomes.filter((result) => result.kind === "SAFE_HELP" && result.code === "INVALID_SEMANTIC_INTERPRETATION")).toHaveLength(1);
    expect(outcomes.filter((result) => result.kind === "SAFE_HELP" && result.code === "BUDGET_EXHAUSTED")).toHaveLength(11);
    const rows = await db.prepare("SELECT reserved_calls, finalized_calls, reserved_microunits, finalized_microunits FROM semantic_budget_windows").all();
    for (const row of rows.results) expect(row).toEqual({ reserved_calls: 0, finalized_calls: 1, reserved_microunits: 0, finalized_microunits: 6_128 });
  });

  it("reclaims an undispatched crashed reservation before a new fallback, preserving old inbound idempotency", async () => {
    const budget = new D1SemanticBudgetStore(db, limits);
    const reservation = await budget.reservePaidCall({ ownerId: "one", sourceInboundId: "one-0", now: NOW });
    expect(reservation.status).toBe("RESERVED");
    clock = NOW + 60_000;
    let paidCalls = 0;
    const transport: SemanticTransport = async (request) => {
      if (request.model === "fixture/free") return { status: 503, body: "" };
      paidCalls++;
      return success;
    };
    expect(await service(transport).interpret(input(1))).toEqual({ kind: "SAFE_HELP", code: "INVALID_SEMANTIC_INTERPRETATION" });
    expect(paidCalls).toBe(1);
    expect(await db.prepare("SELECT state FROM semantic_budget_reservations WHERE source_inbound_id = 'one-0'").first()).toEqual({ state: "EXPIRED" });
    expect(await budget.reservePaidCall({ ownerId: "one", sourceInboundId: "one-0", now: clock })).toEqual({ status: "BUDGET_EXHAUSTED" });
  });

  it("finalizes unknown paid transport failure at maximum and never refunds it for the next inbound", async () => {
    let paidCalls = 0;
    const transport: SemanticTransport = async (request) => {
      if (request.model === "fixture/free") return { status: 503, body: "" };
      paidCalls++;
      throw new Error("ambiguous upstream failure");
    };
    expect(await service(transport).interpret(input(0))).toEqual({ kind: "SAFE_HELP", code: "AI_UNAVAILABLE" });
    clock = NOW + 60_000;
    expect(await service(transport).interpret(input(1))).toEqual({ kind: "SAFE_HELP", code: "BUDGET_EXHAUSTED" });
    expect(paidCalls).toBe(1);
    expect(await db.prepare("SELECT state, finalized_microunits FROM semantic_budget_reservations WHERE source_inbound_id = 'one-0'").first())
      .toEqual({ state: "FINALIZED", finalized_microunits: 6_128 });
  });
});
