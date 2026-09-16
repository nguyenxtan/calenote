// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import type { SemanticGateway, SemanticInput, SemanticTier, SemanticAttemptResult } from "@/modules/intelligence/semantic-gateway";
import { createKeyring } from "@/modules/security/keyring";
import { persistedD1Blob } from "@/modules/db/persisted-blob";
import { D1SemanticContextStore } from "@/modules/semantic/infrastructure/d1/context-store";
import { D1SemanticBudgetStore } from "@/modules/semantic/infrastructure/d1/budget-store";
import { NOW, seedSemanticRuntime, semanticRuntime } from "@/modules/semantic/infrastructure/d1/runtime.test-support";
import { claimInbound, D1InboundProcessorStore, processInbound, type ProcessInboundDependencies } from "./processor";

const runtimes: Array<Awaited<ReturnType<typeof semanticRuntime>>["runtime"]> = [];
afterEach(async () => { await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose())); });
const create: SemanticAttemptResult = { status: "SUCCESS", usage: { costMicrounits: 0 }, interpretation: {
  intent: "CREATE_REMINDER", title: "Bí mật hoa lan tím", localDate: "2026-09-17", localTime: "08:00",
  timezone: "Asia/Ho_Chi_Minh", needsClarification: false,
} };
const clarify: SemanticAttemptResult = { status: "SUCCESS", usage: { costMicrounits: 0 }, interpretation: {
  intent: "NEEDS_CLARIFICATION", targetIntent: "CREATE_REMINDER", missingFields: ["time"], question: "Bạn muốn được nhắc lúc mấy giờ?",
} };

async function harness(outcomes: SemanticAttemptResult[] = [create]) {
  const { runtime, db } = await semanticRuntime();
  runtimes.push(runtime);
  await seedSemanticRuntime(db);
  const keyring = await createKeyring("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  for (const owner of ["one", "two"]) {
    const token = await keyring.encryptCredential(`connection-${owner}`, "telegram", 1, "synthetic-token");
    await db.batch([
      db.prepare("INSERT INTO workspaces (id,owner_user_id,kind,created_at,updated_at) VALUES (?,?,'PERSONAL',1,1)")
        .bind(`workspace-${owner}`, owner),
      db.prepare("INSERT INTO memberships (workspace_id,user_id,role,created_at) VALUES (?,?,'OWNER',1)")
        .bind(`workspace-${owner}`, owner),
      db.prepare("UPDATE bot_connections SET encrypted_token=?,encrypted_token_iv=? WHERE id=?")
        .bind(token.ciphertext, token.iv, `connection-${owner}`),
    ]);
  }
  const calls: Array<{ tier: SemanticTier; input: SemanticInput }> = [];
  const gateway: SemanticGateway = { prepare(tier, input) {
    return { status: "READY", model: "synthetic", provider: "synthetic", maximumCostMicrounits: 1,
      async dispatch() { calls.push({ tier, input }); return outcomes.shift() ?? { status: "FAILURE", category: "PROVIDER_FAILURE" }; } };
  } };
  const contextStore = new D1SemanticContextStore(db, keyring);
  const budgetStore = new D1SemanticBudgetStore(db, {
    ownerDailyFallbackLimit: 10, ownerMonthlyCostMicrounits: 100, globalDailyCostMicrounits: 100,
    maxInputTokens: 1, maxOutputTokens: 1, promptPriceMicrounitsPerMillionTokens: 1,
    completionPriceMicrounitsPerMillionTokens: 1, reservationTtlMs: 60_000,
  });
  let now = NOW + 1_000;
  const store = new D1InboundProcessorStore(db);
  const replies: string[] = [];
  const semantic = { mode: "semantic" as "semantic" | "off", gateway, budgetStore, contextStore, paidFallbackEnabled: false };
  const deps: ProcessInboundDependencies = { store, keyring, semantic, now: () => now,
    sendText: async (_provider, _token, _chat, text) => { replies.push(text); return { providerMessageId: "synthetic-reply" }; } };
  return { db, keyring, store, semantic, contextStore, calls, replies, deps,
    setNow(value: number) { now = value; },
    async add(id: string, text: string, options: { owner?: string; receivedAt?: number; stranger?: boolean } = {}) {
      const owner = options.owner ?? "one";
      const encrypted = await keyring.encryptSensitive("inbound-message", id, 1, text);
      await db.prepare(`INSERT INTO inbound_updates (id,connection_id,provider,provider_message_id,provider_user_id,
        private_chat_id,message_ciphertext,message_iv,message_key_version,state,received_at)
        VALUES (?,?,'telegram',?,?,?,?,?,1,'PENDING',?)`)
        .bind(id, `connection-${owner}`, id, options.stranger ? "stranger" : `provider-${owner}`,
          `private-${owner}`, encrypted.ciphertext, encrypted.iv, options.receivedAt ?? NOW).run();
    },
    process: (id: string) => processInbound(id, deps),
    async count(table: "command_drafts" | "reminders" | "semantic_contexts") {
      return (await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;
    },
  };
}

describe("semantic inbound lifecycle", () => {
  it("creates exactly one encrypted draft and only deterministic confirmation creates one reminder", async () => {
    const h = await harness();
    await h.add("create", "nhớ giùm tui cái việc đó sáng mai");
    expect(await h.process("create")).toEqual({ status: "DRAFT_CREATED" });
    expect(await h.process("create")).toEqual({ status: "TERMINAL" });
    expect(await h.count("command_drafts")).toBe(1);
    expect(await h.count("reminders")).toBe(0);
    const draft = await h.db.prepare("SELECT * FROM command_drafts").first<{
      id: string; title_ciphertext: unknown; title_iv: unknown; scheduled_at: number;
    }>();
    expect(draft!.scheduled_at).toBe(Date.UTC(2026, 8, 17, 1));
    expect(await h.keyring.decryptSensitive("draft-title", draft!.id, 1, {
      ciphertext: persistedD1Blob(draft!.title_ciphertext), iv: persistedD1Blob(draft!.title_iv),
    })).toBe("Bí mật hoa lan tím");
    expect(JSON.stringify(draft)).not.toContain("hoa lan");
    await h.add("confirm", "ok", { receivedAt: NOW + 1 });
    expect(await h.process("confirm")).toEqual({ status: "CONFIRMED" });
    expect(await h.process("confirm")).toEqual({ status: "TERMINAL" });
    expect(await h.count("reminders")).toBe(1);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].input).toEqual({ text: "nhớ giùm tui cái việc đó sáng mai", interpretationReferenceTime: NOW, timezone: "Asia/Ho_Chi_Minh" });
  });

  it("semantic off overrides the old parser and terminalizes locally with zero calls", async () => {
    const h = await harness();
    h.semantic.mode = "off";
    await h.add("off", "mai 8h nhắc tôi gọi mẹ");
    expect(await h.process("off")).toEqual({ status: "REJECTED" });
    expect(await h.process("off")).toEqual({ status: "TERMINAL" });
    expect(await h.count("command_drafts")).toBe(0);
    expect(h.calls).toHaveLength(0);
  });

  it("keeps connect, malformed connect, help, confirmation, cancellation and ownership local", async () => {
    const h = await harness();
    for (const [id, text] of [["connect", "/connect ABCDEFGHJKLMNPQRSTUVWXYZ234"], ["bad-connect", "/connect wrong"],
      ["help", "/help"], ["confirm", "có"], ["cancel", "hủy"], ["foreign", "nhớ giùm sáng mai"]]) {
      await h.add(id, text, { stranger: id === "foreign" });
      expect((await h.process(id)).status).toBe("REJECTED");
      expect(await h.process(id)).toEqual({ status: "TERMINAL" });
    }
    expect(h.calls).toHaveLength(0);
    expect(await h.count("command_drafts")).toBe(0);
  });

  it("binds a valid connect command without invoking semantic interpretation", async () => {
    const h = await harness();
    const code = "ABCDEFGHJKLMNPQRSTUVWXYZ23";
    await h.db.batch([
      h.db.prepare("DELETE FROM chat_identities WHERE id='chat-one'"),
      h.db.prepare("UPDATE bot_connections SET state='ACTIVE_UNBOUND' WHERE id='connection-one'"),
      h.db.prepare(`INSERT INTO connect_codes (id,connection_id,user_id,digest,expires_at,created_at)
        VALUES ('connect-code','connection-one','one',?,?,?)`)
        .bind(await h.keyring.digestCode(code), NOW + 60_000, NOW),
    ]);
    await h.add("connect", `/connect ${code}`);
    expect(await h.process("connect")).toEqual({ status: "BOUND" });
    expect(await h.process("connect")).toEqual({ status: "TERMINAL" });
    expect(h.calls).toHaveLength(0);
    expect(await h.db.prepare("SELECT state FROM bot_connections WHERE id='connection-one'").first())
      .toEqual({ state: "ACTIVE_BOUND" });
  });

  it("cancels a semantic draft through the existing deterministic draft lifecycle", async () => {
    const h = await harness();
    await h.add("create", "nhớ một việc sáng mai");
    expect(await h.process("create")).toEqual({ status: "DRAFT_CREATED" });
    await h.add("cancel", "hủy", { receivedAt: NOW + 1 });
    expect(await h.process("cancel")).toEqual({ status: "CANCELLED" });
    expect(await h.db.prepare("SELECT status,resolution_inbound_id FROM command_drafts").first())
      .toEqual({ status: "CANCELLED", resolution_inbound_id: "cancel" });
    expect(h.calls).toHaveLength(1);
    expect(await h.count("reminders")).toBe(0);
  });

  it("persists encrypted bounded slots, sends only those slots on continuation, then resolves the context", async () => {
    const h = await harness([clarify, create]);
    await h.add("question", "nhớ giùm tôi một việc bí mật chưa đủ giờ");
    expect(await h.process("question")).toEqual({ status: "CLARIFICATION_REQUESTED" });
    const pending = await h.contextStore.findPending({ ownerId: "one", chatIdentityId: "chat-one", now: NOW + 1_000 });
    expect(pending?.slots).toEqual({ targetIntent: "CREATE_REMINDER", title: null, localDate: null,
      localTime: null, missingFields: ["time"] });
    expect(pending!.expiresAt - (NOW + 1_000)).toBeLessThanOrEqual(1_800_000);
    const row = await h.db.prepare("SELECT * FROM semantic_contexts").first();
    expect(JSON.stringify(row)).not.toContain("bí mật");
    expect(JSON.stringify(row)).not.toContain("missingFields");
    await h.add("answer", "8 giờ sáng mai", { receivedAt: NOW + 1 });
    expect(await h.process("answer")).toEqual({ status: "DRAFT_CREATED" });
    expect(h.calls[1].input.previousContext).toEqual(pending!.slots);
    expect(JSON.stringify(h.calls[1].input)).not.toContain("chưa đủ giờ");
    expect(await h.db.prepare("SELECT status,resolution_inbound_id FROM semantic_contexts").first())
      .toEqual({ status: "RESOLVED", resolution_inbound_id: "answer" });
  });

  it("cancels clarification deterministically without creating a reminder", async () => {
    const h = await harness([clarify]);
    await h.add("question", "nhắc tôi với");
    expect(await h.process("question")).toEqual({ status: "CLARIFICATION_REQUESTED" });
    await h.add("cancel", "hủy", { receivedAt: NOW + 1 });
    expect(await h.process("cancel")).toEqual({ status: "CANCELLED" });
    expect(await h.db.prepare("SELECT status FROM semantic_contexts").first()).toEqual({ status: "CANCELLED" });
    expect(h.calls).toHaveLength(1);
    expect(await h.count("reminders")).toBe(0);
  });

  it("lists a bounded owner/chat-scoped range without mutating reminders or drafts", async () => {
    const h = await harness([{ status: "SUCCESS", usage: { costMicrounits: 0 }, interpretation: {
      intent: "LIST_REMINDERS", rangeKind: "TOMORROW", localDate: null,
    } }]);
    for (let index = 0; index < 9; index++) {
      const id = `reminder-${index}`;
      const owner = index === 0 ? "two" : "one";
      const encrypted = await h.keyring.encryptSensitive("reminder-title", id, 1, index === 0 ? "OTHER OWNER SECRET" : `Việc ${index}`);
      await h.db.prepare(`INSERT INTO reminders (id,public_id,workspace_id,chat_identity_id,title_ciphertext,title_iv,
        title_key_version,scheduled_at,timezone,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,1,?,'Asia/Ho_Chi_Minh','PENDING',1,1)`)
        .bind(id, id, `workspace-${owner}`, `chat-${owner}`, encrypted.ciphertext, encrypted.iv,
          index === 8 ? Date.UTC(2026, 8, 18, 1) : Date.UTC(2026, 8, 17, 1) + index).run();
    }
    const before = await h.db.prepare("SELECT * FROM reminders ORDER BY id").all();
    await h.add("query", "mai còn việc gì không");
    expect(await h.process("query")).toEqual({ status: "REMINDERS_LISTED" });
    expect(await h.process("query")).toEqual({ status: "TERMINAL" });
    expect(h.replies[0]).toContain("Việc 1");
    expect(h.replies[0]).not.toContain("OTHER OWNER SECRET");
    expect(h.replies[0]).not.toContain("Việc 6");
    expect(h.replies[0]).not.toContain("Việc 8");
    expect(h.replies[0].length).toBeLessThanOrEqual(2_000);
    expect((await h.db.prepare("SELECT * FROM reminders ORDER BY id").all()).results).toEqual(before.results);
    expect(await h.count("command_drafts")).toBe(0);
  });

  it.each(["PROVIDER_FAILURE", "INVALID_JSON", "SCHEMA_INVALID", "TIMEOUT"] as const)(
    "terminalizes %s without a redelivery storm or mutation", async (category) => {
      const h = await harness([{ status: "FAILURE", category }]);
      await h.add("failed", "nhớ một việc không rõ");
      expect(await h.process("failed")).toEqual({ status: "REJECTED" });
      expect(await h.process("failed")).toEqual({ status: "TERMINAL" });
      expect(h.calls).toHaveLength(1);
      expect(await h.count("command_drafts")).toBe(0);
      expect(await h.count("reminders")).toBe(0);
    },
  );

  it("durably fences the entire attempt across a reclaimed lease and reconstructed store", async () => {
    const h = await harness();
    await h.add("crash", "nhớ một việc không rõ");
    const claimed = await claimInbound("crash", { store: h.store, keyring: h.keyring, now: () => NOW + 1_000 });
    if (claimed.status !== "CLAIMED") throw new Error("Expected claim");
    expect(await h.store.claimSemanticAttempt(claimed.message, "two", NOW + 1_000)).toBe(false);
    const contenders = await Promise.all([
      h.store.claimSemanticAttempt(claimed.message, "one", NOW + 1_000),
      new D1InboundProcessorStore(h.db).claimSemanticAttempt(claimed.message, "one", NOW + 1_000),
    ]);
    expect(contenders.filter(Boolean)).toHaveLength(1);
    h.setNow(NOW + 3_600_000);
    expect(await h.process("crash")).toEqual({ status: "REJECTED" });
    expect(await h.process("crash")).toEqual({ status: "TERMINAL" });
    expect(h.calls).toHaveLength(0);
    expect(await h.count("command_drafts")).toBe(0);
  });

  it("does not retry an AI call after its real durable fence committed but acknowledgement was lost", async () => {
    const h = await harness();
    const claim = h.store.claimSemanticAttempt.bind(h.store);
    h.store.claimSemanticAttempt = async (...args) => { await claim(...args); throw new Error("synthetic lost acknowledgement"); };
    await h.add("lost-ack", "nhắc tôi việc chưa rõ");
    expect(await h.process("lost-ack")).toEqual({ status: "REJECTED" });
    expect(await h.process("lost-ack")).toEqual({ status: "TERMINAL" });
    expect(h.calls).toHaveLength(0);
    expect(await h.count("command_drafts")).toBe(0);
  });

  it("caps paid recovery at two actual attempts and never repeats it after terminal delivery", async () => {
    const h = await harness([{ status: "FAILURE", category: "TIMEOUT" }, create]);
    h.semantic.paidFallbackEnabled = true;
    await h.add("fallback", "nhắc tôi việc chưa rõ");
    expect(await h.process("fallback")).toEqual({ status: "DRAFT_CREATED" });
    expect(await h.process("fallback")).toEqual({ status: "TERMINAL" });
    expect(h.calls.map((call) => call.tier)).toEqual(["FREE_PRIMARY", "CHEAP_PAID_FALLBACK"]);
    expect(await h.count("command_drafts")).toBe(1);
    expect(await h.db.prepare("SELECT state FROM semantic_budget_reservations").first()).toEqual({ state: "FINALIZED" });
  });

  it("rejects invalid model objects and past-time business results without paid fallback or mutation", async () => {
    const h = await harness([
      { status: "SUCCESS", usage: { costMicrounits: 0 }, interpretation: { ...(create.status === "SUCCESS" ? create.interpretation : {}), ownerId: "two" } } as unknown as SemanticAttemptResult,
      { status: "SUCCESS", usage: { costMicrounits: 0 }, interpretation: {
        intent: "CREATE_REMINDER", title: "Past", localDate: "2026-09-16", localTime: "14:00",
        timezone: "Asia/Ho_Chi_Minh", needsClarification: false,
      } },
    ]);
    h.semantic.paidFallbackEnabled = true;
    for (const id of ["invalid", "past"]) {
      await h.add(id, "nhắc tôi việc chưa rõ");
      expect(await h.process(id)).toEqual({ status: "REJECTED" });
      expect(await h.process(id)).toEqual({ status: "TERMINAL" });
    }
    expect(h.calls.map((call) => call.tier)).toEqual(["FREE_PRIMARY", "FREE_PRIMARY"]);
    expect(await h.count("command_drafts")).toBe(0);
    expect(await h.count("reminders")).toBe(0);
    expect(h.replies.at(-1)).toContain("đã qua");
  });

  it("expires old clarification before the next semantic input and never sends the old slots", async () => {
    const h = await harness([clarify, create]);
    await h.add("question", "nhắc tôi việc chưa rõ");
    expect(await h.process("question")).toEqual({ status: "CLARIFICATION_REQUESTED" });
    h.setNow(NOW + 1_801_000);
    await h.add("new", "nhắc tôi một việc khác", { receivedAt: NOW + 1_800_000 });
    expect(await h.process("new")).toEqual({ status: "DRAFT_CREATED" });
    expect(h.calls[1].input.previousContext).toBeUndefined();
    expect(await h.db.prepare("SELECT status FROM semantic_contexts").first()).toEqual({ status: "EXPIRED" });
  });

  it("rejects an older continuation without replacing a newer pending context or creating a draft", async () => {
    const h = await harness([clarify, create]);
    await h.add("question", "nhắc tôi việc chưa rõ", { receivedAt: NOW + 1 });
    expect(await h.process("question")).toEqual({ status: "CLARIFICATION_REQUESTED" });
    await h.add("older", "8 giờ sáng mai", { receivedAt: NOW });
    expect(await h.process("older")).toEqual({ status: "REJECTED" });
    expect(await h.db.prepare("SELECT status FROM semantic_contexts").first()).toEqual({ status: "PENDING" });
    expect(await h.count("command_drafts")).toBe(0);
  });

  it("terminalizes query before an ambiguous reply and never replays the reply", async () => {
    const h = await harness([{ status: "SUCCESS", usage: { costMicrounits: 0 }, interpretation: {
      intent: "LIST_REMINDERS", rangeKind: "TODAY", localDate: null,
    } }]);
    let replies = 0;
    h.deps.sendText = async () => {
      replies++;
      expect(await h.db.prepare("SELECT state FROM inbound_updates WHERE id='query'").first()).toEqual({ state: "PROCESSED" });
      throw new Error("synthetic ambiguous delivery");
    };
    await h.add("query", "hôm nay còn việc gì không");
    expect(await h.process("query")).toEqual({ status: "REMINDERS_LISTED" });
    expect(await h.process("query")).toEqual({ status: "TERMINAL" });
    expect(replies).toBe(1);
    expect(h.calls).toHaveLength(1);
  });
});
