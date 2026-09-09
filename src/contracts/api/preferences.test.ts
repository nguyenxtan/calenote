import { describe, expect, it } from "vitest";

describe("preferences API contract", () => {
  it("publishes only safe presentation preference input and output", async () => {
    const contracts = await import("./preferences").catch(() => null) as {
      PreferencesResponseSchema?: { parse(value: unknown): unknown };
      UpdatePreferencesSchema?: { parse(value: unknown): unknown };
    } | null;

    expect(contracts?.PreferencesResponseSchema?.parse({
      data: { preferences: { addressStyle: "custom", customDisplayName: "Chị Tuyền", tone: "friendly" } },
    })).toEqual({
      data: { preferences: { addressStyle: "custom", customDisplayName: "Chị Tuyền", tone: "friendly" } },
    });
    expect(contracts?.UpdatePreferencesSchema?.parse({
      addressStyle: "custom", customDisplayName: "Chị Tuyền", tone: "professional",
    })).toEqual({ addressStyle: "custom", customDisplayName: "Chị Tuyền", tone: "professional" });
  });

  it("rejects malformed public preference input and output", async () => {
    const contracts = await import("./preferences").catch(() => null) as {
      PreferencesResponseSchema?: { parse(value: unknown): unknown };
      UpdatePreferencesSchema?: { parse(value: unknown): unknown };
    } | null;

    expect(() => contracts?.UpdatePreferencesSchema?.parse({ addressStyle: "friend" })).toThrow();
    expect(() => contracts?.UpdatePreferencesSchema?.parse({ tone: "chatty" })).toThrow();
    expect(() => contracts?.UpdatePreferencesSchema?.parse({ customDisplayName: 7 })).toThrow();
    expect(() => contracts?.PreferencesResponseSchema?.parse({
      data: { preferences: { userId: "secret", addressStyle: "ban", customDisplayName: null, tone: "friendly" } },
    })).toThrow();
  });
});
