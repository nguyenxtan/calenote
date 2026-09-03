import { z } from "zod";
import {
  prepareOneTimeCode,
  type ConnectCodeRecord,
} from "@/modules/auth/codes";
import { prepareSession, type SessionRecord } from "@/modules/auth/session";
import type {
  BotProfile,
  BotProvider,
  WebhookRegistration,
} from "@/modules/connections/contracts";
import { ProviderOperationError, ProviderVerificationError } from "@/modules/connections/provider-error";
import type { RateLimitStore } from "@/modules/rate-limit/service";
import { consumeRateLimit } from "@/modules/rate-limit/service";
import {
  cryptoRandomBytes,
  randomOpaqueId,
  systemClock,
  type Clock,
  type RandomBytes,
} from "@/modules/platform/types";
import type { Keyring } from "@/modules/security/keyring";

const inputSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email().max(254),
  timezone: z.literal("Asia/Ho_Chi_Minh"),
  provider: z.enum(["zalo", "telegram"]),
  token: z.string().min(1).max(512),
}).strict();

export type ConnectionState =
  | "VALIDATING"
  | "ACTIVE_UNBOUND"
  | "ACTIVE_BOUND"
  | "WEBHOOK_FAILED"
  | "SUSPENDED";

export interface AccountGraph {
  user: {
    id: string;
    email: string;
    displayName: string;
    timezone: "Asia/Ho_Chi_Minh";
    createdAt: number;
  };
  workspace: { id: string; ownerUserId: string; createdAt: number };
  membership: { workspaceId: string; userId: string; createdAt: number };
  connection: {
    id: string;
    userId: string;
    provider: BotProvider;
    publicId: string;
    providerBotId: string;
    displayName: string;
    handle: string | null;
    accountType: string | null;
    canJoinGroups: boolean | null;
    encryptedToken: ArrayBuffer;
    encryptedTokenIv: ArrayBuffer;
    tokenFingerprint: string;
    credentialVersion: 1;
    state: "VALIDATING";
    createdAt: number;
  };
  session: SessionRecord;
  audit: SafeAuditEvent;
}

export interface SafeAuditEvent {
  id: string;
  actorUserId: string;
  action: "ONBOARDING_CREATED" | "WEBHOOK_ACTIVATED" | "WEBHOOK_ACTIVATION_FAILED" | "CONNECT_CODE_ROTATED";
  targetUserId: string;
  targetConnectionId: string;
  result: "SUCCESS" | "FAILURE";
  createdAt: number;
}

export interface ActivationSuccess {
  connectionId: string;
  userId: string;
  registeredAt: number;
  code: ConnectCodeRecord;
  audit: SafeAuditEvent;
}

export interface ActivationFailure {
  connectionId: string;
  userId: string;
  state: "WEBHOOK_FAILED" | "SUSPENDED";
  failedAt: number;
  auditResult: "FAILURE";
  audit: SafeAuditEvent;
}

export interface OwnedConnection {
  id: string;
  publicId: string;
  userId: string;
  state: ConnectionState;
}

export interface ConnectCodeRotation {
  connection: OwnedConnection;
  code: ConnectCodeRecord;
  rotatedAt: number;
  audit: SafeAuditEvent;
}

export interface OnboardingStore {
  commitAccountGraph(graph: AccountGraph): Promise<void>;
  activateConnection(input: ActivationSuccess): Promise<void>;
  failActivation(input: ActivationFailure): Promise<void>;
  findOwnedConnection(userId: string, publicId: string): Promise<OwnedConnection | null>;
  rotateConnectCode(input: ConnectCodeRotation): Promise<void>;
}

export interface OnboardingInput {
  displayName: string;
  email: string;
  timezone: "Asia/Ho_Chi_Minh";
  provider: BotProvider;
  token: string;
}

export function parseOnboardingInput(input: unknown): OnboardingInput {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new OnboardingInputError();
  return parsed.data;
}

type VerifyToken = (provider: BotProvider, token: string) => Promise<BotProfile>;
type RegisterWebhook = (
  provider: BotProvider,
  token: string,
  registration: WebhookRegistration,
) => Promise<void>;

export interface OnboardingDependencies {
  store: OnboardingStore;
  keyring: Pick<Keyring, "encryptCredential" | "fingerprintToken" | "digestSession" | "digestCode" | "webhookSecrets">;
  verifyToken: VerifyToken;
  registerWebhook: RegisterWebhook;
  appOrigin: string;
  now?: Clock;
  randomBytes?: RandomBytes;
}

export interface PublicOnboardedBot {
  publicId: string;
  provider: BotProvider;
  providerBotId: string;
  displayName: string;
  handle: string | null;
  accountType: string | null;
  canJoinGroups: boolean | null;
  state: "ACTIVE_UNBOUND" | "WEBHOOK_FAILED" | "SUSPENDED";
  webhook: "READY" | "FAILED";
}

export interface OnboardingResult {
  bot: PublicOnboardedBot;
  connectCommand: string | null;
  connectCodeExpiresAt: number | null;
  sessionCookie: string;
  activationCode: "WEBHOOK_ACTIVATION_FAILED" | null;
}

class SafeServiceError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class OnboardingInputError extends SafeServiceError {
  constructor() {
    super("INVALID_ONBOARDING", 400, "Thông tin khởi tạo chưa hợp lệ.");
    this.name = "OnboardingInputError";
  }
}

export class OnboardingConflictError extends SafeServiceError {
  constructor() {
    super("ONBOARDING_CONFLICT", 409, "Không thể kích hoạt tài khoản hoặc bot này.");
    this.name = "OnboardingConflictError";
  }
}

export class ConnectionNotFoundError extends SafeServiceError {
  constructor() {
    super("CONNECTION_NOT_FOUND", 404, "Không tìm thấy kết nối.");
    this.name = "ConnectionNotFoundError";
  }
}

export class ConnectionStateError extends SafeServiceError {
  constructor() {
    super("CONNECTION_STATE_CONFLICT", 409, "Trạng thái kết nối hiện tại không cho phép thao tác này.");
    this.name = "ConnectionStateError";
  }
}

export class RateLimitExceededError extends SafeServiceError {
  constructor(readonly retryAfterSeconds: number) {
    super("RATE_LIMITED", 429, "Bạn thao tác quá nhanh. Vui lòng thử lại sau.");
    this.name = "RateLimitExceededError";
  }
}

function opaqueId(randomBytes: RandomBytes): string {
  return randomOpaqueId(randomBytes);
}

function audit(
  action: SafeAuditEvent["action"],
  result: SafeAuditEvent["result"],
  userId: string,
  connectionId: string,
  createdAt: number,
  randomBytes: RandomBytes,
): SafeAuditEvent {
  return {
    id: opaqueId(randomBytes),
    actorUserId: userId,
    action,
    targetUserId: userId,
    targetConnectionId: connectionId,
    result,
    createdAt,
  };
}

function canonicalAppOrigin(value: string): string {
  let origin: string;
  try {
    origin = new URL(value).origin;
  } catch {
    throw new TypeError("APP_ORIGIN is invalid");
  }
  if (origin === "null" || origin !== value) throw new TypeError("APP_ORIGIN is invalid");
  return origin;
}

function publicBot(
  publicId: string,
  profile: BotProfile,
  state: PublicOnboardedBot["state"],
): PublicOnboardedBot {
  return {
    publicId,
    provider: profile.provider,
    providerBotId: profile.providerBotId,
    displayName: profile.displayName,
    handle: profile.handle,
    accountType: profile.accountType,
    canJoinGroups: profile.canJoinGroups,
    state,
    webhook: state === "ACTIVE_UNBOUND" ? "READY" : "FAILED",
  };
}

export async function onboard(
  rawInput: OnboardingInput,
  dependencies: OnboardingDependencies,
): Promise<OnboardingResult> {
  const input = parseOnboardingInput(rawInput);
  const now = dependencies.now ?? systemClock;
  const randomBytes = dependencies.randomBytes ?? cryptoRandomBytes;

  const profile = await dependencies.verifyToken(input.provider, input.token);
  if (profile.provider !== input.provider) {
    throw new ProviderVerificationError("INVALID_PROVIDER_RESPONSE");
  }

  const createdAt = now();
  const userId = opaqueId(randomBytes);
  const workspaceId = opaqueId(randomBytes);
  const connectionId = opaqueId(randomBytes);
  const publicId = opaqueId(randomBytes);
  const credentialVersion = 1 as const;
  const encrypted = await dependencies.keyring.encryptCredential(
    connectionId,
    input.provider,
    credentialVersion,
    input.token,
  );
  const tokenFingerprint = await dependencies.keyring.fingerprintToken(input.token);
  const preparedSession = await prepareSession(userId, {
    keyring: dependencies.keyring,
    now: () => createdAt,
    randomBytes,
  });
  const graph: AccountGraph = {
    user: {
      id: userId,
      email: input.email,
      displayName: input.displayName,
      timezone: input.timezone,
      createdAt,
    },
    workspace: { id: workspaceId, ownerUserId: userId, createdAt },
    membership: { workspaceId, userId, createdAt },
    connection: {
      id: connectionId,
      userId,
      provider: input.provider,
      publicId,
      providerBotId: profile.providerBotId,
      displayName: profile.displayName,
      handle: profile.handle,
      accountType: profile.accountType,
      canJoinGroups: profile.canJoinGroups,
      encryptedToken: encrypted.ciphertext,
      encryptedTokenIv: encrypted.iv,
      tokenFingerprint,
      credentialVersion,
      state: "VALIDATING",
      createdAt,
    },
    session: preparedSession.record,
    audit: audit("ONBOARDING_CREATED", "SUCCESS", userId, connectionId, createdAt, randomBytes),
  };

  await dependencies.store.commitAccountGraph(graph);

  const secrets = await dependencies.keyring.webhookSecrets(publicId);
  const webhookUrl = `${canonicalAppOrigin(dependencies.appOrigin)}/webhooks/${input.provider}/${publicId}/${secrets.pathSecret}`;
  try {
    await dependencies.registerWebhook(input.provider, input.token, {
      url: webhookUrl,
      secretToken: secrets.headerSecret,
    });
  } catch (error) {
    if (!(error instanceof ProviderOperationError)) throw error;
    const state = error.code === "REJECTED_CREDENTIAL"
      ? "SUSPENDED"
      : "WEBHOOK_FAILED";
    const failedAt = now();
    await dependencies.store.failActivation({
      connectionId,
      userId,
      state,
      failedAt,
      auditResult: "FAILURE",
      audit: audit("WEBHOOK_ACTIVATION_FAILED", "FAILURE", userId, connectionId, failedAt, randomBytes),
    });
    return {
      bot: publicBot(publicId, profile, state),
      connectCommand: null,
      connectCodeExpiresAt: null,
      sessionCookie: preparedSession.cookie,
      activationCode: "WEBHOOK_ACTIVATION_FAILED",
    };
  }

  const activatedAt = now();
  const preparedCode = await prepareOneTimeCode(
    { kind: "connect", userId, connectionId },
    { keyring: dependencies.keyring, now: () => activatedAt, randomBytes },
  );
  if (preparedCode.record.kind !== "connect") throw new TypeError("Prepared code kind mismatch");
  await dependencies.store.activateConnection({
    connectionId,
    userId,
    registeredAt: activatedAt,
    code: preparedCode.record,
    audit: audit("WEBHOOK_ACTIVATED", "SUCCESS", userId, connectionId, activatedAt, randomBytes),
  });
  return {
    bot: publicBot(publicId, profile, "ACTIVE_UNBOUND"),
    connectCommand: `/connect ${preparedCode.code}`,
    connectCodeExpiresAt: preparedCode.expiresAt,
    sessionCookie: preparedSession.cookie,
    activationCode: null,
  };
}

export interface RotateConnectCodeDependencies {
  store: OnboardingStore;
  keyring: Pick<Keyring, "digestCode">;
  rateLimitStore: RateLimitStore;
  now?: Clock;
  randomBytes?: RandomBytes;
}

export async function rotateConnectCode(
  input: { userId: string; publicId: string },
  dependencies: RotateConnectCodeDependencies,
): Promise<{ command: string; expiresAt: number }> {
  const connection = await dependencies.store.findOwnedConnection(input.userId, input.publicId);
  if (!connection) throw new ConnectionNotFoundError();
  if (connection.state !== "ACTIVE_UNBOUND") throw new ConnectionStateError();

  const now = dependencies.now ?? systemClock;
  const currentTime = now();
  const subjectDigest = await dependencies.keyring.digestCode(
    `rate-limit:connect-code:${input.userId}:${connection.id}`,
  );
  const limited = await consumeRateLimit(
    { subjectDigest, scope: "connect-code", limit: 5, windowMs: 60_000 },
    { store: dependencies.rateLimitStore, now: () => currentTime },
  );
  if (!limited.allowed) {
    throw new RateLimitExceededError(Math.max(1, Math.ceil((limited.resetAt - currentTime) / 1_000)));
  }

  const randomBytes = dependencies.randomBytes ?? cryptoRandomBytes;
  const prepared = await prepareOneTimeCode(
    { kind: "connect", userId: input.userId, connectionId: connection.id },
    { keyring: dependencies.keyring, now: () => currentTime, randomBytes },
  );
  if (prepared.record.kind !== "connect") throw new TypeError("Prepared code kind mismatch");
  await dependencies.store.rotateConnectCode({
    connection,
    code: prepared.record,
    rotatedAt: currentTime,
    audit: audit("CONNECT_CODE_ROTATED", "SUCCESS", input.userId, connection.id, currentTime, randomBytes),
  });
  return { command: `/connect ${prepared.code}`, expiresAt: prepared.expiresAt };
}
