import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deterministicRandomBytes,
  SqliteD1Database,
} from "@/testing/sqlite-d1.test-support";

const now = 1_800_000_000_000;
const databases: SqliteD1Database[] = [];

function database(): SqliteD1Database {
  const value = new SqliteD1Database();
  databases.push(value);
  return value;
}

afterEach(() => {
  vi.restoreAllMocks();
  while (databases.length > 0) databases.pop()?.close();
});

function seedAccount(db: SqliteD1Database): void {
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
     ) VALUES ('connection-1', 'user-1', 'telegram', ?, 'provider-bot', 'Bot',
       X'01', zeroblob(12), 'fingerprint', 1, 'ACTIVE_BOUND', ?, ?)`,
  ).run("A".repeat(22), now, now);
  db.sqlite.prepare(
    `INSERT INTO chat_identities (
       id, connection_id, provider_user_id, private_chat_id, display_name, linked_at
     ) VALUES ('chat-identity-1', 'connection-1', 'provider-user', 'private-chat', 'Owner', ?)`,
  ).run(now);
}

function seedReminder(
  db: SqliteD1Database,
  id: string,
  scheduledAt: number,
  status = "PENDING",
  claimedAt: number | null = null,
  marker: string | null = null,
): void {
  db.sqlite.prepare(
    `INSERT INTO reminders (
       id, workspace_id, chat_identity_id, title_ciphertext, title_iv,
       title_key_version, scheduled_at, timezone, status, claimed_at,
       cancelled_at, transition_marker, created_at, updated_at
     ) VALUES (?, 'workspace-1', 'chat-identity-1', X'01', zeroblob(12), 1,
       ?, 'Asia/Ho_Chi_Minh', ?, ?, NULL, ?, ?, ?)`,
  ).run(id, scheduledAt, status, claimedAt, marker, now, now);
}

async function schedulerModule() {
  const modulePath = "./scheduler";
  return import(/* @vite-ignore */ modulePath).catch(() => null);
}

async function deliveryModule() {
  const modulePath = "./delivery";
  return import(/* @vite-ignore */ modulePath).catch(() => null);
}

describe("Task 7 migrated scheduling schema", () => {
  it("adds bounded dispatch, claim, and delivery lease fields with recovery indexes", () => {
    const db = database();
    const inbound = db.sqlite.prepare("PRAGMA table_info(inbound_updates)").all() as Array<{ name: string }>;
    const reminders = db.sqlite.prepare("PRAGMA table_info(reminders)").all() as Array<{ name: string }>;
    const deliveries = db.sqlite.prepare("PRAGMA table_info(reminder_deliveries)").all() as Array<{ name: string }>;
    const indexes = db.sqlite.prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'index' AND name LIKE 'idx_%'
       ORDER BY name`,
    ).all() as Array<{ name: string }>;

    expect(inbound.map(({ name }) => name)).toEqual(expect.arrayContaining([
      "dispatch_started_at",
      "dispatch_attempt_count",
      "dispatch_marker",
      "safe_error_code",
    ]));
    expect(reminders.map(({ name }) => name)).toContain("transition_marker");
    expect(deliveries.map(({ name }) => name)).toEqual(expect.arrayContaining([
      "send_started_at",
      "retry_not_before",
      "transition_marker",
    ]));
    expect(indexes.map(({ name }) => name)).toEqual(expect.arrayContaining([
      "idx_reminders_due_pending",
      "idx_reminders_stale_claimed",
      "idx_deliveries_due_retryable",
      "idx_deliveries_stale_sending",
      "idx_inbound_pending_dispatch",
      "idx_inbound_processing_dispatch",
    ]));

    expect(() => db.sqlite.prepare(
      `INSERT INTO inbound_updates (
         id, connection_id, provider, provider_message_id, provider_user_id,
         private_chat_id, message_ciphertext, message_iv, message_key_version,
         state, received_at, attempt_count, dispatch_attempt_count
       ) VALUES ('bad-inbound', 'missing', 'telegram', 'message', 'user', 'chat',
         X'01', zeroblob(12), 1, 'PENDING', ?, 5, 0)`,
    ).run(now)).toThrow();
  });

  it("enforces delivery state invariants in the migrated database", () => {
    const db = database();
    seedAccount(db);
    seedReminder(db, "reminder-invariant-01", now - 1);

    expect(() => db.sqlite.prepare(
      `INSERT INTO reminder_deliveries (
         id, reminder_id, status, attempt_count, created_at, updated_at
       ) VALUES ('delivery-1', 'reminder-invariant-01', 'SENDING', 1, ?, ?)`,
    ).run(now, now)).toThrow(/CHECK constraint failed/iu);
    expect(() => db.sqlite.prepare(
      `INSERT INTO reminder_deliveries (
         id, reminder_id, status, attempt_count, created_at, updated_at
       ) VALUES ('delivery-2', 'reminder-invariant-01', 'RETRYABLE', 1, ?, ?)`,
    ).run(now, now)).toThrow(/CHECK constraint failed/iu);
  });
});

describe("D1 due reminder scheduler", () => {
  it("validates a positive integer limit and caps a stable due batch at ten", async () => {
    const scheduler = await schedulerModule();
    expect(scheduler).not.toBeNull();
    if (!scheduler) return;
    const db = database();
    seedAccount(db);
    for (let index = 11; index >= 0; index -= 1) {
      seedReminder(
        db,
        `reminder-${String(index).padStart(2, "0")}`,
        now - 1_000 + Math.floor(index / 2),
      );
    }
    const published: unknown[] = [];
    const deps = {
      store: new scheduler.D1ReminderSchedulerStore(db as unknown as D1Database),
      enqueue: async (job: unknown) => { published.push(job); },
      randomBytes: deterministicRandomBytes(),
    };

    await expect(scheduler.claimDueReminders(now, 0, deps)).rejects.toThrow(TypeError);
    await expect(scheduler.claimDueReminders(now, 1.5, deps)).rejects.toThrow(TypeError);
    const result = await scheduler.claimDueReminders(now, 99, deps);

    expect(result).toEqual({ selected: 10, published: 10, publishFailed: 0 });
    expect(published).toEqual(Array.from({ length: 10 }, (_, index) => ({
      type: "DELIVER_REMINDER",
      reminderId: `reminder-${String(index).padStart(2, "0")}`,
    })));
    expect(JSON.stringify(published)).not.toContain("title");
  });

  it("claims conditionally once and makes repeated Cron a no-op before lease expiry", async () => {
    const scheduler = await schedulerModule();
    expect(scheduler).not.toBeNull();
    if (!scheduler) return;
    const db = database();
    seedAccount(db);
    seedReminder(db, "reminder-single-00001", now - 1);
    const enqueue = vi.fn(async () => undefined);
    const deps = {
      store: new scheduler.D1ReminderSchedulerStore(db as unknown as D1Database),
      enqueue,
      randomBytes: deterministicRandomBytes(),
    };

    await Promise.all([
      scheduler.claimDueReminders(now, 5, deps),
      scheduler.claimDueReminders(now, 5, deps),
    ]);
    await scheduler.claimDueReminders(now + 299_999, 5, deps);

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(db.sqlite.prepare(
      "SELECT status, claimed_at, transition_marker FROM reminders WHERE id = ?",
    ).get("reminder-single-00001")).toMatchObject({
      status: "CLAIMED",
      claimed_at: now,
      transition_marker: expect.any(String),
    });
  });

  it("restores only its own exact prior state after publish rejection and continues", async () => {
    const scheduler = await schedulerModule();
    expect(scheduler).not.toBeNull();
    if (!scheduler) return;
    const db = database();
    seedAccount(db);
    seedReminder(db, "reminder-first-000001", now - 2);
    seedReminder(db, "reminder-second-00001", now - 1);
    const enqueue = vi.fn(async (job: { reminderId: string }) => {
      if (job.reminderId === "reminder-first-000001") throw new Error("queue unavailable");
    });

    const result = await scheduler.claimDueReminders(now, 5, {
      store: new scheduler.D1ReminderSchedulerStore(db as unknown as D1Database),
      enqueue,
      randomBytes: deterministicRandomBytes(),
    });

    expect(result).toEqual({ selected: 2, published: 1, publishFailed: 1 });
    expect(db.sqlite.prepare(
      "SELECT status, claimed_at, transition_marker FROM reminders WHERE id = ?",
    ).get("reminder-first-000001")).toEqual({
      status: "PENDING",
      claimed_at: null,
      transition_marker: null,
    });
    expect(db.sqlite.prepare("SELECT status FROM reminders WHERE id = ?").get(
      "reminder-second-00001",
    )).toEqual({ status: "CLAIMED" });
  });

  it("continues the bounded reminder batch when a publish rollback also rejects", async () => {
    const scheduler = await schedulerModule();
    expect(scheduler).not.toBeNull();
    if (!scheduler) return;
    const db = database();
    seedAccount(db);
    seedReminder(db, "reminder-first-rollback", now - 2);
    seedReminder(db, "reminder-second-after01", now - 1);
    const realStore = new scheduler.D1ReminderSchedulerStore(db as unknown as D1Database);
    const rollback = vi.fn(async () => { throw new Error("D1 rollback unavailable"); });
    const enqueue = vi.fn(async (job: { reminderId: string }) => {
      if (job.reminderId === "reminder-first-rollback") throw new Error("queue unavailable");
    });

    await expect(scheduler.claimDueReminders(now, 5, {
      store: {
        selectCandidates: (time: number, limit: number) => realStore.selectCandidates(time, limit),
        claim: (candidate: never, time: number, marker: string) => realStore.claim(candidate, time, marker),
        rollback,
      },
      enqueue,
      randomBytes: deterministicRandomBytes(),
    })).resolves.toEqual({ selected: 2, published: 1, publishFailed: 1 });

    expect(rollback).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(db.sqlite.prepare("SELECT status FROM reminders WHERE id = ?").get(
      "reminder-second-after01",
    )).toEqual({ status: "CLAIMED" });
  });

  it("recovers stale claims and only redrives retryable deliveries when due", async () => {
    const scheduler = await schedulerModule();
    expect(scheduler).not.toBeNull();
    if (!scheduler) return;
    const db = database();
    seedAccount(db);
    seedReminder(db, "reminder-stale-000001", now - 10_000, "CLAIMED", now - 300_000, "old-marker");
    seedReminder(db, "reminder-retry-due-01", now - 9_000, "RETRYABLE");
    seedReminder(db, "reminder-retry-early1", now - 8_000, "RETRYABLE");
    seedReminder(db, "reminder-terminal-000", now - 7_000, "CLAIMED", now - 300_001, "terminal-marker");
    db.sqlite.prepare(
      `INSERT INTO reminder_deliveries (
         id, reminder_id, status, attempt_count, retry_not_before, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run("delivery-due", "reminder-retry-due-01", "RETRYABLE", 2, now, now, now);
    db.sqlite.prepare(
      `INSERT INTO reminder_deliveries (
         id, reminder_id, status, attempt_count, retry_not_before, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run("delivery-early", "reminder-retry-early1", "RETRYABLE", 2, now + 1, now, now);
    db.sqlite.prepare(
      `INSERT INTO reminder_deliveries (
         id, reminder_id, status, attempt_count, safe_error_code, created_at, updated_at
       ) VALUES (?, ?, 'FAILED', 1, 'FAILED', ?, ?)`,
    ).run("delivery-terminal", "reminder-terminal-000", now, now);
    const published: Array<{ reminderId: string }> = [];

    await scheduler.claimDueReminders(now, 10, {
      store: new scheduler.D1ReminderSchedulerStore(db as unknown as D1Database),
      enqueue: async (job: { reminderId: string }) => { published.push(job); },
      randomBytes: deterministicRandomBytes(),
    });

    expect(published.map(({ reminderId }) => reminderId)).toEqual([
      "reminder-stale-000001",
      "reminder-retry-due-01",
    ]);
    expect(db.sqlite.prepare("SELECT status FROM reminders WHERE id = ?").get(
      "reminder-retry-early1",
    )).toEqual({ status: "RETRYABLE" });
    expect(db.sqlite.prepare("SELECT status FROM reminders WHERE id = ?").get(
      "reminder-terminal-000",
    )).toEqual({ status: "CLAIMED" });
  });

  it("keeps an exact-boundary SENDING lease and enqueues it only one millisecond after expiry", async () => {
    const scheduler = await schedulerModule();
    expect(scheduler).not.toBeNull();
    if (!scheduler) return;
    const db = database();
    seedAccount(db);
    seedReminder(
      db,
      "reminder-sending-equal",
      now - 2,
      "CLAIMED",
      now - 300_001,
      "fresh-send-owner",
    );
    seedReminder(
      db,
      "reminder-sending-stale",
      now - 1,
      "CLAIMED",
      now - 300_001,
      "stale-send-owner",
    );
    db.sqlite.prepare(
      `INSERT INTO reminder_deliveries (
         id, reminder_id, status, attempt_count, send_started_at,
         transition_marker, created_at, updated_at
       ) VALUES (?, ?, 'SENDING', 1, ?, ?, ?, ?)`,
    ).run(
      "delivery-sending-equal",
      "reminder-sending-equal",
      now - 300_000,
      "fresh-send-owner",
      now,
      now,
    );
    db.sqlite.prepare(
      `INSERT INTO reminder_deliveries (
         id, reminder_id, status, attempt_count, send_started_at,
         transition_marker, created_at, updated_at
       ) VALUES (?, ?, 'SENDING', 1, ?, ?, ?, ?)`,
    ).run(
      "delivery-sending-stale",
      "reminder-sending-stale",
      now - 300_001,
      "stale-send-owner",
      now,
      now,
    );
    const published: unknown[] = [];

    const result = await scheduler.claimDueReminders(now, 5, {
      store: new scheduler.D1ReminderSchedulerStore(db as unknown as D1Database),
      enqueue: async (job: unknown) => { published.push(job); },
      randomBytes: deterministicRandomBytes(),
    });

    expect(result).toEqual({ selected: 1, published: 1, publishFailed: 0 });
    expect(published).toEqual([{
      type: "DELIVER_REMINDER",
      reminderId: "reminder-sending-stale",
    }]);
    expect(db.sqlite.prepare(
      "SELECT claimed_at, transition_marker FROM reminders WHERE id = ?",
    ).get("reminder-sending-equal")).toEqual({
      claimed_at: now - 300_001,
      transition_marker: "fresh-send-owner",
    });
  });

  it("cannot roll back a reminder after delivery atomically replaces the scheduler marker", async () => {
    const scheduler = await schedulerModule();
    const deliveryApi = await deliveryModule();
    expect(scheduler).not.toBeNull();
    expect(deliveryApi).not.toBeNull();
    if (!scheduler || !deliveryApi) return;
    const db = database();
    seedAccount(db);
    seedReminder(db, "reminder-retry-race01", now - 1, "RETRYABLE");
    db.sqlite.prepare(
      `INSERT INTO reminder_deliveries (
         id, reminder_id, status, attempt_count, retry_not_before,
         transition_marker, created_at, updated_at
       ) VALUES ('delivery-retry-race', ?, 'RETRYABLE', 1, ?, NULL, ?, ?)`,
    ).run("reminder-retry-race01", now, now, now);
    const deliveryStore = new deliveryApi.D1ReminderDeliveryStore(
      db as unknown as D1Database,
    );

    const result = await scheduler.claimDueReminders(now, 5, {
      store: new scheduler.D1ReminderSchedulerStore(db as unknown as D1Database),
      enqueue: async () => {
        await expect(deliveryStore.acquire(
          "reminder-retry-race01",
          "unused-new-delivery-id",
          "delivery-send-owner",
          now,
        )).resolves.toMatchObject({ status: "OWNED" });
        throw new Error("ambiguous Queue publication");
      },
      randomBytes: deterministicRandomBytes(),
    });

    expect(result).toEqual({ selected: 1, published: 0, publishFailed: 1 });
    expect(db.sqlite.prepare(
      "SELECT status, claimed_at, transition_marker FROM reminders WHERE id = ?",
    ).get("reminder-retry-race01")).toEqual({
      status: "CLAIMED",
      claimed_at: now,
      transition_marker: "delivery-send-owner",
    });
    expect(db.sqlite.prepare(
      "SELECT status, attempt_count, send_started_at, transition_marker FROM reminder_deliveries WHERE reminder_id = ?",
    ).get("reminder-retry-race01")).toEqual({
      status: "SENDING",
      attempt_count: 2,
      send_started_at: now,
      transition_marker: "delivery-send-owner",
    });

    const recoveryEnqueue = vi.fn(async () => undefined);
    const recovery = {
      store: new scheduler.D1ReminderSchedulerStore(db as unknown as D1Database),
      enqueue: recoveryEnqueue,
      randomBytes: deterministicRandomBytes(),
    };
    await scheduler.claimDueReminders(now + 300_000, 5, recovery);
    expect(recoveryEnqueue).not.toHaveBeenCalled();
    await scheduler.claimDueReminders(now + 300_001, 5, recovery);
    expect(recoveryEnqueue).toHaveBeenCalledExactlyOnceWith({
      type: "DELIVER_REMINDER",
      reminderId: "reminder-retry-race01",
    });
  });
});

function seedInbound(
  db: SqliteD1Database,
  input: {
    id: string;
    state?: "PENDING" | "PROCESSING";
    receivedAt?: number;
    processingStartedAt?: number | null;
    attemptCount?: number;
    dispatchStartedAt?: number | null;
    dispatchAttemptCount?: number;
    dispatchMarker?: string | null;
  },
): void {
  db.sqlite.prepare(
    `INSERT INTO inbound_updates (
       id, connection_id, provider, provider_message_id, provider_user_id,
       private_chat_id, message_ciphertext, message_iv, message_key_version,
       state, received_at, processing_started_at, attempt_count, processed_at,
       transition_marker, dispatch_started_at, dispatch_attempt_count,
       dispatch_marker, safe_error_code
     ) VALUES (?, 'connection-1', 'telegram', ?, 'provider-user', 'private-chat',
       X'01', zeroblob(12), 1, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, NULL)`,
  ).run(
    input.id,
    input.id,
    input.state ?? "PENDING",
    input.receivedAt ?? now - 1,
    input.processingStartedAt ?? null,
    input.attemptCount ?? 0,
    input.dispatchStartedAt ?? null,
    input.dispatchAttemptCount ?? 0,
    input.dispatchMarker ?? null,
  );
}

describe("D1 inbound orphan redrive", () => {
  it("recovers a lost initial Queue message with an owned dispatch reservation", async () => {
    const scheduler = await schedulerModule();
    expect(scheduler).not.toBeNull();
    if (!scheduler) return;
    const db = database();
    seedAccount(db);
    seedInbound(db, {
      id: "inbound-lost-000000001",
      dispatchStartedAt: now - 300_001,
      dispatchAttemptCount: 1,
      dispatchMarker: "old-dispatch",
    });
    const jobs: unknown[] = [];

    const result = await scheduler.redriveInboundOrphans(now, 5, {
      store: new scheduler.D1InboundDispatchStore(db as unknown as D1Database),
      enqueue: async (job: unknown) => { jobs.push(job); },
      randomBytes: deterministicRandomBytes(),
    });

    expect(result).toEqual({ selected: 1, published: 1, publishFailed: 0, exhausted: 0 });
    expect(jobs).toEqual([{ type: "PROCESS_INBOUND", inboundId: "inbound-lost-000000001" }]);
    expect(db.sqlite.prepare(
      "SELECT dispatch_attempt_count, dispatch_started_at, dispatch_marker FROM inbound_updates",
    ).get()).toMatchObject({
      dispatch_attempt_count: 2,
      dispatch_started_at: now,
      dispatch_marker: expect.any(String),
    });
  });

  it("rolls back a rejected dispatch reservation without clobbering its prior values", async () => {
    const scheduler = await schedulerModule();
    expect(scheduler).not.toBeNull();
    if (!scheduler) return;
    const db = database();
    seedAccount(db);
    seedInbound(db, {
      id: "inbound-rollback-00001",
      dispatchStartedAt: now - 300_001,
      dispatchAttemptCount: 2,
      dispatchMarker: "prior-marker",
    });

    await scheduler.redriveInboundOrphans(now, 5, {
      store: new scheduler.D1InboundDispatchStore(db as unknown as D1Database),
      enqueue: async () => { throw new Error("queue unavailable"); },
      randomBytes: deterministicRandomBytes(),
    });

    expect(db.sqlite.prepare(
      "SELECT state, dispatch_started_at, dispatch_attempt_count, dispatch_marker FROM inbound_updates",
    ).get()).toEqual({
      state: "PENDING",
      dispatch_started_at: now - 300_001,
      dispatch_attempt_count: 2,
      dispatch_marker: "prior-marker",
    });
  });

  it("continues inbound recovery when a rejected publish cannot roll back immediately", async () => {
    const scheduler = await schedulerModule();
    expect(scheduler).not.toBeNull();
    if (!scheduler) return;
    const db = database();
    seedAccount(db);
    seedInbound(db, { id: "inbound-first-rollback1", receivedAt: now - 2 });
    seedInbound(db, { id: "inbound-second-after01", receivedAt: now - 1 });
    const realStore = new scheduler.D1InboundDispatchStore(db as unknown as D1Database);
    const rollback = vi.fn(async () => { throw new Error("D1 rollback unavailable"); });
    const enqueue = vi.fn(async (job: { inboundId: string }) => {
      if (job.inboundId === "inbound-first-rollback1") throw new Error("queue unavailable");
    });

    await expect(scheduler.redriveInboundOrphans(now, 5, {
      store: {
        selectOrphans: (time: number, limit: number) => realStore.selectOrphans(time, limit),
        reserve: (id: string, time: number, marker: string) => realStore.reserve(id, time, marker),
        rollback,
      },
      enqueue,
      randomBytes: deterministicRandomBytes(),
    })).resolves.toEqual({ selected: 2, published: 1, publishFailed: 1, exhausted: 0 });

    expect(rollback).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledTimes(2);
  });

  it("terminally fails exhausted poison rows but never kills a fresh fourth processing owner", async () => {
    const scheduler = await schedulerModule();
    expect(scheduler).not.toBeNull();
    if (!scheduler) return;
    const db = database();
    seedAccount(db);
    seedInbound(db, {
      id: "inbound-dispatch-bad01",
      dispatchStartedAt: now - 300_001,
      dispatchAttemptCount: 4,
      dispatchMarker: "old",
    });
    seedInbound(db, {
      id: "inbound-process-bad001",
      state: "PROCESSING",
      processingStartedAt: now - 300_001,
      attemptCount: 4,
      dispatchStartedAt: now - 300_001,
      dispatchAttemptCount: 2,
      dispatchMarker: "old",
    });
    seedInbound(db, {
      id: "inbound-fresh-fourth1",
      state: "PROCESSING",
      processingStartedAt: now - 299_999,
      attemptCount: 4,
      dispatchStartedAt: now - 299_999,
      dispatchAttemptCount: 4,
      dispatchMarker: "fresh",
    });
    const enqueue = vi.fn(async () => undefined);

    const result = await scheduler.redriveInboundOrphans(now, 5, {
      store: new scheduler.D1InboundDispatchStore(db as unknown as D1Database),
      enqueue,
      randomBytes: deterministicRandomBytes(),
    });

    expect(result).toEqual({ selected: 2, published: 0, publishFailed: 0, exhausted: 2 });
    expect(db.sqlite.prepare(
      "SELECT id, state, safe_error_code FROM inbound_updates ORDER BY id",
    ).all()).toEqual([
      { id: "inbound-dispatch-bad01", state: "FAILED", safe_error_code: "INBOUND_DISPATCH_EXHAUSTED" },
      { id: "inbound-fresh-fourth1", state: "PROCESSING", safe_error_code: null },
      { id: "inbound-process-bad001", state: "FAILED", safe_error_code: "INBOUND_PROCESSING_EXHAUSTED" },
    ]);
    expect(enqueue).not.toHaveBeenCalled();
  });
});
