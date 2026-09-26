// @vitest-environment node
import { afterEach, beforeEach, expect, it } from "vitest";
import { createKeyring } from "@/modules/security/keyring";
import { readFileSync } from "node:fs";
import { D1ConversationStore } from "./context-store";
import { NOW, makeContextHarness } from "./test-support";

let h: Awaited<ReturnType<typeof makeContextHarness>>;
beforeEach(async () => { h = await makeContextHarness(); }, 20_000);
afterEach(async () => { await h?.dispose(); });

it("encrypts bounded context and reads it through the authenticated scope", async () => {
  expect(await h.store.save(h.scope(), null, h.initial)).toBe("SAVED");
  expect(await h.store.load(h.scope(1))).toEqual(h.initial);
  const row = await h.db.prepare("SELECT * FROM conversation_contexts").first();
  expect(JSON.stringify(row)).not.toContain("bí mật");
  expect(JSON.stringify(row)).not.toContain("userText");
  expect(row?.payload_ciphertext).toBeDefined();
});

it.each(["owner", "chat", "claim"])("rejects mismatched %s without changing data", async mismatch => {
  const scope = {...h.scope(), ...(mismatch === "owner" ? {ownerId: "two"} : mismatch === "chat" ? {chatIdentityId: "chat-two"} : {claimMarker: "stale"})};
  expect(await h.store.save(scope, null, h.initial)).toBe("STALE");
  expect(await h.store.load(scope)).toBeNull();
  expect(await h.store.save(h.scope(), null, h.initial)).toBe("SAVED");
  expect(await h.store.load(scope)).toBeNull();
  expect(await h.store.finish(scope, h.initial.id, 1, "CANCELLED")).toBe(false);
  expect(await h.store.load(h.scope(1))).toEqual(h.initial);
});

it("permits one active context and one winner at a revision under concurrency", async () => {
  const creation = await Promise.all([h.store.save(h.scope(), null, h.initial),
    h.store.save(h.scope(1), null, {...h.initial, id: "other"})]);
  expect(creation.filter(x => x === "SAVED")).toHaveLength(1);
  const current = await h.store.load(h.scope(2));
  if (!current) throw new Error("missing context");
  const next = {...current, revision: 2};
  const writes = await Promise.all([h.store.save(h.scope(2), 1, next), h.store.save(h.scope(3), 1, next)]);
  expect(writes.sort()).toEqual(["SAVED", "STALE"]);
  expect((await h.store.load(h.scope(4)))?.revision).toBe(2);
});

it("a source inbound cannot advance twice or replay after completion", async () => {
  expect(await h.store.save(h.scope(), null, h.initial)).toBe("SAVED");
  expect(await h.store.save(h.scope(), 1, {...h.initial, revision: 2})).toBe("STALE");
  expect(await h.store.finish(h.scope(1), h.initial.id, 1, "COMPLETED")).toBe(true);
  expect(await h.store.finish(h.scope(1), h.initial.id, 1, "COMPLETED")).toBe(true);
  expect(await h.store.save(h.scope(), null, {...h.initial, id: "replayed"})).toBe("STALE");
  expect(await h.db.prepare("SELECT count(*) AS count FROM conversation_contexts").first()).toEqual({count: 1});
});

it.each(["COMPLETED", "CANCELLED", "INVALID"] as const)("purges ciphertext when terminalized %s", async status => {
  await h.store.save(h.scope(), null, h.initial);
  expect(await h.store.finish(h.scope(1), h.initial.id, 1, status)).toBe(true);
  expect(await h.store.load(h.scope(2))).toBeNull();
  expect(await h.db.prepare("SELECT status, payload_ciphertext, payload_iv, key_version FROM conversation_contexts").first())
    .toEqual({status, payload_ciphertext: null, payload_iv: null, key_version: null});
});

it.each(["key", "ciphertext", "aad", "schema"])("fails closed for invalid %s", async failure => {
  await h.store.save(h.scope(), null, h.initial);
  let store = h.store;
  if (failure === "key") store = new D1ConversationStore(h.db, await createKeyring(Buffer.alloc(32, 1).toString("base64url")));
  else if (failure === "ciphertext") await h.db.prepare("UPDATE conversation_contexts SET payload_ciphertext = zeroblob(32)").run();
  else {
    const encrypted = await h.keyring.encryptSensitive("conversation-context", failure === "aad" ? "wrong-id" : JSON.stringify(["one", "chat-one", h.initial.id]),
      1, failure === "schema" ? "{}" : JSON.stringify(h.initial));
    await h.db.prepare("UPDATE conversation_contexts SET payload_ciphertext = ?, payload_iv = ?").bind(encrypted.ciphertext, encrypted.iv).run();
  }
  await expect(store.load(h.scope(1))).rejects.toThrow("INVALID_CONVERSATION_CONTEXT");
});

it("rejects seventh turn, overlong Unicode and total UTF-8 byte overflow", async () => {
  for (const turns of [Array(7).fill(h.initial.turns[0]),
    [{...h.initial.turns[0], userText: "😀".repeat(2001)}],
    Array(6).fill({...h.initial.turns[0], userText: "😀".repeat(1000)})]) {
    expect(await h.store.save(h.scope(), null, {...h.initial, turns})).toBe("INVALID");
  }
  expect(await h.store.save(h.scope(), null, {...h.initial, turns: Array(6).fill(h.initial.turns[0])})).toBe("SAVED");
});

it("does not extend absolute lifetime or resurrect an expired context", async () => {
  expect(await h.store.save(h.scope(), null, {...h.initial, expiresAt: NOW + 2 * 60 * 60_000 + 1})).toBe("INVALID");
  await h.store.save(h.scope(), null, h.initial);
  const expired = {...h.scope(1), now: h.initial.expiresAt};
  expect(await h.store.load(expired)).toBeNull();
  expect(await h.store.save(expired, 1, {...h.initial, revision: 2, expiresAt: expired.now + 60_000})).not.toBe("SAVED");
  expect(await h.store.purgeExpired(expired.now, 1)).toBe(1);
  expect(await h.db.prepare("SELECT payload_ciphertext, status FROM conversation_contexts").first()).toEqual({payload_ciphertext: null, status: "EXPIRED"});
  expect(await h.store.purgeExpired(expired.now, 1)).toBe(0);
});

it("cannot change context creation time, use a stale revision or supersede a later durable outcome", async () => {
  await h.store.save(h.scope(1), null, h.initial);
  expect(await h.store.save(h.scope(2), 1, {...h.initial, revision: 2, createdAt: NOW + 1,
    turns: [{...h.initial.turns[0], receivedAt: NOW + 1}]})).toBe("STALE");
  expect(await h.store.save(h.scope(2), 9, {...h.initial, revision: 10})).toBe("STALE");
  await h.db.prepare("UPDATE inbound_updates SET state='PROCESSED' WHERE id='one-10'").run();
  expect(await h.store.save(h.scope(2), 1, {...h.initial, revision: 2})).toBe("STALE");
  expect(await h.store.finish(h.scope(2), h.initial.id, 1, "CANCELLED")).toBe(false);
});

it("a new owned request expires its old buffer atomically without waiting for cron", async () => {
  await h.store.save(h.scope(), null, h.initial);
  const now = h.initial.expiresAt + 1;
  const next = {...h.initial, id: "new-conversation", createdAt: now, expiresAt: now + 60_000,
    turns: [{...h.initial.turns[0], receivedAt: now}]};
  expect(await h.store.save({...h.scope(1), now}, null, next)).toBe("SAVED");
  expect(await h.db.prepare("SELECT status,payload_ciphertext FROM conversation_contexts WHERE id = ?").bind(h.initial.id).first())
    .toEqual({status: "EXPIRED", payload_ciphertext: null});
});

it("binds ciphertext to owner and chat, not just a globally unique row ID", async () => {
  await h.store.save(h.scope(), null, h.initial);
  await h.db.prepare("UPDATE conversation_contexts SET owner_id = 'two', chat_identity_id = 'chat-two'").run();
  await expect(h.store.load({...h.scope(1), ownerId: "two", chatIdentityId: "chat-two", sourceInboundId: "two-1"}))
    .rejects.toThrow("INVALID_CONVERSATION_CONTEXT");
});

it("enforces active ciphertext metadata in the database itself", async () => {
  await h.store.save(h.scope(), null, h.initial);
  await expect(h.db.prepare("UPDATE conversation_contexts SET key_version = NULL").run()).rejects.toThrow();
});

it("purges at most 100 rows through the expiry index and retains content-free history", async () => {
  await h.store.save(h.scope(), null, h.initial);
  const statements: D1PreparedStatement[] = [];
  for (let index = 1; index <= 100; index++) {
    statements.push(h.db.prepare(`INSERT INTO bot_connections
      (id,user_id,provider,public_id,provider_bot_id,display_name,encrypted_token,encrypted_token_iv,token_fingerprint,credential_version,state,created_at,updated_at)
      VALUES (?,'one','telegram',?,?,'Synthetic',x'01',zeroblob(12),?,1,'ACTIVE_BOUND',1,1)`)
      .bind(`purge-connection-${index}`, `purge-public-${index}`, `purge-bot-${index}`, `purge-fingerprint-${index}`));
    statements.push(h.db.prepare(`INSERT INTO chat_identities (id, connection_id, provider_user_id, private_chat_id, linked_at)
      VALUES (?, ?, ?, ?, 1)`).bind(`purge-chat-${index}`, `purge-connection-${index}`, `purge-user-${index}`, `purge-private-${index}`));
    statements.push(h.db.prepare(`INSERT INTO inbound_updates
      (id,connection_id,provider,provider_message_id,provider_user_id,private_chat_id,message_ciphertext,message_iv,message_key_version,state,received_at)
      VALUES (?,?,'telegram',?,?,?,x'01',zeroblob(12),1,'PROCESSED',?)`)
      .bind(`purge-in-${index}`, `purge-connection-${index}`, `purge-message-${index}`, `purge-user-${index}`, `purge-private-${index}`, NOW));
    statements.push(h.db.prepare(`INSERT INTO conversation_contexts
      SELECT ?,owner_id,?,?,?,'claim',revision,status,created_at,updated_at,expires_at,payload_ciphertext,payload_iv,key_version
      FROM conversation_contexts WHERE id = ?`)
      .bind(`purge-ctx-${index}`, `purge-chat-${index}`, `purge-in-${index}`, `purge-in-${index}`, h.initial.id));
  }
  await h.db.batch(statements);
  expect(await h.store.purgeExpired(h.initial.expiresAt, 1000)).toBe(100);
  expect(await h.store.purgeExpired(h.initial.expiresAt, 1000)).toBe(1);
  expect(await h.db.prepare("SELECT count(*) AS count FROM conversation_context_outcomes").first()).toEqual({count: 1});
  const plan = await h.db.prepare(`EXPLAIN QUERY PLAN SELECT id FROM conversation_contexts
    WHERE status IN ('CLARIFYING','DRAFT_READY') AND expires_at <= ? ORDER BY expires_at,id LIMIT 100`).bind(h.initial.expiresAt).all();
  expect(JSON.stringify(plan.results)).toContain("idx_conversation_expiry");
}, 20_000);

it("retains legacy encrypted context and rejects creation while a V1 draft is confirmable", async () => {
  const encrypted = await h.keyring.encryptSensitive("semantic-context", "legacy", 1,
    JSON.stringify({targetIntent: "CREATE_REMINDER", title: "legacy", localDate: null, localTime: null, missingFields: ["date"]}));
  await h.db.prepare(`INSERT INTO semantic_contexts
    (id,owner_id,chat_identity_id,source_inbound_id,target_intent,context_ciphertext,context_iv,context_key_version,status,expires_at,created_at,updated_at)
    VALUES ('legacy','one','chat-one','one-0','CREATE_REMINDER',?,?,1,'PENDING',?,?,?)`)
    .bind(encrypted.ciphertext, encrypted.iv, NOW + 60_000, NOW, NOW).run();
  const before = await h.db.prepare("SELECT * FROM semantic_contexts").first();
  await h.db.prepare(`INSERT INTO command_drafts
    (id,chat_identity_id,source_inbound_id,title_ciphertext,title_iv,title_key_version,scheduled_at,timezone,status,expires_at,created_at,updated_at)
    VALUES ('legacy-draft','chat-one','one-1',x'01',zeroblob(12),1,?,'Asia/Ho_Chi_Minh','PENDING',?,?,?)`)
    .bind(NOW + 100_000, NOW + 60_000, NOW, NOW).run();
  expect(await h.store.save(h.scope(2), null, h.initial)).toBe("STALE");
  expect(await h.db.prepare("SELECT * FROM semantic_contexts").first()).toEqual(before);
});

it("never reads an expired draft even within the conversation idle TTL", async () => {
  await h.store.save(h.scope(), null, {...h.initial, status: "DRAFT_READY", expiresAt: NOW + 600_000});
  expect(await h.store.load({...h.scope(1), now: NOW + 600_000})).toBeNull();
});

it("a no-op revision replay cannot invalidate a draft written after the original CAS", async () => {
  await h.store.save(h.scope(), null, h.initial);
  const next = { ...h.initial, revision: 2 };
  expect(await h.store.save(h.scope(1), 1, next)).toBe("SAVED");
  // Emulate an old Worker finishing an already-started legacy draft write.
  await h.db.prepare(`INSERT INTO command_drafts
    (id,chat_identity_id,source_inbound_id,title_ciphertext,title_iv,title_key_version,scheduled_at,timezone,status,expires_at,created_at,updated_at)
    VALUES ('late-draft','chat-one','one-0',x'01',zeroblob(12),1,?,'Asia/Ho_Chi_Minh','PENDING',?,?,?)`)
    .bind(NOW + 100_000, NOW + 60_000, NOW, NOW).run();
  expect(await h.store.save({ ...h.scope(1), claimMarker: "revoked" }, 1, next)).toBe("STALE");
  expect(await h.db.prepare("SELECT status FROM command_drafts WHERE id = 'late-draft'").first("status")).toBe("PENDING");
});

it("rolls back a context revision if its durable outcome cannot be recorded", async () => {
  await h.store.save(h.scope(), null, h.initial);
  await h.db.prepare(`INSERT INTO conversation_context_outcomes
    VALUES (?,2,'one-0','FINISH',?)`).bind(h.initial.id, NOW).run();
  expect(await h.store.save(h.scope(1), 1, {...h.initial, revision: 2})).toBe("STALE");
  expect(await h.store.load(h.scope(1))).toEqual(h.initial);
});

it("the additive migration is replay-safe with populated legacy and V2 tables", async () => {
  await h.store.save(h.scope(), null, h.initial);
  const before = await h.db.prepare("SELECT * FROM conversation_contexts").all();
  const migration = readFileSync(new URL("../../../../../migrations/0007_conversation_context_v2.sql", import.meta.url), "utf8");
  for (const statement of migration.split(";").map(s => s.trim()).filter(Boolean)) await h.db.prepare(statement).run();
  expect(await h.db.prepare("SELECT * FROM conversation_contexts").all()).toMatchObject({results: before.results});
  expect(await h.store.load(h.scope(1))).toEqual(h.initial);
});
