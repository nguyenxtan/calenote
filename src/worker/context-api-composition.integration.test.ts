// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { fixture, now } from "@/modules/conversation/context-contract/infrastructure/d1/test-support";
import { addConfirmationToken } from "@/modules/conversation/context-contract/confirmation-test-support";
import { createD1ContextContractStoreV3 } from "@/modules/conversation/context-contract/infrastructure/d1/store";
import { CONTEXT_PROTOCOL_V3 } from "@/modules/conversation/context-contract/protocol";
import { ContextSnapshotV2Schema } from "@/modules/conversation/context-contract/state";
import { createKeyring } from "@/modules/security/keyring";
import { SqliteD1Database } from "@/testing/sqlite-d1.test-support";
import { createContextApiOperations } from "./composition-root";
import { createRouter } from "./router";

const origin = "https://calenote.iconiclogs.com";
const bearer = "A".repeat(43);
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
const capability = { contextContract: "calenote-context-2" as const, sourceSha: "a".repeat(40) };
const disposers: Array<() => void> = [];
afterEach(() => { vi.restoreAllMocks(); for (const close of disposers.splice(0)) close(); });
function environment(db: D1Database): Env {
  return { DB: db, JOBS: { send: async () => {} }, ASSETS: { fetch: async () => new Response("missing") },
    APP_ORIGIN: origin, CALENOTE_RUNTIME_ENVIRONMENT: "production", CALENOTE_MASTER_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" } as unknown as Env;
}
function request(path: string, body?: unknown) {
  return new Request(origin + path, { method: body === undefined ? "GET" : "POST", headers: {
    cookie: `__Host-calenote_session=${bearer}`, ...(body === undefined ? {} : { origin, "content-type": "application/json" }),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function authorizedFixture() {
  vi.spyOn(Date, "now").mockReturnValue(now + 1);
  const f = await fixture(); disposers.push(f.close);
  await f.db.prepare("UPDATE sessions SET digest=? WHERE id='session'").bind(await f.keyring.digestSession(bearer)).run();
  await addConfirmationToken(f);
  const store = createD1ContextContractStoreV3({ db: f.db, keyring: f.keyring, protocol: CONTEXT_PROTOCOL_V3 });
  const observation = await store.observe(f.scope());
  if ("failure" in observation) throw Error(observation.failure);
  const snapshot = ContextSnapshotV2Schema.parse({ ...f.snapshot, schemaVersion: "calenote-context-state-2", pendingSemanticCandidate: null });
  expect(await store.apply(f.scope(), observation.observation, { ...f.transition, snapshot })).toMatchObject({ status: "APPLIED" });
  return { ...f, store };
}
describe("real Context API factory composition", () => {
  it("keeps the default factory independent of successor schema on migrations 0001–0008", async () => {
    const db = new SqliteD1Database(); disposers.push(() => db.close());
    const operations = await createContextApiOperations(environment(db as unknown as D1Database));
    const principal = { sessionId: "session", userId: "owner", expiresAt: now + 10000 };
    await expect(operations.listPreviews(principal)).resolves.toEqual({ previews: [], hasMore: false });
    await expect(operations.listDetailedReminders(principal)).rejects.toMatchObject({ code: "PREVIEW_UNAVAILABLE" });
    await expect(operations.decidePreview(principal, {} as never)).rejects.toMatchObject({ code: "PREVIEW_UNAVAILABLE" });
    expect(await db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='reminder_context_details'").first("n")).toBe(0);
    vi.spyOn(Date, "now").mockReturnValue(now + 1);
    const keyring = await createKeyring("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    await db.prepare("INSERT INTO users VALUES('owner','owner@example.test','Test','Asia/Ho_Chi_Minh',1,1)").run();
    await db.prepare("INSERT INTO sessions VALUES('session','owner',?,?,NULL,1)")
      .bind(await keyring.digestSession(bearer), now + 1000000).run();
    const env = environment(db as unknown as D1Database);
    const router = createRouter({ contextApiOperations: () => createContextApiOperations(env) });
    expect((await router(request("/api/v2/reminders"), env, ctx)).status).toBe(409);
    const listed = await router(request("/api/v2/conversation-previews"), env, ctx);
    expect(listed.status).toBe(200);
    expect(await listed.json()).toMatchObject({ data: { previews: [], hasMore: false } });
  });
  it.each([undefined, "unknown", "g".repeat(40)])("rejects opt-in without a valid explicit source SHA %s", async sourceSha => {
    await expect(createContextApiOperations(environment({} as D1Database), { contextContract: "calenote-context-2", sourceSha })).rejects.toThrow("Source SHA required");
  });
  it("uses actual V3 store and session through router for exact preview, save, replay and full details", async () => {
    const f = await authorizedFixture(), env = environment(f.db);
    const router = createRouter({ contextApiOperations: () => createContextApiOperations(env, capability) });
    const listed = await router(request("/api/v2/conversation-previews"), env, ctx);
    expect(listed.status).toBe(200);
    const previews = (await listed.json() as { data: { previews: Array<Record<string, unknown>> } }).data.previews;
    expect(previews).toHaveLength(1);
    const preview = previews[0];
    const body = { schemaVersion: "conversation-previews-1", publicId: preview.publicId, draftRevision: preview.draftRevision,
      previewHash: preview.previewHash, decisionToken: preview.decisionToken, action: "SAVE_PREVIEW", idempotencyKey: "factory-save-one" };
    const save = await router(request("/api/v2/conversation-previews/decision", body), env, ctx);
    expect(save.status).toBe(200);
    expect(await save.json()).toMatchObject({ data: { result: "COMMITTED", childCount: 2 } });
    const replay = await router(request("/api/v2/conversation-previews/decision", body), env, ctx);
    expect(await replay.json()).toMatchObject({ data: { result: "IDEMPOTENT" } });
    const details = await router(request("/api/v2/reminders"), env, ctx);
    expect(details.status).toBe(200);
    expect(await details.json()).toMatchObject({ data: { scope: "OWNER", reminders: [ { details: f.preview.details }, { details: f.preview.details } ] } });
    expect(await f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(2);
    await f.db.prepare("UPDATE sessions SET revoked_at=? WHERE id='session'").bind(now + 1).run();
    expect((await router(request("/api/v2/conversation-previews/decision", body), env, ctx)).status).toBe(401);
  });
  it("keeps owner isolation and authenticated decline behind the real opted-in factory", async () => {
    const f = await authorizedFixture(), env = environment(f.db);
    const operations = await createContextApiOperations(env, capability);
    const principal = await operations.requireUser({ bearer });
    const { previews } = await operations.listPreviews(principal);
    const preview = previews[0];
    const body = { schemaVersion: "conversation-previews-1" as const, publicId: preview.publicId,
      draftRevision: preview.draftRevision, previewHash: preview.previewHash, decisionToken: preview.decisionToken,
      action: "DECLINE" as const, idempotencyKey: "factory-decline-one" };
    await f.db.prepare("INSERT INTO users VALUES('intruder','intruder@example.test','Other','Asia/Ho_Chi_Minh',1,1)").run();
    const otherBearer = "B".repeat(43);
    await f.db.prepare("INSERT INTO sessions VALUES('other-session','intruder',?,?,NULL,1)")
      .bind(await f.keyring.digestSession(otherBearer), now + 1000000).run();
    const other = await operations.requireUser({ bearer: otherBearer });
    expect(await operations.listPreviews(other)).toEqual({ previews: [], hasMore: false });
    expect(await operations.decidePreview(other, body)).toEqual({ status: "STALE" });
    expect((await operations.listDetailedReminders(other)).reminders).toEqual([]);
    expect(await operations.decidePreview(principal, body)).toEqual({ status: "DECLINED" });
    expect(await operations.decidePreview(principal, body)).toEqual({ status: "ALREADY_DECLINED" });
    expect(await f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
    expect(await operations.listPreviews(principal)).toEqual({ previews: [], hasMore: false });
  });

});
