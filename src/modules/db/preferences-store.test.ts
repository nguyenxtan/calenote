import { describe, expect, it } from "vitest";
import { D1UserPreferencesStore } from "./preferences-store";

describe("D1UserPreferencesStore", () => {
  it("persists preview through real SQLite and isolates another account", async () => {
    const { SqliteD1Database } = await import("@/testing/sqlite-d1.test-support");
    const db = new SqliteD1Database({ conversationV2: true });
    try {
      db.sqlite.exec("INSERT INTO users(id,email,display_name,timezone,created_at,updated_at) VALUES('first','first@example.test','First','Asia/Ho_Chi_Minh',1,1),('second','second@example.test','Second','Asia/Ho_Chi_Minh',1,1)");
      const store = new D1UserPreferencesStore(db as unknown as D1Database);
      const { getUserPreferences, saveUserPreferences } = await import("@/modules/preferences/service");
      expect((await getUserPreferences("first", store)).reminderConfirmation).toBe("auto");
      await saveUserPreferences("first", { reminderConfirmation: "preview" }, store, 100);
      expect((await getUserPreferences("first", new D1UserPreferencesStore(db as unknown as D1Database))).reminderConfirmation).toBe("preview");
      expect((await getUserPreferences("second", store)).reminderConfirmation).toBe("auto");
    } finally { db.close(); }
  });
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
