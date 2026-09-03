import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderOperationError } from "@/modules/connections/provider-error";
import { createKeyring } from "@/modules/security/keyring";
import {
  deterministicRandomBytes,
  SqliteD1Database,
} from "@/testing/sqlite-d1.test-support";
import { MAX_REMINDER_TITLE_CODE_UNITS } from "./parse-vietnamese";
import type { DeliverReminderDependencies } from "./delivery";

const master = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const now = 1_800_000_000_000;
const reminderId = "R".repeat(22);
const connectionId = "connection-1";
const token = "123456789:AAExample_secret-token_123456789";
const databases: SqliteD1Database[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  while (databases.length > 0) databases.pop()?.close();
});

async function deliveryModule() {
  const modulePath = "./delivery";
  return import(/* @vite-ignore */ modulePath).catch(() => null);
}

interface HarnessOptions {
  title?: string;
  reminderStatus?: "PENDING" | "CLAIMED" | "SENT" | "CANCELLED" | "FAILED" | "RETRYABLE" | "UNCERTAIN";
  claimedAt?: number | null;
  connectionState?: "ACTIVE_BOUND" | "SUSPENDED" | "ACTIVE_UNBOUND";
  privateChatId?: string;
  corruptTitle?: boolean;
  corruptToken?: boolean;
}

async function createHarness(options: HarnessOptions = {}) {
  const deliveryApi = await deliveryModule();
  expect(deliveryApi).not.toBeNull();
  if (!deliveryApi) throw new Error("delivery module missing");
  const db = new SqliteD1Database();
  databases.push(db);
  const keyring = await createKeyring(master);
  const encryptedToken = await keyring.encryptCredential(connectionId, "telegram", 1, token);
  const encryptedTitle = await keyring.encryptSensitive(
    "reminder-title",
    reminderId,
    1,
    options.title ?? "gọi cho mẹ",
  );
  db.sqlite.prepare(
    "INSERT INTO users (id, email, display_name, timezone, created_at, updated_at) VALUES ('user-1', 'owner@example.test', 'Owner', 'Asia/Ho_Chi_Minh', ?, ?)",
  ).run(now, now);
  db.sqlite.prepare(
    "INSERT INTO workspaces (id, owner_user_id, kind, created_at, updated_at) VALUES ('workspace-1', 'user-1', 'PERSONAL', ?, ?)",
  ).run(now, now);
  db.sqlite.prepare(
    "INSERT INTO memberships (workspace_id, user_id, role, created_at) VALUES ('workspace-1', 'user-1', 'OWNER', ?)",
  ).run(now);
  db.sqlite.prepare(
    `INSERT INTO bot_connections (
       id, user_id, provider, public_id, provider_bot_id, display_name,
       encrypted_token, encrypted_token_iv, token_fingerprint, credential_version,
       state, created_at, updated_at
     ) VALUES (?, 'user-1', 'telegram', ?, 'provider-bot', 'Bot', ?, ?,
       'fingerprint', 1, ?, ?, ?)`,
  ).run(
    connectionId,
    "A".repeat(22),
    options.corruptToken ? new Uint8Array([1]) : new Uint8Array(encryptedToken.ciphertext),
    options.corruptToken ? new Uint8Array(12) : new Uint8Array(encryptedToken.iv),
    options.connectionState ?? "ACTIVE_BOUND",
    now,
    now,
  );
  db.sqlite.prepare(
    `INSERT INTO chat_identities (
       id, connection_id, provider_user_id, private_chat_id, display_name, linked_at
     ) VALUES ('chat-identity-1', ?, 'provider-user', ?, 'Owner', ?)`,
  ).run(connectionId, options.privateChatId ?? "private-chat", now);
  db.sqlite.prepare(
    `INSERT INTO reminders (
       id, workspace_id, chat_identity_id, title_ciphertext, title_iv,
       title_key_version, scheduled_at, timezone, status, claimed_at,
       cancelled_at, transition_marker, created_at, updated_at
     ) VALUES (?, 'workspace-1', 'chat-identity-1', ?, ?, 1, ?,
       'Asia/Ho_Chi_Minh', ?, ?, NULL, 'scheduler-owner', ?, ?)`,
  ).run(
    reminderId,
    options.corruptTitle ? new Uint8Array([1]) : new Uint8Array(encryptedTitle.ciphertext),
    options.corruptTitle ? new Uint8Array(12) : new Uint8Array(encryptedTitle.iv),
    now - 1,
    options.reminderStatus ?? "CLAIMED",
    options.claimedAt === undefined ? now : options.claimedAt,
    now,
    now,
  );
  const sendText = vi.fn<NonNullable<DeliverReminderDependencies["sendText"]>>(
    async () => ({ providerMessageId: "provider-receipt-1" }),
  );
  let currentTime = now;
  const deps = {
    store: new deliveryApi.D1ReminderDeliveryStore(db as unknown as D1Database),
    keyring,
    sendText,
    now: () => currentTime,
    randomBytes: deterministicRandomBytes(),
  };
  return {
    module: deliveryApi,
    db,
    keyring,
    sendText,
    deps,
    setNow(value: number) { currentTime = value; },
  };
}

function seedDelivery(
  db: SqliteD1Database,
  input: {
    status: "PENDING" | "SENDING" | "SENT" | "RETRYABLE" | "FAILED" | "UNCERTAIN" | "CANCELLED";
    attemptCount: number;
    sendStartedAt?: number | null;
    retryNotBefore?: number | null;
    marker?: string | null;
    receipt?: string | null;
  },
): void {
  db.sqlite.prepare(
    `INSERT INTO reminder_deliveries (
       id, reminder_id, status, attempt_count, provider_receipt, safe_error_code,
       sent_at, send_started_at, retry_not_before, transition_marker, created_at, updated_at
     ) VALUES ('delivery-existing', ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?)`,
  ).run(
    reminderId,
    input.status,
    input.attemptCount,
    input.receipt ?? null,
    input.sendStartedAt ?? null,
    input.retryNotBefore ?? null,
    input.marker ?? null,
    now,
    now,
  );
}

describe("D1 reminder delivery ownership and finalization", () => {
  it("acquires SENDING before egress and atomically records a successful receipt", async () => {
    const harness = await createHarness();
    const decryptTitle = vi.spyOn(harness.keyring, "decryptSensitive");
    const decryptCredential = vi.spyOn(harness.keyring, "decryptCredential");
    harness.sendText.mockImplementationOnce(async (provider, credential, chatId, text) => {
      expect(harness.db.sqlite.prepare(
        "SELECT status, attempt_count, send_started_at, transition_marker FROM reminder_deliveries",
      ).get()).toMatchObject({
        status: "SENDING",
        attempt_count: 1,
        send_started_at: now,
        transition_marker: expect.any(String),
      });
      expect(provider).toBe("telegram");
      expect(credential).toBe(token);
      expect(chatId).toBe("private-chat");
      expect(text).toBe("⏰ Nhắc hẹn: gọi cho mẹ");
      expect(text.length).toBeLessThanOrEqual(2_000);
      return { providerMessageId: "provider-receipt-1" };
    });

    await expect(harness.module.deliverReminder(reminderId, harness.deps)).resolves.toEqual({ status: "SENT" });

    expect(decryptTitle).toHaveBeenCalledWith(
      "reminder-title",
      reminderId,
      1,
      expect.objectContaining({ ciphertext: expect.any(ArrayBuffer), iv: expect.any(ArrayBuffer) }),
    );
    expect(decryptCredential).toHaveBeenCalledWith(
      connectionId,
      "telegram",
      1,
      expect.objectContaining({ ciphertext: expect.any(ArrayBuffer), iv: expect.any(ArrayBuffer) }),
    );
    expect(harness.db.sqlite.prepare(
      "SELECT status, provider_receipt, sent_at FROM reminder_deliveries",
    ).get()).toEqual({ status: "SENT", provider_receipt: "provider-receipt-1", sent_at: now });
    expect(harness.db.sqlite.prepare("SELECT status FROM reminders").get()).toEqual({ status: "SENT" });
    expect(harness.db.sqlite.prepare(
      "SELECT action, result FROM audit_events ORDER BY rowid",
    ).all()).toEqual([
      { action: "REMINDER_DELIVERY_STARTED", result: "SUCCESS" },
      { action: "REMINDER_SENT", result: "SUCCESS" },
    ]);
  });

  it("is idempotent for an already-sent reminder and keeps one unique delivery row", async () => {
    const harness = await createHarness();

    await harness.module.deliverReminder(reminderId, harness.deps);
    await expect(harness.module.deliverReminder(reminderId, harness.deps)).resolves.toEqual({ status: "SENT" });

    expect(harness.sendText).toHaveBeenCalledTimes(1);
    expect(harness.db.sqlite.prepare("SELECT COUNT(*) AS count FROM reminder_deliveries").get()).toEqual({ count: 1 });
    expect(() => seedDelivery(harness.db, { status: "PENDING", attemptCount: 0 })).toThrow(/UNIQUE constraint failed/iu);
  });

  it("allows exactly one concurrent job to call the provider", async () => {
    const harness = await createHarness();
    let release: ((value: { providerMessageId: string }) => void) | undefined;
    harness.sendText.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));

    const first = harness.module.deliverReminder(reminderId, harness.deps);
    await vi.waitFor(() => expect(harness.sendText).toHaveBeenCalledTimes(1));
    const duplicate = await harness.module.deliverReminder(reminderId, harness.deps);
    expect(duplicate).toEqual({ status: "NOOP" });
    expect(harness.sendText).toHaveBeenCalledTimes(1);

    release?.({ providerMessageId: "provider-receipt-1" });
    await expect(first).resolves.toEqual({ status: "SENT" });
    expect(harness.db.sqlite.prepare("SELECT COUNT(*) AS count FROM reminder_deliveries").get()).toEqual({ count: 1 });
  });

  it("leaves SENDING after a success-finalize rollback and never sends it twice", async () => {
    const harness = await createHarness();
    harness.db.sqlite.exec(
      `CREATE TRIGGER force_sent_finalize_failure
       BEFORE UPDATE OF status ON reminders
       WHEN NEW.status = 'SENT'
       BEGIN SELECT RAISE(ABORT, 'forced finalization failure'); END`,
    );

    await expect(harness.module.deliverReminder(reminderId, harness.deps)).resolves.toEqual({ status: "UNCERTAIN" });
    expect(harness.db.sqlite.prepare(
      "SELECT status, provider_receipt FROM reminder_deliveries",
    ).get()).toEqual({ status: "SENDING", provider_receipt: null });
    expect(harness.db.sqlite.prepare("SELECT status FROM reminders").get()).toEqual({ status: "CLAIMED" });

    harness.setNow(now + 1);
    await expect(harness.module.deliverReminder(reminderId, harness.deps)).resolves.toEqual({ status: "NOOP" });
    expect(harness.sendText).toHaveBeenCalledTimes(1);
    harness.setNow(now + 300_000);
    await expect(harness.module.deliverReminder(reminderId, harness.deps)).resolves.toEqual({ status: "NOOP" });
    expect(harness.sendText).toHaveBeenCalledTimes(1);
    harness.setNow(now + 300_001);
    await expect(harness.module.deliverReminder(reminderId, harness.deps)).resolves.toEqual({ status: "UNCERTAIN" });
    expect(harness.db.sqlite.prepare("SELECT status FROM reminder_deliveries").get()).toEqual({ status: "UNCERTAIN" });
    expect(harness.db.sqlite.prepare("SELECT status FROM reminders").get()).toEqual({ status: "UNCERTAIN" });
    expect(harness.sendText).toHaveBeenCalledTimes(1);
  });

  it("fences a direct RETRYABLE attempt as CLAIMED so a failed finalization can be reconciled", async () => {
    const harness = await createHarness({ reminderStatus: "RETRYABLE", claimedAt: null });
    seedDelivery(harness.db, {
      status: "RETRYABLE",
      attemptCount: 1,
      retryNotBefore: now,
    });
    harness.db.sqlite.exec(
      `CREATE TRIGGER force_retry_finalize_failure
       BEFORE UPDATE OF status ON reminders
       WHEN NEW.status = 'SENT'
       BEGIN SELECT RAISE(ABORT, 'forced retry finalization failure'); END`,
    );

    await expect(harness.module.deliverReminder(reminderId, harness.deps)).resolves.toEqual({ status: "UNCERTAIN" });

    const reminder = harness.db.sqlite.prepare(
      "SELECT status, claimed_at, transition_marker FROM reminders WHERE id = ?",
    ).get(reminderId) as { status: string; claimed_at: number | null; transition_marker: string | null };
    const delivery = harness.db.sqlite.prepare(
      "SELECT status, attempt_count, send_started_at, transition_marker FROM reminder_deliveries WHERE reminder_id = ?",
    ).get(reminderId) as {
      status: string;
      attempt_count: number;
      send_started_at: number | null;
      transition_marker: string | null;
    };
    expect(reminder).toEqual({
      status: "CLAIMED",
      claimed_at: now,
      transition_marker: delivery.transition_marker,
    });
    expect(delivery).toMatchObject({
      status: "SENDING",
      attempt_count: 2,
      send_started_at: now,
      transition_marker: expect.any(String),
    });

    harness.setNow(now + 300_000);
    await expect(harness.module.deliverReminder(reminderId, harness.deps)).resolves.toEqual({ status: "NOOP" });
    harness.setNow(now + 300_001);
    await expect(harness.module.deliverReminder(reminderId, harness.deps)).resolves.toEqual({ status: "UNCERTAIN" });
    expect(harness.db.sqlite.prepare(
      "SELECT status FROM reminder_deliveries WHERE reminder_id = ?",
    ).get(reminderId)).toEqual({ status: "UNCERTAIN" });
    expect(harness.db.sqlite.prepare(
      "SELECT status FROM reminders WHERE id = ?",
    ).get(reminderId)).toEqual({ status: "UNCERTAIN" });
    expect(harness.sendText).toHaveBeenCalledTimes(1);
  });
});

describe("provider outcome mapping", () => {
  it("persists quota retry time before returning a bounded retry and honors early duplicates", async () => {
    const harness = await createHarness();
    harness.sendText.mockRejectedValueOnce(new ProviderOperationError("QUOTA", 37));

    await expect(harness.module.deliverReminder(reminderId, harness.deps)).resolves.toEqual({
      status: "RETRYABLE",
      retryAfterSeconds: 37,
    });
    expect(harness.db.sqlite.prepare(
      "SELECT status, attempt_count, retry_not_before, safe_error_code FROM reminder_deliveries",
    ).get()).toEqual({
      status: "RETRYABLE",
      attempt_count: 1,
      retry_not_before: now + 37_000,
      safe_error_code: "QUOTA",
    });
    expect(harness.db.sqlite.prepare("SELECT status FROM reminders").get()).toEqual({ status: "RETRYABLE" });

    harness.setNow(now + 1);
    await expect(harness.module.deliverReminder(reminderId, harness.deps)).resolves.toEqual({
      status: "RETRY_AFTER",
      retryAfterSeconds: 37,
    });
    expect(harness.sendText).toHaveBeenCalledTimes(1);

    harness.setNow(now + 37_000);
    await expect(harness.module.deliverReminder(reminderId, harness.deps)).resolves.toEqual({ status: "SENT" });
    expect(harness.sendText).toHaveBeenCalledTimes(2);
  });

  it("uses deterministic fallback delays and terminally fails the fourth quota attempt", async () => {
    const harness = await createHarness({ reminderStatus: "RETRYABLE" });
    seedDelivery(harness.db, {
      status: "RETRYABLE",
      attemptCount: 3,
      retryNotBefore: now,
    });
    harness.sendText.mockRejectedValueOnce(new ProviderOperationError("QUOTA"));

    await expect(harness.module.deliverReminder(reminderId, harness.deps)).resolves.toEqual({ status: "FAILED" });
    expect(harness.db.sqlite.prepare(
      "SELECT status, attempt_count, retry_not_before, safe_error_code FROM reminder_deliveries",
    ).get()).toEqual({
      status: "FAILED",
      attempt_count: 4,
      retry_not_before: null,
      safe_error_code: "QUOTA_RETRY_EXHAUSTED",
    });
    expect(harness.db.sqlite.prepare("SELECT status FROM reminders").get()).toEqual({ status: "FAILED" });
    await expect(harness.module.deliverReminder(reminderId, harness.deps)).resolves.toEqual({ status: "FAILED" });
    expect(harness.sendText).toHaveBeenCalledTimes(1);
  });

  it("uses the deterministic second-attempt quota fallback when retry-after is absent", async () => {
    const harness = await createHarness({ reminderStatus: "RETRYABLE" });
    seedDelivery(harness.db, {
      status: "RETRYABLE",
      attemptCount: 1,
      retryNotBefore: now,
    });
    harness.sendText.mockRejectedValueOnce(new ProviderOperationError("QUOTA"));

    await expect(harness.module.deliverReminder(reminderId, harness.deps)).resolves.toEqual({
      status: "RETRYABLE",
      retryAfterSeconds: 300,
    });
    expect(harness.db.sqlite.prepare(
      "SELECT status, attempt_count, retry_not_before FROM reminder_deliveries",
    ).get()).toEqual({
      status: "RETRYABLE",
      attempt_count: 2,
      retry_not_before: now + 300_000,
    });
  });

  it("atomically suspends rejected credentials and fails both delivery rows", async () => {
    const harness = await createHarness();
    harness.sendText.mockRejectedValueOnce(new ProviderOperationError("REJECTED_CREDENTIAL"));

    await expect(harness.module.deliverReminder(reminderId, harness.deps)).resolves.toEqual({ status: "FAILED" });

    expect(harness.db.sqlite.prepare("SELECT state FROM bot_connections").get()).toEqual({ state: "SUSPENDED" });
    expect(harness.db.sqlite.prepare("SELECT status, safe_error_code FROM reminder_deliveries").get()).toEqual({
      status: "FAILED",
      safe_error_code: "REJECTED_CREDENTIAL",
    });
    expect(harness.db.sqlite.prepare("SELECT status FROM reminders").get()).toEqual({ status: "FAILED" });
  });

  it.each(["UNCERTAIN", "INVALID_RESPONSE"] as const)(
    "maps %s to terminal UNCERTAIN and never retries the provider",
    async (code) => {
      const harness = await createHarness();
      harness.sendText.mockRejectedValueOnce(new ProviderOperationError(code));

      await expect(harness.module.deliverReminder(reminderId, harness.deps)).resolves.toEqual({ status: "UNCERTAIN" });
      await expect(harness.module.deliverReminder(reminderId, harness.deps)).resolves.toEqual({ status: "UNCERTAIN" });

      expect(harness.db.sqlite.prepare("SELECT status, safe_error_code FROM reminder_deliveries").get()).toEqual({
        status: "UNCERTAIN",
        safe_error_code: code,
      });
      expect(harness.db.sqlite.prepare("SELECT status FROM reminders").get()).toEqual({ status: "UNCERTAIN" });
      expect(harness.sendText).toHaveBeenCalledTimes(1);
    },
  );

  it("maps a known non-quota provider failure to terminal FAILED", async () => {
    const harness = await createHarness();
    harness.sendText.mockRejectedValueOnce(new ProviderOperationError("FAILED"));

    await expect(harness.module.deliverReminder(reminderId, harness.deps)).resolves.toEqual({ status: "FAILED" });
    expect(harness.db.sqlite.prepare("SELECT status, safe_error_code FROM reminder_deliveries").get()).toEqual({
      status: "FAILED",
      safe_error_code: "FAILED",
    });
    expect(harness.sendText).toHaveBeenCalledTimes(1);
  });
});

describe("safe local delivery boundaries", () => {
  it("terminally rejects a cross-tenant reminder before ownership or provider egress", async () => {
    const harness = await createHarness();
    harness.db.sqlite.prepare(
      "INSERT INTO users (id, email, display_name, timezone, created_at, updated_at) VALUES ('user-2', 'other@example.test', 'Other', 'Asia/Ho_Chi_Minh', ?, ?)",
    ).run(now, now);
    harness.db.sqlite.prepare(
      "UPDATE bot_connections SET user_id = 'user-2' WHERE id = ?",
    ).run(connectionId);

    await expect(harness.deps.store.read(reminderId)).resolves.toBeNull();
    await expect(harness.deps.store.acquire(
      reminderId,
      "cross-tenant-delivery",
      "cross-tenant-owner",
      now,
    )).resolves.toEqual({ status: "MISSING" });
    expect(harness.db.sqlite.prepare(
      "SELECT COUNT(*) AS count FROM reminder_deliveries",
    ).get()).toEqual({ count: 0 });

    await expect(harness.module.deliverReminder(reminderId, harness.deps)).resolves.toEqual({ status: "FAILED" });
    expect(harness.db.sqlite.prepare(
      "SELECT status FROM reminders WHERE id = ?",
    ).get(reminderId)).toEqual({ status: "FAILED" });
    expect(harness.db.sqlite.prepare(
      "SELECT status, safe_error_code FROM reminder_deliveries WHERE reminder_id = ?",
    ).get(reminderId)).toEqual({
      status: "FAILED",
      safe_error_code: "INVALID_REMINDER_TENANT",
    });
    expect(harness.sendText).not.toHaveBeenCalled();
  });

  it("reconciles an expired SENDING lease to UNCERTAIN without another provider call", async () => {
    const harness = await createHarness({ claimedAt: now - 300_001 });
    seedDelivery(harness.db, {
      status: "SENDING",
      attemptCount: 1,
      sendStartedAt: now - 300_001,
      marker: "stale-owner",
    });

    await expect(harness.module.deliverReminder(reminderId, harness.deps)).resolves.toEqual({ status: "UNCERTAIN" });

    expect(harness.db.sqlite.prepare("SELECT status, safe_error_code FROM reminder_deliveries").get()).toEqual({
      status: "UNCERTAIN",
      safe_error_code: "STALE_SENDING_LEASE",
    });
    expect(harness.db.sqlite.prepare("SELECT status FROM reminders").get()).toEqual({ status: "UNCERTAIN" });
    expect(harness.sendText).not.toHaveBeenCalled();
  });

  it.each([
    { label: "corrupt title", options: { corruptTitle: true }, code: "INVALID_REMINDER_DATA" },
    { label: "corrupt credential", options: { corruptToken: true }, code: "INVALID_REMINDER_DATA" },
    { label: "legacy oversized title", options: { title: "a".repeat(MAX_REMINDER_TITLE_CODE_UNITS + 1) }, code: "TITLE_TOO_LONG" },
    { label: "inactive connection", options: { connectionState: "SUSPENDED" as const }, code: "CONNECTION_NOT_ACTIVE" },
    { label: "empty private chat identity", options: { privateChatId: "" }, code: "INVALID_REMINDER_DATA" },
  ])("fails $label locally without provider egress", async ({ options, code }) => {
    const harness = await createHarness(options);

    await expect(harness.module.deliverReminder(reminderId, harness.deps)).resolves.toEqual({ status: "FAILED" });

    expect(harness.db.sqlite.prepare("SELECT status, safe_error_code FROM reminder_deliveries").get()).toEqual({
      status: "FAILED",
      safe_error_code: code,
    });
    expect(harness.db.sqlite.prepare("SELECT status FROM reminders").get()).toEqual({ status: "FAILED" });
    expect(harness.sendText).not.toHaveBeenCalled();
  });

  it("keeps an 1,800-code-unit title inside Zalo's final 2,000-unit wrapper", async () => {
    const harness = await createHarness({ title: "a".repeat(MAX_REMINDER_TITLE_CODE_UNITS) });

    await harness.module.deliverReminder(reminderId, harness.deps);

    const text = harness.sendText.mock.calls[0]?.[3];
    expect(text).toBeTypeOf("string");
    if (typeof text !== "string") throw new TypeError("provider text missing");
    expect(text.startsWith("⏰ Nhắc hẹn: ")).toBe(true);
    expect(text.length).toBeLessThanOrEqual(2_000);
  });

  it("never stores plaintext title/token in D1 or returns them in outcomes", async () => {
    const privateTitle = "bí mật hoa lan tím";
    const harness = await createHarness({ title: privateTitle });

    const result = await harness.module.deliverReminder(reminderId, harness.deps);
    const stored = harness.db.sqlite.prepare(
      `SELECT CAST(r.title_ciphertext AS TEXT) AS title,
              CAST(c.encrypted_token AS TEXT) AS token,
              d.safe_error_code AS safe_error
       FROM reminders r
       JOIN chat_identities ci ON ci.id = r.chat_identity_id
       JOIN bot_connections c ON c.id = ci.connection_id
       JOIN reminder_deliveries d ON d.reminder_id = r.id`,
    ).get();

    expect(JSON.stringify({ result, stored })).not.toContain(privateTitle);
    expect(JSON.stringify({ result, stored })).not.toContain(token);
    expect(JSON.stringify(result)).not.toContain("private-chat");
  });
});

describe("cancellation handoff", () => {
  it("cancels before send ownership and creates a delivery tombstone", async () => {
    const harness = await createHarness({ reminderStatus: "PENDING", claimedAt: null });

    await expect(harness.module.cancelReminderBeforeSend(reminderId, {
      store: harness.deps.store,
      now: () => now,
      randomBytes: deterministicRandomBytes(),
    })).resolves.toEqual({ status: "CANCELLED" });
    await expect(harness.module.deliverReminder(reminderId, harness.deps)).resolves.toEqual({ status: "CANCELLED" });

    expect(harness.db.sqlite.prepare("SELECT status, cancelled_at FROM reminders").get()).toEqual({
      status: "CANCELLED",
      cancelled_at: now,
    });
    expect(harness.db.sqlite.prepare("SELECT status FROM reminder_deliveries").get()).toEqual({ status: "CANCELLED" });
    expect(harness.sendText).not.toHaveBeenCalled();
  });

  it("reports TOO_LATE once SENDING owns the reminder", async () => {
    const harness = await createHarness();
    let release: ((value: { providerMessageId: string }) => void) | undefined;
    harness.sendText.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const delivery = harness.module.deliverReminder(reminderId, harness.deps);
    await vi.waitFor(() => expect(harness.sendText).toHaveBeenCalledTimes(1));

    await expect(harness.module.cancelReminderBeforeSend(reminderId, {
      store: harness.deps.store,
      now: () => now,
      randomBytes: deterministicRandomBytes(),
    })).resolves.toEqual({ status: "TOO_LATE" });
    expect(harness.db.sqlite.prepare("SELECT status FROM reminders").get()).toEqual({ status: "CLAIMED" });

    release?.({ providerMessageId: "provider-receipt-1" });
    await expect(delivery).resolves.toEqual({ status: "SENT" });
  });

  it("rolls back cancellation when its guarded audit commit fails", async () => {
    const harness = await createHarness({ reminderStatus: "PENDING", claimedAt: null });
    harness.db.sqlite.exec(
      "CREATE TRIGGER force_cancel_audit_failure BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'forced cancel failure'); END",
    );

    await expect(harness.module.cancelReminderBeforeSend(reminderId, {
      store: harness.deps.store,
      now: () => now,
      randomBytes: deterministicRandomBytes(),
    })).rejects.toThrow("forced cancel failure");

    expect(harness.db.sqlite.prepare("SELECT status, cancelled_at FROM reminders").get()).toEqual({
      status: "PENDING",
      cancelled_at: null,
    });
    expect(harness.db.sqlite.prepare("SELECT COUNT(*) AS count FROM reminder_deliveries").get()).toEqual({ count: 0 });
  });
});
