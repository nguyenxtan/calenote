import type { WebhookRegistration } from "@/modules/connections/contracts";
import { ConnectionNotFoundError, ConnectionStateError, type OnboardingStore } from "./service";
import { consumeRateLimit, type RateLimitStore } from "@/modules/rate-limit/service";
import type { Keyring } from "@/modules/security/keyring";

const POLL_TIMEOUT_MS = 22_000;
const PROBE_WINDOW_MS = 10 * 60_000;

export type SafeZaloPollEventName = "message.text.received" | "message.unsupported.received" | "NONE";

export interface SafeZaloWebhookInfo {
  configured: boolean;
  exactMatch: boolean;
  hostMatch?: boolean;
  pathPrefixMatch?: boolean;
}

export interface SafeZaloPollingUpdate {
  updateReceived: boolean;
  eventName: SafeZaloPollEventName;
  privateChat: boolean;
}

export interface ZaloPollingProvider {
  getWebhookInfo(token: string, expected: WebhookRegistration): Promise<SafeZaloWebhookInfo>;
  deleteWebhook(token: string): Promise<void>;
  getUpdates(token: string, input: { timeoutMs: number }): Promise<SafeZaloPollingUpdate>;
  setWebhook(token: string, input: WebhookRegistration): Promise<void>;
  testWebhook(token: string): Promise<{ apiOk: boolean; resultOk: boolean }>;
}

export interface ZaloPollDiagnosticDependencies {
  store: Pick<OnboardingStore, "findOwnedRecovery">;
  keyring: Pick<Keyring, "decryptCredential" | "digestCode" | "webhookSecrets">;
  rateLimitStore: RateLimitStore;
  provider: ZaloPollingProvider;
  appOrigin: string;
  now?: () => number;
}

export interface ZaloPollDiagnosticResult {
  pollProbeStarted: boolean;
  webhookRemoved: boolean;
  pollUpdateReceived: boolean;
  pollEventName: SafeZaloPollEventName;
  pollPrivateChat: boolean;
  webhookRestored: boolean;
  restoredHostMatch: boolean;
  restoredPathPrefixMatch: boolean;
  restoreTestOk: boolean | null;
}

export class ZaloPollDiagnosticError extends Error {
  readonly status: 409 | 429 | 502;
  readonly retryAfterSeconds: number | null;

  constructor(
    readonly code: "PRE_DELETE_FENCE_FAILED" | "RATE_LIMITED" | "POLL_FAILED" | "RESTORE_FAILED",
    retryAfterSeconds: number | null = null,
  ) {
    super(code);
    this.name = "ZaloPollDiagnosticError";
    this.status = code === "RATE_LIMITED" ? 429 : code === "POLL_FAILED" || code === "RESTORE_FAILED" ? 502 : 409;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function canonicalOrigin(value: string): string {
  const origin = new URL(value).origin;
  if (origin === "null" || origin !== value) throw new TypeError("APP_ORIGIN is invalid");
  return origin;
}

async function restoreWebhook(
  token: string,
  registration: WebhookRegistration,
  provider: ZaloPollingProvider,
): Promise<SafeZaloWebhookInfo | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await provider.setWebhook(token, registration);
      const verified = await provider.getWebhookInfo(token, registration);
      if (verified.configured && verified.exactMatch) return verified;
    } catch {
      // The bounded retry is the only recovery path; errors remain secret-free.
    }
  }
  return null;
}

export async function runZaloPollDiagnostic(
  input: { userId: string; publicId: string },
  dependencies: ZaloPollDiagnosticDependencies,
): Promise<ZaloPollDiagnosticResult> {
  const connection = await dependencies.store.findOwnedRecovery(input.userId, input.publicId);
  if (!connection) throw new ConnectionNotFoundError();
  if (connection.provider !== "zalo" || connection.state !== "ACTIVE_UNBOUND") throw new ConnectionStateError();

  const now = dependencies.now ?? Date.now;
  const subjectDigest = await dependencies.keyring.digestCode(
    `rate-limit:zalo-poll-diagnostic:${input.userId}:${connection.id}`,
  );
  const rate = await consumeRateLimit(
    { subjectDigest, scope: "zalo-poll-diagnostic", limit: 1, windowMs: PROBE_WINDOW_MS },
    { store: dependencies.rateLimitStore, now },
  );
  if (!rate.allowed) {
    throw new ZaloPollDiagnosticError("RATE_LIMITED", Math.max(1, Math.ceil((rate.resetAt - now()) / 1_000)));
  }

  const token = await dependencies.keyring.decryptCredential(
    connection.id,
    connection.provider,
    connection.credentialVersion,
    { ciphertext: connection.encryptedToken, iv: connection.encryptedTokenIv },
  );
  const secrets = await dependencies.keyring.webhookSecrets(connection.publicId);
  const registration: WebhookRegistration = {
    url: `${canonicalOrigin(dependencies.appOrigin)}/webhooks/zalo/${connection.publicId}/${secrets.pathSecret}`,
    secretToken: secrets.headerSecret,
  };

  const before = await dependencies.provider.getWebhookInfo(token, registration);
  if (!before.configured || !before.exactMatch) throw new ZaloPollDiagnosticError("PRE_DELETE_FENCE_FAILED");

  let deleted = false;
  let pollingError = false;
  let update: SafeZaloPollingUpdate = { updateReceived: false, eventName: "NONE", privateChat: false };
  try {
    await dependencies.provider.deleteWebhook(token);
    deleted = true;
    update = await dependencies.provider.getUpdates(token, { timeoutMs: POLL_TIMEOUT_MS });
  } catch {
    pollingError = true;
  } finally {
    if (deleted) {
      const restored = await restoreWebhook(token, registration, dependencies.provider);
      if (!restored) throw new ZaloPollDiagnosticError("RESTORE_FAILED");
      if (pollingError) throw new ZaloPollDiagnosticError("POLL_FAILED");
      let restoreTestOk = false;
      try {
        const tested = await dependencies.provider.testWebhook(token);
        restoreTestOk = tested.apiOk && tested.resultOk;
      } catch {
        // The webhook has already been restored and verified; test evidence is optional.
      }
      return {
        pollProbeStarted: true,
        webhookRemoved: true,
        pollUpdateReceived: update.updateReceived,
        pollEventName: update.eventName,
        pollPrivateChat: update.privateChat,
        webhookRestored: true,
        restoredHostMatch: restored.hostMatch ?? restored.exactMatch,
        restoredPathPrefixMatch: restored.pathPrefixMatch ?? restored.exactMatch,
        restoreTestOk,
      };
    }
  }

  throw new ZaloPollDiagnosticError("POLL_FAILED");
}
