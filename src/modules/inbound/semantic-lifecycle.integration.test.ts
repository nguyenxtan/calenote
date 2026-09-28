// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SemanticInput, SemanticTier, SemanticGateway, SemanticAttemptResult } from "@/modules/intelligence/semantic-gateway";
import { createSemanticGateway, type SemanticJsonRequest } from "@/modules/intelligence/infrastructure/openrouter/semantic-gateway";
import { createKeyring } from "@/modules/security/keyring";
import { persistedD1Blob } from "@/modules/db/persisted-blob";
import { D1SemanticContextStore } from "@/modules/semantic/infrastructure/d1/context-store";
import { D1SemanticBudgetStore } from "@/modules/semantic/infrastructure/d1/budget-store";
import { NOW, seedSemanticRuntime, semanticRuntime } from "@/modules/semantic/infrastructure/d1/runtime.test-support";
import { claimInbound, D1InboundProcessorStore, processInbound, type ProcessInboundDependencies } from "./processor";

const runtimes: Array<Awaited<ReturnType<typeof semanticRuntime>>["runtime"]> = [];
const raceCleanups: Array<() => Promise<void>> = [];
let fixture: { db: D1Database; keyring: Awaited<ReturnType<typeof createKeyring>> };
afterEach(async () => {
  try {
    await Promise.all(raceCleanups.splice(0).map((cleanup) => cleanup()));
  } finally {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
  }
});
const create: SemanticAttemptResult = { status: "SUCCESS", usage: { costMicrounits: 0 }, interpretation: {
  intent: "CREATE_REMINDER", title: "Bí mật hoa lan tím", titleState: "RESOLVED", targetIntent: null,
} };
const clarify = create;
const continuation: SemanticAttemptResult = { status: "SUCCESS", usage: { costMicrounits: 0 }, interpretation: {
  intent: "CREATE_REMINDER", title: null, titleState: "MISSING", targetIntent: null,
} };

async function runRace(
  release: () => void, operations: Promise<unknown>[], assertions: () => Promise<void>,
): Promise<void> {
  const cleanup = async () => { release(); await Promise.allSettled(operations); };
  // afterEach also releases gates if Vitest times out the still-running body.
  raceCleanups.push(cleanup);
  try {
    await assertions();
  } finally {
    await cleanup();
    const index = raceCleanups.indexOf(cleanup);
    if (index !== -1) raceCleanups.splice(index, 1);
  }
}

// Cold workerd startup, six migrations and seed writes are fixture setup, not
// the race's assertion deadline. Match the other local D1 suites' bounded hook;
// individual test bodies retain Vitest's default 5-second timeout.
beforeEach(async () => {
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
  fixture = { db, keyring };
}, 20_000);

async function harness(outcomes: SemanticAttemptResult[] = [create]) {
  const { db, keyring } = fixture;
  const calls: Array<{ tier: SemanticTier; input: SemanticInput }> = [];
  const requests: SemanticJsonRequest[] = [];
  const gateway = createSemanticGateway({ maxInputChars: 1_800, maxInputTokens: 12_000, maxOutputTokens: 256,
    maxResponseBytes: 20_000, timeoutMs: 500,
    primary: { model: "fixture/model", provider: "fixture-provider", requireZdr: true,
      promptPriceMicrounitsPerMillionTokens: 1, completionPriceMicrounitsPerMillionTokens: 1 },
  }, async (request) => {
    requests.push(request);
    calls.push({ tier: "PRIMARY", input: JSON.parse(request.messages[1].content) });
    const outcome = outcomes.shift() ?? { status: "FAILURE", category: "PROVIDER_FAILURE" };
    if (outcome.status === "SUCCESS") return { status: 200, body: JSON.stringify({ choices: [{
      message: { content: JSON.stringify(outcome.interpretation) }, finish_reason: "stop",
    }], usage: { cost: 0, prompt_tokens: 100, completion_tokens: 20 } }) };
    if (outcome.category === "INVALID_JSON") return { status: 200, body: "invalid" };
    if (outcome.category === "SCHEMA_INVALID") return { status: 200, body: "{}" };
    return { status: outcome.category === "TIMEOUT" ? 408 : 503, body: "" };
  });
  const contextStore = new D1SemanticContextStore(db, keyring);
  const budgetStore = new D1SemanticBudgetStore(db, {
    ownerDailyFallbackLimit: 10, ownerMonthlyCostMicrounits: 100, globalDailyCostMicrounits: 100,
    maxInputTokens: 12_000, maxOutputTokens: 256, promptPriceMicrounitsPerMillionTokens: 1,
    completionPriceMicrounitsPerMillionTokens: 1, reservationTtlMs: 60_000,
  });
  let now = NOW + 1_000;
  const store = new D1InboundProcessorStore(db);
  const replies: string[] = [];
  const feedbackTasks: Promise<unknown>[] = [];
  raceCleanups.push(async () => { await Promise.all(feedbackTasks); });
  const semantic = { mode: "privacy" as "privacy" | "off", gateway: gateway as SemanticGateway, budgetStore, contextStore, paidFallbackEnabled: false };
  const deps: ProcessInboundDependencies = { store, keyring, feedbackLifetime: { waitUntil: task => { feedbackTasks.push(task); } }, semantic: {
    gateway: { prepare: (tier, input) => semantic.gateway.prepare(tier, input) }, budgetStore, contextStore,
    get mode() { return semantic.mode; }, get paidFallbackEnabled() { return semantic.paidFallbackEnabled; },
  }, now: () => now,
    sendText: async (_provider, _token, _chat, text) => { replies.push(text); return { providerMessageId: "synthetic-reply" }; } };
  return { db, keyring, store, semantic, contextStore, calls, replies, requests, deps,
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
  it("invokes Zalo processing feedback once before semantic interpretation and ignores its failure", async () => {
    const h = await harness();
    const token = await h.keyring.encryptCredential("connection-one", "zalo", 1, "typing-token");
    await h.db.prepare("UPDATE bot_connections SET provider='zalo',encrypted_token=?,encrypted_token_iv=? WHERE id='connection-one'")
      .bind(token.ciphertext, token.iv).run();
    const order: string[] = [];
    h.deps.sendProcessingFeedback = async () => {
      order.push("typing");
      throw new Error("synthetic typing failure");
    };
    const realGateway = h.semantic.gateway;
    h.semantic.gateway = { prepare(tier, input) {
      const attempt = realGateway.prepare(tier, input);
      if (attempt.status !== "READY") return attempt;
      return { ...attempt, async dispatch() { order.push("semantic"); return attempt.dispatch(); } };
    } };

    await h.add("typing", "mai 8h nhắc Bí mật hoa lan tím");
    await h.db.prepare("UPDATE inbound_updates SET provider='zalo' WHERE id='typing'").run();
    expect(await h.process("typing")).toEqual({ status: "DRAFT_CREATED" });
    expect(order).toEqual(["typing", "semantic"]);
    expect(h.replies).toHaveLength(1);
    expect(await h.count("command_drafts")).toBe(1);
    expect(await h.process("typing")).toEqual({ status: "TERMINAL" });
    expect(order).toEqual(["typing", "semantic"]);
  });

  it("does not invoke processing feedback for deterministic controls", async () => {
    const h = await harness();
    const token = await h.keyring.encryptCredential("connection-one", "zalo", 1, "typing-token");
    await h.db.prepare("UPDATE bot_connections SET provider='zalo',encrypted_token=?,encrypted_token_iv=? WHERE id='connection-one'")
      .bind(token.ciphertext, token.iv).run();
    const spy = vi.fn(async () => undefined);
    h.deps.sendProcessingFeedback = spy;
    for (const [id, text] of [["connect-no-typing", "/connect wrong"], ["connect-concatenated-no-typing", "/connectABC"], ["confirm-no-typing", "có"],
      ["cancel-no-typing", "hủy"], ["help-no-typing", "/help"], ["foreign", "mai 8h nhắc việc"]]) {
      await h.add(id, text, { stranger: id === "foreign" });
      await h.db.prepare("UPDATE inbound_updates SET provider='zalo' WHERE id=?").bind(id).run();
      await h.process(id);
    }
    expect(spy).not.toHaveBeenCalled();
    expect(h.calls).toHaveLength(0);
  });

  it.each(["off", "duplicate attempt", "budget exhausted", "invalid input"] as const)(
    "does not send typing or dispatch for %s", async (guard) => {
      const h = await harness();
      const token = await h.keyring.encryptCredential("connection-one", "zalo", 1, "typing-token");
      await h.db.prepare("UPDATE bot_connections SET provider='zalo',encrypted_token=?,encrypted_token_iv=? WHERE id='connection-one'")
        .bind(token.ciphertext, token.iv).run();
      const feedback = vi.fn(async () => undefined);
      h.deps.sendProcessingFeedback = feedback;
      if (guard === "off") h.semantic.mode = "off";
      if (guard === "duplicate attempt") h.store.claimSemanticAttempt = async () => false;
      if (guard === "budget exhausted") h.semantic.budgetStore.reservePaidCall = async () => ({ status: "BUDGET_EXHAUSTED" });
      await h.add("guarded", guard === "invalid input" ? "password=synthetic" : "mai 8h nhắc việc");
      await h.db.prepare("UPDATE inbound_updates SET provider='zalo' WHERE id='guarded'").run();
      expect(await h.process("guarded")).toEqual({ status: "REJECTED" });
      expect(await h.process("guarded")).toEqual({ status: "TERMINAL" });
      expect(feedback).not.toHaveBeenCalled();
      expect(h.calls).toHaveLength(0);
      expect(await h.count("command_drafts")).toBe(0);
      expect(await h.count("semantic_contexts")).toBe(0);
    },
  );

  it("preserves encrypted resolved context after a conflicting continuation and later completes it", async () => {
    const h = await harness([clarify, continuation, continuation]);
    await h.add("question", "mai nhắc Bí mật hoa lan tím");
    expect(await h.process("question")).toEqual({ status: "CLARIFICATION_REQUESTED" });
    const before = await h.db.prepare("SELECT * FROM semantic_contexts").all();
    await h.add("conflict", "2026-09-18 9h", { receivedAt: NOW + 1 });
    expect(await h.process("conflict")).toEqual({ status: "REJECTED" });
    expect((await h.db.prepare("SELECT * FROM semantic_contexts").all()).results).toEqual(before.results);
    expect(await h.count("command_drafts")).toBe(0);
    await h.add("answer", "9h", { receivedAt: NOW + 2 });
    expect(await h.process("answer")).toEqual({ status: "DRAFT_CREATED" });
    expect(await h.db.prepare("SELECT scheduled_at FROM command_drafts").first()).toEqual({ scheduled_at: Date.UTC(2026, 8, 17, 2) });
    expect(await h.count("reminders")).toBe(0);
    expect(h.calls).toHaveLength(3);
  });

  it("drains a paused inbound after an assertion failure before disposing its runtime", async () => {
    const h = await harness();
    let started!: () => void;
    let unblock!: () => void;
    let released = false;
    const waiting = new Promise<void>((resolve) => { started = resolve; });
    const blocked = new Promise<void>((resolve) => { unblock = resolve; });
    const release = () => { released = true; unblock(); };
    h.semantic.gateway = { prepare() {
      return { status: "READY", model: "synthetic", provider: "synthetic", maximumCostMicrounits: 1,
        async dispatch() { started(); await blocked; return create; } };
    } };
    const operations: Promise<unknown>[] = [];
    try {
      await expect(runRace(release, operations, async () => {
        await h.add("interrupted", "mai 8h synthetic request");
        operations.push(h.process("interrupted"));
        await waiting;
        throw new Error("synthetic assertion failure");
      })).rejects.toThrow("synthetic assertion failure");
      expect(released).toBe(true);
      expect(await h.db.prepare("SELECT state FROM inbound_updates WHERE id='interrupted'").first())
        .toEqual({ state: "PROCESSED" });
      expect(await h.count("command_drafts")).toBe(1);
    } finally {
      // A broken runRace must not strand this regression's own paused operation.
      release();
      await Promise.allSettled(operations);
    }
  });

  it.each(["later time", "same time", "before newer terminalization"] as const)(
    "supersedes an older in-flight create after a newer clarification commits (%s)", async (ordering) => {
      const h = await harness();
      let started!: () => void;
      let resume!: () => void;
      const waiting = new Promise<void>((resolve) => { started = resolve; });
      const released = new Promise<void>((resolve) => { resume = resolve; });
      let persisted!: () => void;
      let completeNewer!: () => void;
      const contextPersisted = new Promise<void>((resolve) => { persisted = resolve; });
      const completionReleased = new Promise<void>((resolve) => { completeNewer = resolve; });
      const complete = h.store.completeSemanticMessage.bind(h.store);
      h.store.completeSemanticMessage = async (...args) => {
        if (ordering === "before newer terminalization" && args[0].id === "newer-clarification") {
          persisted(); await completionReleased;
        }
        return complete(...args);
      };
      h.semantic.gateway = { prepare(_tier, input) {
        return { status: "READY", model: "synthetic", provider: "synthetic", maximumCostMicrounits: 1,
          async dispatch() {
            if (input.text === "mai 8h older request") { started(); await released; return create; }
            return clarify;
          } };
      } };
      const operations: Promise<unknown>[] = [];
      await runRace(() => { resume(); completeNewer(); }, operations, async () => {
        await h.add("older-create", "mai 8h older request");
        const older = h.process("older-create");
        operations.push(older);
        await waiting;
        await h.add("newer-clarification", "newer request", { receivedAt: ordering === "same time" ? NOW : NOW + 1 });
        const newer = h.process("newer-clarification");
        operations.push(newer);
        if (ordering === "before newer terminalization") {
          await contextPersisted;
          expect(await h.db.prepare("SELECT state FROM inbound_updates WHERE id='newer-clarification'").first())
            .toEqual({ state: "PROCESSING" });
        } else {
          expect(await newer).toEqual({ status: "CLARIFICATION_REQUESTED" });
        }
        const contextBefore = await h.db.prepare("SELECT * FROM semantic_contexts").all();
        const repliesBefore = [...h.replies];
        resume();
        expect(await older).toEqual({ status: "SUPERSEDED" });
        expect(await h.process("older-create")).toEqual({ status: "TERMINAL" });
        expect(await h.count("command_drafts")).toBe(0);
        expect(h.replies).toEqual(repliesBefore);
        expect((await h.db.prepare("SELECT * FROM semantic_contexts").all()).results).toEqual(contextBefore.results);
        completeNewer();
        expect(await newer).toEqual({ status: "CLARIFICATION_REQUESTED" });
        await h.add("confirmation", "ok", { receivedAt: NOW + 2 });
        expect(await h.process("confirmation")).toEqual({ status: "REJECTED" });
        expect(await h.count("reminders")).toBe(0);
      });
    },
  );

  it.each(["clarification", "query", "help"] as const)(
    "supersedes an older in-flight %s after a newer create commits", async (outcome) => {
      const h = await harness();
      let started!: () => void;
      let resume!: () => void;
      const waiting = new Promise<void>((resolve) => { started = resolve; });
      const released = new Promise<void>((resolve) => { resume = resolve; });
      h.semantic.gateway = { prepare(_tier, input) {
        return { status: "READY", model: "synthetic", provider: "synthetic", maximumCostMicrounits: 1,
          async dispatch(): Promise<SemanticAttemptResult> {
            if (input.text !== "hôm nay older request") return create;
            started(); await released;
            if (outcome === "clarification") return clarify;
            return { status: "SUCCESS", usage: { costMicrounits: 0 }, interpretation: outcome === "query"
              ? { intent: "LIST_REMINDERS", title: null, titleState: "NOT_APPLICABLE", targetIntent: null }
              : { intent: "HELP", title: null, titleState: "NOT_APPLICABLE", targetIntent: null } };
          } };
      } };
      const operations: Promise<unknown>[] = [];
      await runRace(resume, operations, async () => {
        await h.add("older", "hôm nay older request");
        const older = h.process("older");
        operations.push(older);
        await waiting;
        await h.add("newer", "mai 8h newer request", { receivedAt: NOW + 1 });
        expect(await h.process("newer")).toEqual({ status: "DRAFT_CREATED" });
        const draftBefore = await h.db.prepare("SELECT * FROM command_drafts").all();
        const repliesBefore = [...h.replies];
        resume();
        expect(await older).toEqual({ status: "SUPERSEDED" });
        expect(await h.process("older")).toEqual({ status: "TERMINAL" });
        expect(await h.count("semantic_contexts")).toBe(0);
        expect(h.replies).toEqual(repliesBefore);
        expect((await h.db.prepare("SELECT * FROM command_drafts").all()).results).toEqual(draftBefore.results);
      });
    },
  );

  it("creates exactly one encrypted draft and only deterministic confirmation creates one reminder", async () => {
    const h = await harness();
    await h.add("create", "mai 8h nhắc Bí mật hoa lan tím");
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
    expect(h.calls[0].input).toMatchObject({ text: "mai 8h nhắc Bí mật hoa lan tím", referenceLocalDate: "2026-09-16", referenceLocalTime: "15:00", timezone: "Asia/Ho_Chi_Minh",
      temporalEvidence: { date: { state: "RESOLVED", localDate: "2026-09-17" }, time: { state: "RESOLVED", localTime: "08:00" } } });
    expect(h.requests[0].provider).toMatchObject({ only: ["fixture-provider"], allow_fallbacks: false, zdr: true, data_collection: "deny" });
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
    await h.add("create", "mai 8h nhớ một việc");
    expect(await h.process("create")).toEqual({ status: "DRAFT_CREATED" });
    await h.add("cancel", "hủy", { receivedAt: NOW + 1 });
    expect(await h.process("cancel")).toEqual({ status: "CANCELLED" });
    expect(await h.db.prepare("SELECT status,resolution_inbound_id FROM command_drafts").first())
      .toEqual({ status: "CANCELLED", resolution_inbound_id: "cancel" });
    expect(h.calls).toHaveLength(1);
    expect(await h.count("reminders")).toBe(0);
  });

  it("persists encrypted bounded slots, sends only those slots on continuation, then resolves the context", async () => {
    const h = await harness([clarify, continuation]);
    await h.add("question", "mai nhắc Bí mật hoa lan tím");
    expect(await h.process("question")).toEqual({ status: "CLARIFICATION_REQUESTED" });
    const pending = await h.contextStore.findPending({ ownerId: "one", chatIdentityId: "chat-one", now: NOW + 1_000 });
    expect(pending?.slots).toEqual({ targetIntent: "CREATE_REMINDER", title: "Bí mật hoa lan tím", localDate: "2026-09-17",
      localTime: null, missingFields: ["time"] });
    expect(pending!.expiresAt - (NOW + 1_000)).toBeLessThanOrEqual(1_800_000);
    const row = await h.db.prepare("SELECT * FROM semantic_contexts").first();
    expect(JSON.stringify(row)).not.toContain("hoa lan tím");
    expect(JSON.stringify(row)).not.toContain("2026-09-17");
    expect(JSON.stringify(row)).not.toContain("missingFields");
    expect(h.replies).toEqual(["Bạn muốn được nhắc lúc mấy giờ?"]);
    await h.add("answer", "9h", { receivedAt: NOW + 1 });
    expect(await h.process("answer")).toEqual({ status: "DRAFT_CREATED" });
    expect(h.calls[1].input.previousContext).toEqual(pending!.slots);
    expect(h.calls[1].input.text).toBe("9h");
    expect(Object.keys(h.calls[1].input).sort()).toEqual(["previousContext", "referenceLocalDate", "referenceLocalTime", "temporalEvidence", "text", "timezone"]);
    expect(await h.db.prepare("SELECT scheduled_at FROM command_drafts").first()).toEqual({ scheduled_at: Date.UTC(2026, 8, 17, 2) });
    expect(await h.db.prepare("SELECT status,resolution_inbound_id FROM semantic_contexts").first())
      .toEqual({ status: "RESOLVED", resolution_inbound_id: "answer" });
  });

  it("asks only for the missing title when a Vietnamese noon date is otherwise complete", async () => {
    const h = await harness([{ status: "SUCCESS", usage: { costMicrounits: 0 }, interpretation: {
      intent: "CREATE_REMINDER", title: null, titleState: "MISSING", targetIntent: null,
    } }]);
    await h.add("missing-title", "Nhắc lúc 12h trưa ngày 10/10");

    expect(await h.process("missing-title")).toEqual({ status: "CLARIFICATION_REQUESTED" });
    expect(h.replies).toEqual(["Bạn muốn được nhắc việc gì?"]);
    expect(await h.contextStore.findPending({ ownerId: "one", chatIdentityId: "chat-one", now: NOW + 1_000 }))
      .toMatchObject({ slots: { targetIntent: "CREATE_REMINDER", title: null, localDate: "2026-10-10", localTime: "12:00", missingFields: ["title"] } });
    expect(await h.count("command_drafts")).toBe(0);
  });

  it("creates only a draft for a complete Vietnamese noon reminder", async () => {
    const h = await harness([{ status: "SUCCESS", usage: { costMicrounits: 0 }, interpretation: {
      intent: "CREATE_REMINDER", title: "đi thi ở quang trung", titleState: "RESOLVED", targetIntent: null,
    } }]);
    await h.add("complete-noon", "Ngày 10/10 lúc 12h trưa nhắc đi thi ở quang trung");

    expect(await h.process("complete-noon")).toEqual({ status: "DRAFT_CREATED" });
    expect(await h.count("command_drafts")).toBe(1);
    expect(await h.count("reminders")).toBe(0);
    expect(await h.db.prepare("SELECT scheduled_at FROM command_drafts").first())
      .toEqual({ scheduled_at: Date.UTC(2026, 9, 10, 5) });
  });

  it("refuses an unsupported recurring continuation without consuming encrypted pending context", async () => {
    const h = await harness([clarify, continuation]);
    await h.add("question", "mai nhắc Bí mật hoa lan tím");
    expect(await h.process("question")).toEqual({ status: "CLARIFICATION_REQUESTED" });
    const pendingBefore = await h.contextStore.findPending({ ownerId: "one", chatIdentityId: "chat-one", now: NOW + 1_000 });

    await h.add("recurrence", "Gấp nên nhắc liên tục 3 ngày gần nhất lúc 12h trưa", { receivedAt: NOW + 1 });
    expect(await h.process("recurrence")).toEqual({ status: "REJECTED" });
    expect(h.replies.at(-1)).toBe("Hiện Calenote chưa hỗ trợ lời nhắc lặp lại. Mình chưa tạo lời nhắc nào; hãy gửi một ngày và giờ cụ thể.");
    expect(await h.contextStore.findPending({ ownerId: "one", chatIdentityId: "chat-one", now: NOW + 1_000 })).toEqual(pendingBefore);
    expect(h.calls).toHaveLength(1);
    expect(await h.count("command_drafts")).toBe(0);

    await h.add("answer", "12h trưa", { receivedAt: NOW + 2 });
    expect(await h.process("answer")).toEqual({ status: "DRAFT_CREATED" });
    expect(await h.db.prepare("SELECT scheduled_at FROM command_drafts").first())
      .toEqual({ scheduled_at: Date.UTC(2026, 8, 17, 5) });
  });

  it("refuses a frequency marker plus a numeric calendar expression without consuming pending context", async () => {
    const h = await harness([clarify, continuation]);
    await h.add("question", "mai nhắc Bí mật hoa lan tím");
    expect(await h.process("question")).toEqual({ status: "CLARIFICATION_REQUESTED" });
    const pendingBefore = await h.contextStore.findPending({ ownerId: "one", chatIdentityId: "chat-one", now: NOW + 1_000 });

    await h.add("numeric-recurrence", "Mỗi 10/10 lúc 12h trưa nhắc đi thi ở quang trung", { receivedAt: NOW + 1 });
    expect(await h.process("numeric-recurrence")).toEqual({ status: "REJECTED" });
    expect(h.replies.at(-1)).toBe("Hiện Calenote chưa hỗ trợ lời nhắc lặp lại. Mình chưa tạo lời nhắc nào; hãy gửi một ngày và giờ cụ thể.");
    expect(await h.contextStore.findPending({ ownerId: "one", chatIdentityId: "chat-one", now: NOW + 1_000 })).toEqual(pendingBefore);
    expect(h.calls).toHaveLength(1);
    expect(await h.count("command_drafts")).toBe(0);
  });

  it("screens an unsupported recurrence before any encrypted context lookup", async () => {
    const h = await harness();
    h.contextStore.findPending = async () => { throw new Error("context lookup must not occur"); };
    await h.add("early-recurrence", "Mỗi 10/10 lúc 12h trưa nhắc đi thi ở quang trung");

    expect(await h.process("early-recurrence")).toEqual({ status: "REJECTED" });
    expect(h.replies).toEqual(["Hiện Calenote chưa hỗ trợ lời nhắc lặp lại. Mình chưa tạo lời nhắc nào; hãy gửi một ngày và giờ cụ thể."]);
    expect(h.calls).toHaveLength(0);
    expect(await h.count("command_drafts")).toBe(0);
  });

  it.each([
    "Mỗi 12h nhắc kiểm tra hệ thống",
    "liên tục 08:30 nhắc kiểm tra hệ thống",
    "nhắc liên tục trong 3 ngày lúc 12h",
    "mỗi vào lúc 08:30 nhắc kiểm tra hệ thống",
    "mỗi thứ 2 lúc 08:30 nhắc kiểm tra hệ thống",
    "Mỗi hai ngày nhắc kiểm tra hệ thống",
    "liên tục ba tuần nhắc kiểm tra hệ thống",
  ])("refuses a recurrence marker bound to a numeric clock expression: %s", async (text) => {
    const h = await harness();
    await h.add("clock-recurrence", text);

    expect(await h.process("clock-recurrence")).toEqual({ status: "REJECTED" });
    expect(h.calls).toHaveLength(0);
    expect(await h.count("command_drafts")).toBe(0);
  });

  it("does not treat a title ending in the proper name Hằng as a recurrence", async () => {
    const h = await harness();
    await h.add("proper-name", "Mai 8h nhắc gọi Hằng");

    expect(await h.process("proper-name")).toEqual({ status: "DRAFT_CREATED" });
    expect(h.calls).toHaveLength(1);
    expect(await h.count("command_drafts")).toBe(1);
  });

  it("keeps a pending clarification and gives a truthful retry reply when the semantic provider is unavailable", async () => {
    const h = await harness([clarify, { status: "FAILURE", category: "PROVIDER_FAILURE" }]);
    await h.add("question", "mai nhắc Bí mật hoa lan tím");
    expect(await h.process("question")).toEqual({ status: "CLARIFICATION_REQUESTED" });
    const pendingBefore = await h.contextStore.findPending({ ownerId: "one", chatIdentityId: "chat-one", now: NOW + 1_000 });

    await h.add("answer", "12h trưa", { receivedAt: NOW + 1 });
    expect(await h.process("answer")).toEqual({ status: "REJECTED" });
    expect(h.replies.at(-1)).toBe("Mình chưa xử lý được câu trả lời này lúc này. Lời nhắc chưa được tạo; bạn có thể gửi lại câu trả lời cho câu hỏi trước.");
    expect(await h.contextStore.findPending({ ownerId: "one", chatIdentityId: "chat-one", now: NOW + 1_000 })).toEqual(pendingBefore);
    expect(await h.count("command_drafts")).toBe(0);
    expect(await h.count("reminders")).toBe(0);
  });

  it("never falls back to legacy parser help when a semantic context lookup fails", async () => {
    const h = await harness();
    h.contextStore.findPending = async () => { throw new Error("private context store failure"); };
    await h.add("context-store-failure", "Ngày 10/10 lúc 12h trưa nhắc đi thi");

    expect(await h.process("context-store-failure")).toEqual({ status: "REJECTED" });
    expect(h.replies).toEqual(["Mình chưa xử lý được yêu cầu này lúc này. Chưa có lời nhắc nào được tạo; bạn có thể gửi lại yêu cầu sau ít phút."]);
    expect(await h.count("command_drafts")).toBe(0);
    expect(await h.count("reminders")).toBe(0);
  });

  it("keeps cancellation fail-closed when encrypted clarification context cannot be read", async () => {
    const h = await harness();
    h.contextStore.findPending = async () => { throw new Error("private context store failure"); };
    await h.add("cancel-context-store-failure", "hủy");

    expect(await h.process("cancel-context-store-failure")).toEqual({ status: "REJECTED" });
    expect(h.replies).toEqual(["Mình chưa xử lý được câu trả lời này lúc này. Lời nhắc chưa được tạo; bạn có thể gửi lại câu trả lời cho câu hỏi trước."]);
    expect(await h.count("command_drafts")).toBe(0);
    expect(await h.count("reminders")).toBe(0);
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
      intent: "LIST_REMINDERS", title: null, titleState: "NOT_APPLICABLE", targetIntent: null,
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

  it("never falls back from privacy even if legacy fallback enablement is set", async () => {
    const h = await harness([{ status: "FAILURE", category: "TIMEOUT" }, create]);
    h.semantic.paidFallbackEnabled = true;
    await h.add("fallback", "nhắc tôi việc chưa rõ");
    expect(await h.process("fallback")).toEqual({ status: "REJECTED" });
    expect(await h.process("fallback")).toEqual({ status: "TERMINAL" });
    expect(h.calls.map((call) => call.tier)).toEqual(["PRIMARY"]);
    expect(await h.count("command_drafts")).toBe(0);
    expect(await h.db.prepare("SELECT state FROM semantic_budget_reservations").first()).toEqual({ state: "FINALIZED" });
  });

  it("rejects invalid model objects and past-time business results without paid fallback or mutation", async () => {
    const h = await harness([
      { status: "SUCCESS", usage: { costMicrounits: 0 }, interpretation: { ...(create.status === "SUCCESS" ? create.interpretation : {}), ownerId: "two" } } as unknown as SemanticAttemptResult,
      { status: "SUCCESS", usage: { costMicrounits: 0 }, interpretation: {
        intent: "CREATE_REMINDER", title: "Past", titleState: "RESOLVED", targetIntent: null,
      } },
    ]);
    h.semantic.paidFallbackEnabled = true;
    for (const id of ["invalid", "past"]) {
      await h.add(id, "hôm nay 14h nhắc tôi việc");
      expect(await h.process(id)).toEqual({ status: "REJECTED" });
      expect(await h.process(id)).toEqual({ status: "TERMINAL" });
    }
    expect(h.calls.map((call) => call.tier)).toEqual(["PRIMARY", "PRIMARY"]);
    expect(await h.count("command_drafts")).toBe(0);
    expect(await h.count("reminders")).toBe(0);
    expect(h.replies.at(-1)).toContain("đã qua");
  });

  it("expires old clarification before the next semantic input and never sends the old slots", async () => {
    const h = await harness([clarify, create]);
    await h.add("question", "nhắc tôi việc chưa rõ");
    expect(await h.process("question")).toEqual({ status: "CLARIFICATION_REQUESTED" });
    h.setNow(NOW + 1_801_000);
    await h.add("new", "mai 8h nhắc tôi một việc khác", { receivedAt: NOW + 1_800_000 });
    expect(await h.process("new")).toEqual({ status: "DRAFT_CREATED" });
    expect(h.calls[1].input.previousContext).toBeUndefined();
    expect(await h.db.prepare("SELECT status FROM semantic_contexts").first()).toEqual({ status: "EXPIRED" });
  });

  it("rejects an older continuation without replacing a newer pending context or creating a draft", async () => {
    const h = await harness([clarify, create]);
    await h.add("question", "nhắc tôi việc chưa rõ", { receivedAt: NOW + 1 });
    expect(await h.process("question")).toEqual({ status: "CLARIFICATION_REQUESTED" });
    await h.add("older", "8 giờ sáng mai", { receivedAt: NOW });
    expect(await h.process("older")).toEqual({ status: "SUPERSEDED" });
    expect(await h.db.prepare("SELECT status FROM semantic_contexts").first()).toEqual({ status: "PENDING" });
    expect(await h.count("command_drafts")).toBe(0);
  });

  it("terminalizes query before an ambiguous reply and never replays the reply", async () => {
    const h = await harness([{ status: "SUCCESS", usage: { costMicrounits: 0 }, interpretation: {
      intent: "LIST_REMINDERS", title: null, titleState: "NOT_APPLICABLE", targetIntent: null,
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
