import { afterEach, describe, expect, it, vi } from "vitest";
import {
  D1LoginCodeStore,
  InvalidLoginCodeError,
  requestLoginCode,
  verifyLoginCode,
  type LoginCodeStore,
} from "@/modules/auth/login-service";
import type { BotProfile } from "@/modules/connections/contracts";
import { ProviderOperationError } from "@/modules/connections/provider-error";
import { createKeyring } from "@/modules/security/keyring";
import {
  deterministicRandomBytes,
  SqliteD1Database,
} from "@/testing/sqlite-d1.test-support";
import { D1OnboardingStore } from "@/modules/db/onboarding-store";
import {
  ConnectionStateError,
  onboard,
  OnboardingConflictError,
  retryWebhook,
  type OnboardingStore,
} from "./service";

const MASTER = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const NOW = 1_800_000_000_000;
const TOKEN = "123456789:AAExample_secret-token_123456789";
const PROFILE: BotProfile = {
  provider: "telegram",
  providerBotId: "provider-bot-1",
  displayName: "Mây",
  handle: "@may_bot",
  accountType: null,
  canJoinGroups: true,
};

const databases: SqliteD1Database[] = [];
afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

async function setup(
  state: "ACTIVE_UNBOUND" | "ACTIVE_BOUND" | "WEBHOOK_FAILED" | "SUSPENDED" | "VALIDATING",
  options: { updatedAt?: number; bound?: boolean } = {},
) {
  const db = new SqliteD1Database();
  databases.push(db);
  const keyring = await createKeyring(MASTER);
  const fingerprint = await keyring.fingerprintToken(TOKEN);
  const encrypted = await keyring.encryptCredential("connection-1", "telegram", 1, TOKEN);
  db.sqlite.exec(`
    INSERT INTO users VALUES ('user-1','owner@example.com','Original owner','Asia/Ho_Chi_Minh',1,1);
    INSERT INTO workspaces VALUES ('workspace-1','user-1','PERSONAL',1,1);
    INSERT INTO memberships VALUES ('workspace-1','user-1','OWNER',1);
  `);
  db.sqlite.prepare(
    `INSERT INTO bot_connections (
      id,user_id,provider,public_id,provider_bot_id,display_name,handle,
      account_type,can_join_groups,encrypted_token,encrypted_token_iv,
      token_fingerprint,credential_version,state,webhook_registered_at,
      created_at,updated_at,transition_marker
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    "connection-1", "user-1", "telegram", "AAAAAAAAAAAAAAAAAAAAAA",
    PROFILE.providerBotId, PROFILE.displayName, PROFILE.handle, null, 1,
    new Uint8Array(encrypted.ciphertext), new Uint8Array(encrypted.iv),
    fingerprint, 1, state, state === "ACTIVE_BOUND" || state === "ACTIVE_UNBOUND" ? 1 : null,
    1, options.updatedAt ?? (state === "VALIDATING" ? NOW - 300_001 : 1), "marker-old",
  );
  db.sqlite.exec(`
    INSERT INTO sessions VALUES ('old-session-1','user-1','old-digest-1',${NOW + 1_000_000},NULL,1);
    INSERT INTO sessions VALUES ('old-session-2','user-1','old-digest-2',${NOW + 1_000_000},NULL,2);
    INSERT INTO connect_codes VALUES ('old-code','connection-1','user-1','old-code-digest',${NOW - 1},NULL,1);
  `);
  if (state === "ACTIVE_BOUND" || options.bound) {
    db.sqlite.exec(
      "INSERT INTO chat_identities VALUES ('chat-1','connection-1','provider-user','private-chat','Owner',1)",
    );
  }
  const verifyToken = vi.fn(async () => PROFILE);
  const registerWebhook = vi.fn(async () => undefined);
  return {
    db,
    keyring,
    verifyToken,
    registerWebhook,
    dependencies: {
      store: new D1OnboardingStore(db as unknown as D1Database),
      keyring,
      verifyToken,
      registerWebhook,
      appOrigin: "https://calenote.iconiclogs.com",
      now: () => NOW,
      randomBytes: deterministicRandomBytes(),
    },
  };
}

function sequencedRandomBytes(initial: number): (length: number) => Uint8Array {
  let value = initial;
  return (length) => new Uint8Array(length).fill(++value);
}

async function issueLoginProof(fixture: Awaited<ReturnType<typeof setup>>): Promise<{
  code: string;
  id: string;
  store: D1LoginCodeStore;
}> {
  const store = new D1LoginCodeStore(fixture.db as unknown as D1Database);
  await requestLoginCode("owner@example.com", {
    store,
    keyring: fixture.keyring,
    enqueue: async () => undefined,
    now: () => NOW - 1,
    randomBytes: sequencedRandomBytes(32),
  });
  const challenge = await store.findVerifiable("owner@example.com", NOW);
  if (!challenge) throw new Error("Expected a real login challenge");
  const code = await fixture.keyring.decryptSensitive(
    "login-code",
    challenge.id,
    challenge.codeKeyVersion,
    challenge.encryptedCode,
  );
  return { code, id: challenge.id, store };
}

const recoveryInput = {
  displayName: "Replacement ignored",
  email: " OWNER@example.com ",
  timezone: "Asia/Ho_Chi_Minh" as const,
  provider: "telegram" as const,
  token: TOKEN,
};

describe("public exact-proof onboarding recovery on migrated D1", () => {
  it("refreshes ACTIVE_UNBOUND session/code without setWebhook and revokes every old session", async () => {
    const fixture = await setup("ACTIVE_UNBOUND");

    const result = await onboard(recoveryInput, fixture.dependencies);

    expect(fixture.verifyToken).toHaveBeenCalledExactlyOnceWith("telegram", TOKEN);
    expect(fixture.registerWebhook).not.toHaveBeenCalled();
    expect(result.bot).toEqual({
      publicId: "AAAAAAAAAAAAAAAAAAAAAA",
      provider: "telegram",
      displayName: "Mây",
      handle: "@may_bot",
      state: "ACTIVE_UNBOUND",
    });
    expect(result.connectCommand).toMatch(/^\/connect [A-HJ-NP-Z2-9]{26}$/u);
    expect(fixture.db.sqlite.prepare(
      "SELECT COUNT(*) AS count FROM sessions WHERE user_id='user-1' AND revoked_at IS NULL",
    ).get()).toEqual({ count: 1 });
    expect(fixture.db.sqlite.prepare(
      "SELECT COUNT(*) AS count FROM connect_codes WHERE connection_id='connection-1' AND consumed_at IS NULL",
    ).get()).toEqual({ count: 1 });
    expect(fixture.db.sqlite.prepare("SELECT display_name FROM users WHERE id='user-1'").get())
      .toEqual({ display_name: "Original owner" });
  });

  it("refreshes ACTIVE_BOUND with no setWebhook or connect-code rotation", async () => {
    const fixture = await setup("ACTIVE_BOUND");

    const result = await onboard(recoveryInput, fixture.dependencies);

    expect(fixture.verifyToken).toHaveBeenCalledTimes(1);
    expect(fixture.registerWebhook).not.toHaveBeenCalled();
    expect(result.bot.state).toBe("ACTIVE_BOUND");
    expect(result.connectCommand).toBeNull();
    expect(result.connectCodeExpiresAt).toBeNull();
    expect(fixture.db.sqlite.prepare(
      "SELECT COUNT(*) AS count FROM connect_codes WHERE consumed_at IS NULL",
    ).get()).toEqual({ count: 0 });
    expect(fixture.db.sqlite.prepare(
      "SELECT COUNT(*) AS count FROM sessions WHERE revoked_at IS NULL",
    ).get()).toEqual({ count: 1 });
  });

  it("consumes a pre-recovery SENDING login proof so it cannot mint a second session", async () => {
    const fixture = await setup("ACTIVE_BOUND");
    const login = await issueLoginProof(fixture);
    fixture.db.sqlite.prepare(
      `UPDATE login_codes
       SET delivery_status = 'SENDING', delivery_attempt_count = 1,
           send_started_at = ?, transition_marker = 'delivery-owner'
       WHERE id = ?`,
    ).run(NOW - 1, login.id);

    await expect(onboard(recoveryInput, fixture.dependencies)).resolves.toMatchObject({
      bot: { state: "ACTIVE_BOUND" },
    });

    await expect(verifyLoginCode("owner@example.com", login.code, {
      store: login.store,
      keyring: fixture.keyring,
      now: () => NOW + 1,
      randomBytes: sequencedRandomBytes(64),
    })).rejects.toBeInstanceOf(InvalidLoginCodeError);
    expect(fixture.db.sqlite.prepare(
      "SELECT delivery_status, consumed_at, transition_marker FROM login_codes WHERE id = ?",
    ).get(login.id)).toEqual({
      delivery_status: "SENDING",
      consumed_at: NOW,
      transition_marker: "delivery-owner",
    });
    expect(fixture.db.sqlite.prepare(
      "SELECT COUNT(*) AS count FROM sessions WHERE user_id = 'user-1' AND revoked_at IS NULL",
    ).get()).toEqual({ count: 1 });
  });

  it("lets public recovery defeat a verification paused after reading the old proof", async () => {
    const fixture = await setup("ACTIVE_BOUND");
    const login = await issueLoginProof(fixture);
    let resumeVerification: (() => void) | undefined;
    const verificationGate = new Promise<void>((resolve) => { resumeVerification = resolve; });
    let verificationEntered: (() => void) | undefined;
    const verificationPaused = new Promise<void>((resolve) => { verificationEntered = resolve; });
    const delayedStore = new Proxy(login.store, {
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
      store: delayedStore,
      keyring: fixture.keyring,
      now: () => NOW,
      randomBytes: sequencedRandomBytes(64),
    });
    await verificationPaused;

    const recovery = await onboard(recoveryInput, fixture.dependencies);
    resumeVerification?.();

    expect(recovery.bot.state).toBe("ACTIVE_BOUND");
    await expect(verification).rejects.toBeInstanceOf(InvalidLoginCodeError);
    expect(fixture.db.sqlite.prepare(
      "SELECT COUNT(*) AS count FROM sessions WHERE user_id = 'user-1' AND revoked_at IS NULL",
    ).get()).toEqual({ count: 1 });
    expect(fixture.db.sqlite.prepare(
      "SELECT COUNT(*) AS count FROM login_codes WHERE user_id = 'user-1' AND consumed_at IS NULL",
    ).get()).toEqual({ count: 0 });
  });

  it("claims stale activation with a new marker and fences the old owner", async () => {
    const fixture = await setup("VALIDATING");

    const result = await onboard(recoveryInput, fixture.dependencies);

    expect(fixture.registerWebhook).toHaveBeenCalledTimes(1);
    expect(result.bot.state).toBe("ACTIVE_UNBOUND");
    const row = fixture.db.sqlite.prepare(
      "SELECT state, transition_marker FROM bot_connections WHERE id='connection-1'",
    ).get() as { state: string; transition_marker: string };
    expect(row.state).toBe("ACTIVE_UNBOUND");
    expect(row.transition_marker).not.toBe("marker-old");

    await expect(fixture.dependencies.store.activateConnection({
      connectionId: "connection-1",
      userId: "user-1",
      registeredAt: NOW,
      expectedMarker: "marker-old",
      code: {
        kind: "connect",
        id: "stale-owner-code",
        connectionId: "connection-1",
        userId: "user-1",
        digest: "stale-owner-digest",
        expiresAt: NOW + 600_000,
        consumedAt: null,
        createdAt: NOW,
      },
      audit: {
        id: "stale-owner-audit",
        actorUserId: "user-1",
        action: "WEBHOOK_ACTIVATED",
        targetUserId: "user-1",
        targetConnectionId: "connection-1",
        result: "SUCCESS",
        createdAt: NOW,
      },
    })).rejects.toThrow();
    expect(fixture.db.sqlite.prepare(
      "SELECT COUNT(*) AS count FROM connect_codes WHERE consumed_at IS NULL",
    ).get()).toEqual({ count: 1 });
  });

  it("keeps exactly-five-minute VALIDATING leased with no mutating provider call", async () => {
    const fixture = await setup("VALIDATING", { updatedAt: NOW - 300_000 });

    await expect(onboard(recoveryInput, fixture.dependencies)).rejects.toBeInstanceOf(
      OnboardingConflictError,
    );
    expect(fixture.verifyToken).toHaveBeenCalledExactlyOnceWith("telegram", TOKEN);
    expect(fixture.registerWebhook).not.toHaveBeenCalled();
    expect(fixture.db.sqlite.prepare("SELECT state, transition_marker FROM bot_connections").get())
      .toEqual({ state: "VALIDATING", transition_marker: "marker-old" });
  });

  it("allows one concurrent stale recovery claim and one session/code graph", async () => {
    const fixture = await setup("WEBHOOK_FAILED");
    let finishProvider: (() => void) | undefined;
    const providerGate = new Promise<void>((resolve) => { finishProvider = resolve; });
    let providerEntered: (() => void) | undefined;
    const providerStarted = new Promise<void>((resolve) => { providerEntered = resolve; });
    fixture.registerWebhook.mockImplementationOnce(async () => {
      providerEntered?.();
      await providerGate;
    });

    const winner = onboard(recoveryInput, fixture.dependencies);
    await providerStarted;
    const loser = onboard(recoveryInput, fixture.dependencies);
    await expect(loser).rejects.toBeInstanceOf(OnboardingConflictError);
    finishProvider?.();
    await expect(winner).resolves.toMatchObject({ bot: { state: "ACTIVE_UNBOUND" } });

    expect(fixture.registerWebhook).toHaveBeenCalledTimes(1);
    expect(fixture.db.sqlite.prepare(
      "SELECT COUNT(*) AS count FROM sessions WHERE revoked_at IS NULL",
    ).get()).toEqual({ count: 1 });
    expect(fixture.db.sqlite.prepare(
      "SELECT COUNT(*) AS count FROM connect_codes WHERE consumed_at IS NULL",
    ).get()).toEqual({ count: 1 });
    expect(fixture.db.sqlite.prepare("SELECT COUNT(*) AS count FROM users").get())
      .toEqual({ count: 1 });
  });

  it("leaves the owned lease and returns no access material when final D1 commit fails after setWebhook", async () => {
    const fixture = await setup("WEBHOOK_FAILED");
    vi.spyOn(fixture.dependencies.store, "commitRecoveredAccess")
      .mockRejectedValueOnce(new Error("ambiguous D1 completion"));

    const failure = await onboard(recoveryInput, fixture.dependencies)
      .catch((error: unknown) => error);

    expect(failure).toEqual(new Error("ambiguous D1 completion"));
    expect(failure).not.toHaveProperty("sessionCookie");
    expect(failure).not.toHaveProperty("connectCommand");
    expect(fixture.registerWebhook).toHaveBeenCalledTimes(1);
    expect(fixture.db.sqlite.prepare("SELECT state FROM bot_connections").get())
      .toEqual({ state: "VALIDATING" });
    expect(fixture.db.sqlite.prepare(
      "SELECT COUNT(*) AS count FROM sessions WHERE revoked_at IS NULL",
    ).get()).toEqual({ count: 2 });
  });

  it("persists a typed provider failure before returning replacement recovery access", async () => {
    const fixture = await setup("ACTIVE_BOUND");
    const login = await issueLoginProof(fixture);
    fixture.db.sqlite.prepare(
      "UPDATE bot_connections SET state = 'WEBHOOK_FAILED' WHERE id = 'connection-1'",
    ).run();
    fixture.registerWebhook.mockRejectedValueOnce(new ProviderOperationError("FAILED"));

    const result = await onboard(recoveryInput, fixture.dependencies);

    expect(result).toMatchObject({
      bot: { state: "WEBHOOK_FAILED" },
      connectCommand: null,
      connectCodeExpiresAt: null,
      sessionCookie: expect.stringContaining("__Host-calenote_session="),
      activationCode: "WEBHOOK_ACTIVATION_FAILED",
    });
    expect(fixture.db.sqlite.prepare("SELECT state FROM bot_connections").get())
      .toEqual({ state: "WEBHOOK_FAILED" });
    expect(fixture.db.sqlite.prepare(
      "SELECT COUNT(*) AS count FROM sessions WHERE revoked_at IS NULL",
    ).get()).toEqual({ count: 1 });
    expect(fixture.db.sqlite.prepare(
      "SELECT consumed_at FROM login_codes WHERE id = ?",
    ).get(login.id)).toEqual({ consumed_at: NOW });
    await expect(verifyLoginCode("owner@example.com", login.code, {
      store: login.store,
      keyring: fixture.keyring,
      now: () => NOW + 1,
      randomBytes: sequencedRandomBytes(64),
    })).rejects.toBeInstanceOf(InvalidLoginCodeError);
  });

  it("restores a suspended exact-proof connection to ACTIVE_BOUND when identity remains", async () => {
    const fixture = await setup("SUSPENDED", { bound: true });

    const result = await onboard(recoveryInput, fixture.dependencies);

    expect(fixture.registerWebhook).toHaveBeenCalledTimes(1);
    expect(result.bot.state).toBe("ACTIVE_BOUND");
    expect(result.connectCommand).toBeNull();
    expect(result.connectCodeExpiresAt).toBeNull();
    expect(fixture.db.sqlite.prepare("SELECT state FROM bot_connections").get())
      .toEqual({ state: "ACTIVE_BOUND" });
  });

  it("collapses a wrong exact proof to the generic conflict", async () => {
    const fixture = await setup("ACTIVE_UNBOUND");
    fixture.verifyToken.mockResolvedValueOnce({ ...PROFILE, providerBotId: "different-bot" });

    await expect(onboard(recoveryInput, fixture.dependencies)).rejects.toBeInstanceOf(
      OnboardingConflictError,
    );
    expect(fixture.registerWebhook).not.toHaveBeenCalled();
    expect(fixture.db.sqlite.prepare("SELECT COUNT(*) AS count FROM sessions WHERE revoked_at IS NULL").get())
      .toEqual({ count: 2 });
  });

  it("fences a paused old-session code rotation after public recovery changes the snapshot", async () => {
    const fixture = await setup("ACTIVE_UNBOUND");
    const baseStore = fixture.dependencies.store;
    let resumeRotation: (() => void) | undefined;
    const rotationGate = new Promise<void>((resolve) => { resumeRotation = resolve; });
    let rotationEntered: (() => void) | undefined;
    const rotationPaused = new Promise<void>((resolve) => { rotationEntered = resolve; });
    const delayedStore = new Proxy(baseStore, {
      get(target, property, receiver) {
        if (property === "rotateConnectCode") {
          return async (...args: Parameters<OnboardingStore["rotateConnectCode"]>) => {
            rotationEntered?.();
            await rotationGate;
            return target.rotateConnectCode(...args);
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as OnboardingStore;
    const staleRequest = retryWebhook(
      { userId: "user-1", publicId: "AAAAAAAAAAAAAAAAAAAAAA" },
      {
        store: delayedStore,
        keyring: fixture.keyring,
        registerWebhook: fixture.registerWebhook,
        rateLimitStore: {
          consume: async () => ({ allowed: true, resetAt: NOW + 600_000 }),
        },
        appOrigin: "https://calenote.iconiclogs.com",
        now: () => NOW,
        randomBytes: fixture.dependencies.randomBytes,
      },
    );
    await rotationPaused;

    await expect(onboard(recoveryInput, fixture.dependencies)).resolves.toMatchObject({
      bot: { state: "ACTIVE_UNBOUND" },
      connectCommand: expect.stringMatching(/^\/connect /u),
    });
    const recoveryCode = fixture.db.sqlite.prepare(
      "SELECT id, digest FROM connect_codes WHERE consumed_at IS NULL",
    ).get();
    resumeRotation?.();

    await expect(staleRequest).rejects.toBeInstanceOf(ConnectionStateError);
    expect(fixture.db.sqlite.prepare(
      "SELECT id, digest FROM connect_codes WHERE consumed_at IS NULL",
    ).get()).toEqual(recoveryCode);
    expect(fixture.db.sqlite.prepare(
      "SELECT COUNT(*) AS count FROM sessions WHERE revoked_at IS NULL",
    ).get()).toEqual({ count: 1 });
  });
});
