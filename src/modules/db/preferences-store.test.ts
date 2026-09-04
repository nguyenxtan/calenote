import { describe, expect, it } from "vitest";
import { D1UserPreferencesStore } from "./preferences-store";

describe("D1UserPreferencesStore", () => {
  it("scopes reads and writes by the authenticated user id", async () => {
    const calls: Array<{ sql: string; binds: unknown[] }> = [];
    const database = {
      prepare(sql: string) {
        return {
          bind(...binds: unknown[]) {
            calls.push({ sql, binds });
            return {
              async first() {
                return null;
              },
              async run() {
                return { meta: { changes: 1 } };
              },
            };
          },
        };
      },
    } as unknown as D1Database;

    const store = new D1UserPreferencesStore(database);
    await store.get("user-1");
    await store.save({
      userId: "user-1",
      addressStyle: "ban",
      customDisplayName: null,
      tone: "friendly",
      updatedAt: 100,
    });

    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.binds.includes("user-1"))).toBe(true);
    expect(calls[0].sql).toMatch(/WHERE preferences\.user_id = \?/i);
    expect(calls[1].sql).toMatch(/ON CONFLICT\s*\(user_id\)/i);
  });
});
