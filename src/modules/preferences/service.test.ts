import { describe, expect, it } from "vitest";
import {
  DEFAULT_USER_PREFERENCES,
  InvalidUserPreferencesError,
  saveUserPreferences,
  type UserPreferences,
  type UserPreferencesStore,
} from "./service";

function storeWith(initial?: UserPreferences): UserPreferencesStore & { saved?: UserPreferences } {
  return {
    saved: undefined,
    async get(userId) {
      return initial?.userId === userId ? initial : null;
    },
    async save(input) {
      this.saved = input;
      return input;
    },
  };
}

describe("user preferences", () => {
  it("uses stable defaults without forcing onboarding", async () => {
    const store = storeWith();

    const result = await saveUserPreferences("user-1", {}, store, 100);

    expect(result).toEqual({ ...DEFAULT_USER_PREFERENCES, userId: "user-1", updatedAt: 100 });
    expect(store.saved).toEqual(result);
  });

  it.each([
    "ban",
    "anh_chi",
    "ong_tui",
    "minh",
    "sep",
  ] as const)("accepts the built-in address style %s", async (addressStyle) => {
    const result = await saveUserPreferences("user-1", { addressStyle }, storeWith(), 100);
    expect(result.addressStyle).toBe(addressStyle);
    expect(result.customDisplayName).toBeNull();
  });

  it("requires and trims a custom display name", async () => {
    const result = await saveUserPreferences(
      "user-1",
      { addressStyle: "custom", customDisplayName: "  Chị Tuyền  " },
      storeWith(),
      100,
    );

    expect(result.addressStyle).toBe("custom");
    expect(result.customDisplayName).toBe("Chị Tuyền");
  });

  it.each([
    { addressStyle: "custom" as const },
    { addressStyle: "ban" as const, customDisplayName: "thừa" },
    { tone: "chatty" as never },
  ])("rejects invalid preference input", async (input) => {
    await expect(saveUserPreferences("user-1", input, storeWith(), 100)).rejects.toBeInstanceOf(
      InvalidUserPreferencesError,
    );
  });

  it("rejects an empty user id before touching the store", async () => {
    const store = storeWith();
    await expect(saveUserPreferences("", {}, store, 100)).rejects.toBeInstanceOf(
      InvalidUserPreferencesError,
    );
    expect(store.saved).toBeUndefined();
  });
});
