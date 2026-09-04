import { afterEach, describe, expect, it } from "vitest";
import { createKeyring, type Keyring } from "@/modules/security/keyring";
import { RateLimitExceededError } from "@/modules/onboarding/service";
import {
  SqliteD1Database,
  deterministicRandomBytes,
} from "@/testing/sqlite-d1.test-support";
import {
  InvalidReminderError,
  ReminderChannelUnavailableError,
  ReminderNotCancellableError,
  ReminderNotFoundError,
  cancelPublicReminder,
  createManualReminder,
  listPublicReminders,
} from "./api-service";
import { D1ReminderApiStore } from "./infrastructure/d1/api-store";

const MASTER_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const NOW = 1_700_000_000_000;
const databases: SqliteD1Database[] = [];

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

async function seedAccount(
  db: SqliteD1Database,
  keyring: Keyring,
  suffix: string,
  state: "ACTIVE_BOUND" | "ACTIVE_UNBOUND" = "ACTIVE_BOUND",
): Promise<void> {
  const userId = `user-${suffix}`;
  const workspaceId = `workspace-${suffix}`;
  const connectionId = `connection-${suffix}`;
  const encrypted = await keyring.encryptCredential(connectionId, "telegram", 1, `token-${suffix}`);
  db.sqlite.prepare(
    "INSERT INTO users (id, email, display_name, timezone, created_at, updated_at) VALUES (?, ?, ?, 'Asia/Ho_Chi_Minh', ?, ?)",
  ).run(userId, `${suffix}@example.com`, `Owner ${suffix}`, NOW, NOW);
  db.sqlite.prepare(
    "INSERT INTO workspaces (id, owner_user_id, kind, created_at, updated_at) VALUES (?, ?, 'PERSONAL', ?, ?)",
  ).run(workspaceId, userId, NOW, NOW);
  db.sqlite.prepare(
    "INSERT INTO memberships (workspace_id, user_id, role, created_at) VALUES (?, ?, 'OWNER', ?)",
  ).run(workspaceId, userId, NOW);
  db.sqlite.prepare(
    `INSERT INTO bot_connections (
       id, user_id, provider, public_id, provider_bot_id, display_name,
       encrypted_token, encrypted_token_iv, token_fingerprint,
       credential_version, state, created_at, updated_at, transition_marker
     ) VALUES (?, ?, 'telegram', ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
  ).run(
    connectionId,
    userId,
    suffix.padEnd(22, "A").slice(0, 22),
    `provider-bot-${suffix}`,
    `Bot ${suffix}`,
    new Uint8Array(encrypted.ciphertext),
    new Uint8Array(encrypted.iv),
    `fingerprint-${suffix}`,
    state,
    NOW,
    NOW,
    `marker-${suffix}`,
  );
  if (state === "ACTIVE_BOUND") {
    db.sqlite.prepare(
      `INSERT INTO chat_identities (
         id, connection_id, provider_user_id, private_chat_id, display_name, linked_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      `identity-${suffix}`,
      connectionId,
      `provider-user-${suffix}`,
      `private-chat-${suffix}`,
      `Owner ${suffix}`,
      NOW,
    );
  }
}

async function setup() {
  const db = new SqliteD1Database();
  databases.push(db);
  const keyring = await createKeyring(MASTER_KEY);
  await seedAccount(db, keyring, "one");
  await seedAccount(db, keyring, "two");
  return {
    db,
    keyring,
    store: new D1ReminderApiStore(db as unknown as D1Database),
    rateLimitStore: {
      consume: async () => ({ allowed: true, resetAt: NOW + 60_000 }),
    },
    randomBytes: deterministicRandomBytes(),
  };
}

async function seedReminder(
  account: Awaited<ReturnType<typeof setup>>,
  suffix: string,
  title: string,
  status: "PENDING" | "CLAIMED" | "RETRYABLE" | "SENT" | "FAILED" | "UNCERTAIN" | "CANCELLED" = "PENDING",
  scheduledAt = NOW + 60_000,
): Promise<void> {
  const id = `reminder-${suffix}`;
  const encrypted = await account.keyring.encryptSensitive("reminder-title", id, 1, title);
  account.db.sqlite.prepare(
    `INSERT INTO reminders (
       id, public_id, workspace_id, chat_identity_id, source_draft_id,
       title_ciphertext, title_iv, title_key_version, scheduled_at, timezone,
       status, claimed_at, cancelled_at, transition_marker, created_at, updated_at
     ) VALUES (?, ?, ?, ?, NULL, ?, ?, 1, ?, 'Asia/Ho_Chi_Minh', ?, NULL, NULL, NULL, ?, ?)`,
  ).run(
    id,
    suffix.padEnd(22, "R").slice(0, 22),
    suffix.includes("two") ? "workspace-two" : "workspace-one",
    suffix.includes("two") ? "identity-two" : "identity-one",
    new Uint8Array(encrypted.ciphertext),
    new Uint8Array(encrypted.iv),
    scheduledAt,
    status,
    NOW,
    NOW,
  );
}

describe("authenticated reminder API service on migrated D1", () => {
  it("filters by tenant before decrypting and returns only bounded UI-safe fields", async () => {
    const account = await setup();
    await seedReminder(account, "one-active", "Gọi cho mẹ", "PENDING", NOW + 120_000);
    await seedReminder(account, "one-terminal", "Gửi báo cáo", "SENT", NOW - 60_000);
    await seedReminder(account, "two-private", "Không được lộ", "PENDING", NOW + 1);

    const reminders = await listPublicReminders("user-one", {
      store: account.store,
      keyring: account.keyring,
    });

    expect(reminders).toEqual([
      {
        publicId: "one-active".padEnd(22, "R"),
        title: "Gọi cho mẹ",
        scheduledAt: NOW + 120_000,
        timezone: "Asia/Ho_Chi_Minh",
        status: "PENDING",
      },
      {
        publicId: "one-terminal".padEnd(22, "R"),
        title: "Gửi báo cáo",
        scheduledAt: NOW - 60_000,
        timezone: "Asia/Ho_Chi_Minh",
        status: "SENT",
      },
    ]);
    expect(JSON.stringify(reminders)).not.toContain("reminder-");
    expect(JSON.stringify(reminders)).not.toContain("two-private");
  });

  it("normalizes and encrypts a manual reminder while deriving the personal channel server-side", async () => {
    const account = await setup();
    const result = await createManualReminder(
      {
        userId: "user-one",
        title: "  Gọi\r\n  cho   mẹ  ",
        scheduledAt: NOW + 60_000,
        timezone: "Asia/Ho_Chi_Minh",
      },
      {
        store: account.store,
        keyring: account.keyring,
        rateLimitStore: account.rateLimitStore,
        now: () => NOW,
        randomBytes: account.randomBytes,
      },
    );

    expect(result).toEqual({
      publicId: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/u),
      title: "Gọi\ncho mẹ",
      scheduledAt: NOW + 60_000,
      timezone: "Asia/Ho_Chi_Minh",
      status: "PENDING",
    });
    const persisted = account.db.sqlite.prepare(
      `SELECT id, public_id, workspace_id, chat_identity_id, source_draft_id,
              title_ciphertext, title_iv
       FROM reminders`,
    ).get() as Record<string, unknown>;
    expect(persisted.id).not.toBe(result.publicId);
    expect(persisted.public_id).toBe(result.publicId);
    expect(persisted.workspace_id).toBe("workspace-one");
    expect(persisted.chat_identity_id).toBe("identity-one");
    expect(persisted.source_draft_id).toBeNull();
    expect(new TextDecoder().decode(persisted.title_ciphertext as Uint8Array)).not.toContain(result.title);
  });

  it.each([
    { title: " ", scheduledAt: NOW + 1, timezone: "Asia/Ho_Chi_Minh", label: "blank title" },
    { title: "x".repeat(1_801), scheduledAt: NOW + 1, timezone: "Asia/Ho_Chi_Minh", label: "long title" },
    { title: "valid", scheduledAt: NOW, timezone: "Asia/Ho_Chi_Minh", label: "non-future time" },
    { title: "valid", scheduledAt: NOW + 366 * 86_400_000 + 1, timezone: "Asia/Ho_Chi_Minh", label: "far time" },
    { title: "valid", scheduledAt: 1.5, timezone: "Asia/Ho_Chi_Minh", label: "non-integer time" },
    { title: "valid", scheduledAt: NOW + 1, timezone: "UTC", label: "wrong timezone" },
  ])("rejects $label before persistence", async ({ title, scheduledAt, timezone }) => {
    const account = await setup();
    await expect(createManualReminder(
      { userId: "user-one", title, scheduledAt, timezone },
      {
        store: account.store,
        keyring: account.keyring,
        rateLimitStore: account.rateLimitStore,
        now: () => NOW,
        randomBytes: account.randomBytes,
      },
    )).rejects.toBeInstanceOf(InvalidReminderError);
    expect(account.db.sqlite.prepare("SELECT COUNT(*) AS count FROM reminders").get()).toEqual({ count: 0 });
  });

  it("rejects creation when there is not exactly one active private channel", async () => {
    const account = await setup();
    account.db.sqlite.prepare("UPDATE bot_connections SET state = 'SUSPENDED' WHERE user_id = 'user-one'").run();

    await expect(createManualReminder(
      {
        userId: "user-one",
        title: "Gọi cho mẹ",
        scheduledAt: NOW + 1,
        timezone: "Asia/Ho_Chi_Minh",
      },
      {
        store: account.store,
        keyring: account.keyring,
        rateLimitStore: account.rateLimitStore,
        now: () => NOW,
        randomBytes: account.randomBytes,
      },
    )).rejects.toBeInstanceOf(ReminderChannelUnavailableError);
  });

  it("rate-limits create before persistence with a stable user-HMAC subject", async () => {
    const account = await setup();
    const consumed: Array<{ subjectDigest: string; bucket: string; limit: number }> = [];
    await expect(createManualReminder(
      {
        userId: "user-one",
        title: "Gọi cho mẹ",
        scheduledAt: NOW + 1,
        timezone: "Asia/Ho_Chi_Minh",
      },
      {
        store: account.store,
        keyring: account.keyring,
        rateLimitStore: {
          consume: async (input) => {
            consumed.push(input);
            return { allowed: false, resetAt: NOW + 21_500 };
          },
        },
        now: () => NOW,
        randomBytes: account.randomBytes,
      },
    )).rejects.toMatchObject({
      code: "RATE_LIMITED",
      retryAfterSeconds: 22,
    });
    expect(consumed).toEqual([expect.objectContaining({
      subjectDigest: await account.keyring.digestCode("rate-limit:reminder-create:user-one"),
      bucket: "reminder-create",
      limit: 30,
    })]);
    expect(account.db.sqlite.prepare("SELECT COUNT(*) AS count FROM reminders").get())
      .toEqual({ count: 0 });
  });

  it("cancels only an owned pre-send reminder and atomically cancels a pending delivery", async () => {
    const account = await setup();
    await seedReminder(account, "one-cancel", "Hủy tôi");
    account.db.sqlite.prepare(
      `INSERT INTO reminder_deliveries (
         id, reminder_id, status, attempt_count, created_at, updated_at
       ) VALUES ('delivery-one-cancel', 'reminder-one-cancel', 'PENDING', 0, ?, ?)`,
    ).run(NOW, NOW);

    await expect(cancelPublicReminder("user-one", "one-cancel".padEnd(22, "R"), {
      store: account.store,
      keyring: account.keyring,
      rateLimitStore: account.rateLimitStore,
      now: () => NOW + 1,
      randomBytes: account.randomBytes,
    })).resolves.toEqual({ cancelled: true });
    expect(account.db.sqlite.prepare("SELECT status FROM reminders WHERE id = 'reminder-one-cancel'").get()).toEqual({ status: "CANCELLED" });
    expect(account.db.sqlite.prepare("SELECT status FROM reminder_deliveries WHERE reminder_id = 'reminder-one-cancel'").get()).toEqual({ status: "CANCELLED" });

    await expect(cancelPublicReminder("user-one", "one-cancel".padEnd(22, "R"), {
      store: account.store,
      keyring: account.keyring,
      rateLimitStore: account.rateLimitStore,
      now: () => NOW + 2,
      randomBytes: account.randomBytes,
    })).resolves.toEqual({ cancelled: true });
  });

  it("makes foreign and missing public IDs identical and refuses a send-owned reminder", async () => {
    const account = await setup();
    await seedReminder(account, "two-foreign", "Foreign");
    await seedReminder(account, "one-sending", "Sending", "CLAIMED");
    account.db.sqlite.prepare(
      `INSERT INTO reminder_deliveries (
         id, reminder_id, status, attempt_count, send_started_at,
         transition_marker, created_at, updated_at
       ) VALUES ('delivery-sending', 'reminder-one-sending', 'SENDING', 1, ?, 'send-owner', ?, ?)`,
    ).run(NOW, NOW, NOW);

    for (const publicId of ["two-foreign".padEnd(22, "R"), "missing".padEnd(22, "R")]) {
      await expect(cancelPublicReminder("user-one", publicId, {
        store: account.store,
        keyring: account.keyring,
        rateLimitStore: account.rateLimitStore,
        now: () => NOW + 1,
        randomBytes: account.randomBytes,
      })).rejects.toBeInstanceOf(ReminderNotFoundError);
    }
    await expect(cancelPublicReminder("user-one", "one-sending".padEnd(22, "R"), {
      store: account.store,
      keyring: account.keyring,
      rateLimitStore: account.rateLimitStore,
      now: () => NOW + 1,
      randomBytes: account.randomBytes,
    })).rejects.toBeInstanceOf(ReminderNotCancellableError);
  });

  it("rate-limits cancellation before reminder lookup or mutation", async () => {
    const account = await setup();
    await seedReminder(account, "one-limited", "Keep me");

    await expect(cancelPublicReminder("user-one", "one-limited".padEnd(22, "R"), {
      store: account.store,
      keyring: account.keyring,
      rateLimitStore: {
        consume: async () => ({ allowed: false, resetAt: NOW + 1_000 }),
      },
      now: () => NOW,
      randomBytes: account.randomBytes,
    })).rejects.toBeInstanceOf(RateLimitExceededError);
    expect(account.db.sqlite.prepare("SELECT status FROM reminders WHERE id='reminder-one-limited'").get())
      .toEqual({ status: "PENDING" });
  });
});
