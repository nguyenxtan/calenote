import { D1PrimaryLoginStore } from "@/modules/auth/primary-login";
import { D1ConnectionLifecycleStore } from "@/modules/connections/lifecycle/store";
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

describe("pause lifecycle on real local D1",()=>{
  it("serializes concurrent pause and primary selection with only one winner",async()=>{
    const fixture=await migratedRuntime();await addBoundChannel(fixture,"alternate");
    const lifecycle=new D1ConnectionLifecycleStore(fixture.db);const primary=new D1PrimaryLoginStore(fixture.db);
    const candidate=(await primary.candidate("user-workerd","alternate"))!;
    const snapshot=(await lifecycle.get("user-workerd","alternate"))!;
    const expected=await primary.snapshot("user-workerd");
    const outcomes=await Promise.all([
      lifecycle.change({userId:"user-workerd",publicId:"alternate",paused:true,expected:snapshot.cas,marker:"pause-winner",now:NOW}),
      primary.select("user-workerd",candidate,expected,"primary-winner",NOW),
    ]);
    expect(outcomes.filter(Boolean)).toHaveLength(1);
    const paused=(await lifecycle.get("user-workerd","alternate"))!.paused;
    expect((await primary.snapshot("user-workerd"))!.connection_id==="alternate").toBe(!paused);
    expect(await fixture.db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE id IN ('pause-winner','primary-winner')").first()).toEqual({n:1});
  },20_000);
  it("rejects stale resume CAS and rolls back a real D1 audit failure",async()=>{
    const fixture=await migratedRuntime();await addBoundChannel(fixture,"alternate");const store=new D1ConnectionLifecycleStore(fixture.db);
    const original=(await store.get("user-workerd","alternate"))!;
    expect(await store.change({userId:"user-workerd",publicId:"alternate",paused:true,expected:original.cas,marker:"pause",now:NOW})).toBe(true);
    expect(await store.change({userId:"user-workerd",publicId:"alternate",paused:false,expected:original.cas,marker:"stale",now:NOW+1})).toBe(false);
    const paused=(await store.get("user-workerd","alternate"))!;
    await fixture.db.prepare("CREATE TRIGGER lifecycle_audit_failure BEFORE INSERT ON audit_events WHEN NEW.action='CONNECTION_RESUMED' BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END").run();
    await expect(store.change({userId:"user-workerd",publicId:"alternate",paused:false,expected:paused.cas,marker:"resume",now:NOW+1})).rejects.toThrow("synthetic audit failure");
    expect((await store.get("user-workerd","alternate"))!.paused).toBe(true);
  },20_000);
});

afterEach(async () => {
  vi.restoreAllMocks();
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
    CALENOTE_RUNTIME_ENVIRONMENT: "production",
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
    .split(source.includes("-- statement-breakpoint") ? "-- statement-breakpoint" : ";")
    .map((statement) => statement.replace(/^--.*$/gm, "").trim())
    .filter(Boolean);
  for (const statement of statements) {
    await db.prepare(statement).run();
  }
}

async function migratedRuntime(
  state: "ACTIVE_BOUND" | "WEBHOOK_FAILED" = "ACTIVE_BOUND",
  provenance = true,
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
  if (provenance) { await applyMigration(db, "migrations/0010_primary_login_provenance.sql"); await applyMigration(db, "migrations/0011_connection_pause.sql"); }

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

async function addBoundChannel(fixture:RuntimeFixture,id:string):Promise<void> {
  const encrypted=await fixture.keyring.encryptCredential(id,"telegram",1,"12345678:synthetic-extra-token");
  await fixture.db.prepare(`INSERT INTO bot_connections(id,user_id,provider,public_id,provider_bot_id,display_name,encrypted_token,encrypted_token_iv,token_fingerprint,credential_version,state,created_at,updated_at,transition_marker)
    VALUES (?,'user-workerd','telegram',?,?,'Synthetic',?,?,?,1,'ACTIVE_BOUND',1,1,'extra-marker')`).bind(id,id,id,encrypted.ciphertext,encrypted.iv,id).run();
  await fixture.db.prepare("INSERT INTO chat_identities VALUES (?,?,'extra-provider-user',?,NULL,1)").bind(`identity-${id}`,id,`chat-${id}`).run();
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
  // Each case boots a real Miniflare/workerd D1 and applies three migrations.
  }, 20_000);

  // The same real workerd bootstrap needs an explicit full-suite integration budget.
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
  }, 15_000);

  it("gives exactly one overlapping primary selection the workerd transaction",async()=>{
    const fixture=await migratedRuntime();await addBoundChannel(fixture,"second-channel");
    const proof=await issueLoginProof(fixture),store=new D1PrimaryLoginStore(fixture.db);
    const expected=await store.snapshot("user-workerd"),a=await store.candidate("user-workerd","AAAAAAAAAAAAAAAAAAAAAA"),b=await store.candidate("user-workerd","second-channel");
    if(!a||!b)throw new Error("Missing synthetic candidates");
    const outcomes=await Promise.all([store.select("user-workerd",a,expected,"primary-winner-a",NOW),store.select("user-workerd",b,expected,"primary-winner-b",NOW)]);
    expect(outcomes.sort()).toEqual([false,true]);
    expect(await fixture.db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action='LOGIN_CHANNEL_SELECTED'").first()).toEqual({count:1});
    await expect(verifyLoginCode("owner@example.com",proof.code,{store:fixture.loginStore,keyring:fixture.keyring,now:()=>NOW,randomBytes:sequencedRandomBytes(64)})).rejects.toBeInstanceOf(InvalidLoginCodeError);
  },15000);

  it("rejects post-issuance restored private binding on workerd D1",async()=>{
    const fixture=await migratedRuntime(),proof=await issueLoginProof(fixture);
    await fixture.db.prepare("UPDATE chat_identities SET private_chat_id='ABA' WHERE id='identity-workerd'").run();
    await fixture.db.prepare("UPDATE chat_identities SET private_chat_id='private-chat-workerd' WHERE id='identity-workerd'").run();
    await expect(verifyLoginCode("owner@example.com",proof.code,{store:fixture.loginStore,keyring:fixture.keyring,now:()=>NOW,randomBytes:sequencedRandomBytes(64)})).rejects.toBeInstanceOf(InvalidLoginCodeError);
    expect(await fixture.db.prepare("SELECT COUNT(*) AS count FROM sessions WHERE id<>'old-session-workerd'").first()).toEqual({count:0});
  },15000);

  it("keeps legacy multi-bound primary unresolved through workerd migration and later binding",async()=>{
    const fixture=await migratedRuntime("ACTIVE_BOUND",false);await addBoundChannel(fixture,"second-channel");
    await applyMigration(fixture.db,"migrations/0010_primary_login_provenance.sql");await applyMigration(fixture.db,"migrations/0011_connection_pause.sql");await addBoundChannel(fixture,"third-channel");
    await fixture.db.prepare("UPDATE bot_connections SET state='SUSPENDED' WHERE id='connection-workerd'").run();
    await fixture.db.prepare("UPDATE bot_connections SET state='ACTIVE_BOUND' WHERE id='connection-workerd'").run();
    expect(await fixture.db.prepare("SELECT COUNT(*) AS count FROM primary_login_channels").first()).toEqual({count:0});
  },15000);

  it.each(["suspended", "reassigned", "chat-changed", "marker-changed"])("rolls back stale %s verification on the actual workerd D1 binding", async change => {
    const fixture = await migratedRuntime();
    const login = await issueLoginProof(fixture);
    const guardedStore = new Proxy(fixture.loginStore, {
      get(target, property, receiver) {
        if (property === "commitCorrectVerification") {
          return async (...args: Parameters<LoginCodeStore["commitCorrectVerification"]>) => {
            if (change === "suspended") await fixture.db.prepare("UPDATE bot_connections SET state='SUSPENDED' WHERE id='connection-workerd'").run();
            if (change === "reassigned") {
              await fixture.db.prepare("INSERT INTO users VALUES ('foreign-fence','foreign-fence@example.invalid','Synthetic','Asia/Ho_Chi_Minh',1,1)").run();
              await fixture.db.prepare("UPDATE bot_connections SET user_id='foreign-fence' WHERE id='connection-workerd'").run();
            }
            if (change === "chat-changed") await fixture.db.prepare("UPDATE chat_identities SET private_chat_id='changed-fence-chat' WHERE connection_id='connection-workerd'").run();
            if (change === "marker-changed") await fixture.db.prepare("UPDATE bot_connections SET transition_marker='changed-fence-marker' WHERE id='connection-workerd'").run();
            return target.commitCorrectVerification(...args);
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as LoginCodeStore;
    await expect(verifyLoginCode("owner@example.com", login.code, {
      store: guardedStore, keyring: fixture.keyring, now: () => NOW, randomBytes: sequencedRandomBytes(64),
    })).rejects.toBeInstanceOf(InvalidLoginCodeError);
    expect(await fixture.db.prepare("SELECT COUNT(*) AS count FROM sessions WHERE id <> 'old-session-workerd'").first()).toEqual({count:0});
    expect(await fixture.db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action='LOGIN_VERIFIED'").first()).toEqual({count:0});
    expect(await fixture.db.prepare("SELECT consumed_at FROM login_codes WHERE id=?").bind(login.id).first()).toEqual({consumed_at:null});
  }, 15_000);

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
  }, 15_000);

  it("bounds the equalized unknown-proof work by both exact verify limits", async () => {
    const fixture = await migratedRuntime();
    // This tests counts within one window, not passage of wall time. Crossing
    // a real ten-minute boundary would correctly reset the production counter.
    vi.spyOn(Date, "now").mockReturnValue(NOW);
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
  }, 45_000);
});
