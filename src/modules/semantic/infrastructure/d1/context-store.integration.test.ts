// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Miniflare } from "miniflare";
import { createKeyring, type Keyring } from "@/modules/security/keyring";
import { D1SemanticContextStore } from "./context-store";
import { NOW, seedSemanticRuntime, semanticRuntime } from "./runtime.test-support";

let runtime: Miniflare;
let db: D1Database;
let keyring: Keyring;
let directory: string;
const slots = { targetIntent: "CREATE_REMINDER" as const, title: "Gọi mẹ bí mật", localDate: "2026-09-17", localTime: null, missingFields: ["time" as const] };
const pending = () => ({ id: "context-one", ownerId: "one", chatIdentityId: "chat-one", sourceInboundId: "one-0", claimMarker: "claim", slots, now: NOW, expiresAt: NOW + 60_000 });
const store = () => new D1SemanticContextStore(db, keyring);
const read = (ownerId = "one", chatIdentityId = "chat-one", now = NOW) => store().findPending({ ownerId, chatIdentityId, now });

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "calenote-semantic-d1-"));
  ({ db, runtime } = await semanticRuntime(directory));
  await seedSemanticRuntime(db);
  keyring = await createKeyring("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
}, 20_000);
afterEach(async () => {
  await runtime?.dispose();
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe("encrypted semantic context on disposable workerd D1", () => {
  it("encrypts minimal slots and rereads them after a real runtime restart", async () => {
    expect(await store().createPending(pending())).toBe("CREATED");
    const row = await db.prepare("SELECT * FROM semantic_contexts").first();
    expect(JSON.stringify(row)).not.toContain(slots.title);
    expect(JSON.stringify(row)).not.toContain(slots.localDate);
    await runtime.dispose();
    ({ db, runtime } = await semanticRuntime(directory));
    expect(await read()).toMatchObject({ id: "context-one", slots });
    const encrypted = await db.prepare("SELECT context_ciphertext, context_iv FROM semantic_contexts").first();
    expect(encrypted?.context_ciphertext).toBeDefined();
  });

  it("keeps one pending context per bound chat and source creation idempotent", async () => {
    const result = await Promise.all([store().createPending(pending()), store().createPending({ ...pending(), id: "context-two", sourceInboundId: "one-1" })]);
    expect(result.filter((value) => value === "CREATED")).toHaveLength(1);
    expect(result.filter((value) => value === "CONFLICT")).toHaveLength(1);
    const current = await read();
    if (!current) throw new Error("Expected context");
    expect(await store().createPending({ ...pending(), id: current.id, sourceInboundId: current.sourceInboundId })).toBe("ALREADY_EXISTS");
    expect(await db.prepare("SELECT count(*) AS count FROM semantic_contexts").first()).toEqual({ count: 1 });
  });

  it("rejects foreign owners, foreign chats, stale claims and unbound connections", async () => {
    expect(await store().createPending({ ...pending(), ownerId: "two" })).toBe("CONFLICT");
    expect(await store().createPending({ ...pending(), chatIdentityId: "chat-two" })).toBe("CONFLICT");
    expect(await store().createPending({ ...pending(), claimMarker: "stale" })).toBe("CONFLICT");
    expect(await store().createPending(pending())).toBe("CREATED");
    expect(await read("two")).toBeNull();
    expect(await read("one", "chat-two")).toBeNull();
    await db.prepare("UPDATE bot_connections SET state = 'SUSPENDED' WHERE user_id = 'one'").run();
    expect(await read()).toBeNull();
  });

  it("expires at TTL and permits a new context without reviving the prior source", async () => {
    await store().createPending(pending());
    expect(await read("one", "chat-one", NOW + 60_000)).toBeNull();
    expect(await db.prepare("SELECT status FROM semantic_contexts").first()).toEqual({ status: "EXPIRED" });
    expect(await store().createPending({ ...pending(), id: "new-context", sourceInboundId: "one-1", now: NOW + 60_000, expiresAt: NOW + 120_000 })).toBe("CREATED");
    expect(await store().createPending(pending())).toBe("ALREADY_EXISTS");
  });

  it.each(["RESOLVED", "CANCELLED"] as const)("terminalizes %s once by a later claimed resolution inbound", async (status) => {
    await store().createPending(pending());
    const input = { id: "context-one", ownerId: "one", chatIdentityId: "chat-one", resolutionInboundId: "one-1", claimMarker: "claim", status, now: NOW + 1 };
    expect(await store().resolve({ ...input, resolutionInboundId: "one-0" })).toBe(false);
    expect(await store().resolve({ ...input, ownerId: "two" })).toBe(false);
    expect(await store().resolve(input)).toBe(true);
    expect(await store().resolve(input)).toBe(true);
    expect(await store().resolve({ ...input, resolutionInboundId: "one-2" })).toBe(false);
    expect(await read()).toBeNull();
    expect(await store().createPending({ ...pending(), id: "next-context", sourceInboundId: "one-2" })).toBe("CREATED");
    expect(await store().resolve({ ...input, id: "next-context" })).toBe(false);
  });

  it("rejects transcript-like extra fields, oversized slots and invalid TTL before persisting", async () => {
    for (const bad of [
      { ...pending(), slots: { ...slots, transcript: "private text" } },
      { ...pending(), slots: { ...slots, title: "x".repeat(1801) } },
      { ...pending(), expiresAt: NOW },
      { ...pending(), expiresAt: NOW + 1_800_001 },
    ]) await expect(store().createPending(bad)).rejects.toThrow();
    expect(await db.prepare("SELECT count(*) AS count FROM semantic_contexts").first()).toEqual({ count: 0 });
  });

  it("cannot reuse a resolution inbound for a different context even if it is later than both sources", async () => {
    await store().createPending(pending());
    const resolution = { id: "context-one", ownerId: "one", chatIdentityId: "chat-one", resolutionInboundId: "one-3", claimMarker: "claim", status: "RESOLVED" as const, now: NOW + 3 };
    expect(await store().resolve(resolution)).toBe(true);
    expect(await store().createPending({ ...pending(), id: "next", sourceInboundId: "one-2" })).toBe("CREATED");
    expect(await store().resolve({ ...resolution, id: "next" })).toBe(false);
    expect(await read()).toMatchObject({ id: "next" });
  });

  it("binds encrypted slots to context identity and fails closed on ciphertext tampering", async () => {
    await store().createPending(pending());
    await db.prepare("UPDATE semantic_contexts SET id = 'swapped-id'").run();
    await expect(read()).rejects.toThrow("Unable to decrypt ciphertext");
  });
});
