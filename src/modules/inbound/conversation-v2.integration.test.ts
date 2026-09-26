// @vitest-environment node
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeContextHarness, NOW } from "@/modules/conversation/infrastructure/d1/test-support";
import { createConversationService } from "@/modules/conversation/service";
import { D1ConversationRuntimeStore } from "@/modules/conversation/infrastructure/d1/runtime-store";
import { D1SeriesStore } from "@/modules/reminders/infrastructure/d1/series-store";
import { D1ReminderCommandStore } from "@/modules/reminders/infrastructure/d1/command-store";
import { D1SemanticReminderQueryStore } from "@/modules/reminders/infrastructure/d1/semantic-query-store";
import { D1SemanticBudgetStore } from "@/modules/semantic/infrastructure/d1/budget-store";
import { processBoundChatMessage, type BoundChatMessage } from "@/modules/reminders/command-service";
import { lunarCalendar } from "@/modules/conversation/lunar-calendar";
import type { ConversationModel } from "@/modules/conversation/contracts";
import { createRuntimeOperations } from "@/worker/composition-root";

const disposals: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(disposals.splice(0).map(fn => fn())); });
const create = (extra: Partial<ConversationModel> = {}): ConversationModel => ({ intent: "CREATE_REMINDER", title: "thi hết môn ở Quang Trung",
  titleState: "RESOLVED", targetIntent: null, dialogueAct: "CONTINUE", continuation: "YES", capability: null, ...extra });
let fixture: Awaited<ReturnType<typeof makeContextHarness>>;
// Cold workerd startup, migrations and seed writes belong to fixture setup.
// Keep a fresh database per test and the default 5-second business-test deadline.
beforeEach(async () => {
  const h = await makeContextHarness(); disposals.push(h.dispose);
  for (const sql of readFileSync("migrations/0008_finite_reminder_series.sql", "utf8").split(/;\s*(?=CREATE|--|$)/u).map(s => s.trim()).filter(Boolean)) await h.db.prepare(sql).run();
  await h.db.batch([
    h.db.prepare("INSERT INTO workspaces (id,kind,owner_user_id,created_at,updated_at) VALUES ('space-one','PERSONAL','one',1,1)"),
    h.db.prepare("INSERT INTO memberships (workspace_id,user_id,role,created_at) VALUES ('space-one','one','OWNER',1)"),
  ]);
  fixture = h;
}, 20_000);
async function harness() {
  const h = fixture;
  const commandStore = new D1ReminderCommandStore(h.db);
  const runtimeStore = new D1ConversationRuntimeStore(h.db);
  const seriesStore = new D1SeriesStore(h.db, h.keyring);
  const replies: string[] = [];
  let currentModel = create(); let index = 0; let time = NOW;
  const dispatch = vi.fn(async () => ({ status: "SUCCESS" as const, interpretation: currentModel, usage: { costMicrounits: 1 } }));
  const service = createConversationService({ contextStore: h.store, seriesStore, commandStore, runtimeStore,
    calendar: lunarCalendar, keyring: h.keyring, now: () => time, reply: async text => { replies.push(text); },
    list: input => new D1SemanticReminderQueryStore(h.db).list(input),
    budgetStore: new D1SemanticBudgetStore(h.db, { ownerDailyFallbackLimit: 50, ownerMonthlyCostMicrounits: 500000,
      globalDailyCostMicrounits: 2000000, maxInputTokens: 1000, maxOutputTokens: 256,
      promptPriceMicrounitsPerMillionTokens: 100000, completionPriceMicrounitsPerMillionTokens: 400000, reservationTtlMs: 60000 }),
    gateway: { prepare: () => ({ status: "READY", model: "google/gemini-2.5-flash-lite", provider: "google-vertex/eu", maximumCostMicrounits: 203, dispatch }) },
  });
  const process = (message: BoundChatMessage, v2 = true) => processBoundChatMessage(message, { store: commandStore,
    keyring: h.keyring, now: () => time, reply: async text => { replies.push(text); }, conversation: v2 ? service : undefined });
  const send = async (text: string, model = create(), v2 = true) => {
    currentModel = model; time = NOW + index;
    const message: BoundChatMessage = { id: `one-${index++}`, connectionId: "connection-one", providerUserId: "provider-one",
      privateChatId: "private-one", text, receivedAt: time, claimMarker: "claim" };
    return { result: await process(message, v2), message, reply: replies.at(-1) };
  };
  const count = () => h.db.prepare("SELECT count(*) n FROM reminders").first<number>("n");
  return { ...h, send, process, count, dispatch, replies, seriesStore, runtimeStore, commandStore, service };
}
describe("guarded conversation V2 integration", () => {
  it.each(["telegram", "zalo"] as const)("real %s composition uses V2 and does not wait for typing transport settlement", async provider => {
    const h = await harness();
    const encrypted = await h.keyring.encryptSensitive("inbound-message", "one-0", 1, "thi hết môn ngày 11/10/2026 ở Quang Trung");
    const credential = await h.keyring.encryptCredential("connection-one", provider, 1, "synthetic-token");
    await h.db.prepare("UPDATE bot_connections SET provider=?, encrypted_token = ?, encrypted_token_iv = ? WHERE id = 'connection-one'")
      .bind(provider, credential.ciphertext, credential.iv).run();
    await h.db.prepare("UPDATE inbound_updates SET provider=?, state = 'PENDING', transition_marker = NULL, message_ciphertext = ?, message_iv = ? WHERE id = 'one-0'")
      .bind(provider, encrypted.ciphertext, encrypted.iv).run();
    const config = JSON.parse(readFileSync("wrangler.jsonc", "utf8"));
    const env = { ...config.vars, DB: h.db, JOBS: { send: vi.fn() }, CALENOTE_MASTER_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", OPENROUTER_API_KEY: "synthetic-no-network" } as unknown as Env;
    vi.spyOn(Date, "now").mockReturnValue(NOW + 100);
    let elapsed = 0;
    vi.spyOn(performance, "now").mockImplementation(() => elapsed);
    const claimAttempt = D1ConversationRuntimeStore.prototype.claimAttempt;
    vi.spyOn(D1ConversationRuntimeStore.prototype, "claimAttempt").mockImplementation(async function (this: D1ConversationRuntimeStore, scope) {
      elapsed += 120; return claimAttempt.call(this, scope);
    });
    const safeLogs = vi.spyOn(console, "log").mockImplementation(() => {});
    const requests: Record<string, unknown>[] = [];
    const outbound: string[] = [];
    const tasks: Promise<unknown>[] = []; let typingSignal: AbortSignal | null | undefined; let inferenceStartedBeforeAbort = false;
    await h.db.prepare("INSERT INTO user_preferences (user_id,address_style,tone,updated_at) VALUES ('one','ban','concise',1)").run();
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      if (url === "https://openrouter.ai/api/v1/chat/completions") {
        elapsed += 450;
        inferenceStartedBeforeAbort = !typingSignal?.aborted;
        requests.push(JSON.parse(init.body as string));
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(create()) }, finish_reason: "stop" }] }));
      }
      if (url.endsWith("/sendChatAction")) {
        typingSignal = init.signal;
        expect(JSON.parse(init.body as string)).toEqual({ chat_id: "private-one", action: "typing" });
        expect(init.redirect).toBe("manual");
        return new Promise<Response>((_resolve, reject) => { init.signal?.addEventListener("abort", () => reject(new Error("synthetic deadline")), { once: true }); });
      }
      if (url.startsWith("https://api.telegram.org/") || url.endsWith("/sendMessage")) {
        elapsed += 30;
        outbound.push(JSON.parse(init.body as string).text);
        return new Response(JSON.stringify(provider === "telegram" ? { ok: true, result: { message_id: 1 } } : { ok: true, result: { message_id: "synthetic" } }));
      }
      throw new Error("Unapproved synthetic transport endpoint");
    }));
    const off = await createRuntimeOperations(env);
    expect(off.purgeConversationContexts).toBeUndefined();
    const operations = await createRuntimeOperations(env, { conversationV2: true }, { waitUntil: task => { tasks.push(task); } });
    expect((await operations.processInbound("one-0")).status).toBe("CLARIFICATION_REQUESTED");
    expect(requests).toHaveLength(1);
    expect(requests[0].response_format).toMatchObject({ json_schema: { name: "conversation_semantic_interpretation" } });
    expect(await h.db.prepare("SELECT state FROM inbound_updates WHERE id = 'one-0'").first("state")).toBe("PROCESSED");
    expect(await h.count()).toBe(0);
    expect(outbound).toEqual(["Bạn muốn mình nhắc lúc mấy giờ?"]);
    expect(inferenceStartedBeforeAbort).toBe(true);
    const timings = safeLogs.mock.calls.flatMap(([value]) => {
      if (typeof value !== "string") return [];
      try { const parsed = JSON.parse(value); return parsed.operation === "conversation_timing" ? [parsed] : []; } catch { return []; }
    });
    expect(timings).toContainEqual({ operation: "conversation_timing", stage: "MODEL", elapsedMs: 450 });
    expect(timings.find(value => value.stage === "FINAL_REPLY")?.elapsedMs).toBeGreaterThanOrEqual(600);
    if (provider === "zalo") {
      expect(timings.find(value => value.stage === "TYPING_DISPATCH")?.elapsedMs).toBeGreaterThanOrEqual(120);
      expect(tasks).toHaveLength(1); expect(typingSignal?.aborted).toBe(false);
      await Promise.all(tasks); expect(typingSignal?.aborted).toBe(true);
    }
  });
  it("preserves exam context, previews all dates and creates three children only on explicit confirmation", async () => {
    const h = await harness();
    expect((await h.send("thi hết môn ngày 11/10/2026 ở Quang Trung")).reply).toContain("mấy giờ");
    expect((await h.send("12h trưa, nhắc liên tục 3 ngày")).reply).toContain("tính cả");
    expect(await h.count()).toBe(0);
    const proposal = await h.send("3 ngày trước ngày thi, không tính ngày thi");
    for (const date of ["08/10/2026", "09/10/2026", "10/10/2026"]) expect(proposal.reply).toContain(date);
    expect(await h.count()).toBe(0);
    const confirm = await h.send("có");
    expect(confirm.result.status).toBe("CONFIRMED");
    expect(await h.count()).toBe(3);
    await h.process(confirm.message);
    await h.send("có");
    expect(await h.count()).toBe(3);
    expect(h.dispatch).toHaveBeenCalledTimes(3);
  });
  it("abandons only pending context without restarting the missing-time loop", async () => {
    const h = await harness();
    await h.send("thi ngày 11/10/2026");
    const reply = await h.send("thế thôi", { intent: "HELP", title: null, titleState: "NOT_APPLICABLE", targetIntent: null,
      dialogueAct: "ABANDON", continuation: "YES", capability: null });
    expect(reply.reply).toContain("bỏ yêu cầu");
    expect(await h.db.prepare("SELECT status FROM conversation_contexts").first("status")).toBe("CANCELLED");
    expect(await h.count()).toBe(0);
  });
  it("one-off drafts retain context until the legacy confirmation atomically resolves both", async () => {
    const h = await harness();
    await h.send("mai nhắc gọi mẹ", create({ title: "gọi mẹ" }));
    const proposal = await h.send("9h", create({ title: "gọi mẹ" }));
    expect(proposal.result.status).toBe("DRAFT_CREATED");
    expect(await h.count()).toBe(0);
    expect((await h.send("có")).result.status).toBe("CONFIRMED");
    expect(await h.count()).toBe(1);
    expect(await h.db.prepare("SELECT payload_ciphertext FROM conversation_contexts").first("payload_ciphertext")).toBeNull();
    expect(await h.db.prepare("SELECT count(*) n FROM reminder_calendar_facts").first("n")).toBe(1);
  });
  it("standalone greeting bypasses the model but mixed greeting does not swallow a request", async () => {
    const h = await harness();
    expect((await h.send("Chào bạn!")).reply).toContain("Chào");
    expect(h.dispatch).not.toHaveBeenCalled();
    expect((await h.send("Chào, mai 9h nhắc gọi mẹ", create({ title: "gọi mẹ" }))).result.status).toBe("DRAFT_CREATED");
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    expect(await h.count()).toBe(0);
  });
  it("LIST leaves pending request and reminders unchanged", async () => {
    const h = await harness();
    await h.send("thi ngày 11/10/2026");
    const before = (await h.db.prepare("SELECT * FROM conversation_contexts").all()).results;
    const response = await h.send("mai tui có gì?", { intent: "LIST_REMINDERS", title: null, titleState: "NOT_APPLICABLE",
      targetIntent: null, dialogueAct: "NEW_REQUEST", continuation: "NO", capability: null });
    expect(response.result.status).toBe("REMINDERS_LISTED");
    expect((await h.db.prepare("SELECT * FROM conversation_contexts").all()).results).toEqual(before);
    expect(await h.count()).toBe(0);
  });
  it("a provider failure terminalizes without retrying or losing the pending context", async () => {
    const h = await harness(); await h.send("thi ngày 11/10/2026");
    h.dispatch.mockRejectedValueOnce(new Error("synthetic private provider response"));
    const result = await h.send("12h");
    expect(await h.db.prepare("SELECT state FROM inbound_updates WHERE id = ?").bind(result.message.id).first("state")).toBe("PROCESSED");
    await h.process(result.message);
    expect(h.dispatch).toHaveBeenCalledTimes(2);
    expect(await h.count()).toBe(0);
    expect(h.replies.join(" ")).not.toContain("synthetic private");
  });
  it("current owner/claim authorization precedes any model call", async () => {
    const h = await harness();
    const result = await h.process({ id: "one-0", connectionId: "connection-one", providerUserId: "provider-two",
      privateChatId: "private-one", text: "mai 9h nhắc gọi mẹ", receivedAt: NOW, claimMarker: "claim" });
    expect(result.status).not.toBe("DRAFT_CREATED"); expect(h.dispatch).not.toHaveBeenCalled(); expect(await h.count()).toBe(0);
  });
  it("persisted attempt fence survives reclaim after a crashed attempt", async () => {
    const h = await harness(); const first = await h.send("thi ngày 11/10/2026");
    await h.db.prepare("UPDATE inbound_updates SET state = 'PROCESSING', processed_at = NULL WHERE id = ?").bind(first.message.id).run();
    await h.process(first.message);
    expect(h.dispatch).toHaveBeenCalledTimes(1); expect(await h.count()).toBe(0);
  });
  it("a V1 draft is drained, never silently converted or joined by a second proposal", async () => {
    const h = await harness();
    expect((await h.send("mai 9h nhắc gọi mẹ", create({ title: "gọi mẹ" }), false)).result.status).toBe("DRAFT_CREATED");
    await h.send("thi 11/10/2026, nhắc 3 ngày lúc 12h");
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(await h.db.prepare("SELECT count(*) n FROM command_drafts WHERE status = 'PENDING'").first("n")).toBe(1);
    expect(await h.db.prepare("SELECT count(*) n FROM reminder_series_proposals").first("n")).toBe(0);
  });
  it("V2 one-off edit invalidates the old draft atomically and confirms only the replacement once", async () => {
    const h = await harness();
    await h.send("mai 9h nhắc gọi mẹ", create({ title: "gọi mẹ" }));
    const original = await h.db.prepare("SELECT id FROM command_drafts").first<string>("id");
    const edit = await h.send("đổi 10h", create({ title: "gọi mẹ", dialogueAct: "EDIT" }));
    expect(edit.result.status).toBe("DRAFT_CREATED");
    expect(await h.db.prepare("SELECT status FROM command_drafts WHERE id = ?").bind(original).first("status")).toBe("CANCELLED");
    await h.process(edit.message);
    expect(await h.db.prepare("SELECT count(*) n FROM command_drafts WHERE status = 'PENDING'").first("n")).toBe(1);
    const confirm = await h.send("có");
    expect(confirm.result.status).toBe("CONFIRMED");
    await h.process(confirm.message);
    expect(await h.count()).toBe(1);
    expect(await h.db.prepare("SELECT scheduled_at FROM reminders").first("scheduled_at")).toBe(Date.parse("2026-09-17T10:00:00+07:00"));
  });
  it("greeting, capability and LIST remain nonmutating while a V2 one-off awaits confirmation", async () => {
    const h = await harness();
    await h.send("mai 9h nhắc gọi mẹ", create({ title: "gọi mẹ" }));
    const before = (await h.db.prepare("SELECT * FROM conversation_contexts").all()).results;
    const draft = (await h.db.prepare("SELECT * FROM command_drafts").all()).results;
    expect((await h.send("chào")).reply).toContain("Chào");
    expect((await h.send("có lưu âm lịch không?", { intent: "HELP", title: null, titleState: "NOT_APPLICABLE", targetIntent: null,
      dialogueAct: "CAPABILITY", continuation: "NO", capability: "LUNAR" })).reply).toContain("âm lịch");
    expect((await h.send("mai tui có gì?", { intent: "LIST_REMINDERS", title: null, titleState: "NOT_APPLICABLE", targetIntent: null,
      dialogueAct: "NEW_REQUEST", continuation: "NO", capability: null })).result.status).toBe("REMINDERS_LISTED");
    expect((await h.db.prepare("SELECT * FROM conversation_contexts").all()).results).toEqual(before);
    expect((await h.db.prepare("SELECT * FROM command_drafts").all()).results).toEqual(draft);
    expect(await h.count()).toBe(0);
  });
  it("contextual abandon removes the transferred one-off confirmation authority", async () => {
    const h = await harness();
    await h.send("mai 9h nhắc gọi mẹ", create({ title: "gọi mẹ" }));
    expect((await h.send("thế thôi", { intent: "HELP", title: null, titleState: "NOT_APPLICABLE", targetIntent: null,
      dialogueAct: "ABANDON", continuation: "YES", capability: null })).result.status).toBe("CANCELLED");
    expect(await h.db.prepare("SELECT status FROM command_drafts").first("status")).toBe("CANCELLED");
    await h.send("có"); expect(await h.count()).toBe(0);
  });
  it("a failed old-draft invalidation rolls back the context revision and keeps the original confirmation", async () => {
    const h = await harness();
    await h.send("mai 9h nhắc gọi mẹ", create({ title: "gọi mẹ" }));
    const before = (await h.db.prepare("SELECT * FROM conversation_contexts").all()).results;
    await h.db.prepare(`CREATE TRIGGER injected_invalidation_failure BEFORE UPDATE OF status ON command_drafts
      WHEN OLD.status = 'PENDING' AND NEW.status = 'CANCELLED'
      BEGIN SELECT RAISE(ABORT, 'synthetic invalidation failure'); END`).run();
    expect((await h.send("đổi 10h", create({ title: "gọi mẹ", dialogueAct: "EDIT" }))).result.status).toBe("REJECTED");
    expect((await h.db.prepare("SELECT * FROM conversation_contexts").all()).results).toEqual(before);
    expect(await h.db.prepare("SELECT status FROM command_drafts").first("status")).toBe("PENDING");
    expect((await h.send("có")).result.status).toBe("CONFIRMED");
    expect(await h.count()).toBe(1);
    expect(await h.db.prepare("SELECT scheduled_at FROM reminders").first("scheduled_at")).toBe(Date.parse("2026-09-17T09:00:00+07:00"));
  });
  it.each(["edit-first", "confirm-first", "concurrent"])("stale reads cannot make both a context edit and old-draft confirmation win: %s", async ordering => {
    const h = await harness();
    await h.send("mai 9h nhắc gọi mẹ", create({ title: "gọi mẹ" }));
    const scope = h.scope(1);
    const previous = await h.store.load(scope);
    const message: BoundChatMessage = { id: "one-2", connectionId: "connection-one", providerUserId: "provider-one",
      privateChatId: "private-one", text: "có", receivedAt: NOW + 2, claimMarker: "claim" };
    const context = await h.commandStore.findBoundContext(message);
    const draft = await h.commandStore.findPendingDraft(message, "chat-one");
    if (!previous || !context || !draft) throw new Error("Missing synthetic proposal");
    const encryptedTitle = await h.keyring.encryptSensitive("reminder-title", "race-reminder", 1, "synthetic");
    const edit = () => h.store.save(scope, previous.revision, { ...previous, revision: previous.revision + 1,
      request: { ...previous.request, reminderTime: "10:00" } });
    const confirm = () => h.commandStore.confirmDraft({ message, context, draft, now: NOW + 2, auditId: "race-audit",
      reminderId: "race-reminder", reminderPublicId: "race-public", encryptedTitle, titleKeyVersion: 1, enforceConversationOrder: true });
    const [edited, confirmed] = ordering === "edit-first" ? [await edit(), await confirm()]
      : ordering === "confirm-first" ? await (async () => { const c = await confirm(); return [await edit(), c]; })()
        : await Promise.all([edit(), confirm()]);
    expect(Number(edited === "SAVED") + Number(confirmed === "COMMITTED")).toBe(1);
    expect(await h.count()).toBe(confirmed === "COMMITTED" ? 1 : 0);
  });
  it("pending series can be abandoned without cancelling any already-confirmed reminder", async () => {
    const h = await harness();
    await h.send("thi ngày 11/10/2026 lúc 12h, nhắc 3 ngày trước ngày thi");
    expect((await h.send("hủy")).result.status).toBe("CANCELLED");
    await h.send("có");
    expect(await h.count()).toBe(0);
    expect(await h.db.prepare("SELECT status FROM reminder_series_proposals").first("status")).toBe("CANCELLED");
  });
  it("edited proposal invalidates the old revision rather than silently confirming old dates", async () => {
    const h = await harness();
    await h.send("thi ngày 11/10/2026 lúc 12h, nhắc 3 ngày trước ngày thi");
    const original = await h.db.prepare("SELECT id,revision FROM reminder_series_proposals").first<{ id: string; revision: number }>();
    await h.send("đổi 13h", create({ dialogueAct: "EDIT" }));
    expect((await h.seriesStore.confirm(h.scope(2), original!.id, original!.revision)).status).toBe("STALE");
    await h.send("có");
    expect(await h.count()).toBe(3);
    for (const row of (await h.db.prepare("SELECT scheduled_at FROM reminders").all<{ scheduled_at: number }>()).results)
      expect(new Date(row.scheduled_at).getUTCHours()).toBe(6);
  });
  it("new Gregorian request cannot inherit lunar calendar or prior title/date", async () => {
    const h = await harness();
    await h.send("ngày 15/8/2027 âm lịch nhắc chuẩn bị lễ", create({ title: "chuẩn bị lễ" }));
    const response = await h.send("9h nhắc gọi mẹ", create({ dialogueAct: "NEW_REQUEST", continuation: "NO", title: "gọi mẹ" }));
    expect(response.reply).toContain("ngày nào");
    const pending = await h.store.load(h.scope(2));
    expect(pending?.request).toMatchObject({ calendar: "GREGORIAN", title: "gọi mẹ", eventDate: null, reminderDate: null });
  });
  it("missing V2 schema fails closed with zero provider calls and no V1 fallthrough", async () => {
    const h = await harness();
    await h.db.prepare("DROP TABLE reminder_series_proposals").run();
    expect((await h.send("mai 9h nhắc gọi mẹ")).result.status).toBe("REJECTED");
    expect(h.dispatch).not.toHaveBeenCalled(); expect(await h.count()).toBe(0);
    expect(await h.db.prepare("SELECT state FROM inbound_updates WHERE id = 'one-0'").first("state")).toBe("PROCESSED");
  });
  it("does not persist a confirmable proposal when the complete preview exceeds the provider reply bound", async () => {
    const h = await harness();
    const title = "a".repeat(1800);
    const response = await h.send("thi ngày 11/11/2026 lúc 12h, nhắc 30 ngày trước ngày thi", create({ title }));
    expect(response.reply).toContain("ngắn");
    expect(await h.db.prepare("SELECT count(*) n FROM reminder_series_proposals").first("n")).toBe(0);
    expect(await h.count()).toBe(0);
  });
});
