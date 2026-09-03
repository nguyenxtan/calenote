import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import type { InboundTextMessage } from "@/modules/connections/contracts";
import { parseTelegramWebhook } from "@/modules/connections/providers/telegram";
import { readBoundedJson } from "@/modules/http/body";
import { createKeyring } from "@/modules/security/keyring";
import {
  INBOUND_DISPATCH_LEASE_MS,
  type InboundDispatchReservation,
  type InboundDispatchResult,
  type InboundDispatchStore,
} from "@/modules/reminders/scheduler";
import {
  acceptWebhook,
  D1InboundWebhookStore,
  type InboundRecord,
  type InboundStore,
} from "./webhook";

const connection = {
  id: "connection-1",
  provider: "telegram" as const,
  publicId: "AAAAAAAAAAAAAAAAAAAAAA",
};

const parsedMessage: InboundTextMessage = {
  provider: "telegram",
  providerMessageId: "message-1",
  providerUserId: "user-e\u0301",
  privateChatId: "chat-e\u0301",
  displayName: "Nguye\u0302n",
  text: "Xin cha\u0300o\r\nNga\u0300y mai\rnhắc tôi",
  receivedAt: 1_700_000_000_000,
};

function request(body: unknown = { update_id: 1 }, headers: HeadersInit = {}) {
  return new Request("https://calenote.iconiclogs.com/webhooks/telegram/opaque/secret", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

class MemoryStore implements InboundStore, InboundDispatchStore {
  readonly rows: InboundRecord[] = [];
  readonly events: string[] = [];

  async findDuplicate(
    provider: InboundRecord["provider"],
    connectionId: string,
    privateChatId: string,
    providerMessageId: string,
  ): Promise<InboundRecord | null> {
    return this.rows.find((row) =>
      row.provider === provider &&
      row.connectionId === connectionId &&
      row.privateChatId === privateChatId &&
      row.providerMessageId === providerMessageId
    ) ?? null;
  }

  async insert(record: InboundRecord): Promise<boolean> {
    this.events.push("insert");
    if (await this.findDuplicate(
      record.provider,
      record.connectionId,
      record.privateChatId,
      record.providerMessageId,
    )) return false;
    this.rows.push(record);
    return true;
  }

  async selectOrphans(): Promise<string[]> {
    return this.rows.map(({ id }) => id);
  }

  async reserve(inboundId: string, now: number, marker: string): Promise<InboundDispatchResult> {
    const row = this.rows.find(({ id }) => id === inboundId);
    if (!row) return { status: "MISSING" };
    if (row.state !== "PENDING" && row.state !== "PROCESSING") return { status: "TERMINAL" };
    const dispatchStartedAt = row.dispatchStartedAt;
    if (
      dispatchStartedAt !== null
      && dispatchStartedAt > now - INBOUND_DISPATCH_LEASE_MS
    ) {
      return {
        status: "LEASED",
        retryAfterMs: dispatchStartedAt + INBOUND_DISPATCH_LEASE_MS - now,
      };
    }
    const reservation: InboundDispatchReservation = {
      inboundId,
      marker,
      previousStartedAt: row.dispatchStartedAt,
      previousAttemptCount: row.dispatchAttemptCount,
      previousMarker: row.dispatchMarker,
    };
    row.dispatchStartedAt = now;
    row.dispatchAttemptCount += 1;
    row.dispatchMarker = marker;
    this.events.push("reserve");
    return { status: "RESERVED", reservation };
  }

  async rollback(reservation: InboundDispatchReservation): Promise<boolean> {
    const row = this.rows.find(({ id }) => id === reservation.inboundId);
    if (!row || row.dispatchMarker !== reservation.marker) return false;
    row.dispatchStartedAt = reservation.previousStartedAt;
    row.dispatchAttemptCount = reservation.previousAttemptCount;
    row.dispatchMarker = reservation.previousMarker;
    this.events.push("rollback");
    return true;
  }
}

function dependencies(store = new MemoryStore()) {
  let random = 0;
  const enqueue = vi.fn(async ({ inboundId }: { type: "PROCESS_INBOUND"; inboundId: string }) => {
    store.events.push(`enqueue:${inboundId}`);
  });
  const parseWebhook = vi.fn<(payload: unknown) => InboundTextMessage | null>(() => parsedMessage);
  return {
    store,
    dispatchStore: store,
    enqueue,
    parseWebhook,
    keyring: {
      encryptSensitive: vi.fn(async (
        purpose: string,
        entityId: string,
        version: number,
        plaintext: string,
      ) => ({
        ciphertext: new TextEncoder().encode(`sealed:${purpose}:${entityId}:${version}:${plaintext}`).buffer,
        iv: new Uint8Array(12).fill(7).buffer,
      })),
    },
    now: () => 1_700_000_010_000,
    randomBytes: (length: number) => new Uint8Array(length).fill(++random),
    readJson: undefined as typeof readBoundedJson | undefined,
  };
}

describe("authenticated webhook acceptance", () => {
  it.each([
    { label: "non-JSON", headers: { "content-type": "text/plain" }, body: "hello", status: 415 },
    { label: "declared oversized", headers: { "content-length": "32769" }, body: "{}", status: 413 },
  ])("rejects $label bodies without parsing or persistence", async ({ headers, body, status }) => {
    const deps = dependencies();

    const response = await acceptWebhook(request(body, headers as unknown as HeadersInit), connection, deps);

    expect(response.status).toBe(status);
    expect(deps.parseWebhook).not.toHaveBeenCalled();
    expect(deps.store.rows).toHaveLength(0);
    expect(deps.enqueue).not.toHaveBeenCalled();
  });

  it("enforces the streamed 32 KiB cap", async () => {
    const deps = dependencies();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(20_000).fill(32));
        controller.enqueue(new Uint8Array(13_000).fill(32));
        controller.close();
      },
    });
    const oversized = new Request("https://calenote.iconiclogs.com/webhooks/telegram/a/b", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      // Required by Node's Request implementation for a streaming request body.
      duplex: "half",
    } as RequestInit);

    const response = await acceptWebhook(oversized, connection, deps);

    expect(response.status).toBe(413);
    expect(deps.store.rows).toHaveLength(0);
  });

  it("rejects malformed JSON before adapter parsing", async () => {
    const deps = dependencies();

    const response = await acceptWebhook(request("{"), connection, deps);

    expect(response.status).toBe(400);
    expect(deps.parseWebhook).not.toHaveBeenCalled();
    expect(deps.store.rows).toHaveLength(0);
  });

  it("cancels a body that exceeds the absolute read deadline", async () => {
    const deps = dependencies();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        setTimeout(() => {
          if (!cancelled) {
            controller.enqueue(new TextEncoder().encode("{}"));
            controller.close();
          }
        }, 30);
      },
      cancel() {
        cancelled = true;
      },
    });
    const slow = new Request("https://calenote.iconiclogs.com/webhooks/telegram/a/b", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      duplex: "half",
    } as RequestInit);
    deps.readJson = (input, maximumBytes) => readBoundedJson(input, maximumBytes, { timeoutMs: 5 });

    const response = await acceptWebhook(slow, connection, deps);

    expect(response.status).toBe(408);
    expect(cancelled).toBe(true);
    expect(deps.parseWebhook).not.toHaveBeenCalled();
  });

  it("returns 204 for unsupported or group events without persisting", async () => {
    const deps = dependencies();
    deps.parseWebhook.mockReturnValue(null);

    const response = await acceptWebhook(request(), connection, deps);

    expect(response.status).toBe(204);
    expect(deps.store.rows).toHaveLength(0);
    expect(deps.enqueue).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "group",
      payload: { update_id: 1, message: { message_id: 1, date: 1, text: "ignored", chat: { id: 1, type: "group" }, from: { id: 2, first_name: "Bot", is_bot: false } } },
    },
    {
      label: "bot",
      payload: { update_id: 2, message: { message_id: 2, date: 1, text: "ignored", chat: { id: 1, type: "private" }, from: { id: 2, first_name: "Bot", is_bot: true } } },
    },
    {
      label: "non-text",
      payload: { update_id: 3, message: { message_id: 3, date: 1, photo: [], chat: { id: 1, type: "private" }, from: { id: 2, first_name: "Sender", is_bot: false } } },
    },
  ])("drops real Telegram $label events before persistence", async ({ payload }) => {
    const deps = dependencies();
    deps.parseWebhook.mockImplementation(parseTelegramWebhook);

    const response = await acceptWebhook(request(payload), connection, deps);

    expect(response.status).toBe(204);
    expect(deps.store.rows).toHaveLength(0);
    expect(deps.enqueue).not.toHaveBeenCalled();
  });

  it("normalizes and encrypts accepted text, inserts before publishing, and never queues content", async () => {
    const deps = dependencies();

    const response = await acceptWebhook(request(), connection, deps);

    expect(response.status).toBe(200);
    expect(deps.store.rows).toHaveLength(1);
    const row = deps.store.rows[0];
    expect(row).toMatchObject({
      connectionId: "connection-1",
      provider: "telegram",
      providerMessageId: "message-1",
      providerUserId: "user-é",
      privateChatId: "chat-é",
      displayName: "Nguyên",
      state: "PENDING",
      processingStartedAt: null,
      attemptCount: 0,
      dispatchStartedAt: deps.now(),
      dispatchAttemptCount: 1,
      dispatchMarker: expect.any(String),
      safeErrorCode: null,
    });
    expect(row).not.toHaveProperty("text");
    expect(new TextDecoder().decode(row.messageCiphertext)).toContain("Xin chào\nNgày mai\nnhắc tôi");
    expect(deps.keyring.encryptSensitive).toHaveBeenCalledWith(
      "inbound-message",
      row.id,
      1,
      "Xin chào\nNgày mai\nnhắc tôi",
    );
    expect(deps.store.events).toEqual(["insert", "reserve", `enqueue:${row.id}`]);
    expect(deps.enqueue).toHaveBeenCalledWith({ type: "PROCESS_INBOUND", inboundId: row.id });
    expect(JSON.stringify(deps.enqueue.mock.calls)).not.toContain("Xin chào");
  });

  it("deduplicates per provider, connection, private chat, and provider message ID", async () => {
    const deps = dependencies();
    await acceptWebhook(request(), connection, deps);
    deps.enqueue.mockClear();

    await acceptWebhook(request(), connection, deps);
    deps.parseWebhook.mockReturnValue({ ...parsedMessage, privateChatId: "different-chat" });
    await acceptWebhook(request(), connection, deps);

    expect(deps.store.rows).toHaveLength(2);
    expect(deps.keyring.encryptSensitive).toHaveBeenCalledTimes(2);
    expect(deps.enqueue).toHaveBeenCalledTimes(1);
    expect(deps.enqueue).toHaveBeenNthCalledWith(1, {
      type: "PROCESS_INBOUND",
      inboundId: deps.store.rows[1].id,
    });
  });

  it("reserves duplicate pending and expired-processing rows only after dispatch lease expiry", async () => {
    const deps = dependencies();
    await acceptWebhook(request(), connection, deps);
    const row = deps.store.rows[0];
    deps.enqueue.mockClear();

    const pending = await acceptWebhook(request(), connection, deps);
    row.dispatchStartedAt = deps.now() - INBOUND_DISPATCH_LEASE_MS - 1;
    row.state = "PROCESSING";
    row.processingStartedAt = deps.now() - 300_001;
    const expired = await acceptWebhook(request(), connection, deps);
    row.state = "PROCESSED";
    const terminal = await acceptWebhook(request(), connection, deps);

    expect([pending.status, expired.status, terminal.status]).toEqual([200, 200, 200]);
    expect(deps.enqueue).toHaveBeenCalledTimes(1);
    expect(deps.enqueue).toHaveBeenCalledWith({ type: "PROCESS_INBOUND", inboundId: row.id });
  });

  it("returns a safe 503 after a committed insert when queue publication fails", async () => {
    const deps = dependencies();
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    deps.enqueue.mockRejectedValueOnce(new Error("provider text and queue details must stay private"));

    const response = await acceptWebhook(request(), connection, deps);

    expect(response.status).toBe(503);
    expect(await response.text()).toBe("");
    expect(deps.store.rows).toHaveLength(1);
    expect(deps.store.rows[0].state).toBe("PENDING");
    expect(deps.store.rows[0]).toMatchObject({
      dispatchStartedAt: null,
      dispatchAttemptCount: 0,
      dispatchMarker: null,
    });

    const retry = await acceptWebhook(request(), connection, deps);
    expect(retry.status).toBe(200);
    expect(deps.store.rows).toHaveLength(1);
    expect(deps.enqueue).toHaveBeenLastCalledWith({
      type: "PROCESS_INBOUND",
      inboundId: deps.store.rows[0].id,
    });
    expect(logged).not.toHaveBeenCalled();
    logged.mockRestore();
  });
});

class SqliteStatement {
  private values: SQLInputValue[] = [];
  constructor(private readonly database: DatabaseSync, private readonly sql: string) {}
  bind(...values: unknown[]): D1PreparedStatement {
    this.values = values.map((value) =>
      Object.prototype.toString.call(value) === "[object ArrayBuffer]"
        ? new Uint8Array(value as ArrayBuffer)
        : value
    ) as SQLInputValue[];
    return this as unknown as D1PreparedStatement;
  }
  async run<T>(): Promise<D1Result<T>> {
    const statement = this.database.prepare(this.sql);
    const results = /\bRETURNING\b/iu.test(this.sql) ? statement.all(...this.values) as T[] : [];
    const changes = results.length > 0 ? results.length : Number(statement.run(...this.values).changes);
    return { success: true, results, meta: { changes } } as D1Result<T>;
  }
  async first<T>(): Promise<T | null> {
    return (this.database.prepare(this.sql).get(...this.values) as T | undefined) ?? null;
  }
}

class SqliteDatabase {
  readonly sqlite = new DatabaseSync(":memory:");
  constructor() {
    this.sqlite.exec(readFileSync(resolve(process.cwd(), "migrations/0001_production_mvp.sql"), "utf8"));
    this.sqlite.exec(readFileSync(resolve(process.cwd(), "migrations/0002_onboarding_transition_marker.sql"), "utf8"));
  }
  prepare(sql: string): D1PreparedStatement {
    return new SqliteStatement(this.sqlite, sql) as unknown as D1PreparedStatement;
  }
}

describe("D1 webhook persistence", () => {
  it("looks up only ingress-eligible connections and stores encrypted four-part dedupe rows", async () => {
    const database = new SqliteDatabase();
    const keyring = await createKeyring("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    try {
      database.sqlite.prepare(
        "INSERT INTO users (id, email, display_name, timezone, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run("user-1", "owner@example.test", "Owner", "Asia/Ho_Chi_Minh", 1, 1);
      database.sqlite.prepare(
        `INSERT INTO bot_connections (
          id, user_id, provider, public_id, provider_bot_id, display_name, encrypted_token,
          encrypted_token_iv, token_fingerprint, credential_version, state, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "connection-1", "user-1", "telegram", connection.publicId, "bot-1", "Bot",
        new Uint8Array([1]), new Uint8Array(12), "fingerprint", 1, "ACTIVE_UNBOUND", 1, 1,
      );
      const store = new D1InboundWebhookStore(database as unknown as D1Database);
      await expect(store.findConnection("telegram", connection.publicId)).resolves.toEqual(connection);
      for (const state of ["VALIDATING", "ACTIVE_BOUND", "WEBHOOK_FAILED"] as const) {
        database.sqlite.prepare("UPDATE bot_connections SET state = ? WHERE id = ?").run(state, connection.id);
        await expect(store.findConnection("telegram", connection.publicId)).resolves.toEqual(connection);
      }
      database.sqlite.prepare("UPDATE bot_connections SET state = 'ACTIVE_UNBOUND' WHERE id = ?").run(connection.id);

      const plaintext = "Nội dung tuyệt đối không nằm trong D1";
      const sealed = await keyring.encryptSensitive("inbound-message", "inbound-real-1", 1, plaintext);
      const record: InboundRecord = {
        id: "inbound-real-1", connectionId: connection.id, provider: "telegram",
        providerMessageId: "provider-message-1", providerUserId: "provider-user-1",
        privateChatId: "private-chat-1", displayName: "Sender",
        messageCiphertext: sealed.ciphertext, messageIv: sealed.iv, messageKeyVersion: 1,
        state: "PENDING", receivedAt: 2, processingStartedAt: null, attemptCount: 0,
        processedAt: null,
        dispatchStartedAt: null, dispatchAttemptCount: 0, dispatchMarker: null,
        safeErrorCode: null,
      };
      await expect(store.insert(record)).resolves.toBe(true);
      await expect(store.insert({ ...record, id: "inbound-real-duplicate" })).resolves.toBe(false);
      await expect(store.insert({
        ...record, id: "inbound-real-other-chat", privateChatId: "private-chat-2",
      })).resolves.toBe(true);

      const raw = database.sqlite.prepare(
        "SELECT message_ciphertext, provider_message_id, private_chat_id FROM inbound_updates WHERE id = ?",
      ).get(record.id) as { message_ciphertext: Uint8Array; provider_message_id: string; private_chat_id: string };
      expect(new TextDecoder().decode(raw.message_ciphertext)).not.toContain(plaintext);
      expect(raw).toMatchObject({ provider_message_id: "provider-message-1", private_chat_id: "private-chat-1" });

      database.sqlite.prepare("UPDATE bot_connections SET state = 'SUSPENDED' WHERE id = ?").run(connection.id);
      await expect(store.findConnection("telegram", connection.publicId)).resolves.toBeNull();
    } finally {
      database.sqlite.close();
    }
  });
});
