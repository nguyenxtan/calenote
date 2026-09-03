import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  claimInbound,
  D1InboundProcessorStore,
  processInbound,
  type ClaimedInboundMessage,
  type ProcessInboundDependencies,
} from "@/modules/inbound/processor";
import { createKeyring, type Keyring } from "@/modules/security/keyring";
import { processBoundChatMessage } from "./command-service";
import { MAX_REMINDER_TITLE_CODE_UNITS } from "./parse-vietnamese";

const master = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const timezone = "Asia/Ho_Chi_Minh";
const receivedAt = Date.UTC(2026, 8, 2, 3, 15);
const processingAt = receivedAt + 1_000;
const providerToken = "123456789:AAExample_secret-token_123456789";

class SqliteStatement {
  private values: SQLInputValue[] = [];

  constructor(
    private readonly database: DatabaseSync,
    private readonly sql: string,
  ) {}

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
    const changes = returnsRows
      ? results.length
      : Number(statement.run(...this.values).changes);
    return { success: true, results, meta: { changes } } as D1Result<T>;
  }

  async first<T>(): Promise<T | null> {
    return (this.database.prepare(this.sql).get(...this.values) as T | undefined) ?? null;
  }
}

class SqliteD1Database {
  readonly sqlite = new DatabaseSync(":memory:");
  private batchTail: Promise<void> = Promise.resolve();

  constructor() {
    this.sqlite.exec(readFileSync(resolve(process.cwd(), "migrations/0001_production_mvp.sql"), "utf8"));
    this.sqlite.exec(readFileSync(resolve(process.cwd(), "migrations/0002_onboarding_transition_marker.sql"), "utf8"));
  }

  prepare(sql: string): D1PreparedStatement {
    return new SqliteStatement(this.sqlite, sql) as unknown as D1PreparedStatement;
  }

  async batch<T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    let release!: () => void;
    const previous = this.batchTail;
    this.batchTail = new Promise<void>((resolveBatch) => { release = resolveBatch; });
    await previous;
    this.sqlite.exec("BEGIN");
    try {
      const results: D1Result<T>[] = [];
      for (const statement of statements) results.push(await statement.run<T>());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    } finally {
      release();
    }
  }
}

interface InboundInput {
  id: string;
  text: string;
  receivedAt?: number;
  providerUserId?: string;
  privateChatId?: string;
}

interface Harness {
  database: SqliteD1Database;
  keyring: Keyring;
  store: D1InboundProcessorStore;
  sendText: ReturnType<typeof vi.fn<NonNullable<ProcessInboundDependencies["sendText"]>>>;
  addInbound(input: InboundInput): Promise<void>;
  process(id: string, now?: number): ReturnType<typeof processInbound>;
  claim(id: string, now?: number): Promise<ClaimedInboundMessage>;
}

const databases: DatabaseSync[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  while (databases.length > 0) databases.pop()?.close();
});

async function createHarness(): Promise<Harness> {
  const database = new SqliteD1Database();
  databases.push(database.sqlite);
  const keyring = await createKeyring(master);
  const encryptedToken = await keyring.encryptCredential(
    "connection-1",
    "telegram",
    1,
    providerToken,
  );
  database.sqlite.prepare(
    "INSERT INTO users (id, email, display_name, timezone, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run("user-1", "owner@example.test", "Owner", timezone, receivedAt, receivedAt);
  database.sqlite.prepare(
    "INSERT INTO workspaces (id, owner_user_id, kind, created_at, updated_at) VALUES (?, ?, 'PERSONAL', ?, ?)",
  ).run("workspace-1", "user-1", receivedAt, receivedAt);
  database.sqlite.prepare(
    "INSERT INTO memberships (workspace_id, user_id, role, created_at) VALUES (?, ?, 'OWNER', ?)",
  ).run("workspace-1", "user-1", receivedAt);
  database.sqlite.prepare(
    `INSERT INTO bot_connections (
      id, user_id, provider, public_id, provider_bot_id, display_name,
      encrypted_token, encrypted_token_iv, token_fingerprint, credential_version,
      state, created_at, updated_at
    ) VALUES (?, ?, 'telegram', ?, ?, ?, ?, ?, ?, 1, 'ACTIVE_BOUND', ?, ?)`,
  ).run(
    "connection-1",
    "user-1",
    "AAAAAAAAAAAAAAAAAAAAAA",
    "provider-bot-1",
    "Bot",
    new Uint8Array(encryptedToken.ciphertext),
    new Uint8Array(encryptedToken.iv),
    "fingerprint-1",
    receivedAt,
    receivedAt,
  );
  database.sqlite.prepare(
    `INSERT INTO chat_identities (
      id, connection_id, provider_user_id, private_chat_id, display_name, linked_at
    ) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run("identity-1", "connection-1", "provider-user-1", "chat-1", "Sender", receivedAt);

  const store = new D1InboundProcessorStore(database as unknown as D1Database);
  const sendText = vi.fn<NonNullable<ProcessInboundDependencies["sendText"]>>(
    async () => ({ providerMessageId: "reply-1" }),
  );
  let randomByte = 20;

  async function addInbound(input: InboundInput): Promise<void> {
    const encrypted = await keyring.encryptSensitive("inbound-message", input.id, 1, input.text);
    database.sqlite.prepare(
      `INSERT INTO inbound_updates (
        id, connection_id, provider, provider_message_id, provider_user_id, private_chat_id,
        display_name, message_ciphertext, message_iv, message_key_version, state,
        received_at, processing_started_at, attempt_count, processed_at, transition_marker
      ) VALUES (?, 'connection-1', 'telegram', ?, ?, ?, 'Sender', ?, ?, 1,
        'PENDING', ?, NULL, 0, NULL, NULL)`,
    ).run(
      input.id,
      input.id,
      input.providerUserId ?? "provider-user-1",
      input.privateChatId ?? "chat-1",
      new Uint8Array(encrypted.ciphertext),
      new Uint8Array(encrypted.iv),
      input.receivedAt ?? receivedAt,
    );
  }

  function dependencies(now: number): ProcessInboundDependencies {
    return {
      store,
      keyring,
      sendText,
      now: () => now,
      randomBytes: (length) => new Uint8Array(length).fill(++randomByte),
    };
  }

  return {
    database,
    keyring,
    store,
    sendText,
    addInbound,
    process: (id, now = processingAt) => processInbound(id, dependencies(now)),
    claim: async (id, now = processingAt) => {
      const result = await claimInbound(id, {
        store,
        keyring,
        now: () => now,
        randomBytes: (length) => new Uint8Array(length).fill(++randomByte),
      });
      if (result.status !== "CLAIMED") throw new Error(`Expected claim, received ${result.status}`);
      return result.message;
    },
  };
}

async function readEncryptedTitle(
  harness: Harness,
  table: "command_drafts" | "reminders",
  purpose: "draft-title" | "reminder-title",
): Promise<string> {
  const row = harness.database.sqlite.prepare(
    `SELECT id, title_ciphertext, title_iv, title_key_version FROM ${table} ORDER BY rowid DESC LIMIT 1`,
  ).get() as {
    id: string;
    title_ciphertext: Uint8Array;
    title_iv: Uint8Array;
    title_key_version: number;
  };
  return harness.keyring.decryptSensitive(purpose, row.id, row.title_key_version, {
    ciphertext: Uint8Array.from(row.title_ciphertext).buffer,
    iv: Uint8Array.from(row.title_iv).buffer,
  });
}

describe("migrated reminder command schema", () => {
  it("enforces source/resolution identity, one pending draft, and one reminder per source draft", async () => {
    const { database } = await createHarness();
    const draftColumns = database.sqlite.prepare("PRAGMA table_info(command_drafts)").all() as Array<{
      name: string;
      notnull: number;
    }>;
    expect(draftColumns).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "source_inbound_id", notnull: 1 }),
      expect.objectContaining({ name: "resolution_inbound_id", notnull: 0 }),
    ]));
    expect(database.sqlite.prepare("PRAGMA table_info(reminders)").all()).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "source_draft_id", notnull: 0 })]),
    );

    const indexes = database.sqlite.prepare(
      "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name IN ('command_drafts', 'reminders')",
    ).all() as Array<{ name: string; sql: string | null }>;
    const definitions = indexes.map(({ sql }) => sql ?? "").join("\n");
    expect(definitions).toMatch(/UNIQUE[\s\S]+command_drafts[\s\S]+status = 'PENDING'/iu);
    expect(definitions).toMatch(/chat_identity_id, created_at DESC/iu);
    expect(definitions).toMatch(/UNIQUE[\s\S]+reminders[\s\S]+source_draft_id IS NOT NULL/iu);
  });
});

describe("bound reminder commands", () => {
  it("creates an encrypted pending draft and replays the same inbound without another draft or reply", async () => {
    const harness = await createHarness();
    await harness.addInbound({ id: "inbound-create", text: "mai 8h nhắc tui gọi cho mẹ" });

    await expect(harness.process("inbound-create")).resolves.toEqual({ status: "DRAFT_CREATED" });
    expect(harness.database.sqlite.prepare(
      "SELECT source_inbound_id, resolution_inbound_id, scheduled_at, timezone, status, expires_at FROM command_drafts",
    ).get()).toEqual({
      source_inbound_id: "inbound-create",
      resolution_inbound_id: null,
      scheduled_at: Date.UTC(2026, 8, 3, 1),
      timezone,
      status: "PENDING",
      expires_at: processingAt + 10 * 60_000,
    });
    await expect(readEncryptedTitle(harness, "command_drafts", "draft-title")).resolves.toBe("gọi cho mẹ");
    expect(harness.database.sqlite.prepare("SELECT state FROM inbound_updates").get()).toEqual({ state: "PROCESSED" });
    expect(harness.sendText).toHaveBeenCalledTimes(1);

    await expect(harness.process("inbound-create")).resolves.toEqual({ status: "TERMINAL" });
    expect(harness.database.sqlite.prepare("SELECT COUNT(*) AS count FROM command_drafts").get()).toEqual({ count: 1 });
    expect(harness.sendText).toHaveBeenCalledTimes(1);
  });

  it("keeps the confirmation prompt within Zalo's 2,000 UTF-16-unit text limit", async () => {
    const harness = await createHarness();
    const title = "a".repeat(MAX_REMINDER_TITLE_CODE_UNITS);
    await harness.addInbound({ id: "max-title", text: `mai 8h nhắc tôi ${title}` });

    await expect(harness.process("max-title")).resolves.toEqual({ status: "DRAFT_CREATED" });
    const reply = harness.sendText.mock.calls[0][3];
    expect(reply.length).toBeLessThanOrEqual(2_000);
    expect(reply).toContain(title);
  });

  it("atomically replaces only an older pending draft and preserves it on invalid/help input", async () => {
    const harness = await createHarness();
    await harness.addInbound({ id: "older", text: "mai 8h nhắc tôi việc cũ", receivedAt });
    await harness.addInbound({ id: "newer", text: "mai 9h nhắc tôi việc mới", receivedAt: receivedAt + 1 });
    await harness.addInbound({ id: "help", text: "okay", receivedAt: receivedAt + 2 });

    await expect(harness.process("older")).resolves.toEqual({ status: "DRAFT_CREATED" });
    await expect(harness.process("newer")).resolves.toEqual({ status: "DRAFT_CREATED" });
    expect(harness.database.sqlite.prepare(
      "SELECT source_inbound_id, status FROM command_drafts ORDER BY created_at, rowid",
    ).all()).toEqual([
      { source_inbound_id: "older", status: "CANCELLED" },
      { source_inbound_id: "newer", status: "PENDING" },
    ]);

    await expect(harness.process("help")).resolves.toEqual({ status: "REJECTED" });
    expect(harness.database.sqlite.prepare(
      "SELECT source_inbound_id FROM command_drafts WHERE status = 'PENDING'",
    ).get()).toEqual({ source_inbound_id: "newer" });
    expect(harness.database.sqlite.prepare("SELECT state FROM inbound_updates WHERE id = 'help'").get()).toEqual({
      state: "REJECTED",
    });
  });

  it("confirms by re-encrypting the title for one reminder in the personal workspace", async () => {
    const harness = await createHarness();
    await harness.addInbound({ id: "create", text: "mai 8h nhắc tôi gửi báo cáo" });
    await harness.addInbound({ id: "confirm", text: "  XÁC NHẬN\r\n", receivedAt: receivedAt + 2 });
    await harness.process("create");

    await expect(harness.process("confirm", processingAt + 2)).resolves.toEqual({ status: "CONFIRMED" });
    expect(harness.database.sqlite.prepare(
      "SELECT status, resolution_inbound_id FROM command_drafts",
    ).get()).toEqual({ status: "CONFIRMED", resolution_inbound_id: "confirm" });
    expect(harness.database.sqlite.prepare(
      "SELECT workspace_id, chat_identity_id, source_draft_id, scheduled_at, timezone, status FROM reminders",
    ).get()).toMatchObject({
      workspace_id: "workspace-1",
      chat_identity_id: "identity-1",
      scheduled_at: Date.UTC(2026, 8, 3, 1),
      timezone,
      status: "PENDING",
    });
    await expect(readEncryptedTitle(harness, "reminders", "reminder-title")).resolves.toBe("gửi báo cáo");
    const ciphertexts = harness.database.sqlite.prepare(
      `SELECT d.title_ciphertext AS draft_ciphertext, r.title_ciphertext AS reminder_ciphertext
       FROM command_drafts d JOIN reminders r ON r.source_draft_id = d.id`,
    ).get() as { draft_ciphertext: Uint8Array; reminder_ciphertext: Uint8Array };
    expect(Buffer.from(ciphertexts.reminder_ciphertext).equals(Buffer.from(ciphertexts.draft_ciphertext))).toBe(false);
    expect(harness.database.sqlite.prepare(
      "SELECT action, target_reminder_id, result FROM audit_events ORDER BY rowid DESC LIMIT 1",
    ).get()).toMatchObject({ action: "REMINDER_CONFIRMED", result: "SUCCESS" });
  });

  it.each(["có", "ok", "1", "xác nhận"])("accepts exact confirmation word %s", async (word) => {
    const harness = await createHarness();
    await harness.addInbound({ id: "create", text: "mai 8h nhắc tôi uống thuốc" });
    await harness.addInbound({ id: "resolve", text: word, receivedAt: receivedAt + 1 });
    await harness.process("create");
    await expect(harness.process("resolve")).resolves.toEqual({ status: "CONFIRMED" });
  });

  it.each(["hủy", "huỷ", "không", "2"])("cancels with exact whole-message word %s and creates no reminder", async (word) => {
    const harness = await createHarness();
    await harness.addInbound({ id: "create", text: "mai 8h nhắc tôi uống thuốc" });
    await harness.addInbound({ id: "cancel", text: word, receivedAt: receivedAt + 1 });
    await harness.process("create");

    await expect(harness.process("cancel")).resolves.toEqual({ status: "CANCELLED" });
    expect(harness.database.sqlite.prepare(
      "SELECT status, resolution_inbound_id FROM command_drafts",
    ).get()).toEqual({ status: "CANCELLED", resolution_inbound_id: "cancel" });
    expect(harness.database.sqlite.prepare("SELECT COUNT(*) AS count FROM reminders").get()).toEqual({ count: 0 });
  });

  it("does not treat a confirmation prefix as confirmation and keeps the pending draft", async () => {
    const harness = await createHarness();
    await harness.addInbound({ id: "create", text: "mai 8h nhắc tôi uống thuốc" });
    await harness.addInbound({ id: "not-exact", text: "ok luôn", receivedAt: receivedAt + 1 });
    await harness.process("create");

    await expect(harness.process("not-exact")).resolves.toEqual({ status: "REJECTED" });
    expect(harness.database.sqlite.prepare("SELECT status FROM command_drafts").get()).toEqual({ status: "PENDING" });
  });

  it("expires at the exact minimum of ten minutes and the scheduled instant", async () => {
    const tenMinute = await createHarness();
    await tenMinute.addInbound({ id: "create", text: "mai 8h nhắc tôi uống thuốc" });
    await tenMinute.addInbound({ id: "confirm", text: "ok", receivedAt: receivedAt + 1 });
    await tenMinute.process("create");
    await expect(tenMinute.process("confirm", processingAt + 10 * 60_000)).resolves.toEqual({ status: "EXPIRED" });
    expect(tenMinute.database.sqlite.prepare("SELECT status FROM command_drafts").get()).toEqual({ status: "EXPIRED" });

    const scheduled = await createHarness();
    await scheduled.addInbound({ id: "create-soon", text: "hôm nay 10:20 nhắc tôi việc gần" });
    await scheduled.addInbound({ id: "confirm-soon", text: "ok", receivedAt: receivedAt + 1 });
    await scheduled.process("create-soon");
    expect(scheduled.database.sqlite.prepare("SELECT expires_at FROM command_drafts").get()).toEqual({
      expires_at: Date.UTC(2026, 8, 2, 3, 20),
    });
    await expect(scheduled.process("confirm-soon", Date.UTC(2026, 8, 2, 3, 20))).resolves.toEqual({ status: "EXPIRED" });
  });

  it("uses receivedAt for parsing but rejects provider time >5 minutes ahead and schedules already past processingNow", async () => {
    const delayed = await createHarness();
    await delayed.addInbound({ id: "delayed", text: "hôm nay 10:20 nhắc tôi trễ" });
    await expect(delayed.process("delayed", Date.UTC(2026, 8, 2, 3, 21))).resolves.toEqual({ status: "REJECTED" });
    expect(delayed.database.sqlite.prepare("SELECT COUNT(*) AS count FROM command_drafts").get()).toEqual({ count: 0 });

    const future = await createHarness();
    await future.addInbound({
      id: "future",
      text: "mai 8h nhắc tôi sai đồng hồ",
      receivedAt: processingAt + 5 * 60_000 + 1,
    });
    await expect(future.process("future", processingAt)).resolves.toEqual({ status: "REJECTED" });
    expect(future.database.sqlite.prepare("SELECT COUNT(*) AS count FROM command_drafts").get()).toEqual({ count: 0 });
  });
});

describe("D1 reminder command concurrency and privacy", () => {
  it("lets one simultaneous confirmation win and gives the other no reminder", async () => {
    const harness = await createHarness();
    await harness.addInbound({ id: "create", text: "mai 8h nhắc tôi uống thuốc" });
    await harness.process("create");
    await harness.addInbound({ id: "confirm-a", text: "ok", receivedAt: receivedAt + 1 });
    await harness.addInbound({ id: "confirm-b", text: "1", receivedAt: receivedAt + 2 });

    const results = await Promise.all([
      harness.process("confirm-a", processingAt + 3),
      harness.process("confirm-b", processingAt + 3),
    ]);
    expect(results.map(({ status }) => status).sort()).toEqual(["CONFIRMED", "REJECTED"]);
    expect(harness.database.sqlite.prepare("SELECT COUNT(*) AS count FROM reminders").get()).toEqual({ count: 1 });
    expect(harness.database.sqlite.prepare(
      "SELECT COUNT(*) AS count FROM command_drafts WHERE status = 'CONFIRMED'",
    ).get()).toEqual({ count: 1 });
  });

  it("gives a confirmation-vs-cancel race exactly one winner", async () => {
    const harness = await createHarness();
    await harness.addInbound({ id: "create", text: "mai 8h nhắc tôi uống thuốc" });
    await harness.process("create");
    await harness.addInbound({ id: "confirm", text: "ok", receivedAt: receivedAt + 1 });
    await harness.addInbound({ id: "cancel", text: "hủy", receivedAt: receivedAt + 2 });

    const results = await Promise.all([
      harness.process("confirm", processingAt + 3),
      harness.process("cancel", processingAt + 3),
    ]);
    const statuses = results.map(({ status }) => status);
    expect(statuses.filter((status) => status === "CONFIRMED" || status === "CANCELLED")).toHaveLength(1);
    expect(statuses).toContain("REJECTED");
    const draft = harness.database.sqlite.prepare("SELECT status FROM command_drafts").get() as { status: string };
    expect(["CONFIRMED", "CANCELLED"]).toContain(draft.status);
    expect(harness.database.sqlite.prepare("SELECT COUNT(*) AS count FROM reminders").get()).toEqual({
      count: draft.status === "CONFIRMED" ? 1 : 0,
    });
  });

  it("rejects out-of-order commands by receivedAt and then SQLite rowid", async () => {
    const harness = await createHarness();
    await harness.addInbound({ id: "older-time", text: "mai 8h nhắc tôi cũ theo giờ", receivedAt });
    await harness.addInbound({ id: "newer-time", text: "mai 9h nhắc tôi mới theo giờ", receivedAt: receivedAt + 2 });
    await harness.process("newer-time");
    await expect(harness.process("older-time")).resolves.toEqual({ status: "REJECTED" });
    await expect(readEncryptedTitle(harness, "command_drafts", "draft-title")).resolves.toBe("mới theo giờ");

    const equal = await createHarness();
    await equal.addInbound({ id: "lower-rowid", text: "mai 8h nhắc tôi cũ theo hàng", receivedAt });
    await equal.addInbound({ id: "higher-rowid", text: "mai 9h nhắc tôi mới theo hàng", receivedAt });
    await equal.process("higher-rowid");
    await expect(equal.process("lower-rowid")).resolves.toEqual({ status: "REJECTED" });
    await expect(readEncryptedTitle(equal, "command_drafts", "draft-title")).resolves.toBe("mới theo hàng");
  });

  it("refuses an ACTIVE_BOUND connection when the exact sender/chat identity does not match", async () => {
    const harness = await createHarness();
    await harness.addInbound({
      id: "intruder",
      text: "mai 8h nhắc tôi đọc dữ liệu",
      providerUserId: "provider-user-attacker",
      privateChatId: "chat-attacker",
    });

    await expect(harness.process("intruder")).resolves.toEqual({ status: "REJECTED" });
    expect(harness.database.sqlite.prepare("SELECT COUNT(*) AS count FROM command_drafts").get()).toEqual({ count: 0 });
    expect(harness.database.sqlite.prepare("SELECT state FROM inbound_updates").get()).toEqual({ state: "REJECTED" });
  });

  it("does nothing when invocation ownership was lost before the command mutation", async () => {
    const harness = await createHarness();
    await harness.addInbound({ id: "lost", text: "mai 8h nhắc tôi không được tạo" });
    const message = await harness.claim("lost");
    harness.database.sqlite.prepare(
      "UPDATE inbound_updates SET transition_marker = 'new-owner' WHERE id = 'lost'",
    ).run();
    const reply = vi.fn(async () => undefined);

    await expect(processBoundChatMessage(message, {
      store: harness.store,
      keyring: harness.keyring,
      now: () => processingAt,
      randomBytes: () => new Uint8Array(16).fill(91),
      reply,
    })).resolves.toEqual({ status: "SUPERSEDED" });
    expect(harness.database.sqlite.prepare("SELECT COUNT(*) AS count FROM command_drafts").get()).toEqual({ count: 0 });
    expect(harness.database.sqlite.prepare("SELECT state, transition_marker FROM inbound_updates").get()).toEqual({
      state: "PROCESSING",
      transition_marker: "new-owner",
    });
    expect(reply).not.toHaveBeenCalled();
  });

  it("rolls back draft resolution and inbound terminalization on a forced reminder insert failure", async () => {
    const harness = await createHarness();
    await harness.addInbound({ id: "create", text: "mai 8h nhắc tôi vẫn còn" });
    await harness.process("create");
    await harness.addInbound({ id: "confirm", text: "ok", receivedAt: receivedAt + 1 });
    const message = await harness.claim("confirm", processingAt + 2);
    harness.database.sqlite.exec(
      "CREATE TRIGGER force_reminder_failure BEFORE INSERT ON reminders BEGIN SELECT RAISE(ABORT, 'forced reminder insert failure'); END",
    );
    const reply = vi.fn(async () => undefined);

    await expect(processBoundChatMessage(message, {
      store: harness.store,
      keyring: harness.keyring,
      now: () => processingAt + 2,
      randomBytes: () => new Uint8Array(16).fill(92),
      reply,
    })).rejects.toThrow("forced reminder insert failure");
    expect(harness.database.sqlite.prepare(
      "SELECT status, resolution_inbound_id FROM command_drafts",
    ).get()).toEqual({ status: "PENDING", resolution_inbound_id: null });
    expect(harness.database.sqlite.prepare("SELECT COUNT(*) AS count FROM reminders").get()).toEqual({ count: 0 });
    expect(harness.database.sqlite.prepare("SELECT state FROM inbound_updates WHERE id = 'confirm'").get()).toEqual({
      state: "PROCESSING",
    });
    expect(reply).not.toHaveBeenCalled();
  });

  it("does not hide an expected-looking constraint error without a re-queried race winner", async () => {
    const harness = await createHarness();
    await harness.addInbound({ id: "create", text: "mai 8h nhắc tôi còn nguyên" });
    await harness.process("create");
    await harness.addInbound({ id: "confirm", text: "ok", receivedAt: receivedAt + 1 });
    const message = await harness.claim("confirm", processingAt + 2);
    harness.database.sqlite.exec(
      `CREATE TRIGGER misleading_constraint BEFORE INSERT ON reminders
       BEGIN SELECT RAISE(ABORT, 'UNIQUE constraint failed: reminders.source_draft_id'); END`,
    );

    await expect(processBoundChatMessage(message, {
      store: harness.store,
      keyring: harness.keyring,
      now: () => processingAt + 2,
      randomBytes: () => new Uint8Array(16).fill(94),
      reply: async () => undefined,
    })).rejects.toThrow("UNIQUE constraint failed: reminders.source_draft_id");
    expect(harness.database.sqlite.prepare(
      "SELECT status, resolution_inbound_id FROM command_drafts",
    ).get()).toEqual({ status: "PENDING", resolution_inbound_id: null });
    expect(harness.database.sqlite.prepare("SELECT state FROM inbound_updates WHERE id = 'confirm'").get()).toEqual({
      state: "PROCESSING",
    });
  });

  it("rolls back older-draft cancellation on a forced replacement insert failure", async () => {
    const harness = await createHarness();
    await harness.addInbound({ id: "older", text: "mai 8h nhắc tôi giữ lại" });
    await harness.process("older");
    await harness.addInbound({ id: "newer", text: "mai 9h nhắc tôi lỗi ghi", receivedAt: receivedAt + 1 });
    const message = await harness.claim("newer", processingAt + 2);
    harness.database.sqlite.exec(
      "CREATE TRIGGER force_draft_failure BEFORE INSERT ON command_drafts BEGIN SELECT RAISE(ABORT, 'forced draft insert failure'); END",
    );

    await expect(processBoundChatMessage(message, {
      store: harness.store,
      keyring: harness.keyring,
      now: () => processingAt + 2,
      randomBytes: () => new Uint8Array(16).fill(93),
      reply: async () => undefined,
    })).rejects.toThrow("forced draft insert failure");
    expect(harness.database.sqlite.prepare("SELECT status FROM command_drafts").get()).toEqual({ status: "PENDING" });
    expect(harness.database.sqlite.prepare("SELECT state FROM inbound_updates WHERE id = 'newer'").get()).toEqual({
      state: "PROCESSING",
    });
  });

  it("stores no plaintext inbound, draft, or reminder content", async () => {
    const harness = await createHarness();
    const privateTitle = "bí mật hoa lan tím";
    await harness.addInbound({ id: "create", text: `mai 8h nhắc tôi ${privateTitle}` });
    await harness.addInbound({ id: "confirm", text: "ok", receivedAt: receivedAt + 1 });
    await harness.process("create");
    await harness.process("confirm", processingAt + 2);

    const stored = harness.database.sqlite.prepare(
      `SELECT CAST(i.message_ciphertext AS TEXT) AS inbound_text,
              CAST(d.title_ciphertext AS TEXT) AS draft_text,
              CAST(r.title_ciphertext AS TEXT) AS reminder_text,
              group_concat(a.action, ',') AS audit_actions
       FROM inbound_updates i
       JOIN command_drafts d ON d.source_inbound_id = i.id
       JOIN reminders r ON r.source_draft_id = d.id
       LEFT JOIN audit_events a ON 1 = 1
       WHERE i.id = 'create'`,
    ).get();
    expect(JSON.stringify(stored)).not.toContain(privateTitle);
    expect(JSON.stringify(stored)).not.toContain("mai 8h nhắc tôi");
  });

  it("attempts a reply only after commit and swallows an ambiguous reply failure", async () => {
    const harness = await createHarness();
    await harness.addInbound({ id: "create", text: "mai 8h nhắc tôi gọi mẹ" });
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    harness.sendText.mockImplementationOnce(async () => {
      expect(harness.database.sqlite.prepare("SELECT state FROM inbound_updates").get()).toEqual({ state: "PROCESSED" });
      expect(harness.database.sqlite.prepare("SELECT COUNT(*) AS count FROM command_drafts").get()).toEqual({ count: 1 });
      throw new Error("ambiguous provider detail");
    });

    await expect(harness.process("create")).resolves.toEqual({ status: "DRAFT_CREATED" });
    await expect(harness.process("create")).resolves.toEqual({ status: "TERMINAL" });
    expect(harness.sendText).toHaveBeenCalledTimes(1);
    expect(logged).not.toHaveBeenCalled();
  });
});
