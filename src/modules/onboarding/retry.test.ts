import { afterEach, describe, expect, it, vi } from "vitest";
import { D1OnboardingStore } from "@/modules/db/onboarding-store";
import { ProviderOperationError } from "@/modules/connections/provider-error";
import { createKeyring } from "@/modules/security/keyring";
import { deterministicRandomBytes, SqliteD1Database } from "@/testing/sqlite-d1.test-support";
import {
  BotTokenRejectedError,
  ConnectionNotFoundError,
  ConnectionStateError,
  retryWebhook,
  WebhookActivationFailedError,
} from "./service";

const MASTER = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const NOW = 1_800_000_000_000;
const TOKEN = "123456789:AAExample_secret-token_123456789";
const PUBLIC_ID = "AAAAAAAAAAAAAAAAAAAAAA";
const databases: SqliteD1Database[] = [];

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

async function setup(
  state: "ACTIVE_UNBOUND" | "ACTIVE_BOUND" | "WEBHOOK_FAILED" | "SUSPENDED" | "VALIDATING",
  options: { bound?: boolean; updatedAt?: number } = {},
) {
  const db = new SqliteD1Database();
  databases.push(db);
  const keyring = await createKeyring(MASTER);
  const encrypted = await keyring.encryptCredential("connection-1", "telegram", 1, TOKEN);
  const fingerprint = await keyring.fingerprintToken(TOKEN);
  db.sqlite.exec(`
    INSERT INTO users VALUES ('user-1','owner@example.com','Owner','Asia/Ho_Chi_Minh',1,1);
    INSERT INTO users VALUES ('user-2','other@example.com','Other','Asia/Ho_Chi_Minh',1,1);
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
    "connection-1", "user-1", "telegram", PUBLIC_ID, "provider-bot", "Mây", "@may_bot",
    null, 1, new Uint8Array(encrypted.ciphertext), new Uint8Array(encrypted.iv), fingerprint,
    1, state, null, 1, options.updatedAt ?? 1, "marker-old",
  );
  if (options.bound) {
    db.sqlite.exec(
      "INSERT INTO chat_identities VALUES ('chat-1','connection-1','provider-user','private-chat','Owner',1)",
    );
  }
  const registerWebhook = vi.fn(async () => undefined);
  const rateLimitStore = {
    consume: vi.fn(async () => ({ allowed: true as const, resetAt: NOW + 600_000 })),
  };
  return {
    db,
    keyring,
    registerWebhook,
    dependencies: {
      store: new D1OnboardingStore(db as unknown as D1Database),
      keyring,
      registerWebhook,
      rateLimitStore,
      appOrigin: "https://calenote.iconiclogs.com",
      now: () => NOW,
      randomBytes: deterministicRandomBytes(),
    },
  };
}

describe("authenticated webhook recovery on migrated D1", () => {
  it("rotates ACTIVE_UNBOUND access with zero provider calls", async () => {
    const fixture = await setup("ACTIVE_UNBOUND");

    const result = await retryWebhook(
      { userId: "user-1", publicId: PUBLIC_ID },
      fixture.dependencies,
    );

    expect(fixture.registerWebhook).not.toHaveBeenCalled();
    expect(result.connection).toEqual({
      publicId: PUBLIC_ID,
      provider: "telegram",
      displayName: "Mây",
      handle: "@may_bot",
      state: "ACTIVE_UNBOUND",
    });
    expect(result.connectCommand).toMatch(/^\/connect /u);
    expect(fixture.db.sqlite.prepare(
      "SELECT COUNT(*) AS count FROM connect_codes WHERE consumed_at IS NULL",
    ).get()).toEqual({ count: 1 });
  });

  it("restores SUSPENDED to ACTIVE_BOUND when its private identity still exists", async () => {
    const fixture = await setup("SUSPENDED", { bound: true });

    const result = await retryWebhook(
      { userId: "user-1", publicId: PUBLIC_ID },
      fixture.dependencies,
    );

    expect(fixture.registerWebhook).toHaveBeenCalledTimes(1);
    expect(result.connection.state).toBe("ACTIVE_BOUND");
    expect(result.connectCommand).toBeNull();
    expect(result.expiresAt).toBeNull();
    expect(fixture.db.sqlite.prepare("SELECT state FROM bot_connections").get())
      .toEqual({ state: "ACTIVE_BOUND" });
  });

  it("rejects foreign, bound, and exactly-five-minute VALIDATING rows before decrypt/provider", async () => {
    const foreign = await setup("WEBHOOK_FAILED");
    await expect(retryWebhook(
      { userId: "user-2", publicId: PUBLIC_ID },
      foreign.dependencies,
    )).rejects.toBeInstanceOf(ConnectionNotFoundError);
    expect(foreign.registerWebhook).not.toHaveBeenCalled();

    const bound = await setup("ACTIVE_BOUND", { bound: true });
    await expect(retryWebhook(
      { userId: "user-1", publicId: PUBLIC_ID },
      bound.dependencies,
    )).rejects.toBeInstanceOf(ConnectionStateError);
    expect(bound.registerWebhook).not.toHaveBeenCalled();

    const fresh = await setup("VALIDATING", { updatedAt: NOW - 300_000 });
    await expect(retryWebhook(
      { userId: "user-1", publicId: PUBLIC_ID },
      fresh.dependencies,
    )).rejects.toBeInstanceOf(ConnectionStateError);
    expect(fresh.registerWebhook).not.toHaveBeenCalled();
  });

  it("persists credential rejection before returning its typed safe error", async () => {
    const fixture = await setup("WEBHOOK_FAILED");
    fixture.registerWebhook.mockRejectedValueOnce(new ProviderOperationError("REJECTED_CREDENTIAL"));

    await expect(retryWebhook(
      { userId: "user-1", publicId: PUBLIC_ID },
      fixture.dependencies,
    )).rejects.toBeInstanceOf(BotTokenRejectedError);
    expect(fixture.db.sqlite.prepare("SELECT state FROM bot_connections").get())
      .toEqual({ state: "SUSPENDED" });
  });

  it("claims a strictly stale VALIDATING lease but not the equality boundary", async () => {
    const fixture = await setup("VALIDATING", { updatedAt: NOW - 300_001 });

    await expect(retryWebhook(
      { userId: "user-1", publicId: PUBLIC_ID },
      fixture.dependencies,
    )).resolves.toMatchObject({ connection: { state: "ACTIVE_UNBOUND" } });
    expect(fixture.registerWebhook).toHaveBeenCalledTimes(1);
    expect(fixture.db.sqlite.prepare("SELECT state FROM bot_connections").get())
      .toEqual({ state: "ACTIVE_UNBOUND" });
  });

  it("allows only one overlapping provider recovery claim", async () => {
    const fixture = await setup("WEBHOOK_FAILED");
    let releaseProvider: (() => void) | undefined;
    const providerGate = new Promise<void>((resolve) => { releaseProvider = resolve; });
    let providerEntered: (() => void) | undefined;
    const providerStarted = new Promise<void>((resolve) => { providerEntered = resolve; });
    fixture.registerWebhook.mockImplementationOnce(async () => {
      providerEntered?.();
      await providerGate;
    });

    const winner = retryWebhook(
      { userId: "user-1", publicId: PUBLIC_ID },
      fixture.dependencies,
    );
    await providerStarted;
    await expect(retryWebhook(
      { userId: "user-1", publicId: PUBLIC_ID },
      fixture.dependencies,
    )).rejects.toBeInstanceOf(ConnectionStateError);
    releaseProvider?.();
    await expect(winner).resolves.toMatchObject({ connection: { state: "ACTIVE_UNBOUND" } });
    expect(fixture.registerWebhook).toHaveBeenCalledTimes(1);
  });

  it("persists non-credential provider failure before returning its safe error", async () => {
    const fixture = await setup("WEBHOOK_FAILED");
    fixture.registerWebhook.mockRejectedValueOnce(new ProviderOperationError("FAILED"));

    await expect(retryWebhook(
      { userId: "user-1", publicId: PUBLIC_ID },
      fixture.dependencies,
    )).rejects.toBeInstanceOf(WebhookActivationFailedError);
    expect(fixture.db.sqlite.prepare("SELECT state FROM bot_connections").get())
      .toEqual({ state: "WEBHOOK_FAILED" });
    expect(fixture.db.sqlite.prepare("SELECT COUNT(*) AS count FROM sessions").get())
      .toEqual({ count: 0 });
  });

  it("returns no access material and keeps VALIDATING after setWebhook succeeds but final D1 fails", async () => {
    const fixture = await setup("WEBHOOK_FAILED");
    vi.spyOn(fixture.dependencies.store, "commitRecoveredAccess")
      .mockRejectedValueOnce(new Error("ambiguous D1 completion"));

    const failure = await retryWebhook(
      { userId: "user-1", publicId: PUBLIC_ID },
      fixture.dependencies,
    ).catch((error: unknown) => error);

    expect(failure).toEqual(new Error("ambiguous D1 completion"));
    expect(failure).not.toHaveProperty("connectCommand");
    expect(failure).not.toHaveProperty("expiresAt");
    expect(fixture.registerWebhook).toHaveBeenCalledTimes(1);
    expect(fixture.db.sqlite.prepare("SELECT state FROM bot_connections").get())
      .toEqual({ state: "VALIDATING" });
    expect(fixture.db.sqlite.prepare("SELECT COUNT(*) AS count FROM connect_codes").get())
      .toEqual({ count: 0 });
  });
});
