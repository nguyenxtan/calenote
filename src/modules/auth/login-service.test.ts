import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderOperationError } from "@/modules/connections/provider-error";
import { createKeyring, type Keyring } from "@/modules/security/keyring";
import {
  SqliteD1Database,
  deterministicRandomBytes,
} from "@/testing/sqlite-d1.test-support";
import {
  D1LoginCodeStore,
  InvalidLoginCodeError,
  deliverLoginCode,
  redriveLoginCodes,
  requestLoginCode,
  verifyLoginCode,
} from "./login-service";

const MASTER_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const NOW = 1_700_000_000_000;
const USER_ID = "user-login-owner";
const CONNECTION_ID = "connection-login";
const PUBLIC_ID = "L".repeat(22);
const CHAT_ID = "private-chat-login";
const TOKEN = "123456789:AAExample_secret-token_123456789";

interface LoginRow {
  id: string;
  user_id: string;
  connection_id: string;
  code_ciphertext: Uint8Array;
  code_iv: Uint8Array;
  code_key_version: number;
  expires_at: number;
  attempt_count: number;
  consumed_at: number | null;
  delivery_status: string;
  delivery_attempt_count: number;
  send_started_at: number | null;
  retry_not_before: number | null;
  dispatch_started_at: number | null;
  dispatch_attempt_count: number;
  dispatch_marker: string | null;
  safe_error_code: string | null;
  verification_marker: string | null;
  transition_marker: string | null;
}

const databases: SqliteD1Database[] = [];

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

async function setupBoundAccount(
  email = "owner@example.com",
): Promise<{
  db: SqliteD1Database;
  keyring: Keyring;
  store: D1LoginCodeStore;
  randomBytes: (length: number) => Uint8Array;
}> {
  const db = new SqliteD1Database();
  databases.push(db);
  const keyring = await createKeyring(MASTER_KEY);
  const encrypted = await keyring.encryptCredential(CONNECTION_ID, "telegram", 1, TOKEN);
  db.sqlite.prepare(
    "INSERT INTO users (id, email, display_name, timezone, created_at, updated_at) VALUES (?, ?, ?, 'Asia/Ho_Chi_Minh', ?, ?)",
  ).run(USER_ID, email, "Owner", NOW, NOW);
  db.sqlite.prepare(
    "INSERT INTO workspaces (id, owner_user_id, kind, created_at, updated_at) VALUES (?, ?, 'PERSONAL', ?, ?)",
  ).run("workspace-login", USER_ID, NOW, NOW);
  db.sqlite.prepare(
    "INSERT INTO memberships (workspace_id, user_id, role, created_at) VALUES (?, ?, 'OWNER', ?)",
  ).run("workspace-login", USER_ID, NOW);
  db.sqlite.prepare(
    `INSERT INTO bot_connections (
       id, user_id, provider, public_id, provider_bot_id, display_name, handle,
       encrypted_token, encrypted_token_iv, token_fingerprint,
       credential_version, state, created_at, updated_at, transition_marker
     ) VALUES (?, ?, 'telegram', ?, 'provider-bot-login', 'Login bot', '@login_bot',
       ?, ?, 'fingerprint-login', 1, 'ACTIVE_BOUND', ?, ?, 'activation-login')`,
  ).run(
    CONNECTION_ID,
    USER_ID,
    PUBLIC_ID,
    new Uint8Array(encrypted.ciphertext),
    new Uint8Array(encrypted.iv),
    NOW,
    NOW,
  );
  db.sqlite.prepare(
    `INSERT INTO chat_identities (
       id, connection_id, provider_user_id, private_chat_id, display_name, linked_at
     ) VALUES ('identity-login', ?, 'provider-user-login', ?, 'Owner', ?)`,
  ).run(CONNECTION_ID, CHAT_ID, NOW);
  return {
    db,
    keyring,
    store: new D1LoginCodeStore(db as unknown as D1Database),
    randomBytes: deterministicRandomBytes(),
  };
}

function row(db: SqliteD1Database): LoginRow {
  return db.sqlite.prepare(
    `SELECT id, user_id, connection_id, code_ciphertext, code_iv,
            code_key_version, expires_at, attempt_count, consumed_at,
            delivery_status, delivery_attempt_count, send_started_at,
            retry_not_before, dispatch_started_at, dispatch_attempt_count,
            dispatch_marker, safe_error_code, verification_marker, transition_marker
     FROM login_codes ORDER BY rowid DESC LIMIT 1`,
  ).get() as unknown as LoginRow;
}

async function decryptedCode(keyring: Keyring, login: LoginRow): Promise<string> {
  return keyring.decryptSensitive(
    "login-code",
    login.id,
    login.code_key_version,
    {
      ciphertext: Uint8Array.from(login.code_ciphertext).buffer,
      iv: Uint8Array.from(login.code_iv).buffer,
    },
  );
}

async function issue(
  account: Awaited<ReturnType<typeof setupBoundAccount>>,
  overrides: {
    now?: number;
    enqueue?: (job: { type: "DELIVER_LOGIN_CODE"; loginCodeId: string }) => Promise<unknown>;
    randomBytes?: (length: number) => Uint8Array;
  } = {},
) {
  return requestLoginCode("owner@example.com", {
    store: account.store,
    keyring: account.keyring,
    enqueue: overrides.enqueue ?? (async () => undefined),
    now: () => overrides.now ?? NOW,
    randomBytes: overrides.randomBytes ?? account.randomBytes,
  });
}

describe("migrated-D1 bot login issuance", () => {
  it("persists only an encrypted ten-minute code and publishes one opaque job", async () => {
    const account = await setupBoundAccount();
    const jobs: unknown[] = [];

    await expect(issue(account, {
      enqueue: async (job) => { jobs.push(job); },
    })).resolves.toEqual({ accepted: true });

    const login = row(account.db);
    const code = await decryptedCode(account.keyring, login);
    expect(code).toMatch(/^\d{6}$/u);
    expect(login).toMatchObject({
      user_id: USER_ID,
      connection_id: CONNECTION_ID,
      code_key_version: 1,
      expires_at: NOW + 600_000,
      attempt_count: 0,
      consumed_at: null,
      delivery_status: "PENDING",
      delivery_attempt_count: 0,
      dispatch_attempt_count: 1,
    });
    expect(login.code_iv).toHaveLength(12);
    expect(new TextDecoder().decode(login.code_ciphertext)).not.toContain(code);
    expect(jobs).toEqual([{ type: "DELIVER_LOGIN_CODE", loginCodeId: login.id }]);
    expect(JSON.stringify(jobs)).not.toContain(code);
  });

  it("rotates every older unconsumed row and leaves exactly one active code", async () => {
    const account = await setupBoundAccount();
    await issue(account);
    const first = row(account.db);
    await issue(account, { now: NOW + 1 });
    const replacement = row(account.db);

    expect(replacement.id).not.toBe(first.id);
    expect(account.db.sqlite.prepare(
      "SELECT id, consumed_at, delivery_status FROM login_codes ORDER BY rowid",
    ).all()).toEqual([
      { id: first.id, consumed_at: NOW + 1, delivery_status: "CANCELLED" },
      { id: replacement.id, consumed_at: null, delivery_status: "PENDING" },
    ]);
    expect(account.db.sqlite.prepare(
      "SELECT COUNT(*) AS count FROM login_codes WHERE consumed_at IS NULL",
    ).get()).toEqual({ count: 1 });
  });

  it("publishes an indistinguishable decoy for an ineligible email and hides Queue rejection", async () => {
    const account = await setupBoundAccount();
    const jobs: Array<{ type: string; loginCodeId: string }> = [];
    const releases = vi.spyOn(account.store, "releaseInitialDispatch");

    await expect(requestLoginCode("missing@example.com", {
      store: account.store,
      keyring: account.keyring,
      enqueue: async (job) => { jobs.push(job); throw new Error("ambiguous publish"); },
      now: () => NOW,
      randomBytes: deterministicRandomBytes(),
    })).resolves.toEqual({ accepted: true });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toEqual({ type: "DELIVER_LOGIN_CODE", loginCodeId: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/u) });
    expect(account.db.sqlite.prepare("SELECT COUNT(*) AS count FROM login_codes").get()).toEqual({ count: 0 });
    expect(releases).toHaveBeenCalledExactlyOnceWith(jobs[0].loginCodeId, expect.any(String));

    await expect(issue(account, {
      enqueue: async (job) => { jobs.push(job); throw new Error("rejected publish"); },
    })).resolves.toEqual({ accepted: true });
    const real = row(account.db);
    expect(real.delivery_status).toBe("PENDING");
    expect(real.dispatch_started_at).toBeNull();
    expect(real.dispatch_attempt_count).toBe(0);
    expect(releases).toHaveBeenNthCalledWith(2, real.id, expect.any(String));
    expect(jobs[1]).toEqual({ type: "DELIVER_LOGIN_CODE", loginCodeId: real.id });
  });

  it("redrives a durable orphan after publish failure without putting proof in the job", async () => {
    const account = await setupBoundAccount();
    await issue(account, { enqueue: async () => { throw new Error("publish failed"); } });
    const login = row(account.db);
    const jobs: unknown[] = [];

    await expect(redriveLoginCodes(NOW + 60_000, 5, {
      store: account.store,
      enqueue: async (job) => { jobs.push(job); },
      randomBytes: deterministicRandomBytes(),
    })).resolves.toMatchObject({ selected: 1, published: 1, publishFailed: 0 });
    expect(jobs).toEqual([{ type: "DELIVER_LOGIN_CODE", loginCodeId: login.id }]);
    expect(JSON.stringify(jobs)).not.toContain(await decryptedCode(account.keyring, login));
  });

  it("uses the bounded due-dispatch index without a temp sort past an expired-row prefix", async () => {
    const account = await setupBoundAccount();
    for (let index = 0; index < 40; index += 1) {
      const userId = `expired-user-${index}`;
      const connectionId = `expired-connection-${index}`;
      account.db.sqlite.prepare(
        "INSERT INTO users VALUES (?, ?, 'Expired', 'Asia/Ho_Chi_Minh', ?, ?)",
      ).run(userId, `expired-${index}@example.com`, index, index);
      account.db.sqlite.prepare(
        `INSERT INTO bot_connections (
           id, user_id, provider, public_id, provider_bot_id, display_name, handle,
           encrypted_token, encrypted_token_iv, token_fingerprint,
           credential_version, state, created_at, updated_at, transition_marker
         ) VALUES (?, ?, 'telegram', ?, ?, 'Expired bot', NULL, ?, ?, ?, 1,
           'ACTIVE_BOUND', ?, ?, 'expired-marker')`,
      ).run(
        connectionId,
        userId,
        `expired-public-${index}`,
        `expired-bot-${index}`,
        new Uint8Array([index]),
        new Uint8Array(12),
        `expired-fingerprint-${index}`,
        index,
        index,
      );
      account.db.sqlite.prepare(
        `INSERT INTO login_codes (
           id, user_id, connection_id, code_ciphertext, code_iv, code_key_version,
           expires_at, attempt_count, consumed_at, verification_marker,
           delivery_status, delivery_attempt_count, send_started_at,
           retry_not_before, safe_error_code, transition_marker,
           dispatch_started_at, dispatch_attempt_count, dispatch_marker,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 1, ?, 0, NULL, NULL, 'PENDING', 0,
           NULL, NULL, NULL, NULL, NULL, 0, NULL, ?, ?)`,
      ).run(
        `expired-login-${index}`,
        userId,
        connectionId,
        new Uint8Array([index]),
        new Uint8Array(12),
        NOW - index - 1,
        index,
        index,
      );
    }
    await issue(account);
    const login = row(account.db);
    account.db.sqlite.prepare(
      "UPDATE login_codes SET dispatch_started_at = NULL, dispatch_marker = NULL WHERE id = ?",
    ).run(login.id);
    let selectedSql = "";
    const recordingDatabase = {
      prepare: (sql: string) => {
        if (sql.includes("FROM login_codes") && sql.includes("ORDER BY") && sql.includes("LIMIT ?")) {
          selectedSql = sql;
        }
        return account.db.prepare(sql);
      },
      batch: account.db.batch.bind(account.db),
    } as unknown as D1Database;
    const store = new D1LoginCodeStore(recordingDatabase);

    await expect(store.selectDispatchCandidates(NOW + 1, 5)).resolves.toEqual([login.id]);
    expect(selectedSql).not.toBe("");
    const plan = account.db.sqlite.prepare(`EXPLAIN QUERY PLAN ${selectedSql}`).all(
      NOW + 1,
      NOW + 1,
      NOW + 1 - 300_000,
      5,
    ) as Array<{ detail: string }>;
    expect(plan.some(({ detail }) => detail.includes("idx_login_codes_due_dispatch"))).toBe(true);
    expect(plan.some(({ detail }) => detail.includes("TEMP B-TREE"))).toBe(false);
  });

  it("does not burn the bounded dispatch budget across repeated explicit Queue rejections", async () => {
    const account = await setupBoundAccount();
    await issue(account, { enqueue: async () => { throw new Error("queue rejected"); } });

    for (let attempt = 1; attempt <= 6; attempt += 1) {
      await expect(redriveLoginCodes(NOW + attempt, 5, {
        store: account.store,
        enqueue: async () => { throw new Error("queue rejected"); },
        randomBytes: account.randomBytes,
      })).resolves.toMatchObject({ selected: 1, published: 0, publishFailed: 1, exhausted: 0 });
      expect(row(account.db)).toMatchObject({
        delivery_status: "PENDING",
        consumed_at: null,
        dispatch_started_at: null,
        dispatch_attempt_count: 0,
        dispatch_marker: null,
      });
    }
  });

  it("does not roll back a reservation whose possibly-published job already won delivery ownership", async () => {
    const account = await setupBoundAccount();
    await issue(account, { enqueue: async () => { throw new Error("queue rejected"); } });
    const login = row(account.db);

    await expect(redriveLoginCodes(NOW + 1, 5, {
      store: account.store,
      enqueue: async () => {
        const prepared = await account.store.prepareDelivery(login.id, NOW + 1);
        expect(prepared.status).toBe("READY");
        if (prepared.status !== "READY") throw new Error("login delivery was not ready");
        const owned = await account.store.acquireDelivery(
          prepared.delivery,
          "send-owner",
          NOW + 1,
        );
        expect(owned).toMatchObject({ status: "OWNED" });
        throw new Error("outcome ambiguous after acceptance");
      },
      randomBytes: account.randomBytes,
    })).resolves.toMatchObject({ selected: 1, published: 0, publishFailed: 1 });

    expect(row(account.db)).toMatchObject({
      delivery_status: "SENDING",
      dispatch_attempt_count: 1,
      dispatch_started_at: null,
      dispatch_marker: null,
      transition_marker: "send-owner",
    });
  });

  it("keeps one concurrent fourth dispatch winner processable instead of exhausting its fresh lease", async () => {
    const account = await setupBoundAccount();
    await issue(account);
    const login = row(account.db);
    account.db.sqlite.prepare(
      `UPDATE login_codes
       SET dispatch_attempt_count = 3, dispatch_started_at = NULL, dispatch_marker = NULL
       WHERE id = ?`,
    ).run(login.id);
    const jobs: Array<{ type: "DELIVER_LOGIN_CODE"; loginCodeId: string }> = [];
    const dependencies = {
      store: account.store,
      enqueue: async (job: { type: "DELIVER_LOGIN_CODE"; loginCodeId: string }) => { jobs.push(job); },
      randomBytes: account.randomBytes,
    };

    const results = await Promise.all([
      redriveLoginCodes(NOW + 1, 5, dependencies),
      redriveLoginCodes(NOW + 1, 5, dependencies),
    ]);

    expect(jobs).toEqual([{ type: "DELIVER_LOGIN_CODE", loginCodeId: login.id }]);
    expect(results.reduce((sum, result) => sum + result.exhausted, 0)).toBe(0);
    expect(row(account.db)).toMatchObject({
      delivery_status: "PENDING",
      consumed_at: null,
      dispatch_attempt_count: 4,
      dispatch_started_at: NOW + 1,
    });
    await expect(deliverLoginCode(login.id, {
      store: account.store,
      keyring: account.keyring,
      sendText: async () => ({ providerMessageId: "receipt-fourth" }),
      now: () => NOW + 2,
      randomBytes: account.randomBytes,
    })).resolves.toEqual({ status: "SENT" });
  });

  it("keeps a fresh exhausted dispatch lease and terminalizes it exactly at the stale boundary", async () => {
    const fresh = await setupBoundAccount();
    await issue(fresh);
    const freshRow = row(fresh.db);
    fresh.db.sqlite.prepare(
      `UPDATE login_codes SET dispatch_attempt_count = 4,
       dispatch_started_at = ?, dispatch_marker = 'fourth-owner' WHERE id = ?`,
    ).run(NOW - 299_999, freshRow.id);
    await expect(redriveLoginCodes(NOW, 5, {
      store: fresh.store,
      enqueue: vi.fn(),
      randomBytes: fresh.randomBytes,
    })).resolves.toMatchObject({ selected: 0, exhausted: 0 });
    expect(row(fresh.db)).toMatchObject({ delivery_status: "PENDING", consumed_at: null });

    fresh.db.sqlite.prepare(
      "UPDATE login_codes SET dispatch_started_at = ? WHERE id = ?",
    ).run(NOW - 300_000, freshRow.id);
    await expect(redriveLoginCodes(NOW, 5, {
      store: fresh.store,
      enqueue: vi.fn(),
      randomBytes: fresh.randomBytes,
    })).resolves.toMatchObject({ selected: 1, exhausted: 1 });
    expect(row(fresh.db)).toMatchObject({ delivery_status: "FAILED", consumed_at: NOW });
  });
});

describe("migrated-D1 login delivery ownership", () => {
  it("keeps the owned delivery snapshot when verification consumes between claim and read", async () => {
    const account = await setupBoundAccount();
    await issue(account);
    const login = row(account.db);
    const racingDatabase = {
      prepare: (sql: string) => {
        const prepared = account.db.prepare(sql);
        if (!sql.includes("SET delivery_status = 'SENDING'")) return prepared;
        let bound = prepared;
        const wrapper = {
          bind: (...values: unknown[]) => {
            bound = prepared.bind(...values);
            return wrapper as unknown as D1PreparedStatement;
          },
          run: async <T>() => {
            const result = await bound.run<T>();
            account.db.sqlite.prepare(
              "UPDATE login_codes SET consumed_at = ? WHERE id = ?",
            ).run(NOW + 1, login.id);
            return result;
          },
        };
        return wrapper as unknown as D1PreparedStatement;
      },
      batch: account.db.batch.bind(account.db),
    } as unknown as D1Database;
    const send = vi.fn(async () => ({ providerMessageId: "receipt-race" }));

    await expect(deliverLoginCode(login.id, {
      store: new D1LoginCodeStore(racingDatabase),
      keyring: account.keyring,
      sendText: send,
      now: () => NOW + 1,
      randomBytes: deterministicRandomBytes(),
    })).resolves.toEqual({ status: "SENT" });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("claims before decrypting and commits a successful provider send once", async () => {
    const account = await setupBoundAccount();
    await issue(account);
    const login = row(account.db);
    const code = await decryptedCode(account.keyring, login);
    const sent: unknown[][] = [];

    await expect(deliverLoginCode(login.id, {
      store: account.store,
      keyring: account.keyring,
      sendText: async (...args) => { sent.push(args); return { providerMessageId: "receipt-login" }; },
      now: () => NOW + 1,
      randomBytes: deterministicRandomBytes(),
    })).resolves.toEqual({ status: "SENT" });
    expect(sent).toHaveLength(1);
    expect(sent[0].slice(0, 3)).toEqual(["telegram", TOKEN, CHAT_ID]);
    expect(String(sent[0][3])).toContain(code);
    expect(row(account.db).delivery_status).toBe("SENT");

    await expect(deliverLoginCode(login.id, {
      store: account.store,
      keyring: account.keyring,
      sendText: vi.fn(),
      now: () => NOW + 2,
      randomBytes: deterministicRandomBytes(),
    })).resolves.toEqual({ status: "SENT" });
  });

  it("terminally fails a malformed decrypted provider credential without provider egress", async () => {
    const account = await setupBoundAccount();
    const malformed = await account.keyring.encryptCredential(
      CONNECTION_ID,
      "telegram",
      1,
      "unsafe/token",
    );
    account.db.sqlite.prepare(
      "UPDATE bot_connections SET encrypted_token = ?, encrypted_token_iv = ? WHERE id = ?",
    ).run(
      new Uint8Array(malformed.ciphertext),
      new Uint8Array(malformed.iv),
      CONNECTION_ID,
    );
    await issue(account);
    const login = row(account.db);
    const send = vi.fn();

    await expect(deliverLoginCode(login.id, {
      store: account.store,
      keyring: account.keyring,
      sendText: send,
      now: () => NOW + 1,
      randomBytes: account.randomBytes,
    })).resolves.toEqual({ status: "FAILED" });

    expect(send).not.toHaveBeenCalled();
    expect(row(account.db)).toMatchObject({
      delivery_status: "FAILED",
      delivery_attempt_count: 0,
      send_started_at: null,
      consumed_at: NOW + 1,
      safe_error_code: "INVALID_LOGIN_DATA",
    });
  });

  it("keeps a deterministic local-data failure retryable when its terminal D1 write rejects", async () => {
    const account = await setupBoundAccount();
    const malformed = await account.keyring.encryptCredential(
      CONNECTION_ID,
      "telegram",
      1,
      "unsafe/token",
    );
    account.db.sqlite.prepare(
      "UPDATE bot_connections SET encrypted_token = ?, encrypted_token_iv = ? WHERE id = ?",
    ).run(
      new Uint8Array(malformed.ciphertext),
      new Uint8Array(malformed.iv),
      CONNECTION_ID,
    );
    await issue(account);
    const login = row(account.db);
    const failingStore = new Proxy(account.store, {
      get(target, property, receiver) {
        if (property === "finalizePreProviderFailure" || property === "finalizeDeliveryTerminal") {
          return async () => { throw new Error("D1 terminal write unavailable"); };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const send = vi.fn();

    await expect(deliverLoginCode(login.id, {
      store: failingStore,
      keyring: account.keyring,
      sendText: send,
      now: () => NOW + 1,
      randomBytes: account.randomBytes,
    })).resolves.toEqual({ status: "RETRYABLE", retryAfterSeconds: 60 });

    expect(send).not.toHaveBeenCalled();
    expect(row(account.db)).toMatchObject({
      delivery_status: "PENDING",
      delivery_attempt_count: 0,
      consumed_at: null,
    });
  });

  it("does not acquire or send when the credential snapshot changes after pre-read", async () => {
    const account = await setupBoundAccount();
    await issue(account);
    const login = row(account.db);
    const racingStore = new Proxy(account.store, {
      get(target, property, receiver) {
        if (property === "acquireDelivery") {
          return async (...args: unknown[]) => {
            account.db.sqlite.prepare(
              "UPDATE bot_connections SET credential_version = 2, updated_at = ? WHERE id = ?",
            ).run(NOW + 1, CONNECTION_ID);
            return Reflect.apply(target.acquireDelivery, target, args) as Promise<unknown>;
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const send = vi.fn();

    await expect(deliverLoginCode(login.id, {
      store: racingStore,
      keyring: account.keyring,
      sendText: send,
      now: () => NOW + 1,
      randomBytes: account.randomBytes,
    })).resolves.toEqual({ status: "NOOP" });

    expect(send).not.toHaveBeenCalled();
    expect(row(account.db)).toMatchObject({
      delivery_status: "PENDING",
      delivery_attempt_count: 0,
      consumed_at: null,
    });
  });

  it.each([
    { providerError: new ProviderOperationError("FAILED"), status: "FAILED", consumed: true, suspended: false },
    { providerError: new ProviderOperationError("REJECTED_CREDENTIAL"), status: "FAILED", consumed: true, suspended: true },
    { providerError: new ProviderOperationError("UNCERTAIN"), status: "UNCERTAIN", consumed: false, suspended: false },
    { providerError: new ProviderOperationError("INVALID_RESPONSE"), status: "UNCERTAIN", consumed: false, suspended: false },
    { providerError: new Error("ambiguous transport"), status: "UNCERTAIN", consumed: false, suspended: false },
  ])("persists $providerError.code as $status without unsafe resend", async ({ providerError, status, consumed, suspended }) => {
    const account = await setupBoundAccount();
    await issue(account);
    const login = row(account.db);

    await expect(deliverLoginCode(login.id, {
      store: account.store,
      keyring: account.keyring,
      sendText: async () => { throw providerError; },
      now: () => NOW + 1,
      randomBytes: deterministicRandomBytes(),
    })).resolves.toEqual({ status });
    const persisted = row(account.db);
    expect(persisted.delivery_status).toBe(status);
    expect(persisted.consumed_at !== null).toBe(consumed);
    expect(account.db.sqlite.prepare("SELECT state FROM bot_connections WHERE id = ?").get(CONNECTION_ID)).toEqual({
      state: suspended ? "SUSPENDED" : "ACTIVE_BOUND",
    });
  });

  it("uses bounded quota backoff and fails rather than making a fifth provider call", async () => {
    const account = await setupBoundAccount();
    await issue(account);
    const login = row(account.db);
    const send = vi.fn(async () => { throw new ProviderOperationError("QUOTA", 1); });

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const at = NOW + attempt * 2_000;
      account.db.sqlite.prepare(
        "UPDATE login_codes SET retry_not_before = ? WHERE id = ?",
      ).run(at, login.id);
      await expect(deliverLoginCode(login.id, {
        store: account.store,
        keyring: account.keyring,
        sendText: send,
        now: () => at,
        randomBytes: account.randomBytes,
      })).resolves.toMatchObject({ status: "RETRYABLE" });
    }
    const finalAt = NOW + 8_000;
    account.db.sqlite.prepare("UPDATE login_codes SET retry_not_before = ? WHERE id = ?").run(finalAt, login.id);
    await expect(deliverLoginCode(login.id, {
      store: account.store,
      keyring: account.keyring,
      sendText: send,
      now: () => finalAt,
      randomBytes: account.randomBytes,
    })).resolves.toEqual({ status: "FAILED" });
    expect(send).toHaveBeenCalledTimes(4);
    expect(row(account.db)).toMatchObject({ delivery_status: "FAILED", delivery_attempt_count: 4 });
    expect(row(account.db).consumed_at).toBe(finalAt);
  });

  it("terminalizes a stale SENDING lease as UNCERTAIN and never republishes it", async () => {
    const account = await setupBoundAccount();
    await issue(account);
    const login = row(account.db);
    account.db.sqlite.prepare(
      "UPDATE login_codes SET delivery_status = 'SENDING', delivery_attempt_count = 1, send_started_at = ?, transition_marker = 'old-send' WHERE id = ?",
    ).run(NOW - 300_001, login.id);
    const enqueue = vi.fn();

    await redriveLoginCodes(NOW, 5, {
      store: account.store,
      enqueue,
      randomBytes: deterministicRandomBytes(),
    });

    expect(row(account.db).delivery_status).toBe("UNCERTAIN");
    expect(row(account.db).consumed_at).toBeNull();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("has one stale-SENDING terminalization and audit winner across overlapping Crons", async () => {
    const account = await setupBoundAccount();
    await issue(account);
    const login = row(account.db);
    account.db.sqlite.prepare(
      "UPDATE login_codes SET delivery_status = 'SENDING', delivery_attempt_count = 1, send_started_at = ?, transition_marker = 'old-send' WHERE id = ?",
    ).run(NOW - 300_001, login.id);

    const firstSnapshot = await account.store.selectStaleSending(NOW, 5);
    const overlappingSnapshot = await account.store.selectStaleSending(NOW, 5);
    expect(firstSnapshot).toEqual(overlappingSnapshot);
    const first = await account.store.terminalizeStaleSending(
      login.id,
      firstSnapshot[0].transition_marker,
      "terminal-owner-a",
      "audit-terminal-a",
      NOW,
    );
    const loser = await account.store.terminalizeStaleSending(
      login.id,
      overlappingSnapshot[0].transition_marker,
      "terminal-owner-b",
      "audit-terminal-b",
      NOW,
    );

    expect([first, loser]).toEqual([true, false]);
    expect(row(account.db)).toMatchObject({
      delivery_status: "UNCERTAIN",
      transition_marker: expect.not.stringMatching(/^old-send$/u),
    });
    expect(account.db.sqlite.prepare(
      "SELECT COUNT(*) AS count FROM audit_events WHERE action = 'LOGIN_CODE_DELIVERY_UNCERTAIN'",
    ).get()).toEqual({ count: 1 });
  });

  it("selects consumed stale SENDING rows through the covering stale-send index", async () => {
    const account = await setupBoundAccount();
    await issue(account);
    const login = row(account.db);
    account.db.sqlite.prepare(
      "UPDATE login_codes SET consumed_at = ?, delivery_status = 'SENDING', send_started_at = ?, transition_marker = 'consumed-send' WHERE id = ?",
    ).run(NOW - 1, NOW - 300_001, login.id);

    await expect(account.store.selectStaleSending(NOW, 5)).resolves.toEqual([
      { id: login.id, transition_marker: "consumed-send" },
    ]);
    const plan = account.db.sqlite.prepare(
      `EXPLAIN QUERY PLAN SELECT id, transition_marker
       FROM login_codes
       WHERE delivery_status = 'SENDING' AND send_started_at IS NOT NULL
         AND send_started_at < ? AND transition_marker IS NOT NULL
       ORDER BY send_started_at, id LIMIT ?`,
    ).all(NOW - 300_000, 5) as Array<{ detail: string }>;
    expect(plan.some(({ detail }) => detail.includes("idx_login_codes_stale_sending"))).toBe(true);
  });
});

describe("migrated-D1 login verification", () => {
  it.each(["PENDING", "UNCERTAIN"])("accepts exact proof from %s and issues one secure digest-only session", async (deliveryStatus) => {
    const account = await setupBoundAccount();
    await issue(account);
    const login = row(account.db);
    const code = await decryptedCode(account.keyring, login);
    account.db.sqlite.prepare("UPDATE login_codes SET delivery_status = ? WHERE id = ?").run(deliveryStatus, login.id);

    const result = await verifyLoginCode("owner@example.com", code, {
      store: account.store,
      keyring: account.keyring,
      now: () => NOW + 1,
      randomBytes: deterministicRandomBytes(),
    });

    expect(result.cookie).toContain("__Host-calenote_session=");
    expect(result.cookie).toContain("HttpOnly");
    expect(result.cookie).toContain("Secure");
    expect(result.cookie).toContain("SameSite=Lax");
    expect(account.db.sqlite.prepare("SELECT COUNT(*) AS count FROM sessions").get()).toEqual({ count: 1 });
    const bearer = /^__Host-calenote_session=([^;]+)/u.exec(result.cookie)?.[1];
    expect(account.db.sqlite.prepare("SELECT digest FROM sessions").get()).not.toEqual({ digest: bearer });
    expect(account.db.sqlite.prepare("SELECT consumed_at FROM login_codes WHERE id = ?").get(login.id)).toEqual({ consumed_at: NOW + 1 });
  });

  it("allows exactly one winner across concurrent correct verification", async () => {
    const account = await setupBoundAccount();
    await issue(account);
    const login = row(account.db);
    const code = await decryptedCode(account.keyring, login);
    const dependencies = {
      store: account.store,
      keyring: account.keyring,
      now: () => NOW + 1,
    };

    const results = await Promise.allSettled([
      verifyLoginCode("owner@example.com", code, { ...dependencies, randomBytes: account.randomBytes }),
      verifyLoginCode("owner@example.com", code, { ...dependencies, randomBytes: account.randomBytes }),
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const failure = results.find(({ status }) => status === "rejected");
    expect(failure).toMatchObject({ status: "rejected", reason: expect.any(InvalidLoginCodeError) });
    expect(account.db.sqlite.prepare("SELECT COUNT(*) AS count FROM sessions").get()).toEqual({ count: 1 });
  });

  it("increments wrong attempts atomically, exhausts attempt five, and collapses all failures", async () => {
    const account = await setupBoundAccount();
    await issue(account);
    const login = row(account.db);
    const code = await decryptedCode(account.keyring, login);

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await expect(verifyLoginCode("owner@example.com", "999999", {
        store: account.store,
        keyring: account.keyring,
        now: () => NOW + attempt,
        randomBytes: deterministicRandomBytes(),
      })).rejects.toBeInstanceOf(InvalidLoginCodeError);
    }
    expect(row(account.db)).toMatchObject({ attempt_count: 5, consumed_at: NOW + 5 });
    await expect(verifyLoginCode("owner@example.com", code, {
      store: account.store,
      keyring: account.keyring,
      now: () => NOW + 6,
      randomBytes: deterministicRandomBytes(),
    })).rejects.toBeInstanceOf(InvalidLoginCodeError);
    await expect(verifyLoginCode("missing@example.com", "123456", {
      store: account.store,
      keyring: account.keyring,
      now: () => NOW + 6,
      randomBytes: deterministicRandomBytes(),
    })).rejects.toBeInstanceOf(InvalidLoginCodeError);
    expect(account.db.sqlite.prepare("SELECT COUNT(*) AS count FROM sessions").get()).toEqual({ count: 0 });
  });

  it("has one winner in a correct-versus-fifth-wrong race", async () => {
    const account = await setupBoundAccount();
    await issue(account);
    const login = row(account.db);
    const code = await decryptedCode(account.keyring, login);
    account.db.sqlite.prepare("UPDATE login_codes SET attempt_count = 4 WHERE id = ?").run(login.id);

    const results = await Promise.allSettled([
      verifyLoginCode("owner@example.com", code, {
        store: account.store,
        keyring: account.keyring,
        now: () => NOW + 1,
        randomBytes: deterministicRandomBytes(),
      }),
      verifyLoginCode("owner@example.com", "999999", {
        store: account.store,
        keyring: account.keyring,
        now: () => NOW + 1,
        randomBytes: deterministicRandomBytes(),
      }),
    ]);

    expect(results.filter(({ status }) => status === "fulfilled").length).toBeLessThanOrEqual(1);
    expect(account.db.sqlite.prepare("SELECT COUNT(*) AS count FROM sessions").get()).toEqual({ count: results[0].status === "fulfilled" ? 1 : 0 });
    expect(row(account.db).consumed_at).toBe(NOW + 1);
  });

  it("verifies during an owned SENDING call without overwriting its delivery marker", async () => {
    const account = await setupBoundAccount();
    await issue(account);
    const login = row(account.db);
    const code = await decryptedCode(account.keyring, login);
    let releaseSend: (() => void) | undefined;
    const sendStarted = new Promise<void>((resolve) => {
      releaseSend = resolve;
    });
    let providerEntered: (() => void) | undefined;
    const providerStarted = new Promise<void>((resolve) => {
      providerEntered = resolve;
    });
    const delivery = deliverLoginCode(login.id, {
      store: account.store,
      keyring: account.keyring,
      sendText: async () => {
        providerEntered?.();
        await sendStarted;
        return { providerMessageId: "receipt" };
      },
      now: () => NOW + 1,
      randomBytes: account.randomBytes,
    });
    await providerStarted;
    const owned = row(account.db);
    expect(owned.delivery_status).toBe("SENDING");
    expect(owned.transition_marker).not.toBeNull();

    await verifyLoginCode("owner@example.com", code, {
      store: account.store,
      keyring: account.keyring,
      now: () => NOW + 1,
      randomBytes: account.randomBytes,
    });
    const verified = row(account.db);
    expect(verified.verification_marker).not.toBeNull();
    expect(verified.verification_marker).not.toBe(owned.transition_marker);
    expect(verified.transition_marker).toBe(owned.transition_marker);

    releaseSend?.();
    await expect(delivery).resolves.toEqual({ status: "SENT" });
    expect(row(account.db).delivery_status).toBe("SENT");
  });

  it("preserves verification consumption when an owned SENDING call later fails deterministically", async () => {
    const account = await setupBoundAccount();
    await issue(account);
    const login = row(account.db);
    const code = await decryptedCode(account.keyring, login);
    let finishProvider: (() => void) | undefined;
    const providerGate = new Promise<void>((resolve) => { finishProvider = resolve; });
    let providerEntered: (() => void) | undefined;
    const providerStarted = new Promise<void>((resolve) => { providerEntered = resolve; });
    let currentTime = NOW + 1;
    const delivery = deliverLoginCode(login.id, {
      store: account.store,
      keyring: account.keyring,
      sendText: async () => {
        providerEntered?.();
        await providerGate;
        throw new ProviderOperationError("FAILED");
      },
      now: () => currentTime,
      randomBytes: account.randomBytes,
    });
    await providerStarted;

    await verifyLoginCode("owner@example.com", code, {
      store: account.store,
      keyring: account.keyring,
      now: () => NOW + 1,
      randomBytes: account.randomBytes,
    });
    currentTime = NOW + 2;
    finishProvider?.();
    await expect(delivery).resolves.toEqual({ status: "FAILED" });

    expect(row(account.db)).toMatchObject({
      delivery_status: "FAILED",
      consumed_at: NOW + 1,
    });
    expect(account.db.sqlite.prepare("SELECT COUNT(*) AS count FROM sessions").get())
      .toEqual({ count: 1 });
  });

  it("collapses expiry, reuse, tenant mismatch, and an outcome-ambiguous session commit", async () => {
    const expired = await setupBoundAccount();
    await issue(expired);
    const expiredRow = row(expired.db);
    const expiredCode = await decryptedCode(expired.keyring, expiredRow);
    await expect(verifyLoginCode("owner@example.com", expiredCode, {
      store: expired.store,
      keyring: expired.keyring,
      now: () => NOW + 600_000,
      randomBytes: expired.randomBytes,
    })).rejects.toBeInstanceOf(InvalidLoginCodeError);

    const active = await setupBoundAccount("tenant@example.com");
    await requestLoginCode("tenant@example.com", {
      store: active.store,
      keyring: active.keyring,
      enqueue: async () => undefined,
      now: () => NOW,
      randomBytes: active.randomBytes,
    });
    const activeRow = row(active.db);
    const activeCode = await decryptedCode(active.keyring, activeRow);
    await expect(verifyLoginCode("other@example.com", activeCode, {
      store: active.store,
      keyring: active.keyring,
      now: () => NOW + 1,
      randomBytes: active.randomBytes,
    })).rejects.toBeInstanceOf(InvalidLoginCodeError);

    const originalBatch = active.db.batch.bind(active.db);
    active.db.batch = async (statements) => {
      await originalBatch(statements);
      throw new Error("ambiguous D1 completion");
    };
    const proof = await verifyLoginCode("tenant@example.com", activeCode, {
      store: active.store,
      keyring: active.keyring,
      now: () => NOW + 1,
      randomBytes: active.randomBytes,
    }).catch((error: unknown) => error);
    expect(proof).toEqual(new Error("ambiguous D1 completion"));
    expect(proof).not.toHaveProperty("cookie");
    expect(active.db.sqlite.prepare("SELECT COUNT(*) AS count FROM sessions").get())
      .toEqual({ count: 1 });
  });
});
