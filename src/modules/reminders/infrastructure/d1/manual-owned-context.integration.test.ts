// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, expect, it } from "vitest";
import { semanticRuntime } from "@/modules/semantic/infrastructure/d1/runtime.test-support";
import { migrationStatements } from "@/testing/sqlite-d1.test-support";
import { fixture } from "@/modules/conversation/context-contract/infrastructure/d1/test-support";
import { createManualReminder } from "../../api-service";
import { D1ReminderApiStore } from "./api-store";

const disposers: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(disposers.splice(0).map(fn => fn())); });
async function ownedFixture() {
  const { db, runtime } = await semanticRuntime(); disposers.push(() => runtime.dispose());
  for (const file of readdirSync("migrations").filter(x => x.endsWith(".sql")).sort())
    for (const sql of migrationStatements(readFileSync(`migrations/${file}`, "utf8"))) if (sql.replace(/--[^\n]*/gu, "").trim()) await db.prepare(sql).run();
  const f = await fixture(db);
  expect((await f.save()).result.status).toBe("APPLIED");
  const now = f.scope().now;
  return { ...f, now, deps: { store: new D1ReminderApiStore(db), keyring: f.keyring, rateLimitStore: { consume: async () => ({ allowed: true, resetAt: now + 60_000 }) }, now: () => now } };
}
it("authenticated manual create works after conversation ownership and retries the same intent once", async () => {
  const f = await ownedFixture();
  const input = { userId: "owner", title: "QA manual after chat", scheduledAt: f.now + 60_000, timezone: "Asia/Ho_Chi_Minh", intentId: "manual-owned-12345678" };
  const saved = await createManualReminder(input, f.deps);
  expect(saved).toMatchObject({ status: "PENDING", title: "QA manual after chat", scheduledAt: f.now + 60_000 });
  expect(await createManualReminder(input, f.deps)).toEqual(saved);
  expect(await f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(1);
  expect(await f.db.prepare("SELECT count(*) n FROM follow_through_items").first("n")).toBe(1);
  expect(await f.db.prepare("SELECT count(*) n FROM conversation_contract_write_permits").first("n")).toBe(0);
  expect(await f.db.prepare("SELECT count(*) n FROM manual_reminder_write_permits").first("n")).toBe(0);
}, 20_000);
it("another account cannot select the owned channel or insert directly after chat ownership", async () => {
  const f = await ownedFixture();
  await f.db.prepare("UPDATE bot_connections SET public_id='aaaaaaaaaaaaaaaaaaaaaa' WHERE id='connection'").run();
  await f.db.prepare("INSERT INTO users VALUES('other','other@example.test','Other','Asia/Ho_Chi_Minh',1,1)").run();
  await expect(createManualReminder({ userId: "other", title: "QA forged channel", scheduledAt: f.now + 60_000, timezone: "Asia/Ho_Chi_Minh", intentId: "manual-other-12345678", connectionPublicId: "aaaaaaaaaaaaaaaaaaaaaa" }, f.deps)).rejects.toMatchObject({ code: "REMINDER_CHANNEL_UNAVAILABLE" });
  await expect(f.db.prepare("INSERT INTO reminders(id,public_id,workspace_id,chat_identity_id,title_ciphertext,title_iv,title_key_version,scheduled_at,timezone,status,created_at,updated_at) VALUES('forged','forged','workspace','identity',x'01',zeroblob(12),1,?,'Asia/Ho_Chi_Minh','PENDING',1,1)").bind(f.now + 60_000).run()).rejects.toThrow("CONTEXT_CONTRACT_FENCE");
  await expect(f.db.batch([
    f.db.prepare("INSERT INTO manual_reminder_write_permits VALUES('forged','other','workspace','identity','wrong-owner-marker')"),
    f.db.prepare("INSERT INTO reminders(id,public_id,workspace_id,chat_identity_id,title_ciphertext,title_iv,title_key_version,scheduled_at,timezone,status,created_at,updated_at,context_write_marker) VALUES('forged','forged','workspace','identity',x'01',zeroblob(12),1,?,'Asia/Ho_Chi_Minh','PENDING',1,1,'wrong-owner-marker')").bind(f.now + 60_000),
  ])).rejects.toThrow("CONTEXT_CONTRACT_FENCE");
  expect(await f.db.prepare("SELECT count(*) n FROM manual_reminder_write_permits").first("n")).toBe(0);
  expect(await f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
}, 20_000);
