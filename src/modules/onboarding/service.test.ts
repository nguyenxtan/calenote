import { describe, expect, it, vi } from "vitest";
import { prepareOneTimeCode } from "@/modules/auth/codes";
import type { BotProfile } from "@/modules/connections/contracts";
import { ProviderOperationError, ProviderVerificationError } from "@/modules/connections/provider-error";
import { createKeyring } from "@/modules/security/keyring";
import {
  ConnectionNotFoundError,
  ConnectionStateError,
  OnboardingConflictError,
  OnboardingInputError,
  onboard,
  rotateConnectCode,
  type AccountGraph,
  type ActivationFailure,
  type ActivationSuccess,
  type ConnectCodeRotation,
  type OwnedConnection,
  type OnboardingStore,
  type RecoveryAccessCommit,
  type RecoveryConnection,
  type RecoveryFailureCommit,
} from "./service";

const master = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const now = 1_700_000_000_000;
const token = "123456789:AAExample_secret-token_123456789";
const bot: BotProfile = {
  provider: "telegram",
  providerBotId: "987654321",
  displayName: "Thư ký Mây",
  handle: "@may_calendar_bot",
  accountType: null,
  canJoinGroups: true,
};

function incrementalRandom() {
  let seed = 1;
  return (length: number) => {
    const bytes = Uint8Array.from({ length }, (_, index) => (seed + index * 17) & 0xff);
    seed = (seed + length + 1) & 0xff;
    return bytes;
  };
}

class MemoryOnboardingStore implements OnboardingStore {
  readonly events: string[] = [];
  readonly graphs: AccountGraph[] = [];
  readonly successes: ActivationSuccess[] = [];
  readonly failures: ActivationFailure[] = [];
  readonly rotations: ConnectCodeRotation[] = [];
  ownedConnection: OwnedConnection | null = null;
  graphError: Error | null = null;
  recovery: RecoveryConnection | null = null;

  async commitAccountGraph(graph: AccountGraph): Promise<void> {
    this.events.push("persist");
    if (this.graphError) throw this.graphError;
    this.graphs.push(structuredClone(graph));
  }

  async activateConnection(input: ActivationSuccess): Promise<void> {
    this.events.push("activate");
    this.successes.push(structuredClone(input));
  }

  async failActivation(input: ActivationFailure): Promise<void> {
    this.events.push("fail");
    this.failures.push(structuredClone(input));
  }

  async findOwnedConnection(userId: string, publicId: string): Promise<OwnedConnection | null> {
    this.events.push(`find:${userId}:${publicId}`);
    return this.ownedConnection;
  }

  async rotateConnectCode(input: ConnectCodeRotation): Promise<void> {
    this.events.push("rotate");
    this.rotations.push(structuredClone(input));
  }

  async findExactRecovery(): Promise<RecoveryConnection | null> {
    this.events.push("find-recovery");
    return this.recovery;
  }

  async findOwnedRecovery(): Promise<RecoveryConnection | null> {
    this.events.push("find-owned-recovery");
    return this.recovery;
  }

  async claimRecovery(): Promise<boolean> {
    this.events.push("claim-recovery");
    return true;
  }

  async commitRecoveredAccess(input: RecoveryAccessCommit): Promise<boolean> {
    void input;
    this.events.push("commit-recovery");
    return true;
  }

  async failRecoveredActivation(input: RecoveryFailureCommit): Promise<boolean> {
    void input;
    this.events.push("fail-recovery");
    return true;
  }
}

async function dependencies(store = new MemoryOnboardingStore()) {
  const keyring = await createKeyring(master);
  const verifyToken = vi.fn(async () => {
    store.events.push("verify");
    return bot;
  });
  const registerWebhook = vi.fn(
    async () => {
      store.events.push("webhook");
    },
  );
  return {
    store,
    keyring,
    verifyToken,
    registerWebhook,
    appOrigin: "https://calenote.iconiclogs.com",
    now: () => now,
    randomBytes: incrementalRandom(),
  };
}

const input = {
  displayName: "  Bích Tuyền  ",
  email: "  Owner@Example.COM ",
  timezone: "Asia/Ho_Chi_Minh" as const,
  provider: "telegram" as const,
  token,
};

describe("durable onboarding", () => {
  it("verifies getMe before persisting any account state", async () => {
    const deps = await dependencies();

    await onboard(input, deps);

    expect(deps.store.events.slice(0, 4)).toEqual(["verify", "find-recovery", "persist", "webhook"]);
    expect(deps.verifyToken).toHaveBeenCalledWith("telegram", token);
  });

  it("stores normalized identity and bound ciphertext instead of the plaintext token", async () => {
    const deps = await dependencies();

    await onboard(input, deps);

    const graph = deps.store.graphs[0];
    expect(graph.user).toMatchObject({ displayName: "Bích Tuyền", email: "owner@example.com" });
    expect(new TextDecoder().decode(graph.connection.encryptedToken)).not.toBe(token);
    await expect(
      deps.keyring.decryptCredential(
        graph.connection.id,
        graph.connection.provider,
        graph.connection.credentialVersion,
        { ciphertext: graph.connection.encryptedToken, iv: graph.connection.encryptedTokenIv },
      ),
    ).resolves.toBe(token);
    expect(JSON.stringify(graph)).not.toContain(token);
  });

  it.each(["duplicate email", "duplicate token", "duplicate provider bot"])(
    "collapses a %s race to one generic conflict",
    async () => {
      const deps = await dependencies();
      deps.store.graphError = new OnboardingConflictError();

      const failure = await onboard(input, deps).catch((error: unknown) => error);

      expect(failure).toMatchObject({ code: "ONBOARDING_CONFLICT", status: 409 });
      expect(String(failure)).not.toContain(input.email.trim().toLowerCase());
      expect(String(failure)).not.toContain(token);
    },
  );

  it("leaves a failed webhook registration in an auditable failure state without a code", async () => {
    const deps = await dependencies();
    deps.registerWebhook.mockRejectedValueOnce(new ProviderOperationError("FAILED"));

    const result = await onboard(input, deps);

    expect(deps.store.failures).toHaveLength(1);
    expect(deps.store.failures[0]).toMatchObject({ state: "WEBHOOK_FAILED", auditResult: "FAILURE" });
    expect(deps.store.successes).toHaveLength(0);
    expect(result.bot).toMatchObject({ state: "WEBHOOK_FAILED" });
    expect(result.connectCommand).toBeNull();
    expect(result.connectCodeExpiresAt).toBeNull();
    expect(result.activationCode).toBe("WEBHOOK_ACTIVATION_FAILED");
  });

  it("suspends a connection when webhook activation rejects the committed credential", async () => {
    const deps = await dependencies();
    deps.registerWebhook.mockRejectedValueOnce(new ProviderOperationError("REJECTED_CREDENTIAL"));

    const result = await onboard(input, deps);

    expect(deps.store.failures[0]).toMatchObject({ state: "SUSPENDED", auditResult: "FAILURE" });
    expect(result.bot.state).toBe("SUSPENDED");
    expect(result.connectCommand).toBeNull();
  });

  it.each([
    new TypeError("internal secret setup failed"),
    new ProviderVerificationError("INVALID_PROVIDER_RESPONSE"),
  ])("phase-wraps a non-operational registration error without recording provider failure", async (registrationError) => {
    const deps = await dependencies();
    deps.registerWebhook.mockRejectedValueOnce(registrationError);

    const failure = await onboard(input, deps).catch((error: unknown) => error);
    expect(failure).toMatchObject({
      name: "WebhookActivationInternalError",
      message: "Không thể hoàn tất kích hoạt webhook.",
    });
    expect(failure).not.toBe(registrationError);
    expect(deps.store.failures).toHaveLength(0);
    expect(deps.store.successes).toHaveLength(0);
    expect(deps.store.events).toEqual(["verify", "find-recovery", "persist"]);
    expect(deps.store.graphs[0].connection.state).toBe("VALIDATING");
  });

  it("derives the exact webhook URL and emits only public metadata", async () => {
    const deps = await dependencies();

    const result = await onboard(input, deps);

    const graph = deps.store.graphs[0];
    const secrets = await deps.keyring.webhookSecrets(graph.connection.publicId);
    expect(deps.registerWebhook).toHaveBeenCalledWith("telegram", token, {
      url: `https://calenote.iconiclogs.com/webhooks/telegram/${graph.connection.publicId}/${secrets.pathSecret}`,
      secretToken: secrets.headerSecret,
    });
    expect(result.bot).toEqual({
      publicId: graph.connection.publicId,
      provider: "telegram",
      displayName: "Thư ký Mây",
      handle: "@may_calendar_bot",
      state: "ACTIVE_UNBOUND",
    });
    const serialized = JSON.stringify(result);
    for (const forbidden of [token, "encryptedToken", "encryptedTokenIv", "tokenFingerprint", "credentialVersion", graph.user.id, graph.connection.id]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("returns a secure session cookie and persists one rotated connect-code digest", async () => {
    const deps = await dependencies();

    const result = await onboard(input, deps);

    expect(result.sessionCookie).toContain("__Host-calenote_session=");
    expect(result.sessionCookie).toContain("HttpOnly");
    expect(result.sessionCookie).toContain("Secure");
    expect(result.sessionCookie).toContain("SameSite=Lax");
    expect(result.connectCommand).toMatch(/^\/connect [A-HJ-NP-Z2-9]{26}$/u);
    expect(result.connectCodeExpiresAt).toBe(now + 600_000);
    expect(deps.store.successes[0].code.digest).not.toBe(result.connectCommand?.slice(9));
    expect(JSON.stringify(deps.store.successes[0])).not.toContain(result.connectCommand?.slice(9));
  });

  it.each([
    { field: "displayName", value: " ", label: "blank display name" },
    { field: "email", value: "not-an-email", label: "invalid email" },
    { field: "timezone", value: "UTC", label: "wrong timezone" },
    { field: "token", value: "", label: "blank token" },
  ])("rejects $label before provider egress", async ({ field, value }) => {
    const deps = await dependencies();

    await expect(onboard({ ...input, [field]: value }, deps)).rejects.toBeInstanceOf(OnboardingInputError);
    expect(deps.verifyToken).not.toHaveBeenCalled();
    expect(deps.store.events).toEqual([]);
  });
});

describe("connect-code rotation", () => {
  it("owner-scopes lookup, HMACs the rate subject, and atomically stores only a replacement digest", async () => {
    const deps = await dependencies();
    deps.store.ownedConnection = {
      id: "connection-internal",
      publicId: "bot-public",
      userId: "user-internal",
      state: "ACTIVE_UNBOUND",
      updatedAt: now - 1,
      transitionMarker: "active-marker",
    };
    const consumed: Array<{ subjectDigest: string; scope: string }> = [];
    const result = await rotateConnectCode(
      { userId: "user-internal", publicId: "bot-public" },
      {
        ...deps,
        rateLimitStore: {
          consume: async (rateInput) => {
            consumed.push({ subjectDigest: rateInput.subjectDigest, scope: rateInput.bucket });
            return { allowed: true, resetAt: now + 60_000 };
          },
        },
      },
    );

    expect(deps.store.events.slice(-2)).toEqual(["find:user-internal:bot-public", "rotate"]);
    expect(consumed).toEqual([{
      subjectDigest: await deps.keyring.digestCode("rate-limit:connect-code:user-internal:connection-internal"),
      scope: "connect-code",
    }]);
    expect(result.command).toMatch(/^\/connect [A-HJ-NP-Z2-9]{26}$/u);
    expect(result.expiresAt).toBe(now + 600_000);
    expect(JSON.stringify(deps.store.rotations[0])).not.toContain(result.command.slice(9));
  });

  it("makes another tenant indistinguishable from a missing connection", async () => {
    const deps = await dependencies();

    await expect(
      rotateConnectCode(
        { userId: "other-user", publicId: "bot-public" },
        { ...deps, rateLimitStore: { consume: vi.fn() } },
      ),
    ).rejects.toBeInstanceOf(ConnectionNotFoundError);
  });

  it("rejects an owned connection in the wrong state before rate limiting or rotation", async () => {
    const deps = await dependencies();
    deps.store.ownedConnection = {
      id: "connection-internal",
      publicId: "bot-public",
      userId: "user-internal",
      state: "ACTIVE_BOUND",
      updatedAt: now - 1,
      transitionMarker: "bound-marker",
    };
    const consume = vi.fn();

    await expect(
      rotateConnectCode(
        { userId: "user-internal", publicId: "bot-public" },
        { ...deps, rateLimitStore: { consume } },
      ),
    ).rejects.toBeInstanceOf(ConnectionStateError);
    expect(consume).not.toHaveBeenCalled();
    expect(deps.store.rotations).toHaveLength(0);
  });

  it("returns a stable retry boundary without generating or storing a code when limited", async () => {
    const deps = await dependencies();
    deps.store.ownedConnection = {
      id: "connection-internal",
      publicId: "bot-public",
      userId: "user-internal",
      state: "ACTIVE_UNBOUND",
      updatedAt: now - 1,
      transitionMarker: "active-marker",
    };

    const failure = await rotateConnectCode(
      { userId: "user-internal", publicId: "bot-public" },
      {
        ...deps,
        rateLimitStore: {
          consume: async () => ({ allowed: false, resetAt: now + 21_500 }),
        },
      },
    ).catch((error: unknown) => error);

    expect(failure).toMatchObject({ code: "RATE_LIMITED", status: 429, retryAfterSeconds: 22 });
    expect(deps.store.rotations).toHaveLength(0);
  });
});

describe("prepared one-time codes", () => {
  it("prepares a side-effect-free connect code for a caller-owned D1 batch", async () => {
    const prepared = await prepareOneTimeCode(
      { kind: "connect", userId: "user-1", connectionId: "connection-1" },
      { keyring: await createKeyring(master), now: () => now, randomBytes: incrementalRandom() },
    );

    expect(prepared.code).toMatch(/^[A-HJ-NP-Z2-9]{26}$/u);
    expect(prepared.record).toMatchObject({ kind: "connect", expiresAt: now + 600_000 });
    expect(JSON.stringify(prepared.record)).not.toContain(prepared.code);
  });
});
