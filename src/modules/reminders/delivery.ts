import type {
  BotProvider,
  SendReceipt,
} from "@/modules/connections/contracts";
import { ProviderOperationError } from "@/modules/connections/provider-error";
import { sendProviderText } from "@/modules/inbound/processor";
import {
  cryptoRandomBytes,
  randomOpaqueId,
  systemClock,
  type Clock,
  type RandomBytes,
} from "@/modules/platform/types";
import type { EncryptedValue, Keyring } from "@/modules/security/keyring";
import { isSafeProviderToken } from "@/modules/connections/token-policy";
import { MAX_REMINDER_TITLE_CODE_UNITS } from "./parse-vietnamese";
import {
  DELIVERY_SEND_LEASE_MS,
  MAX_DELIVERY_ATTEMPTS,
} from "./scheduler";

export { DELIVERY_SEND_LEASE_MS } from "./scheduler";
export const QUOTA_FALLBACK_DELAYS_SECONDS = [60, 300, 1_800] as const;
const SAFE_PRE_PROVIDER_RETRY_SECONDS = 60;
const PROVIDER_TEXT_CODE_UNITS = 2_000;
const REMINDER_PREFIX = "⏰ Nhắc hẹn: ";

export type ReminderStatus =
  | "PENDING"
  | "CLAIMED"
  | "SENT"
  | "CANCELLED"
  | "FAILED"
  | "RETRYABLE"
  | "UNCERTAIN";

export type DeliveryStatus =
  | "PENDING"
  | "SENDING"
  | "SENT"
  | "RETRYABLE"
  | "FAILED"
  | "UNCERTAIN"
  | "CANCELLED";

export interface DeliveryContextRow {
  reminder_id: string;
  reminder_status: ReminderStatus;
  scheduled_at: number;
  title_ciphertext: unknown;
  title_iv: unknown;
  title_key_version: number;
  connection_id: string;
  connection_user_id: string;
  provider: BotProvider;
  connection_state: string;
  encrypted_token: unknown;
  encrypted_token_iv: unknown;
  credential_version: number;
  private_chat_id: string;
  delivery_id: string | null;
  delivery_status: DeliveryStatus | null;
  attempt_count: number | null;
  send_started_at: number | null;
  retry_not_before: number | null;
  delivery_marker: string | null;
}

export interface ReminderDeliveryContext {
  reminderId: string;
  reminderStatus: ReminderStatus;
  scheduledAt: number;
  encryptedTitle: EncryptedValue;
  titleKeyVersion: number;
  connectionId: string;
  connectionUserId: string;
  provider: BotProvider;
  connectionState: string;
  encryptedToken: EncryptedValue;
  credentialVersion: number;
  privateChatId: string;
  deliveryId: string | null;
  deliveryStatus: DeliveryStatus | null;
  attemptCount: number;
  sendStartedAt: number | null;
  retryNotBefore: number | null;
  deliveryMarker: string | null;
}

export interface OwnedDelivery {
  deliveryId: string;
  marker: string;
  attemptCount: number;
}

export type AcquireDeliveryResult =
  | { status: "OWNED"; delivery: OwnedDelivery }
  | { status: "RETRY_AFTER"; retryAfterSeconds: number }
  | { status: "NOOP" }
  | { status: "SENT" | "FAILED" | "UNCERTAIN" | "CANCELLED" }
  | { status: "MISSING" };

export interface FinalizeTerminalInput {
  reminderId: string;
  connectionId: string;
  marker: string;
  status: "FAILED" | "UNCERTAIN";
  safeErrorCode: string;
  suspendConnection: boolean;
  auditId: string;
  now: number;
}

export interface FailBeforeSendInput {
  reminderId: string;
  marker: string;
  deliveryId: string;
  safeErrorCode: string;
  auditId: string;
  now: number;
}

export interface ReminderDeliveryStore {
  read(reminderId: string): Promise<ReminderDeliveryContext | null>;
  acquire(
    reminderId: string,
    deliveryId: string,
    marker: string,
    now: number,
  ): Promise<AcquireDeliveryResult>;
  finalizeSuccess(
    reminderId: string,
    marker: string,
    providerReceipt: string | null,
    auditId: string,
    now: number,
  ): Promise<void>;
  finalizeTerminal(input: FinalizeTerminalInput): Promise<void>;
  scheduleRetry(
    reminderId: string,
    marker: string,
    retryNotBefore: number,
    auditId: string,
    now: number,
  ): Promise<void>;
  failBeforeSend(input: FailBeforeSendInput): Promise<boolean>;
  reconcileStaleSending(
    reminderId: string,
    auditId: string,
    now: number,
  ): Promise<boolean>;
  cancelBeforeSend(
    reminderId: string,
    marker: string,
    deliveryId: string,
    auditId: string,
    now: number,
  ): Promise<boolean>;
}

export function arrayBuffer(value: unknown): ArrayBuffer {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    return Uint8Array.from(
      new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
    ).buffer;
  }
  throw new TypeError("Malformed encrypted database value");
}

export function contextFromRow(row: DeliveryContextRow): ReminderDeliveryContext {
  return {
    reminderId: row.reminder_id,
    reminderStatus: row.reminder_status,
    scheduledAt: row.scheduled_at,
    encryptedTitle: {
      ciphertext: arrayBuffer(row.title_ciphertext),
      iv: arrayBuffer(row.title_iv),
    },
    titleKeyVersion: row.title_key_version,
    connectionId: row.connection_id,
    connectionUserId: row.connection_user_id,
    provider: row.provider,
    connectionState: row.connection_state,
    encryptedToken: {
      ciphertext: arrayBuffer(row.encrypted_token),
      iv: arrayBuffer(row.encrypted_token_iv),
    },
    credentialVersion: row.credential_version,
    privateChatId: row.private_chat_id,
    deliveryId: row.delivery_id,
    deliveryStatus: row.delivery_status,
    attemptCount: row.attempt_count ?? 0,
    sendStartedAt: row.send_started_at,
    retryNotBefore: row.retry_not_before,
    deliveryMarker: row.delivery_marker,
  };
}

export function expectedGuardConflict(error: unknown): boolean {
  return error instanceof Error
    && /NOT NULL constraint failed:\s*audit_events\.id/iu.test(error.message);
}

export function secondsUntil(timestamp: number, now: number): number {
  return Math.min(86_400, Math.max(1, Math.ceil((timestamp - now) / 1_000)));
}

type SendText = (
  provider: BotProvider,
  token: string,
  privateChatId: string,
  text: string,
) => Promise<SendReceipt>;

export interface DeliverReminderDependencies {
  store: ReminderDeliveryStore;
  keyring: Pick<Keyring, "decryptSensitive" | "decryptCredential">;
  sendText?: SendText;
  now?: Clock;
  randomBytes?: RandomBytes;
}

export type DeliverReminderResult =
  | { status: "SENT" | "FAILED" | "UNCERTAIN" | "CANCELLED" | "NOOP" | "MISSING" }
  | { status: "RETRYABLE" | "RETRY_AFTER"; retryAfterSeconds: number };

function terminalOutcome(context: ReminderDeliveryContext): DeliverReminderResult | null {
  if (context.deliveryStatus === "SENT" || context.reminderStatus === "SENT") {
    return { status: "SENT" };
  }
  if (context.deliveryStatus === "FAILED" || context.reminderStatus === "FAILED") {
    return { status: "FAILED" };
  }
  if (context.deliveryStatus === "UNCERTAIN" || context.reminderStatus === "UNCERTAIN") {
    return { status: "UNCERTAIN" };
  }
  if (context.deliveryStatus === "CANCELLED" || context.reminderStatus === "CANCELLED") {
    return { status: "CANCELLED" };
  }
  return null;
}

function quotaDelay(error: ProviderOperationError, attemptCount: number): number {
  const providerDelay = error.retryAfterSeconds;
  if (
    providerDelay !== null
    && Number.isInteger(providerDelay)
    && providerDelay >= 1
    && providerDelay <= 86_400
  ) {
    return providerDelay;
  }
  const fallback = QUOTA_FALLBACK_DELAYS_SECONDS[Math.min(
    Math.max(attemptCount - 1, 0),
    QUOTA_FALLBACK_DELAYS_SECONDS.length - 1,
  )];
  return Math.min(86_400, Math.max(1, fallback));
}

async function failBeforeProvider(
  reminderId: string,
  safeErrorCode: string,
  now: number,
  store: ReminderDeliveryStore,
  randomBytes: RandomBytes,
): Promise<DeliverReminderResult> {
  const changed = await store.failBeforeSend({
    reminderId,
    marker: randomOpaqueId(randomBytes),
    deliveryId: randomOpaqueId(randomBytes),
    safeErrorCode,
    auditId: randomOpaqueId(randomBytes),
    now,
  });
  if (changed) return { status: "FAILED" };
  const current = await store.read(reminderId);
  if (!current) return { status: "MISSING" };
  return terminalOutcome(current) ?? { status: "NOOP" };
}

export async function deliverReminder(
  reminderId: string,
  dependencies: DeliverReminderDependencies,
): Promise<DeliverReminderResult> {
  const now = dependencies.now ?? systemClock;
  const randomBytes = dependencies.randomBytes ?? cryptoRandomBytes;
  const startedAt = now();
  const context = await dependencies.store.read(reminderId);
  if (!context) {
    return failBeforeProvider(
      reminderId,
      "INVALID_REMINDER_TENANT",
      startedAt,
      dependencies.store,
      randomBytes,
    );
  }
  const terminal = terminalOutcome(context);
  if (terminal) return terminal;

  if (context.deliveryStatus === "SENDING") {
    if (
      context.sendStartedAt !== null
      && context.sendStartedAt < startedAt - DELIVERY_SEND_LEASE_MS
    ) {
      const reconciled = await dependencies.store.reconcileStaleSending(
        reminderId,
        randomOpaqueId(randomBytes),
        startedAt,
      );
      if (reconciled) return { status: "UNCERTAIN" };
      const raced = await dependencies.store.read(reminderId);
      if (!raced) return { status: "MISSING" };
      return terminalOutcome(raced) ?? { status: "NOOP" };
    }
    return { status: "NOOP" };
  }

  if (
    context.deliveryStatus === "RETRYABLE"
    && context.retryNotBefore !== null
    && context.retryNotBefore > startedAt
  ) {
    return {
      status: "RETRY_AFTER",
      retryAfterSeconds: secondsUntil(context.retryNotBefore, startedAt),
    };
  }

  if (context.connectionState !== "ACTIVE_BOUND") {
    return failBeforeProvider(
      reminderId,
      "CONNECTION_NOT_ACTIVE",
      startedAt,
      dependencies.store,
      randomBytes,
    );
  }

  let title: string;
  let token: string;
  try {
    title = await dependencies.keyring.decryptSensitive(
      "reminder-title",
      context.reminderId,
      context.titleKeyVersion,
      context.encryptedTitle,
    );
    token = await dependencies.keyring.decryptCredential(
      context.connectionId,
      context.provider,
      context.credentialVersion,
      context.encryptedToken,
    );
  } catch {
    return failBeforeProvider(
      reminderId,
      "INVALID_REMINDER_DATA",
      startedAt,
      dependencies.store,
      randomBytes,
    );
  }

  if (
    title.length < 1
    || title.length > MAX_REMINDER_TITLE_CODE_UNITS
    || !isSafeProviderToken(context.provider, token)
    || context.privateChatId.length < 1
  ) {
    return failBeforeProvider(
      reminderId,
      title.length > MAX_REMINDER_TITLE_CODE_UNITS ? "TITLE_TOO_LONG" : "INVALID_REMINDER_DATA",
      startedAt,
      dependencies.store,
      randomBytes,
    );
  }
  const text = `${REMINDER_PREFIX}${title}`;
  if (text.length > PROVIDER_TEXT_CODE_UNITS) {
    return failBeforeProvider(
      reminderId,
      "MESSAGE_TOO_LONG",
      startedAt,
      dependencies.store,
      randomBytes,
    );
  }

  const ownershipMarker = randomOpaqueId(randomBytes);
  const acquired = await dependencies.store.acquire(
    reminderId,
    randomOpaqueId(randomBytes),
    ownershipMarker,
    startedAt,
  );
  if (acquired.status !== "OWNED") return acquired;

  let receipt: SendReceipt;
  try {
    receipt = await (dependencies.sendText ?? sendProviderText)(
      context.provider,
      token,
      context.privateChatId,
      text,
    );
  } catch (error) {
    const completedAt = now();
    if (error instanceof ProviderOperationError && error.code === "QUOTA") {
      if (acquired.delivery.attemptCount >= MAX_DELIVERY_ATTEMPTS) {
        try {
          await dependencies.store.finalizeTerminal({
            reminderId,
            connectionId: context.connectionId,
            marker: ownershipMarker,
            status: "FAILED",
            safeErrorCode: "QUOTA_RETRY_EXHAUSTED",
            suspendConnection: false,
            auditId: randomOpaqueId(randomBytes),
            now: completedAt,
          });
          return { status: "FAILED" };
        } catch {
          return { status: "UNCERTAIN" };
        }
      }
      const retryAfterSeconds = quotaDelay(error, acquired.delivery.attemptCount);
      try {
        await dependencies.store.scheduleRetry(
          reminderId,
          ownershipMarker,
          completedAt + retryAfterSeconds * 1_000,
          randomOpaqueId(randomBytes),
          completedAt,
        );
        return { status: "RETRYABLE", retryAfterSeconds };
      } catch {
        return { status: "UNCERTAIN" };
      }
    }

    const credentialRejected = error instanceof ProviderOperationError
      && error.code === "REJECTED_CREDENTIAL";
    const uncertain = !(error instanceof ProviderOperationError)
      || error.code === "UNCERTAIN"
      || error.code === "INVALID_RESPONSE";
    const status = uncertain ? "UNCERTAIN" : "FAILED";
    const safeErrorCode = error instanceof ProviderOperationError
      ? error.code
      : "UNCERTAIN";
    try {
      await dependencies.store.finalizeTerminal({
        reminderId,
        connectionId: context.connectionId,
        marker: ownershipMarker,
        status,
        safeErrorCode,
        suspendConnection: credentialRejected,
        auditId: randomOpaqueId(randomBytes),
        now: completedAt,
      });
      return { status };
    } catch {
      return { status: "UNCERTAIN" };
    }
  }

  try {
    await dependencies.store.finalizeSuccess(
      reminderId,
      ownershipMarker,
      receipt.providerMessageId,
      randomOpaqueId(randomBytes),
      now(),
    );
    return { status: "SENT" };
  } catch {
    // The provider may have accepted the message. Leave the owned SENDING row
    // intact so a later reconciliation can mark it UNCERTAIN without resending.
    return { status: "UNCERTAIN" };
  }
}

export interface CancelReminderDependencies {
  store: Pick<ReminderDeliveryStore, "cancelBeforeSend" | "read">;
  now?: Clock;
  randomBytes?: RandomBytes;
}

export type CancelReminderResult = {
  status: "CANCELLED" | "TOO_LATE" | "TERMINAL" | "MISSING";
};

export async function cancelReminderBeforeSend(
  reminderId: string,
  dependencies: CancelReminderDependencies,
): Promise<CancelReminderResult> {
  const now = dependencies.now ?? systemClock;
  const randomBytes = dependencies.randomBytes ?? cryptoRandomBytes;
  const cancelled = await dependencies.store.cancelBeforeSend(
    reminderId,
    randomOpaqueId(randomBytes),
    randomOpaqueId(randomBytes),
    randomOpaqueId(randomBytes),
    now(),
  );
  if (cancelled) return { status: "CANCELLED" };

  const current = await dependencies.store.read(reminderId);
  if (!current) return { status: "MISSING" };
  if (current.deliveryStatus === "SENDING" || current.reminderStatus === "CLAIMED") {
    return { status: "TOO_LATE" };
  }
  if (current.reminderStatus === "CANCELLED") return { status: "CANCELLED" };
  return { status: "TERMINAL" };
}

export const SAFE_QUEUE_RETRY_SECONDS = SAFE_PRE_PROVIDER_RETRY_SECONDS;
