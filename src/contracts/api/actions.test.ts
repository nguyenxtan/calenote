import { describe, expect, it } from "vitest";

describe("actions API contract", () => {
  it("publishes only the pending candidate and decision response shapes", async () => {
    const contracts = await import("./actions").catch(() => null) as {
      ActionsResponseSchema?: { parse(value: unknown): unknown };
      ActionDecisionResponseSchema?: { parse(value: unknown): unknown };
    } | null;

    expect(contracts?.ActionsResponseSchema?.parse({ data: { actions: [{
      id: "A".repeat(22), title: "Họp khách hàng", scheduledAt: 1_800_000_000_000,
      timezone: "Asia/Ho_Chi_Minh", status: "PENDING",
    }] } })).toBeDefined();
    expect(contracts?.ActionDecisionResponseSchema?.parse({
      data: { decision: "APPROVED", reminderPublicId: "B".repeat(22) },
    })).toBeDefined();
  });

  it("rejects secret fields and malformed public action output", async () => {
    const contracts = await import("./actions").catch(() => null) as {
      ActionsResponseSchema?: { parse(value: unknown): unknown };
      ActionDecisionResponseSchema?: { parse(value: unknown): unknown };
    } | null;

    expect(() => contracts?.ActionsResponseSchema?.parse({ data: { actions: [{
      id: "short", title: "", scheduledAt: 1.5, timezone: "UTC", status: "APPROVED", title_ciphertext: "secret",
    }] } })).toThrow();
    expect(() => contracts?.ActionDecisionResponseSchema?.parse({ data: { decision: "REJECTED", reminderPublicId: "B".repeat(22) } })).toThrow();
  });
});
