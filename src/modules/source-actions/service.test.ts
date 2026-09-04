import { afterEach, describe, expect, it } from "vitest";
import { createKeyring, type Keyring } from "@/modules/security/keyring";
import {
  SqliteD1Database,
  deterministicRandomBytes,
} from "@/testing/sqlite-d1.test-support";
import { D1SourceActionStore } from "./infrastructure/d1/store";
import {
  approveActionCandidate,
  createReminderActionCandidate,
  rejectActionCandidate,
} from "./service";

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
): Promise<void> {
  const encrypted = await keyring.encryptCredential(
    `connection-${suffix}`,
    "telegram",
    1,
    `token-${suffix}`,
  );
  db.sqlite.prepare(
    "INSERT INTO users (id, email, display_name, timezone, created_at, updated_at) VALUES (?, ?, ?, 'Asia/Ho_Chi_Minh', ?, ?)",
  ).run(`user-${suffix}`, `${suffix}@example.test`, `Owner ${suffix}`, NOW, NOW);
  db.sqlite.prepare(
    "INSERT INTO workspaces (id, owner_user_id, kind, created_at, updated_at) VALUES (?, ?, 'PERSONAL', ?, ?)",
  ).run(`workspace-${suffix}`, `user-${suffix}`, NOW, NOW);
  db.sqlite.prepare(
    "INSERT INTO memberships (workspace_id, user_id, role, created_at) VALUES (?, ?, 'OWNER', ?)",
  ).run(`workspace-${suffix}`, `user-${suffix}`, NOW);
  db.sqlite.prepare(
    `INSERT INTO bot_connections (
       id, user_id, provider, public_id, provider_bot_id, display_name,
       encrypted_token, encrypted_token_iv, token_fingerprint,
       credential_version, state, created_at, updated_at, transition_marker
     ) VALUES (?, ?, 'telegram', ?, ?, ?, ?, ?, ?, 1, 'ACTIVE_BOUND', ?, ?, ?)`,
  ).run(
    `connection-${suffix}`,
    `user-${suffix}`,
    suffix.padEnd(22, "C").slice(0, 22),
    `provider-bot-${suffix}`,
    `Bot ${suffix}`,
    new Uint8Array(encrypted.ciphertext),
    new Uint8Array(encrypted.iv),
    `fingerprint-${suffix}`,
    NOW,
    NOW,
    `marker-${suffix}`,
  );
  db.sqlite.prepare(
    `INSERT INTO chat_identities (
       id, connection_id, provider_user_id, private_chat_id, display_name, linked_at
     ) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    `identity-${suffix}`,
    `connection-${suffix}`,
    `provider-user-${suffix}`,
    `private-chat-${suffix}`,
    `Owner ${suffix}`,
    NOW,
  );
}

function seedSourceItem(db: SqliteD1Database, suffix: string, workspaceId = "workspace-one"): void {
  db.sqlite.prepare(
    `INSERT INTO source_connections (
       id, workspace_id, provider, external_account_id, display_name, status, created_at, updated_at
     ) VALUES (?, ?, 'calendar', ?, ?, 'ACTIVE', ?, ?)`,
  ).run(`source-${suffix}`, workspaceId, `account-${suffix}`, `Source ${suffix}`, NOW, NOW);
  db.sqlite.prepare(
    `INSERT INTO source_items (
       id, source_connection_id, workspace_id, external_item_id, item_type, observed_at, created_at
     ) VALUES (?, ?, ?, ?, 'EVENT', ?, ?)`,
  ).run(
    `source-item-${suffix}`,
    `source-${suffix}`,
    workspaceId,
    `external-item-${suffix}`,
    NOW,
    NOW,
  );
}

async function setup() {
  const db = new SqliteD1Database();
  databases.push(db);
  const keyring = await createKeyring(MASTER_KEY);
  await seedAccount(db, keyring, "one");
  await seedAccount(db, keyring, "two");
  seedSourceItem(db, "one");
  return {
    db,
    keyring,
    store: new D1SourceActionStore(db as unknown as D1Database),
    randomBytes: deterministicRandomBytes(),
  };
}

describe("source action decisions", () => {
  it("deduplicates each source item inside its source connection", async () => {
    const account = await setup();
    expect(() => account.db.sqlite.prepare(
      `INSERT INTO source_items (
         id, source_connection_id, workspace_id, external_item_id, item_type, observed_at, created_at
       ) VALUES ('duplicate', 'source-one', 'workspace-one', 'external-item-one', 'EVENT', ?, ?)`,
    ).run(NOW, NOW)).toThrow(/UNIQUE constraint failed/iu);
  });

  it("creates a reminder only after the owning tenant approves a pending candidate", async () => {
    const account = await setup();
    const candidate = await createReminderActionCandidate(
      {
        sourceItemId: "source-item-one",
        workspaceId: "workspace-one",
        title: "Họp với khách hàng",
        scheduledAt: NOW + 60_000,
        timezone: "Asia/Ho_Chi_Minh",
      },
      {
        store: account.store,
        keyring: account.keyring,
        now: () => NOW,
        randomBytes: account.randomBytes,
      },
    );

    const decision = await approveActionCandidate(
      { userId: "user-one", candidateId: candidate.id },
      {
        store: account.store,
        keyring: account.keyring,
        now: () => NOW,
        randomBytes: account.randomBytes,
      },
    );

    expect(decision).toEqual({ status: "APPROVED", reminderPublicId: expect.any(String) });
    expect(account.db.sqlite.prepare(
      "SELECT workspace_id, chat_identity_id, status FROM reminders",
    ).all()).toEqual([{
      workspace_id: "workspace-one",
      chat_identity_id: "identity-one",
      status: "PENDING",
    }]);
    expect(account.db.sqlite.prepare(
      "SELECT decision, decided_by_user_id, created_reminder_id FROM action_decisions",
    ).all()).toEqual([{
      decision: "APPROVED",
      decided_by_user_id: "user-one",
      created_reminder_id: expect.any(String),
    }]);
    expect(account.db.sqlite.prepare(
      "SELECT status FROM action_candidates WHERE id = ?",
    ).get(candidate.id)).toEqual({ status: "APPROVED" });
  });

  it("does not disclose or decide another tenant's candidate", async () => {
    const account = await setup();
    const candidate = await createReminderActionCandidate(
      {
        sourceItemId: "source-item-one",
        workspaceId: "workspace-one",
        title: "Không được tạo",
        scheduledAt: NOW + 60_000,
        timezone: "Asia/Ho_Chi_Minh",
      },
      {
        store: account.store,
        keyring: account.keyring,
        now: () => NOW,
        randomBytes: account.randomBytes,
      },
    );

    await expect(approveActionCandidate(
      { userId: "user-two", candidateId: candidate.id },
      {
        store: account.store,
        keyring: account.keyring,
        now: () => NOW,
        randomBytes: account.randomBytes,
      },
    )).resolves.toEqual({ status: "NOT_FOUND" });
    expect(account.db.sqlite.prepare("SELECT COUNT(*) AS count FROM reminders").get())
      .toEqual({ count: 0 });
    expect(account.db.sqlite.prepare("SELECT COUNT(*) AS count FROM action_decisions").get())
      .toEqual({ count: 0 });
  });

  it("records rejection without creating a reminder and makes a later approval idempotent", async () => {
    const account = await setup();
    const candidate = await createReminderActionCandidate(
      {
        sourceItemId: "source-item-one",
        workspaceId: "workspace-one",
        title: "Không gửi",
        scheduledAt: NOW + 60_000,
        timezone: "Asia/Ho_Chi_Minh",
      },
      {
        store: account.store,
        keyring: account.keyring,
        now: () => NOW,
        randomBytes: account.randomBytes,
      },
    );

    await expect(rejectActionCandidate(
      { userId: "user-one", candidateId: candidate.id },
      { store: account.store, now: () => NOW, randomBytes: account.randomBytes },
    )).resolves.toEqual({ status: "REJECTED" });
    await expect(approveActionCandidate(
      { userId: "user-one", candidateId: candidate.id },
      {
        store: account.store,
        keyring: account.keyring,
        now: () => NOW,
        randomBytes: account.randomBytes,
      },
    )).resolves.toEqual({ status: "ALREADY_DECIDED" });
    expect(account.db.sqlite.prepare("SELECT COUNT(*) AS count FROM reminders").get())
      .toEqual({ count: 0 });
    expect(account.db.sqlite.prepare(
      "SELECT decision, created_reminder_id FROM action_decisions",
    ).all()).toEqual([{ decision: "REJECTED", created_reminder_id: null }]);
  });
});
