// @vitest-environment node
import { readFileSync } from "node:fs";
import { afterEach, expect, it } from "vitest";
import { makeContextHarness, NOW } from "@/modules/conversation/infrastructure/d1/test-support";
import { createManualReminder } from "../../api-service";
import { D1ReminderApiStore } from "./api-store";

const dispose: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(dispose.splice(0).map(fn => fn())); });
it("real D1 batches atomically fence concurrent manual intents and replay committed requests", async () => {
  const h = await makeContextHarness();
  dispose.push(h.dispose);
  await h.db.prepare(readFileSync("migrations/0010_manual_reminder_intents.sql", "utf8")).run();
  await h.db.batch([
    h.db.prepare("INSERT INTO workspaces (id,kind,owner_user_id,created_at,updated_at) VALUES ('space-one','PERSONAL','one',1,1)"),
    h.db.prepare("INSERT INTO memberships (workspace_id,user_id,role,created_at) VALUES ('space-one','one','OWNER',1)"),
  ]);
  const dependencies = { store: new D1ReminderApiStore(h.db), keyring: h.keyring, rateLimitStore: { consume: async () => ({ allowed: true, resetAt: NOW + 60_000 }) }, now: () => NOW };
  const input = { userId: "one", title: "private fixture", scheduledAt: NOW + 60_000, timezone: "Asia/Ho_Chi_Minh", intentId: "concurrent_intent_1234" };
  const results = await Promise.all(Array.from({ length: 4 }, () => createManualReminder(input, dependencies)));
  expect(new Set(results.map(row => row.publicId)).size).toBe(1);
  expect(await h.db.prepare("SELECT COUNT(*) n FROM reminders").first("n")).toBe(1);
  expect(await h.db.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='REMINDER_CREATED'").first("n")).toBe(1);
  expect(await createManualReminder(input, dependencies)).toEqual(results[0]);
  const racing = { ...input, intentId: "resolve_racing_1234" };
  const race = await Promise.allSettled([
    createManualReminder(racing, dependencies),
    dependencies.store.resolveManualIntent("one", racing.intentId),
  ]);
  const resolved = await dependencies.store.resolveManualIntent("one", racing.intentId);
  if (resolved.state === "ABANDONED") {
    await expect(createManualReminder(racing, dependencies)).rejects.toMatchObject({ code: "REMINDER_INTENT_ABANDONED" });
    expect(race[0].status).toBe("rejected");
  } else {
    expect(await createManualReminder(racing, dependencies)).toMatchObject({ publicId: resolved.publicId });
  }
  expect(await h.db.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='REMINDER_CREATED'").first("n")).toBe(resolved.state === "CREATED" ? 2 : 1);

  await expect(createManualReminder({ ...input, title: "other" }, dependencies)).rejects.toMatchObject({ code: "REMINDER_INTENT_MISMATCH" });
}, 20_000);
