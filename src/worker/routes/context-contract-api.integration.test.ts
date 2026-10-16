import { describe, expect, it } from "vitest";
import { fixture, now } from "@/modules/conversation/context-contract/infrastructure/d1/test-support";
import { addConfirmationToken } from "@/modules/conversation/context-contract/confirmation-test-support";
import { PreviewResponseV1Schema } from "@/contracts/api/conversation-previews";
import { ReminderListResponseV2Schema } from "@/contracts/api/reminders-v2";
import { D1ReminderApiStore } from "@/modules/reminders/infrastructure/d1/api-store";
import { listDetailedReminders } from "@/modules/reminders/details-api-service";
import { createRouter } from "../router";
import { SessionAuthError } from "@/modules/auth/session";

const origin = "https://calenote.iconiclogs.com";
const cookie = `__Host-calenote_session=${"A".repeat(43)}`;
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
const env = { APP_ORIGIN: origin, CALENOTE_RUNTIME_ENVIRONMENT: "production", ASSETS: { fetch: async () => new Response("missing") } } as unknown as Env;

describe("authenticated context preview backing store", () => {
  it("lists a complete opaque preview and confirms it once with WEB authority", async () => {
    const f = await fixture();
    try {
      await addConfirmationToken(f);
      const observed = await f.store.observe(f.scope());
      if ("failure" in observed) throw new Error(observed.failure);
      expect((await f.store.apply(f.scope(), observed.observation, f.transition)).status).toBe("APPLIED");
      const principal = { sessionId: "session", userId: "owner", expiresAt: now + 1_000_000 };
      const listed = await f.store.listWebPreviews(principal, 11);
      expect(PreviewResponseV1Schema.safeParse({ data: { schemaVersion: "conversation-previews-1", previews: listed.previews, hasMore: listed.hasMore } }).success).toBe(true);
      expect(listed.previews).toHaveLength(1);
      const preview = listed.previews[0];
      expect((await f.store.listWebPreviews({ ...principal, userId: "intruder" })).previews).toEqual([]);
      expect(preview).toMatchObject({ title: f.preview.title, details: f.preview.details, previewHash: f.proof.draftHash });
      expect(preview.publicId).not.toBe(f.snapshot.id);
      expect(Object.keys(preview).sort()).toEqual(["decisionToken", "details", "draftRevision", "expiresAt", "occurrences", "previewHash", "publicId", "title"]);
      const request = { schemaVersion: "conversation-previews-1" as const, publicId: preview.publicId,
        draftRevision: preview.draftRevision, previewHash: preview.previewHash, decisionToken: preview.decisionToken,
        action: "SAVE_PREVIEW" as const, idempotencyKey: "web-operation-1" };
      const first = await f.store.decideWebPreview(principal, request);
      expect(first.status).toBe("COMMITTED");
      expect((await f.store.decideWebPreview({ ...principal, userId: "intruder" }, request)).status).toBe("STALE");
      expect((await f.store.decideWebPreview(principal, request)).status).toBe("IDEMPOTENT");
    } finally { f.close(); }
  });

  it("lets only one WEB or CHAT confirmation win the shared transaction", async () => {
    const f = await fixture();
    try {
      await addConfirmationToken(f);
      const observed = await f.store.observe(f.scope());
      if ("failure" in observed) throw new Error(observed.failure);
      expect((await f.store.apply(f.scope(), observed.observation, f.transition)).status).toBe("APPLIED");
      await f.db.prepare("INSERT INTO inbound_updates(id,connection_id,provider,provider_message_id,provider_user_id,private_chat_id,message_ciphertext,message_iv,message_key_version,state,received_at,transition_marker) VALUES('confirm','connection','telegram','confirm','provider-user','chat',x'01',zeroblob(12),1,'PROCESSING',?,'claim')").bind(now + 1).run();
      const principal = { sessionId: "session", userId: "owner", expiresAt: now + 1_000_000 };
      const preview = (await f.store.listWebPreviews(principal)).previews[0];
      const request = { schemaVersion: "conversation-previews-1" as const, publicId: preview.publicId,
        draftRevision: preview.draftRevision, previewHash: preview.previewHash, decisionToken: preview.decisionToken,
        action: "SAVE_PREVIEW" as const, idempotencyKey: "race-web" };
      const [web, chat] = await Promise.all([
        f.store.decideWebPreview(principal, request),
        f.store.confirm(f.authority, f.proof),
      ]);
      expect([web.status, chat.status].filter(status => status === "COMMITTED")).toHaveLength(1);
      expect((await f.db.prepare("SELECT count(*) n FROM reminders").first<{n:number}>())?.n).toBe(2);
    } finally { f.close(); }
  });
  it("makes a suspended connection unavailable for preview listing and decisions", async () => {
    const f = await fixture();
    try {
      await addConfirmationToken(f);
      const observed = await f.store.observe(f.scope());
      if ("failure" in observed) throw new Error(observed.failure);
      expect((await f.store.apply(f.scope(), observed.observation, f.transition)).status).toBe("APPLIED");
      const principal = { sessionId: "session", userId: "owner", expiresAt: now + 1_000_000 };
      const preview = (await f.store.listWebPreviews(principal)).previews[0];
      await f.db.prepare("UPDATE bot_connections SET state='SUSPENDED' WHERE id='connection'").run();
      expect((await f.store.listWebPreviews(principal)).previews).toEqual([]);
      expect((await f.store.decideWebPreview(principal, { schemaVersion: "conversation-previews-1", publicId: preview.publicId,
        draftRevision: preview.draftRevision, previewHash: preview.previewHash, decisionToken: preview.decisionToken,
        action: "SAVE_PREVIEW", idempotencyKey: "disabled" })).status).toBe("STALE");
      expect((await f.db.prepare("SELECT count(*) n FROM reminders").first<{n:number}>())?.n).toBe(0);
    } finally { f.close(); }
  });

  it("settles WEB decline and CHAT save with one winner and no partial canonical writes", async () => {
    const f = await fixture();
    try {
      await addConfirmationToken(f);
      const observed = await f.store.observe(f.scope());
      if ("failure" in observed) throw new Error(observed.failure);
      expect((await f.store.apply(f.scope(), observed.observation, f.transition)).status).toBe("APPLIED");
      await f.db.prepare("INSERT INTO inbound_updates(id,connection_id,provider,provider_message_id,provider_user_id,private_chat_id,message_ciphertext,message_iv,message_key_version,state,received_at,transition_marker) VALUES('confirm','connection','telegram','confirm','provider-user','chat',x'01',zeroblob(12),1,'PROCESSING',?,'claim')").bind(now + 1).run();
      const principal = { sessionId: "session", userId: "owner", expiresAt: now + 1_000_000 };
      const preview = (await f.store.listWebPreviews(principal)).previews[0];
      const request = { schemaVersion: "conversation-previews-1" as const, publicId: preview.publicId,
        draftRevision: preview.draftRevision, previewHash: preview.previewHash, decisionToken: preview.decisionToken,
        action: "DECLINE" as const, idempotencyKey: "race-decline" };
      const [web, chat] = await Promise.all([f.store.decideWebPreview(principal, request), f.store.confirm(f.authority, f.proof)]);
      expect([web.status, chat.status].filter(status => status === "DECLINED" || status === "COMMITTED")).toHaveLength(1);
      const count = (await f.db.prepare("SELECT count(*) n FROM reminders").first<{n:number}>())?.n;
      expect(count).toBe(chat.status === "COMMITTED" ? 2 : 0);
    } finally { f.close(); }
  });

  it("routes strict V2 details and preview decisions with owner auth, origin and exact revision", async () => {
    const f = await fixture();
    try {
      await addConfirmationToken(f);
      const observed = await f.store.observe(f.scope());
      if ("failure" in observed) throw new Error(observed.failure);
      expect((await f.store.apply(f.scope(), observed.observation, f.transition)).status).toBe("APPLIED");
      const principal = { sessionId: "session", userId: "owner", expiresAt: now + 1_000_000 };
      const router = createRouter({ contextApiOperations: async () => ({
        requireUser: async () => principal,
        listDetailedReminders: p => listDetailedReminders(p, { store: new D1ReminderApiStore(f.db), contextStore: f.store, keyring: f.keyring }),
        listPreviews: p => f.store.listWebPreviews(p), decidePreview: (p, decision) => f.store.decideWebPreview(p, decision),
      }) });
      const send = (path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) => router(new Request(origin + path, {
        method, headers: { cookie, ...(body ? { "content-type": "application/json", origin } : {}), ...headers },
        body: body ? JSON.stringify(body) : undefined,
      }), env, ctx);
      const previewsResponse = await send("/api/v2/conversation-previews");
      expect(previewsResponse.status).toBe(200);
      const previewsJson = await previewsResponse.json() as {data:{previews:Array<{publicId:string;draftRevision:number;previewHash:string;decisionToken:string}>}};
      expect(PreviewResponseV1Schema.safeParse(previewsJson).success).toBe(true);
      const preview = previewsJson.data.previews[0];
      const decision = { schemaVersion: "conversation-previews-1", publicId: preview.publicId, draftRevision: preview.draftRevision,
        previewHash: preview.previewHash, decisionToken: preview.decisionToken, action: "SAVE_PREVIEW", idempotencyKey: "web-route-op" };
      expect((await send("/api/v2/conversation-previews/decision", "POST", decision, { origin: "https://foreign.example" })).status).toBe(403);
      expect((await send("/api/v2/conversation-previews/decision", "POST", { ...decision, action: "APPROVE" })).status).toBe(400);
      const stale = await send("/api/v2/conversation-previews/decision", "POST", { ...decision, previewHash: "0".repeat(64) });
      expect(stale.status).toBe(409);
      expect(await stale.json()).toMatchObject({ error: { code: "PREVIEW_STALE" } });
      expect((await send("/api/v2/conversation-previews/decision", "POST", decision)).status).toBe(200);
      const detailsResponse = await send("/api/v2/reminders");
      expect(detailsResponse.status).toBe(200);
      expect(ReminderListResponseV2Schema.safeParse(await detailsResponse.json()).success).toBe(true);
      const ids = (await f.db.prepare("SELECT reminder_id FROM reminder_context_details ORDER BY reminder_id").all<{reminder_id:string}>()).results;
      await f.db.prepare("UPDATE reminder_context_details SET payload_ciphertext=(SELECT payload_ciphertext FROM reminder_context_details WHERE reminder_id=?) WHERE reminder_id=?")
        .bind(ids[0].reminder_id, ids[1].reminder_id).run();
      const corrupt = await send("/api/v2/reminders");
      expect(corrupt.status).toBe(500);
      expect(await corrupt.json()).toEqual({ error: { code: "INTERNAL_ERROR", message: "Không thể hoàn tất yêu cầu." } });
    } finally { f.close(); }
  });

  it("checks a live session before exposing or deciding a preview", async () => {
    let reached = false;
    const router = createRouter({ contextApiOperations: async () => ({
      requireUser: async () => { throw new SessionAuthError(); },
      listDetailedReminders: async () => { reached = true; throw new Error("unreachable"); },
      listPreviews: async () => { reached = true; throw new Error("unreachable"); },
      decidePreview: async () => { reached = true; throw new Error("unreachable"); },
    }) });
    const response = await router(new Request(origin + "/api/v2/conversation-previews", { headers: { cookie } }), env, ctx);
    expect(response.status).toBe(401);
    expect(reached).toBe(false);
  });

  it("declines only the exact delivered preview, preserves its unconfirmed request, and replays a lost response", async () => {
    const f = await fixture();
    try {
      await addConfirmationToken(f);
      const observed = await f.store.observe(f.scope());
      if ("failure" in observed) throw new Error(observed.failure);
      expect((await f.store.apply(f.scope(), observed.observation, f.transition)).status).toBe("APPLIED");
      const principal = { sessionId: "session", userId: "owner", expiresAt: now + 1_000_000 };
      const preview = (await f.store.listWebPreviews(principal)).previews[0];
      const request = { schemaVersion: "conversation-previews-1" as const, publicId: preview.publicId,
        draftRevision: preview.draftRevision, previewHash: preview.previewHash, decisionToken: preview.decisionToken,
        action: "DECLINE" as const, idempotencyKey: "web-decline-1" };
      expect((await f.store.decideWebPreview(principal, request)).status).toBe("DECLINED");
      expect((await f.store.decideWebPreview(principal, request)).status).toBe("ALREADY_DECLINED");
      expect((await f.store.decideWebPreview(principal, { ...request, idempotencyKey: "different" })).status).toBe("STALE");
      expect((await f.store.decideWebPreview(principal, { ...request, decisionToken: "forged" })).status).toBe("STALE");
      expect((await f.store.decideWebPreview({ ...principal, expiresAt: now }, request)).status).toBe("STALE");
      const after = await f.store.observe(f.scope(1));
      if ("failure" in after) throw new Error(after.failure);
      expect(after.snapshot?.lifecycle).toBe("CLARIFYING");
      expect(after.snapshot?.requestId).toBe(f.snapshot.requestId);
      expect(after.snapshot?.slots).toEqual(f.snapshot.slots);
      expect(after.snapshot?.draftExpiresAt).toBe(f.snapshot.draftExpiresAt);
      expect(after.snapshot?.pendingDecision).toBeNull();
      expect(after.snapshot?.previewReceipt).toBeNull();
      expect((await f.store.listWebPreviews(principal)).previews).toEqual([]);
      expect((await f.store.decideWebPreview(principal, { ...request, action: "SAVE_PREVIEW" })).status).toBe("STALE");
      expect((await f.db.prepare("SELECT count(*) n FROM reminders").first<{n:number}>())?.n).toBe(0);
      const row = await f.db.prepare("SELECT payload_ciphertext FROM conversation_contexts WHERE id=?").bind(f.snapshot.id).first<{payload_ciphertext:Uint8Array}>();
      expect(JSON.stringify(row)).not.toContain(request.idempotencyKey);
      expect(JSON.stringify(row)).not.toContain(request.decisionToken);
    } finally { f.close(); }
  });

  it("returns an explicit upgrade error for an old strict client facing a long title", async () => {
    const long = { publicId: "A".repeat(22), title: "🙂".repeat(300), scheduledAt: now + 100000,
      timezone: "Asia/Ho_Chi_Minh" as const, status: "PENDING" as const };
    const router = createRouter({ remindersOperations: async () => ({ requireUser: async () => ({ userId: "owner" }),
      listReminders: async () => [long], createReminder: async () => long, cancelReminder: async () => ({ cancelled: true as const }) }) });
    const response = await router(new Request(origin + "/api/reminders", { headers: { cookie } }), env, ctx);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: { code: "CLIENT_UPGRADE_REQUIRED", message: expect.any(String) } });
  });
});
