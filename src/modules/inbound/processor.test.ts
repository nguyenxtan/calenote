import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createKeyring, type Keyring } from "@/modules/security/keyring";
import { D1ReminderCommandStore } from "@/modules/reminders/infrastructure/d1/command-store";
import {
  D1InboundProcessorStore,
  claimInbound,
  processInbound,
  sendProviderText,
  type ProcessInboundDependencies,
} from "./processor";

const master = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const code = "ABCDEFGHJKLMNPQRSTUVWXYZ23";
const now = 1_700_000_000_000;

describe("inbound persistence boundary", () => {
  it("composes rather than inherits the reminder command repository", () => {
    expect(Object.getPrototypeOf(D1InboundProcessorStore.prototype)).not.toBe(
      D1ReminderCommandStore.prototype,
    );
  });
});

class SqliteStatement {
  private values: SQLInputValue[] = [];
  constructor(private readonly database: DatabaseSync, private readonly sql: string) {}
  bind(...values: unknown[]): D1PreparedStatement {
    this.values = values.map((value) => {
      if (Object.prototype.toString.call(value) === "[object ArrayBuffer]") {
        return new Uint8Array(value as ArrayBuffer);
      }
      if (ArrayBuffer.isView(value)) {
        return Uint8Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
      }
      return value;
    }) as SQLInputValue[];
    return this as unknown as D1PreparedStatement;
  }
  async run<T>(): Promise<D1Result<T>> {
    const statement = this.database.prepare(this.sql);
    const returnsRows = /\bRETURNING\b/iu.test(this.sql);
    const results = returnsRows ? statement.all(...this.values) as T[] : [];
    const changes = returnsRows ? results.length : Number(statement.run(...this.values).changes);
    return { success: true, results, meta: { changes } } as D1Result<T>;
  }
  async first<T>(): Promise<T | null> {
    return (this.database.prepare(this.sql).get(...this.values) as T | undefined) ?? null;
  }
}

class SqliteD1Database {
  readonly sqlite = new DatabaseSync(":memory:");
  constructor() {
    this.sqlite.exec(readFileSync(resolve(process.cwd(), "migrations/0001_production_mvp.sql"), "utf8"));
    this.sqlite.exec(readFileSync(resolve(process.cwd(), "migrations/0002_onboarding_transition_marker.sql"), "utf8"));
  }
  prepare(sql: string): D1PreparedStatement {
    return new SqliteStatement(this.sqlite, sql) as unknown as D1PreparedStatement;
  }
  async batch<T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    this.sqlite.exec("BEGIN");
    try {
      const results: D1Result<T>[] = [];
      for (const statement of statements) results.push(await statement.run<T>());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

const databases: DatabaseSync[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  while (databases.length > 0) databases.pop()?.close();
});

interface SetupOptions {
  state?: "VALIDATING" | "ACTIVE_UNBOUND" | "ACTIVE_BOUND" | "WEBHOOK_FAILED" | "SUSPENDED";
  connectCode?: string;
  codeConnectionId?: string;
  codeExpiresAt?: number;
  codeConsumedAt?: number | null;
  inboundId?: string;
  privateChatId?: string;
  providerUserId?: string;
  text?: string;
}

async function setup(options: SetupOptions = {}) {
  const database = new SqliteD1Database();
  databases.push(database.sqlite);
  const keyring = await createKeyring(master);
  const connectionId = "connection-1";
  const userId = "user-1";
  const inboundId = options.inboundId ?? "inbound-1";
  const provider = "telegram" as const;
  const encryptedToken = await keyring.encryptCredential(connectionId, provider, 1, "123456789:AAExample_secret-token_123456789");
  database.sqlite.prepare(
    "INSERT INTO users (id, email, display_name, timezone, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(userId, "owner@example.test", "Owner", "Asia/Ho_Chi_Minh", now, now);
  database.sqlite.prepare(
    "INSERT INTO workspaces (id, owner_user_id, kind, created_at, updated_at) VALUES (?, ?, 'PERSONAL', ?, ?)",
  ).run("workspace-1", userId, now, now);
  database.sqlite.prepare(
    "INSERT INTO memberships (workspace_id, user_id, role, created_at) VALUES (?, ?, 'OWNER', ?)",
  ).run("workspace-1", userId, now);
  database.sqlite.prepare(
    `INSERT INTO bot_connections (
      id, user_id, provider, public_id, provider_bot_id, display_name,
      encrypted_token, encrypted_token_iv, token_fingerprint, credential_version,
      state, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    connectionId, userId, provider, "AAAAAAAAAAAAAAAAAAAAAA", "provider-bot", "Bot",
    new Uint8Array(encryptedToken.ciphertext), new Uint8Array(encryptedToken.iv), "fingerprint", 1,
    options.state ?? "ACTIVE_UNBOUND", now, now,
  );

  const connectCode = options.connectCode ?? code;
  const digest = await keyring.digestCode(connectCode);
  database.sqlite.prepare(
    "INSERT INTO connect_codes (id, connection_id, user_id, digest, expires_at, consumed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(
    "code-1",
    options.codeConnectionId ?? connectionId,
    userId,
    digest,
    options.codeExpiresAt ?? now + 60_000,
    options.codeConsumedAt ?? null,
    now - 1_000,
  );
  await insertInbound(database.sqlite, keyring, {
    id: inboundId,
    text: options.text ?? `/connect ${connectCode}`,
    privateChatId: options.privateChatId ?? "chat-1",
    providerUserId: options.providerUserId ?? "provider-user-1",
  });
  const store = new D1InboundProcessorStore(database as unknown as D1Database);
  const sendText = vi.fn<NonNullable<ProcessInboundDependencies["sendText"]>>(
    async () => ({ providerMessageId: "reply-1" }),
  );
  let random = 0;
  const deps: ProcessInboundDependencies = {
    store,
    keyring,
    sendText,
    now: () => now,
    randomBytes: (length) => new Uint8Array(length).fill(++random),
  };
  return { database, keyring, store, sendText, deps, inboundId, connectionId };
}

async function insertInbound(
  database: DatabaseSync,
  keyring: Keyring,
  input: { id: string; text: string; privateChatId: string; providerUserId: string; providerMessageId?: string },
) {
  const encrypted = await keyring.encryptSensitive("inbound-message", input.id, 1, input.text);
  database.prepare(
    `INSERT INTO inbound_updates (
      id, connection_id, provider, provider_message_id, provider_user_id, private_chat_id,
      display_name, message_ciphertext, message_iv, message_key_version, state,
      received_at, processing_started_at, attempt_count, processed_at, transition_marker
    ) VALUES (?, ?, 'telegram', ?, ?, ?, ?, ?, ?, 1, 'PENDING', ?, NULL, 0, NULL, NULL)`,
  ).run(
    input.id,
    "connection-1",
    input.providerMessageId ?? input.id,
    input.providerUserId,
    input.privateChatId,
    "Sender",
    new Uint8Array(encrypted.ciphertext),
    new Uint8Array(encrypted.iv),
    now,
  );
}

describe("fresh inbound schema", () => {
  it("enforces one chat per connection and four-part inbound dedupe with lease columns", async () => {
    const { database, keyring } = await setup();
    const columns = database.sqlite.prepare("PRAGMA table_info(inbound_updates)").all() as Array<{ name: string }>;
    expect(columns.map(({ name }) => name)).toEqual(expect.arrayContaining([
      "processing_started_at", "attempt_count", "transition_marker", "display_name",
      "dispatch_started_at", "dispatch_attempt_count", "dispatch_marker", "safe_error_code",
    ]));

    await insertInbound(database.sqlite, keyring, {
      id: "inbound-same-message-other-chat",
      providerMessageId: "inbound-1",
      providerUserId: "provider-user-2",
      privateChatId: "chat-2",
      text: "other",
    });
    await expect(insertInbound(database.sqlite, keyring, {
      id: "inbound-duplicate",
      providerMessageId: "inbound-1",
      providerUserId: "provider-user-3",
      privateChatId: "chat-1",
      text: "duplicate",
    })).rejects.toThrow(/UNIQUE constraint failed/iu);

    database.sqlite.prepare(
      "INSERT INTO chat_identities (id, connection_id, provider_user_id, private_chat_id, display_name, linked_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("identity-1", "connection-1", "provider-user-1", "chat-1", null, now);
    expect(() => database.sqlite.prepare(
      "INSERT INTO chat_identities (id, connection_id, provider_user_id, private_chat_id, display_name, linked_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("identity-2", "connection-1", "provider-user-2", "chat-2", null, now)).toThrow(/UNIQUE constraint failed/iu);
  });
});

describe("inbound claim lease", () => {
  it("claims PENDING once, returns retry-after during the lease, and reclaims after five minutes", async () => {
    const { database, store, keyring, inboundId } = await setup({ text: "Nội dung" });

    const first = await claimInbound(inboundId, {
      store, keyring, now: () => now, randomBytes: () => new Uint8Array(16).fill(4),
    });
    expect(first).toMatchObject({ status: "CLAIMED", message: { id: inboundId, text: "Nội dung", attemptCount: 1 } });
    expect(database.sqlite.prepare(
      "SELECT state, processing_started_at, attempt_count FROM inbound_updates WHERE id = ?",
    ).get(inboundId)).toEqual({ state: "PROCESSING", processing_started_at: now, attempt_count: 1 });

    const leased = await claimInbound(inboundId, {
      store, keyring, now: () => now + 1, randomBytes: () => new Uint8Array(16).fill(5),
    });
    expect(leased).toEqual({ status: "RETRY_AFTER", retryAfterMs: 299_999 });

    const reclaimed = await claimInbound(inboundId, {
      store, keyring, now: () => now + 300_001, randomBytes: () => new Uint8Array(16).fill(6),
    });
    expect(reclaimed).toMatchObject({ status: "CLAIMED", message: { attemptCount: 2 } });
  });

  it("does not claim missing or terminal rows", async () => {
    const { database, store, keyring, inboundId } = await setup();
    database.sqlite.prepare(
      "UPDATE inbound_updates SET state = 'REJECTED', processed_at = ? WHERE id = ?",
    ).run(now, inboundId);

    await expect(claimInbound(inboundId, { store, keyring, now: () => now })).resolves.toEqual({ status: "TERMINAL" });
    await expect(claimInbound("missing", { store, keyring, now: () => now })).resolves.toEqual({ status: "MISSING" });
  });

  it("terminally fails an expired fourth owner but preserves a fresh fourth owner", async () => {
    const expired = await setup({ text: "Nội dung" });
    expired.database.sqlite.prepare(
      `UPDATE inbound_updates
       SET state = 'PROCESSING', processing_started_at = ?, attempt_count = 4,
           transition_marker = 'fourth-owner'
       WHERE id = ?`,
    ).run(now - 300_001, expired.inboundId);

    await expect(claimInbound(expired.inboundId, {
      store: expired.store,
      keyring: expired.keyring,
      now: () => now,
    })).resolves.toEqual({ status: "TERMINAL" });
    expect(expired.database.sqlite.prepare(
      "SELECT state, safe_error_code FROM inbound_updates WHERE id = ?",
    ).get(expired.inboundId)).toEqual({
      state: "FAILED",
      safe_error_code: "INBOUND_PROCESSING_EXHAUSTED",
    });

    const fresh = await setup({ inboundId: "fresh-fourth-owner", text: "Nội dung" });
    fresh.database.sqlite.prepare(
      `UPDATE inbound_updates
       SET state = 'PROCESSING', processing_started_at = ?, attempt_count = 4,
           transition_marker = 'fourth-owner'
       WHERE id = ?`,
    ).run(now - 299_999, fresh.inboundId);

    await expect(claimInbound(fresh.inboundId, {
      store: fresh.store,
      keyring: fresh.keyring,
      now: () => now,
    })).resolves.toEqual({ status: "RETRY_AFTER", retryAfterMs: 1 });
    expect(fresh.database.sqlite.prepare(
      "SELECT state, safe_error_code FROM inbound_updates WHERE id = ?",
    ).get(fresh.inboundId)).toEqual({ state: "PROCESSING", safe_error_code: null });
  });
});

describe("atomic private-chat connection", () => {
  it("dispatches replies through the matching provider adapter", async () => {
    const requester = vi.fn(async (request: { provider: string }) => request.provider === "zalo"
      ? { ok: true, result: { message_id: "zalo-reply" } }
      : { ok: true, result: { message_id: "telegram-reply" } });

    await expect(sendProviderText(
      "zalo", "12345678:abc-xyz_789", "zalo-chat", "Xin chào", requester,
    )).resolves.toEqual({ providerMessageId: "zalo-reply" });
    await expect(sendProviderText(
      "telegram", "123456789:AAExample_secret-token_123456789", "telegram-chat", "Xin chào", requester,
    )).resolves.toEqual({ providerMessageId: "telegram-reply" });
    expect(requester.mock.calls.map(([request]) => request.provider)).toEqual(["zalo", "telegram"]);
  });

  it("accepts only the exact trimmed connect command grammar", async () => {
    const accepted = await setup({ text: ` \n/connect ${code}\t` });
    await expect(processInbound(accepted.inboundId, accepted.deps)).resolves.toEqual({ status: "BOUND" });

    for (const [index, text] of [
      `/connect  ${code}`,
      `/connect ${code.toLowerCase()}`,
      `/connect ${code} extra`,
      `/CONNECT ${code}`,
    ].entries()) {
      const candidate = await setup({ inboundId: `grammar-${index}`, text });
      await expect(processInbound(candidate.inboundId, candidate.deps)).resolves.toEqual({ status: "REJECTED" });
      expect(candidate.database.sqlite.prepare("SELECT COUNT(*) AS count FROM chat_identities").get()).toEqual({ count: 0 });
      expect(candidate.sendText.mock.calls[0][3]).toContain("Hãy gửi đúng lệnh");
    }
  });

  it("binds a valid code, consumes it, terminally processes inbound, audits safely, then replies", async () => {
    const { database, deps, sendText, inboundId } = await setup();
    sendText.mockImplementationOnce(async () => {
      expect(database.sqlite.prepare("SELECT state FROM inbound_updates WHERE id = ?").get(inboundId)).toEqual({ state: "PROCESSED" });
      expect(database.sqlite.prepare("SELECT state FROM bot_connections WHERE id = 'connection-1'").get()).toEqual({ state: "ACTIVE_BOUND" });
      return { providerMessageId: "reply-1" };
    });

    const result = await processInbound(inboundId, deps);

    expect(result).toEqual({ status: "BOUND" });
    expect(database.sqlite.prepare("SELECT connection_id, provider_user_id, private_chat_id FROM chat_identities").get()).toEqual({
      connection_id: "connection-1", provider_user_id: "provider-user-1", private_chat_id: "chat-1",
    });
    expect(database.sqlite.prepare("SELECT consumed_at FROM connect_codes WHERE id = 'code-1'").get()).toEqual({ consumed_at: now });
    expect(database.sqlite.prepare("SELECT action, result FROM audit_events").get()).toEqual({ action: "CHAT_BOUND", result: "SUCCESS" });
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith(
      "telegram",
      "123456789:AAExample_secret-token_123456789",
      "chat-1",
      expect.stringContaining("Đã kết nối"),
    );
    expect(JSON.stringify(sendText.mock.calls)).not.toContain(code);

    await expect(processInbound(inboundId, deps)).resolves.toEqual({ status: "TERMINAL" });
    expect(sendText).toHaveBeenCalledTimes(1);
  });

  it.each([
    { label: "expired", options: { codeExpiresAt: now } },
    { label: "reused", options: { codeConsumedAt: now - 1 } },
    { label: "wrong", options: { text: `/connect ${"Z".repeat(26)}` } },
  ])("rejects a $label code generically without binding", async ({ options }) => {
    const { database, deps, sendText, inboundId } = await setup(options);

    await expect(processInbound(inboundId, deps)).resolves.toEqual({ status: "REJECTED" });
    expect(database.sqlite.prepare("SELECT state FROM inbound_updates WHERE id = ?").get(inboundId)).toEqual({ state: "REJECTED" });
    expect(database.sqlite.prepare("SELECT COUNT(*) AS count FROM chat_identities").get()).toEqual({ count: 0 });
    expect(database.sqlite.prepare("SELECT state FROM bot_connections").get()).toEqual({ state: "ACTIVE_UNBOUND" });
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText.mock.calls[0][3]).toContain("Không thể kết nối");
    expect(sendText.mock.calls[0][3]).not.toContain(code);
  });

  it("rejects an otherwise valid code when it belongs to another connection", async () => {
    const other = await setup();
    other.database.sqlite.prepare(
      `INSERT INTO bot_connections (
        id, user_id, provider, public_id, provider_bot_id, display_name, encrypted_token,
        encrypted_token_iv, token_fingerprint, credential_version, state, created_at, updated_at
      ) SELECT 'connection-2', user_id, provider, 'BBBBBBBBBBBBBBBBBBBBBB', 'provider-bot-2', display_name,
        encrypted_token, encrypted_token_iv, 'fingerprint-2', credential_version, 'ACTIVE_UNBOUND', created_at, updated_at
        FROM bot_connections WHERE id = 'connection-1'`,
    ).run();
    other.database.sqlite.prepare("UPDATE connect_codes SET connection_id = 'connection-2' WHERE id = 'code-1'").run();

    await expect(processInbound(other.inboundId, other.deps)).resolves.toEqual({ status: "REJECTED" });
    expect(other.database.sqlite.prepare("SELECT COUNT(*) AS count FROM chat_identities").get()).toEqual({ count: 0 });
  });

  it("allows exactly one private chat to win a parallel bind and rejects the other", async () => {
    const { database, deps, keyring, inboundId } = await setup();
    await insertInbound(database.sqlite, keyring, {
      id: "inbound-2", providerMessageId: "message-2", providerUserId: "provider-user-2",
      privateChatId: "chat-2", text: `/connect ${code}`,
    });

    const outcomes = await Promise.all([
      processInbound(inboundId, deps),
      processInbound("inbound-2", deps),
    ]);

    expect(outcomes.map(({ status }) => status).sort()).toEqual(["BOUND", "REJECTED"]);
    expect(database.sqlite.prepare("SELECT COUNT(*) AS count FROM chat_identities").get()).toEqual({ count: 1 });
    expect(database.sqlite.prepare("SELECT state FROM inbound_updates ORDER BY id").all()).toEqual([
      { state: outcomes[0].status === "BOUND" ? "PROCESSED" : "REJECTED" },
      { state: outcomes[1].status === "BOUND" ? "PROCESSED" : "REJECTED" },
    ]);
  });

  it("swallows ambiguous reply failure after the terminal commit", async () => {
    const { database, deps, inboundId, sendText } = await setup();
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    sendText.mockRejectedValueOnce(new Error("timeout with private provider detail"));

    await expect(processInbound(inboundId, deps)).resolves.toEqual({ status: "BOUND" });
    expect(database.sqlite.prepare("SELECT state FROM inbound_updates WHERE id = ?").get(inboundId)).toEqual({ state: "PROCESSED" });
    await expect(processInbound(inboundId, deps)).resolves.toEqual({ status: "TERMINAL" });
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(logged).not.toHaveBeenCalled();
  });
});

describe("non-connect processor handoff", () => {
  it("terminally rejects unbound text with a safe instruction", async () => {
    const { database, deps, sendText, inboundId } = await setup({ text: "nhắc tôi họp ngày mai" });

    await expect(processInbound(inboundId, deps)).resolves.toEqual({ status: "REJECTED" });
    expect(database.sqlite.prepare("SELECT state FROM inbound_updates WHERE id = ?").get(inboundId)).toEqual({ state: "REJECTED" });
    expect(sendText.mock.calls[0][3]).toContain("/connect");
    expect(sendText.mock.calls[0][3]).not.toContain("nhắc tôi họp ngày mai");
  });

  it("routes an exactly bound message through reminder handling and terminalizes before replying", async () => {
    const { database, deps, sendText, inboundId } = await setup({
      state: "ACTIVE_BOUND",
      text: "mai 8h nhắc tôi họp",
    });
    database.sqlite.prepare(
      "INSERT INTO chat_identities (id, connection_id, provider_user_id, private_chat_id, display_name, linked_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("identity-1", "connection-1", "provider-user-1", "chat-1", "Sender", now);

    const result = await processInbound(inboundId, deps);

    expect(result).toEqual({ status: "DRAFT_CREATED" });
    expect(database.sqlite.prepare("SELECT state FROM inbound_updates WHERE id = ?").get(inboundId)).toEqual({ state: "PROCESSED" });
    expect(database.sqlite.prepare("SELECT source_inbound_id, status FROM command_drafts").get()).toEqual({
      source_inbound_id: inboundId,
      status: "PENDING",
    });
    expect(sendText).toHaveBeenCalledTimes(1);
  });
});
