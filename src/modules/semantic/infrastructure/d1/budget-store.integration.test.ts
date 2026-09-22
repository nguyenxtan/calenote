// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Miniflare } from "miniflare";
import { D1SemanticBudgetStore } from "./budget-store";
import { applySemanticMigration, NOW, seedSemanticRuntime, semanticRuntime } from "./runtime.test-support";

const limits = {
  ownerDailyFallbackLimit: 3,
  ownerMonthlyCostMicrounits: 300,
  globalDailyCostMicrounits: 300,
  maxInputTokens: 100,
  maxOutputTokens: 100,
  promptPriceMicrounitsPerMillionTokens: 500_000,
  completionPriceMicrounitsPerMillionTokens: 500_000,
  reservationTtlMs: 60_000,
};
let db: D1Database;
let runtime: Miniflare;
let directory: string;
const request = (index: number, ownerId = "one", now = NOW) => ({
  ownerId, sourceInboundId: `${ownerId}-${index}`, now,
});
const store = (overrides = {}) => new D1SemanticBudgetStore(db, { ...limits, ...overrides });
const windows = () => db.prepare(`SELECT kind, scope_id, reserved_calls, finalized_calls,
  reserved_microunits, finalized_microunits FROM semantic_budget_windows ORDER BY kind, scope_id`).all();

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "calenote-budget-d1-"));
  ({ db, runtime } = await semanticRuntime(directory));
  await seedSemanticRuntime(db);
}, 20_000);
afterEach(async () => {
  await runtime?.dispose();
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe("atomic paid budgets on disposable workerd D1", () => {
  it.each([
    { OWNER_DAILY_CALL_LIMIT: "1" },
    { OWNER_MONTHLY_COST_MICROUNITS: "1303" },
    { GLOBAL_DAILY_COST_MICROUNITS: "1303" },
  ])("enforces canonical config through real composition and D1 with tightened limit %j", async (override) => {
    const { createSemanticCapability } = await import("@/worker/composition-root");
    const config = JSON.parse(await readFile("wrangler.jsonc", "utf8"));
    const capability = await createSemanticCapability({
      ...config.vars, ...override, DB: db,
      CALENOTE_MASTER_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      OPENROUTER_API_KEY: "synthetic-never-dispatched",
    });
    expect(capability.mode).toBe("privacy");
    const results = await Promise.all([0, 1].map((index) => capability.budgetStore.reservePaidCall(request(index))));
    expect(results.filter((result) => result.status === "RESERVED")).toEqual([
      expect.objectContaining({ reservedMaximumMicrounits: 1303 }),
    ]);
    expect(results.filter((result) => result.status === "BUDGET_EXHAUSTED")).toHaveLength(1);
    for (const row of (await windows()).results) {
      expect(row).toMatchObject({ reserved_calls: 1, reserved_microunits: 1303, finalized_microunits: 0 });
    }
  });

  it("reserves the deterministic ceiling across all windows and reapplying migration preserves it", async () => {
    const result = await store().reservePaidCall(request(0));
    expect(result).toMatchObject({ status: "RESERVED", reservedMaximumMicrounits: 100 });
    await applySemanticMigration(db);
    expect((await windows()).results).toEqual([
      { kind: "GLOBAL_DAILY", scope_id: "global", reserved_calls: 1, finalized_calls: 0, reserved_microunits: 100, finalized_microunits: 0 },
      { kind: "USER_DAILY", scope_id: "one", reserved_calls: 1, finalized_calls: 0, reserved_microunits: 100, finalized_microunits: 0 },
      { kind: "USER_MONTHLY", scope_id: "one", reserved_calls: 1, finalized_calls: 0, reserved_microunits: 100, finalized_microunits: 0 },
    ]);
  });

  it.each([
    { ownerDailyFallbackLimit: 1 },
    { ownerMonthlyCostMicrounits: 100 },
    { globalDailyCostMicrounits: 100 },
  ])("admits exactly one of 12 concurrent contenders at limit %j", async (override) => {
    const results = await Promise.all(Array.from({ length: 12 }, (_, index) =>
      store(override).reservePaidCall(request(index))));
    expect(results.filter((result) => result.status === "RESERVED")).toHaveLength(1);
    expect(results.filter((result) => result.status === "BUDGET_EXHAUSTED")).toHaveLength(11);
    for (const row of (await windows()).results) {
      expect(row).toMatchObject({ reserved_calls: 1, reserved_microunits: 100, finalized_microunits: 0 });
    }
    expect(await db.prepare("SELECT count(*) AS count FROM semantic_budget_reservations").first()).toEqual({ count: 1 });
  });

  it("shares global capacity across owners without consuming the losing owner's windows", async () => {
    const results = await Promise.all([store({ globalDailyCostMicrounits: 100 }).reservePaidCall(request(0)),
      store({ globalDailyCostMicrounits: 100 }).reservePaidCall(request(0, "two"))]);
    expect(results.filter((result) => result.status === "RESERVED")).toHaveLength(1);
    const totals = await db.prepare(`SELECT SUM(reserved_calls) AS calls,
      SUM(reserved_microunits) AS cost FROM semantic_budget_windows WHERE kind = 'USER_DAILY'`).first();
    expect(totals).toEqual({ calls: 1, cost: 100 });
  });

  it("rolls back earlier increments when the final reservation insert fails ownership", async () => {
    expect(await store().reservePaidCall({ ...request(0), sourceInboundId: "two-0" }))
      .toEqual({ status: "BUDGET_EXHAUSTED" });
    expect((await windows()).results.every((row) => row.reserved_calls === 0)).toBe(true);
    expect(await db.prepare("SELECT count(*) AS count FROM semantic_budget_reservations").first()).toEqual({ count: 0 });
  });

  it("never authorizes a second paid call for a duplicate inbound, including races and terminal replay", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => store().reservePaidCall(request(0))));
    const acquired = results.filter((result) => result.status === "RESERVED");
    expect(acquired).toHaveLength(1);
    const result = acquired[0];
    if (result.status !== "RESERVED") throw new Error("Expected reservation");
    await store().finalizeUsage({ ownerId: "one", reservationId: result.reservationId, actualCostMicrounits: null, now: NOW + 1 });
    expect(await store().reservePaidCall(request(0))).toEqual({ status: "BUDGET_EXHAUSTED" });
    expect(await db.prepare("SELECT count(*) AS count FROM semantic_budget_reservations").first()).toEqual({ count: 1 });
  });

  it("finalizes known cost exactly once and unknown usage at the full reserved maximum", async () => {
    const first = await store().reservePaidCall(request(0));
    const second = await store().reservePaidCall(request(1));
    if (first.status !== "RESERVED" || second.status !== "RESERVED") throw new Error("Expected reservations");
    await Promise.all(Array.from({ length: 8 }, () => store().finalizeUsage({ ownerId: "one", reservationId: first.reservationId, actualCostMicrounits: 20, now: NOW + 1 })));
    await store().finalizeUsage({ ownerId: "one", reservationId: second.reservationId, actualCostMicrounits: null, now: NOW + 1 });
    for (const row of (await windows()).results) {
      expect(row).toMatchObject({ reserved_calls: 0, finalized_calls: 2, reserved_microunits: 0, finalized_microunits: 120 });
    }
  });

  it("retains finalized daily count and monthly cost when later reservations hit limits", async () => {
    const budget = store({ ownerDailyFallbackLimit: 1 });
    const first = await budget.reservePaidCall(request(0));
    if (first.status !== "RESERVED") throw new Error("Expected reservation");
    await budget.finalizeUsage({ ownerId: "one", reservationId: first.reservationId, actualCostMicrounits: 0, now: NOW + 1 });
    expect(await budget.reservePaidCall(request(1))).toEqual({ status: "BUDGET_EXHAUSTED" });
    const second = await store().reservePaidCall(request(2));
    if (second.status !== "RESERVED") throw new Error("Expected reservation");
    await store().finalizeUsage({ ownerId: "one", reservationId: second.reservationId, actualCostMicrounits: 100, now: NOW + 2 });
    expect(await store({ ownerMonthlyCostMicrounits: 199 }).reservePaidCall(request(3, "one", NOW + 86_400_000)))
      .toEqual({ status: "BUDGET_EXHAUSTED" });
  });

  it("recovers crashed expiry exactly once before reserve and never refunds a finalized reservation", async () => {
    const budget = store({ globalDailyCostMicrounits: 100 });
    const first = await budget.reservePaidCall(request(0));
    if (first.status !== "RESERVED") throw new Error("Expected reservation");
    expect(await budget.releaseOrExpireReservation({ ownerId: "one", reservationId: first.reservationId, reason: "EXPIRED", now: NOW + 59_999 })).toBe(false);
    const results = await Promise.all(Array.from({ length: 8 }, (_, index) =>
      store({ globalDailyCostMicrounits: 100 }).reservePaidCall(request(index + 1, "one", NOW + 60_000))));
    expect(results.filter((result) => result.status === "RESERVED")).toHaveLength(1);
    expect(await db.prepare("SELECT state FROM semantic_budget_reservations WHERE id = ?").bind(first.reservationId).first()).toEqual({ state: "EXPIRED" });
    for (const row of (await windows()).results) expect(row.reserved_microunits).toBe(100);
    expect(await budget.releaseOrExpireReservation({ ownerId: "one", reservationId: first.reservationId, reason: "SAFE_FAILURE", now: NOW + 60_001 })).toBe(false);
  });

  it("releases a safely failed request once and rejects foreign-owner settlement", async () => {
    const first = await store().reservePaidCall(request(0));
    if (first.status !== "RESERVED") throw new Error("Expected reservation");
    expect(await store().finalizeUsage({ ownerId: "two", reservationId: first.reservationId, actualCostMicrounits: 0, now: NOW + 1 })).toBe(false);
    const released = await Promise.all(Array.from({ length: 8 }, () => store().releaseOrExpireReservation({ ownerId: "one", reservationId: first.reservationId, reason: "SAFE_FAILURE", now: NOW + 1 })));
    expect(released.filter(Boolean)).toHaveLength(1);
    for (const row of (await windows()).results) expect(row).toMatchObject({ reserved_calls: 0, reserved_microunits: 0, finalized_microunits: 0 });
    expect(await store().finalizeUsage({ ownerId: "one", reservationId: first.reservationId, actualCostMicrounits: 20, now: NOW + 1 })).toBe(false);
  });

  it("rounds reservation cost upward and rejects invalid/overflowing configuration", async () => {
    expect(await store({ maxInputTokens: 1, maxOutputTokens: 1, promptPriceMicrounitsPerMillionTokens: 1, completionPriceMicrounitsPerMillionTokens: 1 }).reservePaidCall(request(0)))
      .toMatchObject({ status: "RESERVED", reservedMaximumMicrounits: 1 });
    for (const override of [{ reservationTtlMs: 0 }, { reservationTtlMs: 900_001 }, { ownerDailyFallbackLimit: -1 }, { maxInputTokens: Number.MAX_SAFE_INTEGER }, { maxOutputTokens: 0 }]) {
      expect(() => store(override)).toThrow("Invalid semantic budget configuration");
    }
  });

  it("conservatively settles invalid provider costs and enforces database non-negative checks", async () => {
    for (const [index, actualCostMicrounits] of [NaN, -1, 101].entries()) {
      const reservation = await store().reservePaidCall(request(index));
      if (reservation.status !== "RESERVED") throw new Error("Expected reservation");
      await store().finalizeUsage({ ownerId: "one", reservationId: reservation.reservationId, actualCostMicrounits, now: NOW + 1 });
    }
    for (const row of (await windows()).results) expect(row.finalized_microunits).toBe(300);
    await expect(db.prepare("UPDATE semantic_budget_windows SET reserved_microunits = -1").run()).rejects.toThrow();
  });

  it("recovers persisted reservations after a real runtime restart with a bounded reaper", async () => {
    const first = await store().reservePaidCall(request(0));
    const second = await store().reservePaidCall(request(1));
    expect(first.status).toBe("RESERVED");
    expect(second.status).toBe("RESERVED");
    await runtime.dispose();
    ({ db, runtime } = await semanticRuntime(directory));
    expect(await store().reapExpiredReservations(NOW + 60_000, 1)).toBe(1);
    for (const row of (await windows()).results) expect(row.reserved_microunits).toBe(100);
    expect(await store().reapExpiredReservations(NOW + 60_000, 1)).toBe(1);
    expect(await store().reapExpiredReservations(NOW + 60_000, 1)).toBe(0);
    for (const row of (await windows()).results) expect(row.reserved_microunits).toBe(0);
    expect(await store().reservePaidCall(request(0, "one", NOW + 60_000))).toEqual({ status: "BUDGET_EXHAUSTED" });
  });

  it("settles a finalize/expiry race once, preserving exact counters for the winner", async () => {
    const reservation = await store().reservePaidCall(request(0));
    if (reservation.status !== "RESERVED") throw new Error("Expected reservation");
    const results = await Promise.all([
      store().finalizeUsage({ ownerId: "one", reservationId: reservation.reservationId, actualCostMicrounits: 20, now: NOW + 60_000 }),
      store().releaseOrExpireReservation({ ownerId: "one", reservationId: reservation.reservationId, reason: "EXPIRED", now: NOW + 60_000 }),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const row = await db.prepare("SELECT state FROM semantic_budget_reservations").first();
    for (const window of (await windows()).results) {
      expect(window).toMatchObject({ reserved_calls: 0, reserved_microunits: 0,
        finalized_calls: row?.state === "FINALIZED" ? 1 : 0,
        finalized_microunits: row?.state === "FINALIZED" ? 20 : 0 });
    }
    expect(await store().releaseOrExpireReservation({ ownerId: "one", reservationId: reservation.reservationId, reason: "SAFE_FAILURE", now: NOW + 60_001 })).toBe(false);
  });

  it("grants only one durable dispatch claim and denies foreign owners, replays, and expired reservations", async () => {
    const reservation = await store().reservePaidCall(request(0));
    if (reservation.status !== "RESERVED") throw new Error("Expected reservation");
    const dispatch = { ownerId: "one", reservationId: reservation.reservationId, now: NOW + 1 };
    expect(await store().markDispatched({ ...dispatch, ownerId: "two" })).toBe(false);
    const contenders = await Promise.all(Array.from({ length: 8 }, () => store().markDispatched(dispatch)));
    expect(contenders.filter(Boolean)).toHaveLength(1);
    expect(await store().markDispatched(dispatch)).toBe(false);
    const second = await store().reservePaidCall(request(1));
    if (second.status !== "RESERVED") throw new Error("Expected reservation");
    expect(await store().markDispatched({ ...dispatch, reservationId: second.reservationId, now: NOW + 60_000 })).toBe(false);
  });

  it.each([
    { ownerDailyFallbackLimit: 1 },
    { ownerMonthlyCostMicrounits: 100 },
    { globalDailyCostMicrounits: 100 },
  ])("retains a possibly billed call after dispatch/crash/restart/expiry at hard limit %j", async (override) => {
    const reservation = await store(override).reservePaidCall(request(0));
    if (reservation.status !== "RESERVED") throw new Error("Expected reservation");
    expect(await store(override).markDispatched({ ownerId: "one", reservationId: reservation.reservationId, now: NOW + 1 })).toBe(true);
    await runtime.dispose();
    ({ db, runtime } = await semanticRuntime(directory));
    expect(await store(override).reservePaidCall(request(1, "one", NOW + 60_000))).toEqual({ status: "BUDGET_EXHAUSTED" });
    for (const window of (await windows()).results) {
      expect(window).toMatchObject({ reserved_calls: 0, reserved_microunits: 0, finalized_calls: 1, finalized_microunits: 100 });
    }
    expect(await db.prepare("SELECT state, finalized_microunits FROM semantic_budget_reservations WHERE id = ?").bind(reservation.reservationId).first())
      .toEqual({ state: "FINALIZED", finalized_microunits: 100 });
    expect(await store().releaseOrExpireReservation({ ownerId: "one", reservationId: reservation.reservationId, reason: "SAFE_FAILURE", now: NOW + 60_001 })).toBe(false);
    expect(await store().markDispatched({ ownerId: "one", reservationId: reservation.reservationId, now: NOW + 60_001 })).toBe(false);
  });

  it("settles late known usage once after conservative expiry, retaining the paid-call count", async () => {
    const budget = store({ ownerDailyFallbackLimit: 1 });
    const reservation = await budget.reservePaidCall(request(0));
    if (reservation.status !== "RESERVED") throw new Error("Expected reservation");
    expect(await budget.markDispatched({ ownerId: "one", reservationId: reservation.reservationId, now: NOW + 1 })).toBe(true);
    expect(await budget.releaseOrExpireReservation({ ownerId: "one", reservationId: reservation.reservationId, reason: "SAFE_FAILURE", now: NOW + 2 })).toBe(false);
    expect(await budget.reapExpiredReservations(NOW + 60_000)).toBe(1);
    const usage = { ownerId: "one", reservationId: reservation.reservationId, actualCostMicrounits: 20, now: NOW + 60_001 };
    expect(await budget.finalizeUsage({ ...usage, ownerId: "two" })).toBe(false);
    const settled = await Promise.all(Array.from({ length: 8 }, () => budget.finalizeUsage(usage)));
    expect(settled.filter(Boolean)).toHaveLength(1);
    expect(await budget.finalizeUsage({ ...usage, actualCostMicrounits: 10 })).toBe(false);
    for (const window of (await windows()).results) expect(window).toMatchObject({ reserved_calls: 0, reserved_microunits: 0, finalized_calls: 1, finalized_microunits: 20 });
    expect(await budget.reservePaidCall(request(1, "one", NOW + 60_002))).toEqual({ status: "BUDGET_EXHAUSTED" });
  });

  it("conservatively finalizes unknown dispatched usage and permits one later known settlement", async () => {
    const reservation = await store().reservePaidCall(request(0));
    if (reservation.status !== "RESERVED") throw new Error("Expected reservation");
    expect(await store().markDispatched({ ownerId: "one", reservationId: reservation.reservationId, now: NOW + 1 })).toBe(true);
    const usage = { ownerId: "one", reservationId: reservation.reservationId, actualCostMicrounits: null, now: NOW + 2 };
    expect(await store().finalizeUsage(usage)).toBe(true);
    expect(await store().finalizeUsage(usage)).toBe(false);
    for (const window of (await windows()).results) expect(window.finalized_microunits).toBe(100);
    expect(await store().finalizeUsage({ ...usage, actualCostMicrounits: 30 })).toBe(true);
    expect(await store().finalizeUsage({ ...usage, actualCostMicrounits: 0 })).toBe(false);
    for (const window of (await windows()).results) expect(window).toMatchObject({ finalized_calls: 1, finalized_microunits: 30 });
  });

  it("keeps known usage exact when settlement races the dispatched expiry reaper", async () => {
    const reservation = await store().reservePaidCall(request(0));
    if (reservation.status !== "RESERVED") throw new Error("Expected reservation");
    expect(await store().markDispatched({ ownerId: "one", reservationId: reservation.reservationId, now: NOW + 1 })).toBe(true);
    await Promise.all([
      store().reapExpiredReservations(NOW + 60_000),
      store().finalizeUsage({ ownerId: "one", reservationId: reservation.reservationId, actualCostMicrounits: 20, now: NOW + 60_000 }),
    ]);
    for (const window of (await windows()).results) expect(window).toMatchObject({ reserved_calls: 0, reserved_microunits: 0, finalized_calls: 1, finalized_microunits: 20 });
  });

  it("serializes safe release against dispatch so a refunded reservation cannot dispatch", async () => {
    const reservation = await store().reservePaidCall(request(0));
    if (reservation.status !== "RESERVED") throw new Error("Expected reservation");
    const scope = { ownerId: "one", reservationId: reservation.reservationId, now: NOW + 1 };
    const [dispatched, released] = await Promise.all([
      store().markDispatched(scope),
      store().releaseOrExpireReservation({ ...scope, reason: "SAFE_FAILURE" }),
    ]);
    expect(Number(dispatched) + Number(released)).toBe(1);
    for (const window of (await windows()).results) expect(window.reserved_microunits).toBe(dispatched ? 100 : 0);
    expect(await store().markDispatched(scope)).toBe(false);
  });

  it("migrates legacy reservation uncertainty conservatively and keeps dispatch evidence on migration replay", async () => {
    const reservation = await store().reservePaidCall(request(0));
    if (reservation.status !== "RESERVED") throw new Error("Expected reservation");
    // Disposable fixture only: simulate an already-applied 0005 database before 0006.
    await db.prepare("DROP TABLE semantic_budget_dispatches").run();
    await applySemanticMigration(db);
    await applySemanticMigration(db);
    expect(await store().markDispatched({ ownerId: "one", reservationId: reservation.reservationId, now: NOW + 1 })).toBe(false);
    expect(await db.prepare("SELECT count(*) AS count FROM semantic_budget_dispatches").first()).toEqual({ count: 1 });
    expect(await store().reapExpiredReservations(NOW + 60_000)).toBe(1);
    for (const window of (await windows()).results) expect(window).toMatchObject({ reserved_calls: 0, reserved_microunits: 0, finalized_calls: 1, finalized_microunits: 100 });
  });
});
