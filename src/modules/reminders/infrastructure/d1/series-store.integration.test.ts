// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeContextHarness, NOW } from "@/modules/conversation/infrastructure/d1/test-support";
import type { PendingRequest } from "@/modules/conversation/contracts";
import { D1SeriesStore } from "./series-store";
import { D1ReminderSchedulerStore } from "./scheduler-store";
import { D1ReminderCommandStore } from "./command-store";

const dispose: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(dispose.splice(0).map(fn => fn())); });
async function harness(count = 3) {
  const h = await makeContextHarness();
  dispose.push(h.dispose);
  // Keep the trigger body together; D1 prepare accepts one complete statement.
  for (const sql of readFileSync(resolve("migrations/0008_finite_reminder_series.sql"), "utf8").split(/;\s*(?=CREATE|--|$)/u).map(s => s.trim()).filter(Boolean)) await h.db.prepare(sql).run();
  await h.db.batch([
    h.db.prepare("INSERT INTO workspaces (id,kind,owner_user_id,created_at,updated_at) VALUES ('space-one','PERSONAL','one',1,1)"),
    h.db.prepare("INSERT INTO memberships (workspace_id,user_id,role,created_at) VALUES ('space-one','one','OWNER',1)"),
  ]);
  const request: PendingRequest = { ...h.initial.request, title: "ôn thi bí mật", eventDate: {
    solarDate: count > 3 ? "2026-11-11" : "2026-10-11", calendar: "GREGORIAN", lunar: null, conversionVersion: null, sourceInboundId: "one-0" },
    reminderTime: "12:00", count, relation: "BEFORE_EVENT", missing: [] };
  const context = { ...h.initial, status: "DRAFT_READY" as const, expiresAt: NOW + 600_000, request };
  expect(await h.store.save(h.scope(), null, context)).toBe("SAVED");
  const series = new D1SeriesStore(h.db, h.keyring);
  const proposal = await series.propose(h.scope(), request, context.id, 1);
  expect(proposal).not.toBeNull();
  const counts = async () => ({
    series: await h.db.prepare("SELECT count(*) n FROM reminder_series").first<number>("n"),
    occurrences: await h.db.prepare("SELECT count(*) n FROM reminder_series_occurrences").first<number>("n"),
    reminders: await h.db.prepare("SELECT count(*) n FROM reminders").first<number>("n"),
  });
  return { ...h, context, request, series, proposal: proposal!, counts,
    confirm: (index = 1) => series.confirm(h.scope(index), proposal!.proposalId, proposal!.revision) };
}
describe("finite series atomic storage", () => {
  it("one proposal commits exactly one series and three children under concurrent confirmation", async () => {
    const h = await harness();
    expect(await h.counts()).toEqual({ series: 0, occurrences: 0, reminders: 0 });
    const results = await Promise.all([h.confirm(), h.confirm(2)]);
    expect(results.some(r => r.status === "CONFIRMED")).toBe(true);
    expect(await h.counts()).toEqual({ series: 1, occurrences: 3, reminders: 3 });
    expect((await h.confirm(3)).status).toBe("ALREADY_CONFIRMED");
    expect(await h.db.prepare("SELECT count(*) n FROM reminder_calendar_facts").first("n")).toBe(3);
    expect(await h.db.prepare("SELECT count(*) n FROM reminders WHERE source_draft_id IS NOT NULL").first("n")).toBe(0);
    expect(await h.db.prepare("SELECT payload_ciphertext FROM conversation_contexts").first("payload_ciphertext")).toBeNull();
  });
  it("a child insert failure rolls back proposal, context, series and every child", async () => {
    const h = await harness();
    await h.db.prepare("CREATE TRIGGER fail_child BEFORE INSERT ON reminder_series_occurrences WHEN NEW.occurrence_index = 1 BEGIN SELECT RAISE(ABORT,'synthetic failure'); END").run();
    await expect(h.confirm()).rejects.toThrow();
    expect(await h.counts()).toEqual({ series: 0, occurrences: 0, reminders: 0 });
    expect(await h.db.prepare("SELECT status FROM reminder_series_proposals").first("status")).toBe("PENDING");
    expect(await h.db.prepare("SELECT status FROM conversation_contexts").first("status")).toBe("DRAFT_READY");
  });
  it("rejects cross-owner, stale claim, same-inbound and wrong revision", async () => {
    const h = await harness();
    for (const scope of [{ ...h.scope(1), ownerId: "two" }, { ...h.scope(1), chatIdentityId: "chat-two" }, { ...h.scope(1), claimMarker: "old" }, h.scope()]) {
      expect((await h.series.confirm(scope, h.proposal.proposalId, 1)).status).toBe("STALE");
    }
    expect((await h.series.confirm(h.scope(1), h.proposal.proposalId, 2)).status).toBe("STALE");
    expect(await h.counts()).toEqual({ series: 0, occurrences: 0, reminders: 0 });
  });
  it("edited or expired context invalidates old proposal", async () => {
    const h = await harness();
    expect(await h.store.save(h.scope(1), 1, { ...h.context, revision: 2 })).toBe("SAVED");
    expect((await h.confirm(2)).status).toBe("STALE");
    expect(await h.counts()).toEqual({ series: 0, occurrences: 0, reminders: 0 });
  });
  it("expired proposal never confirms", async () => {
    const h = await harness();
    expect((await h.series.confirm({ ...h.scope(1), now: NOW + 600_001 }, h.proposal.proposalId, 1)).status).toBe("EXPIRED");
  });
  it("request cannot differ from encrypted reviewed context", async () => {
    const h = await harness();
    expect(await h.series.propose(h.scope(), { ...h.request, count: 10 }, h.context.id, 1)).toBeNull();
  });
  it("proposal and calendar facts contain ciphertext, not plaintext reminder content", async () => {
    const h = await harness();
    await h.confirm();
    const rows = await h.db.prepare("SELECT * FROM reminder_series_proposals").all();
    const facts = await h.db.prepare("SELECT * FROM reminder_calendar_facts").all();
    expect(JSON.stringify([rows.results, facts.results])).not.toContain(h.request.title);
    const first = await h.db.prepare("SELECT id,title_ciphertext,title_iv FROM reminders LIMIT 1").first();
    expect(first).not.toBeNull();
  });
  it("cancel requires a separate proposal and leaves in-flight/uncertain children intact", async () => {
    const h = await harness();
    const created = await h.confirm();
    if (created.status !== "CONFIRMED") throw new Error("Missing confirmation");
    expect(await h.series.cancelRemaining(h.scope(2), created.seriesId, 1)).toBe("STALE");
    const rows = (await h.db.prepare("SELECT reminder_id FROM reminder_series_occurrences ORDER BY occurrence_index").all<{ reminder_id: string }>()).results;
    await h.db.prepare("UPDATE reminders SET status = 'CLAIMED', claimed_at = ? WHERE id = ?").bind(NOW, rows[1].reminder_id).run();
    await h.db.prepare("UPDATE reminders SET status = 'UNCERTAIN' WHERE id = ?").bind(rows[2].reminder_id).run();
    const cancel = await h.series.proposeCancellation(h.scope(2), created.seriesId);
    expect(cancel).not.toBeNull();
    expect(await h.series.cancelRemaining(h.scope(3), cancel!.proposalId, cancel!.revision)).toBe("CANCELLED");
    expect(await h.series.cancelRemaining(h.scope(4), cancel!.proposalId, cancel!.revision)).toBe("ALREADY_CANCELLED");
    const states = (await h.db.prepare("SELECT status FROM reminders ORDER BY scheduled_at").all<{ status: string }>()).results.map(r => r.status);
    expect(states).toEqual(["CANCELLED", "CLAIMED", "UNCERTAIN"]);
    expect((await new D1ReminderSchedulerStore(h.db).selectCandidates(Date.parse("2026-10-20T00:00:00Z"), 50)).some(r => r.id === rows[0].reminder_id)).toBe(false);
  });
  it("cancel proposal is owner-scoped and does not cancel unrelated one-off rows", async () => {
    const h = await harness();
    const created = await h.confirm();
    if (created.status !== "CONFIRMED") throw new Error("Missing confirmation");
    expect(await h.series.proposeCancellation({ ...h.scope(2), ownerId: "two" }, created.seriesId)).toBeNull();
    await h.db.prepare("INSERT INTO reminders (id,public_id,workspace_id,chat_identity_id,title_ciphertext,title_iv,title_key_version,scheduled_at,timezone,status,created_at,updated_at) VALUES ('unrelated','unrelated','space-one','chat-one',x'01',zeroblob(12),1,?,'Asia/Ho_Chi_Minh','PENDING',1,1)").bind(NOW + 86400000).run();
    const cancel = await h.series.proposeCancellation(h.scope(2), created.seriesId);
    await h.series.cancelRemaining(h.scope(3), cancel!.proposalId, cancel!.revision);
    expect(await h.db.prepare("SELECT status FROM reminders WHERE id = 'unrelated'").first("status")).toBe("PENDING");
  });
  it("a new pending conversation prevents an ambiguous cancellation confirmation", async () => {
    const h = await harness();
    const created = await h.confirm();
    if (created.status !== "CONFIRMED") throw new Error("Missing confirmation");
    const cancel = await h.series.proposeCancellation(h.scope(2), created.seriesId);
    expect(await h.store.save(h.scope(3), null, { ...h.initial, id: "new-request", createdAt: NOW + 3,
      turns: [{ ...h.initial.turns[0], receivedAt: NOW + 3 }] })).toBe("SAVED");
    expect(await h.series.cancelRemaining(h.scope(4), cancel!.proposalId, 1)).toBe("STALE");
  });
  it("compares request structure, not object key insertion order", async () => {
    const h = await harness();
    const reversed = Object.fromEntries(Object.entries(h.request).reverse()) as PendingRequest;
    expect(await h.series.propose(h.scope(), reversed, h.context.id, 1)).toEqual(h.proposal);
  });
  it("legacy one-off confirmation copies encrypted calendar provenance atomically", async () => {
    const h = await harness();
    await h.store.finish(h.scope(1), h.context.id, 1, "CANCELLED");
    const store = new D1ReminderCommandStore(h.db);
    const message = (index: number) => ({ id: `one-${index}`, connectionId: "connection-one", providerUserId: "provider-one", privateChatId: "private-one", claimMarker: "claim", receivedAt: NOW + index, text: "synthetic" });
    const context = await store.findBoundContext(message(2));
    if (!context) throw new Error("Missing context");
    const draftTitle = await h.keyring.encryptSensitive("draft-title", "lunar-draft", 1, "lễ");
    const calendar = await h.keyring.encryptSensitive("reminder-calendar", JSON.stringify(["one", "chat-one", "lunar-draft"]), 1, JSON.stringify({ lunar: "synthetic" }));
    expect(await store.createDraft({ message: message(2), context, now: NOW + 2, auditId: "create-oneoff", draftId: "lunar-draft", encryptedTitle: draftTitle,
      titleKeyVersion: 1, scheduledAt: NOW + 86400000, timezone: "Asia/Ho_Chi_Minh", expiresAt: NOW + 600000,
      encryptedCalendarFacts: calendar })).toBe("COMMITTED");
    const draft = await store.findPendingDraft(message(3), "chat-one");
    if (!draft) throw new Error("Missing draft");
    const title = await h.keyring.encryptSensitive("reminder-title", "oneoff", 1, "lễ");
    await h.db.prepare("CREATE TRIGGER fail_calendar BEFORE INSERT ON reminder_calendar_facts BEGIN SELECT RAISE(ABORT,'synthetic calendar failure'); END").run();
    const input = { message: message(3), context, now: NOW + 3, auditId: "confirm-oneoff", draft, reminderId: "oneoff", reminderPublicId: "oneoff", encryptedTitle: title, titleKeyVersion: 1 };
    await expect(store.confirmDraft(input)).rejects.toThrow();
    expect(await h.db.prepare("SELECT count(*) n FROM reminders WHERE id = 'oneoff'").first("n")).toBe(0);
    await h.db.prepare("DROP TRIGGER fail_calendar").run();
    expect(await store.confirmDraft(input)).toBe("COMMITTED");
    expect(await h.db.prepare("SELECT encryption_entity_id FROM reminder_calendar_facts WHERE reminder_id = 'oneoff'").first("encryption_entity_id")).toBe("lunar-draft");
  });
  it("cancelled reminder/delivery cannot be claimed by a preselected legacy scheduler candidate", async () => {
    const h = await harness();
    const created = await h.confirm();
    if (created.status !== "CONFIRMED") throw new Error("Missing confirmation");
    const scheduler = new D1ReminderSchedulerStore(h.db);
    const due = Date.parse("2026-10-12T00:00:00Z");
    const candidates = await scheduler.selectCandidates(due, 30);
    expect(candidates).toHaveLength(3);
    await h.db.prepare("INSERT INTO reminder_deliveries (id,reminder_id,status,created_at,updated_at) VALUES ('delivery',?,'PENDING',?,?)")
      .bind(candidates[0].id, NOW, NOW).run();
    const cancel = await h.series.proposeCancellation(h.scope(2), created.seriesId);
    await h.series.cancelRemaining(h.scope(3), cancel!.proposalId, 1);
    expect(await h.db.prepare("SELECT status FROM reminder_deliveries WHERE id = 'delivery'").first("status")).toBe("CANCELLED");
    expect(await scheduler.claim(candidates[0], due, "legacy-claim")).toBeNull();
    expect(await scheduler.selectCandidates(due, 30)).toHaveLength(0);
  });
  it("corrupt proposal fails closed and cannot create any child", async () => {
    const h = await harness();
    await h.db.prepare("UPDATE reminder_series_proposals SET payload_ciphertext = zeroblob(32)").run();
    expect((await h.confirm()).status).toBe("REJECTED");
    expect(await h.counts()).toEqual({ series: 0, occurrences: 0, reminders: 0 });
  });
  it("additive migration replay leaves populated series and historical constraints intact", async () => {
    const h = await harness();
    await h.confirm();
    for (const sql of readFileSync(resolve("migrations/0008_finite_reminder_series.sql"), "utf8").split(/;\s*(?=CREATE|--|$)/u).map(s => s.trim()).filter(Boolean)) await h.db.prepare(sql).run();
    expect(await h.counts()).toEqual({ series: 1, occurrences: 3, reminders: 3 });
    expect(await h.db.prepare("SELECT count(*) n FROM sqlite_master WHERE type = 'index' AND name = 'idx_reminders_source_draft'").first("n")).toBe(1);
  });
  it("legacy draft resolution also purges its transferred V2 context in the same transaction", async () => {
    const h = await harness();
    const request = { ...h.request, count: null, relation: null };
    expect(await h.store.save(h.scope(1), 1, { ...h.context, revision: 2, request })).toBe("SAVED");
    await h.db.prepare("INSERT INTO command_drafts (id,chat_identity_id,source_inbound_id,title_ciphertext,title_iv,title_key_version,scheduled_at,timezone,status,expires_at,created_at,updated_at) VALUES ('transfer','chat-one','one-1',zeroblob(32),zeroblob(12),1,?,'Asia/Ho_Chi_Minh','PENDING',?,?,?)")
      .bind(NOW + 86400000, NOW + 600000, NOW + 1, NOW + 1).run();
    await h.db.prepare("UPDATE command_drafts SET status = 'CANCELLED', resolution_inbound_id = 'one-2', updated_at = ? WHERE id = 'transfer'").bind(NOW + 2).run();
    expect(await h.db.prepare("SELECT status FROM conversation_contexts").first("status")).toBe("CANCELLED");
    expect(await h.db.prepare("SELECT payload_ciphertext FROM conversation_contexts").first("payload_ciphertext")).toBeNull();
    expect(await h.db.prepare("SELECT count(*) n FROM conversation_context_outcomes WHERE source_inbound_id = 'one-2' AND operation = 'FINISH'").first("n")).toBe(1);
  });
  it("30-occurrence confirmation stays below 20 D1 statements, not 96 per invocation", async () => {
    const h = await harness(30);
    const batch = vi.fn((statements: D1PreparedStatement[]) => h.db.batch(statements));
    const traced = new D1SeriesStore({ prepare: h.db.prepare.bind(h.db), batch } as unknown as D1Database, h.keyring);
    expect((await traced.confirm(h.scope(1), h.proposal.proposalId, 1)).status).toBe("CONFIRMED");
    expect(batch.mock.calls[0][0].length).toBeLessThanOrEqual(20);
    expect(await h.counts()).toEqual({ series: 1, occurrences: 30, reminders: 30 });
  });
});
