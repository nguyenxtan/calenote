import { describe, expect, it } from "vitest";
import { fixture, now } from "@/modules/conversation/context-contract/infrastructure/d1/test-support";
import { addConfirmationToken } from "@/modules/conversation/context-contract/confirmation-test-support";
import { listDetailedReminders } from "./details-api-service";
import { D1ReminderApiStore } from "./infrastructure/d1/api-store";

describe("owner reminder details", () => {
  it("keeps a legacy reminder in the OWNER list with null details and excludes another owner", async () => {
    const f = await fixture();
    try {
      const encrypted = await f.keyring.encryptSensitive("reminder-title", "legacy", 1, "Gọi cho mẹ");
      await f.db.prepare(`INSERT INTO reminders(id,public_id,workspace_id,chat_identity_id,title_ciphertext,title_iv,title_key_version,
        scheduled_at,timezone,status,created_at,updated_at) VALUES('legacy','legacy-public','workspace','identity',?,?,1,?,
        'Asia/Ho_Chi_Minh','PENDING',1,1)`).bind(encrypted.ciphertext, encrypted.iv, now + 100000).run();
      const dependencies = { store: new D1ReminderApiStore(f.db), contextStore: f.store, keyring: f.keyring };
      const owner = await listDetailedReminders({ sessionId: "session", userId: "owner", expiresAt: now + 1_000_000 }, dependencies);
      expect(owner.reminders).toMatchObject([{ publicId: "legacy-public", title: "Gọi cho mẹ", details: null }]);
      expect((await listDetailedReminders({ sessionId: "session", userId: "intruder", expiresAt: now + 1_000_000 }, dependencies)).reminders).toEqual([]);
    } finally { f.close(); }
  });
  it("returns only complete records under the 128KiB client ceiling and marks the bounded remainder", async () => {
    const rows = Array.from({ length: 101 }, (_, i) => ({ id: `r${i}`, public_id: `public-${i}`,
      title_ciphertext: new ArrayBuffer(0), title_iv: new ArrayBuffer(0), title_key_version: 1,
      scheduled_at: now + i, timezone: "Asia/Ho_Chi_Minh" as const, status: "PENDING" as const,
      owner_id: "owner", chat_identity_id: "identity", workspace_id: "workspace", connection_id: "connection", private_chat_id: "chat", has_context_details: 0 }));
    const result = await listDetailedReminders({ sessionId: "session", userId: "owner", expiresAt: now + 1_000_000 }, {
      store: { listOwnedDetailed: async (_owner, limit) => rows.slice(0, limit) },
      keyring: { decryptSensitive: async () => "🙂".repeat(1800) },
      contextStore: { readReminderDetails: async () => null },
    });
    expect(result.reminders.length).toBeGreaterThan(1);
    expect(result.reminders.length).toBeLessThan(100);
    expect(result.reminders.every(row => row.title === "🙂".repeat(1800))).toBe(true);
    expect(result.hasMore).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify({ data: result })).length).toBeLessThanOrEqual(128 * 1024);
  });

  it("reads complete confirmed details through the real owner/session and encrypted T4 store", async () => {
    const f = await fixture();
    try {
      await addConfirmationToken(f);
      const observed = await f.store.observe(f.scope());
      if ("failure" in observed) throw new Error(observed.failure);
      const applied = await f.store.apply(f.scope(), observed.observation, f.transition);
      expect(applied.status).toBe("APPLIED");
      const confirmed = await f.store.confirm({ kind: "WEB", principal: { sessionId: "session", userId: "owner", expiresAt: now + 1_000_000 }, chat: f.snapshot.scope }, f.proof);
      expect(confirmed.status).toBe("COMMITTED");
      const before = await Promise.all([
        f.db.prepare("SELECT id,revision,status,updated_at FROM conversation_contexts").all(),
        f.db.prepare("SELECT id,status,updated_at FROM reminders ORDER BY id").all(),
        f.db.prepare("SELECT context_id,revision,operation FROM conversation_context_outcomes ORDER BY revision").all(),
      ]);
      const result = await listDetailedReminders({ sessionId: "session", userId: "owner", expiresAt: now + 1_000_000 }, {
        store: new D1ReminderApiStore(f.db), contextStore: f.store, keyring: f.keyring,
      });
      expect(result.reminders).toHaveLength(2);
      expect(result.reminders[0].title).toBe(f.preview.title);
      expect(result.reminders[0].details).toEqual(f.preview.details);
      expect(result.scope).toBe("OWNER");
      expect(result.hasMore).toBe(false);
      expect(await Promise.all([
        f.db.prepare("SELECT id,revision,status,updated_at FROM conversation_contexts").all(),
        f.db.prepare("SELECT id,status,updated_at FROM reminders ORDER BY id").all(),
        f.db.prepare("SELECT context_id,revision,operation FROM conversation_context_outcomes ORDER BY revision").all(),
      ])).toEqual(before);
      await f.db.prepare("UPDATE bot_connections SET state='SUSPENDED' WHERE id='connection'").run();
      const disconnected = await listDetailedReminders({ sessionId: "session", userId: "owner", expiresAt: now + 1_000_000 }, {
        store: new D1ReminderApiStore(f.db), contextStore: f.store, keyring: f.keyring,
      });
      expect(disconnected.reminders[0].details).toEqual(f.preview.details);
      await f.db.prepare("UPDATE sessions SET revoked_at=? WHERE id='session'").bind(now).run();
      await expect(listDetailedReminders({ sessionId: "session", userId: "owner", expiresAt: now + 1_000_000 }, {
        store: new D1ReminderApiStore(f.db), contextStore: f.store, keyring: f.keyring,
      })).rejects.toThrow("INVALID_CONTEXT_DETAILS");
    } finally { f.close(); }
  });
});
