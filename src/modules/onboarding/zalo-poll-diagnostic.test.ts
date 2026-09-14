import { describe, expect, it, vi } from "vitest";
import type { RecoveryConnection } from "./service";
import {
  ZaloPollDiagnosticError,
  runZaloPollDiagnostic,
  type ZaloPollDiagnosticDependencies,
} from "./zalo-poll-diagnostic";

const publicId = "AAAAAAAAAAAAAAAAAAAAAA";
const token = "zalo-token-must-never-appear";
const pathSecret = `${"P".repeat(42)}A`;
const headerSecret = `${"H".repeat(42)}A`;

const connection: RecoveryConnection = {
  id: "connection-internal-must-not-appear",
  publicId,
  userId: "user-internal-must-not-appear",
  provider: "zalo",
  providerBotId: "provider-bot-internal",
  displayName: "Bot",
  handle: null,
  state: "ACTIVE_UNBOUND",
  updatedAt: 1_800_000_000_000,
  transitionMarker: null,
  hasPrivateChat: false,
  encryptedToken: new Uint8Array([1]).buffer,
  encryptedTokenIv: new Uint8Array([2]).buffer,
  credentialVersion: 1,
};

function dependencies(overrides: Partial<ZaloPollDiagnosticDependencies> = {}): ZaloPollDiagnosticDependencies {
  return {
    store: { findOwnedRecovery: vi.fn(async () => connection) },
    keyring: {
      decryptCredential: vi.fn(async () => token),
      digestCode: vi.fn(async () => "A".repeat(43)),
      webhookSecrets: vi.fn(async () => ({ pathSecret, headerSecret })),
    },
    rateLimitStore: { consume: vi.fn(async () => ({ allowed: true, resetAt: 1_800_000_600_000 })) },
    provider: {
      getWebhookInfo: vi.fn(async () => ({ configured: true, exactMatch: true })),
      deleteWebhook: vi.fn(async () => undefined),
      getUpdates: vi.fn(async () => ({ updateReceived: true, eventName: "message.text.received" as const, privateChat: true })),
      setWebhook: vi.fn(async () => undefined),
      testWebhook: vi.fn(async () => ({ apiOk: true, resultOk: true })),
    },
    appOrigin: "https://calenote.iconiclogs.com",
    now: () => 1_800_000_000_000,
    ...overrides,
  };
}

describe("controlled Zalo polling diagnostic", () => {
  it("does not delete an unexpected webhook before the exact canonical fence passes", async () => {
    const deps = dependencies();
    vi.mocked(deps.provider.getWebhookInfo).mockResolvedValueOnce({ configured: true, exactMatch: false });

    await expect(runZaloPollDiagnostic({ userId: connection.userId, publicId }, deps))
      .rejects.toEqual(new ZaloPollDiagnosticError("PRE_DELETE_FENCE_FAILED"));

    expect(deps.provider.deleteWebhook).not.toHaveBeenCalled();
    expect(deps.provider.getUpdates).not.toHaveBeenCalled();
    expect(deps.provider.setWebhook).not.toHaveBeenCalled();
  });

  it("limits a connection to one probe per ten minutes before decrypting or mutating the provider", async () => {
    const deps = dependencies({
      rateLimitStore: { consume: vi.fn(async () => ({ allowed: false, resetAt: 1_800_000_600_000 })) },
    });

    await expect(runZaloPollDiagnostic({ userId: connection.userId, publicId }, deps))
      .rejects.toEqual(new ZaloPollDiagnosticError("RATE_LIMITED", 600));

    expect(deps.keyring.decryptCredential).not.toHaveBeenCalled();
    expect(deps.provider.deleteWebhook).not.toHaveBeenCalled();
  });

  it("deletes only after the fence, polls safely, and restores plus verifies the webhook", async () => {
    const deps = dependencies();

    await expect(runZaloPollDiagnostic({ userId: connection.userId, publicId }, deps)).resolves.toEqual({
      pollProbeStarted: true,
      webhookRemoved: true,
      pollUpdateReceived: true,
      pollEventName: "message.text.received",
      pollPrivateChat: true,
      webhookRestored: true,
      restoredHostMatch: true,
      restoredPathPrefixMatch: true,
      restoreTestOk: true,
    });

    expect(deps.provider.deleteWebhook).toHaveBeenCalledBefore(deps.provider.getUpdates as ReturnType<typeof vi.fn>);
    const restoreCall = vi.mocked(deps.provider.setWebhook).mock.invocationCallOrder[0];
    const verificationCall = vi.mocked(deps.provider.getWebhookInfo).mock.invocationCallOrder.at(-1);
    expect(restoreCall).toBeLessThan(verificationCall!);
    expect(deps.provider.getUpdates).toHaveBeenCalledWith(token, { timeoutMs: 22_000 });
  });

  it("restores once after a polling failure without exposing token, text, or identifiers", async () => {
    const deps = dependencies();
    vi.mocked(deps.provider.getUpdates).mockRejectedValueOnce(new Error("provider body and secret must remain private"));

    const failure = await runZaloPollDiagnostic({ userId: connection.userId, publicId }, deps)
      .catch((error: unknown) => error);

    expect(failure).toEqual(new ZaloPollDiagnosticError("POLL_FAILED"));
    expect(deps.provider.setWebhook).toHaveBeenCalledTimes(1);
    const serialized = JSON.stringify(failure);
    for (const forbidden of [token, pathSecret, headerSecret, connection.id, connection.userId]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("restores after a bounded polling timeout without changing the connection or connect code", async () => {
    const deps = dependencies();
    const timeout = new DOMException("request timed out", "TimeoutError");
    vi.mocked(deps.provider.getUpdates).mockRejectedValueOnce(timeout);

    await expect(runZaloPollDiagnostic({ userId: connection.userId, publicId }, deps))
      .rejects.toEqual(new ZaloPollDiagnosticError("POLL_FAILED"));

    expect(deps.provider.setWebhook).toHaveBeenCalledTimes(1);
    expect(deps.store.findOwnedRecovery).toHaveBeenCalledWith(connection.userId, publicId);
    expect(Object.keys(deps.store)).toEqual(["findOwnedRecovery"]);
  });

  it("retries restoration exactly once and fails closed when restoration cannot be verified", async () => {
    const deps = dependencies();
    vi.mocked(deps.provider.setWebhook)
      .mockRejectedValueOnce(new Error("first restore failure"))
      .mockResolvedValueOnce(undefined);
    vi.mocked(deps.provider.getWebhookInfo)
      .mockResolvedValueOnce({ configured: true, exactMatch: true })
      .mockResolvedValueOnce({ configured: true, exactMatch: false });

    await expect(runZaloPollDiagnostic({ userId: connection.userId, publicId }, deps))
      .rejects.toEqual(new ZaloPollDiagnosticError("RESTORE_FAILED"));

    expect(deps.provider.setWebhook).toHaveBeenCalledTimes(2);
    expect(deps.provider.testWebhook).not.toHaveBeenCalled();
  });

  it("reports a safe failed restoration test after the webhook has already been restored", async () => {
    const deps = dependencies();
    vi.mocked(deps.provider.testWebhook).mockRejectedValueOnce(new Error("provider response must not escape"));

    await expect(runZaloPollDiagnostic({ userId: connection.userId, publicId }, deps)).resolves.toMatchObject({
      webhookRestored: true,
      restoreTestOk: false,
    });
  });
});
