// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import {
  D1LoginCodeStore,
  InvalidLoginCodeError,
  requestLoginCode,
  verifyLoginCode,
  type LoginCodeStore,
} from "@/modules/auth/login-service";
import { prepareSession } from "@/modules/auth/session";
import type { BotProfile } from "@/modules/connections/contracts";
import {
  D1OnboardingStore,
} from "@/modules/db/onboarding-store";
import {
  onboard,
  type RecoveryConnection,
} from "@/modules/onboarding/service";
import { createKeyring, type Keyring } from "@/modules/security/keyring";
import { createRouter } from "@/worker/router";

const MASTER = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const NOW = 1_800_000_000_000;
const TOKEN = "123456789:AAExample_secret-token_123456789";
const PROFILE: BotProfile = {
  provider: "telegram",
  providerBotId: "provider-bot-workerd",
  displayName: "Mây",
  handle: "@may_bot",
  accountType: null,
  canJoinGroups: true,
};

interface RuntimeFixture {
  db: D1Database;
  keyring: Keyring;
  onboardingStore: D1OnboardingStore;
  loginStore: D1LoginCodeStore;
}

const instances: Miniflare[] = [];

afterEach(async () => {
  await Promise.all(instances.splice(0).map((instance) => instance.dispose()));
});

function sequencedRandomBytes(initial: number): (length: number) => Uint8Array {
  let value = initial;
  return (length) => new Uint8Array(length).fill(++value);
}

function executionContext(): ExecutionContext {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext;
}

function workerEnvironment(db: D1Database): Env {
  return {
    APP_ORIGIN: "https://calenote.iconiclogs.com",
    CALENOTE_MASTER_KEY: MASTER,
    DB: db,
    JOBS: { send: vi.fn(async () => undefined) },
    ASSETS: { fetch: vi.fn(async () => new Response(null, { status: 404 })) },
  } as unknown as Env;
}

function verifyRequest(email: string, ip: string): Request {
  return new Request("https://calenote.iconiclogs.com/api/auth/verify-code", {
    method: "POST",
    headers: {
      origin: "https://calenote.iconiclogs.com",
      "content-type": "application/json",
      "CF-Connecting-IP": ip,
    },
    body: JSON.stringify({ email, code: "999999" }),
  });
}

async function applyMigration(db: D1Database, file: string): Promise<void> {
  const source = readFileSync(resolve(process.cwd(), file), "utf8");
  const statements = source
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
  for (const statement of statements) {
    await db.prepare(statement).run();
  }
}

async function migratedRuntime(
  state: "ACTIVE_BOUND" | "WEBHOOK_FAILED" = "ACTIVE_BOUND",
): Promise<RuntimeFixture> {
  const miniflare = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    compatibilityDate: "2026-09-03",
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: { DB: "00000000-0000-0000-0000-000000000008" },
    port: 0,
  }));
  instances.push(miniflare);
  const db = await miniflare.getD1Database("DB") as unknown as D1Database;
  await applyMigration(db, "migrations/0001_production_mvp.sql");
  await applyMigration(db, "migrations/0002_onboarding_transition_marker.sql");
  await applyMigration(db, "migrations/0003_source_action_foundation.sql");

  const keyring = await createKeyring(MASTER);
  const encrypted = await keyring.encryptCredential("connection-workerd", "telegram", 1, TOKEN);
  const fingerprint = await keyring.fingerprintToken(TOKEN);
  await db.batch([
    db.prepare(
      `INSERT INTO users (id, email, display_name, timezone, created_at, updated_at)
       VALUES ('user-workerd', 'owner@example.com', 'Owner', 'Asia/Ho_Chi_Minh', 1, 1)`,
    ),
    db.prepare(
      `INSERT INTO workspaces (id, owner_user_id, kind, created_at, updated_at)
       VALUES ('workspace-workerd', 'user-workerd', 'PERSONAL', 1, 1)`,
    ),
    db.prepare(
      `INSERT INTO memberships (workspace_id, user_id, role, created_at)
       VALUES ('workspace-workerd', 'user-workerd', 'OWNER', 1)`,
    ),
    db.prepare(
      `INSERT INTO bot_connections (
         id, user_id, provider, public_id, provider_bot_id, display_name, handle,
         account_type, can_join_groups, encrypted_token, encrypted_token_iv,
         token_fingerprint, credential_version, state, webhook_registered_at,
         created_at, updated_at, transition_marker
       ) VALUES (
         'connection-workerd', 'user-workerd', 'telegram',
         'AAAAAAAAAAAAAAAAAAAAAA', ?, 'Mây', '@may_bot', NULL, 1, ?, ?, ?, 1,
         ?, 1, 1, 1, 'marker-workerd'
       )`,
    ).bind(
      PROFILE.providerBotId,
      encrypted.ciphertext,
      encrypted.iv,
      fingerprint,
      state,
    ),
    db.prepare(
      `INSERT INTO sessions (id, user_id, digest, expires_at, revoked_at, created_at)
       VALUES ('old-session-workerd', 'user-workerd', 'old-digest-workerd', ?, NULL, 1)`,
    ).bind(NOW + 1_000_000),
    db.prepare(
      `INSERT INTO connect_codes (
         id, connection_id, user_id, digest, expires_at, consumed_at, created_at
       ) VALUES (
         'old-connect-workerd', 'connection-workerd', 'user-workerd',
         'old-connect-digest-workerd', ?, NULL, 1
       )`,
    ).bind(NOW + 1_000_000),
  ]);
  if (state === "ACTIVE_BOUND") {
    await db.prepare(
      `INSERT INTO chat_identities (
         id, connection_id, provider_user_id, private_chat_id, display_name, linked_at
       ) VALUES (
         'identity-workerd', 'connection-workerd', 'provider-user-workerd',
         'private-chat-workerd', 'Owner', 1
       )`,
    ).run();
  }
  return {
    db,
    keyring,
    onboardingStore: new D1OnboardingStore(db),
    loginStore: new D1LoginCodeStore(db),
  };
}

async function issueLoginProof(fixture: RuntimeFixture): Promise<{ code: string; id: string }> {
  await requestLoginCode("owner@example.com", {
    store: fixture.loginStore,
    keyring: fixture.keyring,
    enqueue: async () => undefined,
    now: () => NOW - 1,
    randomBytes: sequencedRandomBytes(32),
  });
  const challenge = await fixture.loginStore.findVerifiable("owner@example.com", NOW);
  if (!challenge) throw new Error("Expected a real workerd login challenge");
  const code = await fixture.keyring.decryptSensitive(
    "login-code",
    challenge.id,
    challenge.codeKeyVersion,
    challenge.encryptedCode,
  );
  return { code, id: challenge.id };
}

async function exactConnection(fixture: RuntimeFixture): Promise<RecoveryConnection> {
  const fingerprint = await fixture.keyring.fingerprintToken(TOKEN);
  const connection = await fixture.onboardingStore.findExactRecovery({
    email: "owner@example.com",
    provider: "telegram",
    tokenFingerprint: fingerprint,
    providerBotId: PROFILE.providerBotId,
  });
  if (!connection) throw new Error("Expected exact recovery connection");
  return connection;
}

describe("Task 8 recovery transactions on a real Miniflare/workerd D1 binding", () => {
  it("rolls back every session/code/audit side effect when a guarded recovery CAS misses", async () => {
    const fixture = await migratedRuntime();
    const login = await issueLoginProof(fixture);
    const connection = await exactConnection(fixture);
    const replacement = await prepareSession("user-workerd", {
      keyring: fixture.keyring,
      now: () => NOW,
      randomBytes: sequencedRandomBytes(96),
    });

    await expect(fixture.onboardingStore.commitRecoveredAccess({
      connection: { ...connection, updatedAt: connection.updatedAt + 1 },
      expectedMarker: connection.transitionMarker,
      newMarker: "lost-recovery-marker",
      completedAt: NOW,
      targetState: "ACTIVE_BOUND",
      session: replacement.record,
      code: null,
      revokeExistingSessions: true,
      audit: {
        id: "lost-recovery-audit",
        actorUserId: "user-workerd",
        action: "ONBOARDING_RECOVERED",
        targetUserId: "user-workerd",
        targetConnectionId: "connection-workerd",
        result: "SUCCESS",
        createdAt: NOW,
      },
    })).resolves.toBe(false);

    await expect(fixture.db.prepare(
      "SELECT revoked_at FROM sessions WHERE id = 'old-session-workerd'",
    ).first()).resolves.toEqual({ revoked_at: null });
    await expect(fixture.db.prepare(
      "SELECT consumed_at FROM connect_codes WHERE id = 'old-connect-workerd'",
    ).first()).resolves.toEqual({ consumed_at: null });
    await expect(fixture.db.prepare(
      "SELECT consumed_at FROM login_codes WHERE id = ?",
    ).bind(login.id).first()).resolves.toEqual({ consumed_at: null });
    await expect(fixture.db.prepare(
      "SELECT COUNT(*) AS count FROM sessions WHERE id = ?",
    ).bind(replacement.record.id).first()).resolves.toEqual({ count: 0 });
    await expect(fixture.db.prepare(
      "SELECT COUNT(*) AS count FROM audit_events WHERE id = 'lost-recovery-audit'",
    ).first()).resolves.toEqual({ count: 0 });
    await expect(fixture.db.prepare(
      "SELECT state, transition_marker FROM bot_connections WHERE id = 'connection-workerd'",
    ).first()).resolves.toEqual({ state: "ACTIVE_BOUND", transition_marker: "marker-workerd" });
  });

  it("uses real D1 meta.changes to classify exactly one recovery claim winner", async () => {
    const fixture = await migratedRuntime("WEBHOOK_FAILED");
    const connection = await exactConnection(fixture);
    const changed = await fixture.db.prepare(
      "UPDATE sessions SET expires_at = expires_at WHERE id = 'old-session-workerd'",
    ).run();
    const missed = await fixture.db.prepare(
      "UPDATE sessions SET expires_at = expires_at WHERE id = 'missing-session-workerd'",
    ).run();

    expect(changed.meta.changes).toBe(1);
    expect(missed.meta.changes).toBe(0);
    await expect(fixture.onboardingStore.claimRecovery({
      connection,
      marker: "claim-workerd",
      claimedAt: NOW,
    })).resolves.toBe(true);
    await expect(fixture.onboardingStore.claimRecovery({
      connection,
      marker: "loser-workerd",
      claimedAt: NOW,
    })).resolves.toBe(false);
  });

  it("gives public recovery the sole live session when verification paused on its old proof", async () => {
    const fixture = await migratedRuntime();
    const login = await issueLoginProof(fixture);
    let resumeVerification: (() => void) | undefined;
    const verificationGate = new Promise<void>((resolve) => { resumeVerification = resolve; });
    let verificationEntered: (() => void) | undefined;
    const verificationPaused = new Promise<void>((resolve) => { verificationEntered = resolve; });
    const delayedLoginStore = new Proxy(fixture.loginStore, {
      get(target, property, receiver) {
        if (property === "commitCorrectVerification") {
          return async (...args: Parameters<LoginCodeStore["commitCorrectVerification"]>) => {
            verificationEntered?.();
            await verificationGate;
            return target.commitCorrectVerification(...args);
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as LoginCodeStore;
    const verification = verifyLoginCode("owner@example.com", login.code, {
      store: delayedLoginStore,
      keyring: fixture.keyring,
      now: () => NOW,
      randomBytes: sequencedRandomBytes(64),
    });
    await verificationPaused;

    const recovery = await onboard({
      displayName: "Ignored replacement",
      email: "owner@example.com",
      timezone: "Asia/Ho_Chi_Minh",
      provider: "telegram",
      token: TOKEN,
    }, {
      store: fixture.onboardingStore,
      keyring: fixture.keyring,
      verifyToken: vi.fn(async () => PROFILE),
      registerWebhook: vi.fn(async () => undefined),
      appOrigin: "https://calenote.iconiclogs.com",
      now: () => NOW,
      randomBytes: sequencedRandomBytes(1),
    });
    resumeVerification?.();

    expect(recovery.bot.state).toBe("ACTIVE_BOUND");
    await expect(verification).rejects.toBeInstanceOf(InvalidLoginCodeError);
    await expect(fixture.db.prepare(
      `SELECT COUNT(*) AS count FROM sessions
       WHERE user_id = 'user-workerd' AND revoked_at IS NULL`,
    ).first()).resolves.toEqual({ count: 1 });
    await expect(fixture.db.prepare(
      `SELECT COUNT(*) AS count FROM login_codes
       WHERE user_id = 'user-workerd' AND consumed_at IS NULL`,
    ).first()).resolves.toEqual({ count: 0 });
    await expect(fixture.db.prepare(
      "SELECT action FROM audit_events ORDER BY created_at, id",
    ).all()).resolves.toMatchObject({
      results: [{ action: "ONBOARDING_RECOVERED" }],
    });
  });

  it("bounds the equalized unknown-proof work by both exact verify limits", async () => {
    const fixture = await migratedRuntime();
    const router = createRouter();
    const env = workerEnvironment(fixture.db);
    const emailIp = "203.0.113.80";

    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const response = await router(
        verifyRequest("missing@example.com", emailIp),
        env,
        executionContext(),
      );
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({
        error: {
          code: "INVALID_LOGIN_CODE",
          message: "Mã đăng nhập không hợp lệ hoặc đã hết hạn.",
        },
      });
    }
    const emailLimited = await router(
      verifyRequest("missing@example.com", emailIp),
      env,
      executionContext(),
    );
    expect(emailLimited.status).toBe(429);
    expect(Number(emailLimited.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect(Number(emailLimited.headers.get("retry-after"))).toBeLessThanOrEqual(600);
    await expect(emailLimited.json()).resolves.toEqual({
      error: {
        code: "RATE_LIMITED",
        message: "Bạn thao tác quá nhanh. Vui lòng thử lại sau.",
      },
    });

    const emailDigest = await fixture.keyring.digestCode(
      "rate-limit:login-verify:email:missing@example.com",
    );
    const emailIpDigest = await fixture.keyring.digestCode(
      `rate-limit:login-verify:ip:${emailIp}`,
    );
    await expect(fixture.db.prepare(
      `SELECT subject_digest, count FROM rate_limits
       WHERE bucket = 'login-verify' AND subject_digest IN (?, ?)
       ORDER BY subject_digest`,
    ).bind(emailDigest, emailIpDigest).all()).resolves.toMatchObject({
      results: expect.arrayContaining([
        { subject_digest: emailDigest, count: 10 },
        { subject_digest: emailIpDigest, count: 11 },
      ]),
    });

    const ip = "203.0.113.81";
    for (let attempt = 1; attempt <= 30; attempt += 1) {
      const response = await router(
        verifyRequest(`missing-${attempt}@example.com`, ip),
        env,
        executionContext(),
      );
      expect(response.status).toBe(401);
    }
    const ipLimitedEmail = "missing-31@example.com";
    const ipLimited = await router(
      verifyRequest(ipLimitedEmail, ip),
      env,
      executionContext(),
    );
    expect(ipLimited.status).toBe(429);
    const ipDigest = await fixture.keyring.digestCode(`rate-limit:login-verify:ip:${ip}`);
    const skippedEmailDigest = await fixture.keyring.digestCode(
      `rate-limit:login-verify:email:${ipLimitedEmail}`,
    );
    await expect(fixture.db.prepare(
      "SELECT count FROM rate_limits WHERE subject_digest = ? AND bucket = 'login-verify'",
    ).bind(ipDigest).first()).resolves.toEqual({ count: 30 });
    await expect(fixture.db.prepare(
      "SELECT count FROM rate_limits WHERE subject_digest = ? AND bucket = 'login-verify'",
    ).bind(skippedEmailDigest).first()).resolves.toBeNull();
  }, 20_000);
});
