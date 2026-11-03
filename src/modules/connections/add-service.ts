import { z } from "zod";
import { prepareOneTimeCode } from "@/modules/auth/codes";
import { cryptoRandomBytes, randomOpaqueId, systemClock } from "@/modules/platform/types";
import { consumeRateLimit, type RateLimitStore } from "@/modules/rate-limit/service";
import { OnboardingInputError, RateLimitExceededError, WebhookActivationInternalError,
  type AccountGraph, type OnboardingDependencies, type OnboardingResult, type OnboardingStore, type SafeAuditEvent } from "@/modules/onboarding/service";
import { ProviderOperationError, ProviderVerificationError } from "./provider-error";

export const AddConnectionInputSchema = z.object({provider: z.enum(["zalo", "telegram"]), token: z.string().min(1).max(512)}).strict();
export type AddConnectionInput = z.infer<typeof AddConnectionInputSchema>;
export type AddConnectionResult = Omit<OnboardingResult, "sessionCookie">;
export interface AddConnectionStore extends Pick<OnboardingStore, "activateConnection" | "failActivation"> {
  commitOwnedConnection(connection: AccountGraph["connection"], audit: SafeAuditEvent): Promise<void>;
}
export type AddConnectionDependencies = Omit<OnboardingDependencies, "store"> & {store: AddConnectionStore; rateLimitStore: RateLimitStore};

export async function addConnection(userId: string, rawInput: unknown, deps: AddConnectionDependencies): Promise<AddConnectionResult> {
  const parsed = AddConnectionInputSchema.safeParse(rawInput);
  if (!parsed.success || !userId) throw new OnboardingInputError();
  const input = parsed.data;
  const now = deps.now ?? systemClock;
  const createdAt = now();
  const randomBytes = deps.randomBytes ?? cryptoRandomBytes;
  const id = () => randomOpaqueId(randomBytes);
  const subjectDigest = await deps.keyring.digestCode(`rate-limit:add-connection:${userId}`);
  const limited = await consumeRateLimit({subjectDigest, scope: "add-connection", limit: 3, windowMs: 10 * 60_000}, {store: deps.rateLimitStore, now: () => createdAt});
  if (!limited.allowed) throw new RateLimitExceededError(Math.max(1, Math.ceil((limited.resetAt - createdAt) / 1_000)));
  const profile = await deps.verifyToken(input.provider, input.token);
  if (profile.provider !== input.provider) throw new ProviderVerificationError("INVALID_PROVIDER_RESPONSE");
  const connectionId = id();
  const publicId = id();
  const marker = id();
  const encrypted = await deps.keyring.encryptCredential(connectionId, input.provider, 1, input.token);
  const audit = (action: SafeAuditEvent["action"], result: SafeAuditEvent["result"], at: number): SafeAuditEvent => ({id: id(), actorUserId: userId, action, targetUserId: userId, targetConnectionId: connectionId, result, createdAt: at});
  await deps.store.commitOwnedConnection({id: connectionId, userId, provider: input.provider, publicId,
    providerBotId: profile.providerBotId, displayName: profile.displayName, handle: profile.handle,
    accountType: profile.accountType, canJoinGroups: profile.canJoinGroups,
    encryptedToken: encrypted.ciphertext, encryptedTokenIv: encrypted.iv,
    tokenFingerprint: await deps.keyring.fingerprintToken(input.token), credentialVersion: 1,
    state: "VALIDATING", transitionMarker: marker, createdAt}, audit("CONNECTION_ADDED", "SUCCESS", createdAt));
  const bot = {publicId, provider: input.provider, displayName: profile.displayName, handle: profile.handle};
  const secrets = await deps.keyring.webhookSecrets(publicId);
  const origin = new URL(deps.appOrigin);
  if (origin.origin !== deps.appOrigin || origin.origin === "null") throw new WebhookActivationInternalError();
  try {
    await deps.registerWebhook(input.provider, input.token, {url: `${origin.origin}/webhooks/${input.provider}/${publicId}/${secrets.pathSecret}`, secretToken: secrets.headerSecret});
  } catch (error) {
    if (!(error instanceof ProviderOperationError)) throw new WebhookActivationInternalError();
    const state = error.code === "REJECTED_CREDENTIAL" ? "SUSPENDED" : "WEBHOOK_FAILED";
    const at = now();
    await deps.store.failActivation({connectionId, userId, state, expectedMarker: marker, failedAt: at, auditResult: "FAILURE", audit: audit("WEBHOOK_ACTIVATION_FAILED", "FAILURE", at)});
    return {bot: {...bot, state}, connectCommand: null, connectCodeExpiresAt: null, activationCode: "WEBHOOK_ACTIVATION_FAILED"};
  }
  const at = now();
  const code = await prepareOneTimeCode({kind: "connect", userId, connectionId}, {keyring: deps.keyring, now: () => at, randomBytes});
  if (code.record.kind !== "connect") throw new WebhookActivationInternalError();
  await deps.store.activateConnection({connectionId, userId, registeredAt: at, expectedMarker: marker, code: code.record, audit: audit("WEBHOOK_ACTIVATED", "SUCCESS", at)});
  return {bot: {...bot, state: "ACTIVE_UNBOUND"}, connectCommand: `/connect ${code.code}`, connectCodeExpiresAt: code.expiresAt, activationCode: null};
}
