import {
  cryptoRandomBytes,
  randomOpaqueId,
  systemClock,
  type Clock,
  type RandomBytes,
} from "@/modules/platform/types";
import type { EncryptedValue, Keyring } from "@/modules/security/keyring";
import type { RateLimitStore } from "@/modules/rate-limit/service";
import { consumeRateLimit } from "@/modules/rate-limit/service";
import { RateLimitExceededError } from "@/modules/onboarding/service";
import {
  MAX_REMINDER_TITLE_CODE_UNITS,
  VIETNAM_TIMEZONE,
} from "./parse-vietnamese";

const MAX_SCHEDULE_AHEAD_MS = 366 * 24 * 60 * 60_000;
const REMINDER_TITLE_KEY_VERSION = 1;
const MAX_LISTED_REMINDERS = 100;

export type PublicReminderStatus =
  | "PENDING"
  | "CLAIMED"
  | "RETRYABLE"
  | "SENT"
  | "FAILED"
  | "UNCERTAIN"
  | "CANCELLED";

export interface PublicReminder {
  publicId: string;
  title: string;
  scheduledAt: number;
  timezone: typeof VIETNAM_TIMEZONE;
  status: PublicReminderStatus;
}

export interface OwnedReminderRow {
  id: string;
  public_id: string;
  title_ciphertext: unknown;
  title_iv: unknown;
  title_key_version: number;
  scheduled_at: number;
  timezone: typeof VIETNAM_TIMEZONE;
  status: PublicReminderStatus;
}

export interface CancellationRow {
  id: string;
  status: PublicReminderStatus;
  delivery_status: string | null;
}

export interface ManualReminderRecord {
  id: string;
  publicId: string;
  userId: string;
  encryptedTitle: EncryptedValue;
  titleKeyVersion: number;
  scheduledAt: number;
  timezone: typeof VIETNAM_TIMEZONE;
  auditId: string;
  now: number;
}

export interface ReminderApiStore {
  listOwned(userId: string, limit: number): Promise<OwnedReminderRow[]>;
  createManual(record: ManualReminderRecord): Promise<boolean>;
  findOwnedForCancellation(userId: string, publicId: string): Promise<CancellationRow | null>;
  cancelOwned(input: {
    userId: string;
    publicId: string;
    marker: string;
    deliveryId: string;
    auditId: string;
    now: number;
  }): Promise<boolean>;
}

function arrayBuffer(value: unknown): ArrayBuffer {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    return Uint8Array.from(
      new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
    ).buffer;
  }
  throw new TypeError("Malformed encrypted reminder value");
}

class ReminderApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class InvalidReminderError extends ReminderApiError {
  constructor() {
    super("INVALID_REMINDER", 400, "Thông tin nhắc hẹn chưa hợp lệ.");
    this.name = "InvalidReminderError";
  }
}

export class ReminderChannelUnavailableError extends ReminderApiError {
  constructor() {
    super(
      "REMINDER_CHANNEL_UNAVAILABLE",
      409,
      "Hãy kết nối một cuộc trò chuyện riêng trước khi tạo nhắc hẹn.",
    );
    this.name = "ReminderChannelUnavailableError";
  }
}

export class ReminderNotFoundError extends ReminderApiError {
  constructor() {
    super("REMINDER_NOT_FOUND", 404, "Không tìm thấy nhắc hẹn.");
    this.name = "ReminderNotFoundError";
  }
}

export class ReminderNotCancellableError extends ReminderApiError {
  constructor() {
    super("REMINDER_NOT_CANCELLABLE", 409, "Nhắc hẹn này không còn có thể hủy.");
    this.name = "ReminderNotCancellableError";
  }
}

export async function listPublicReminders(
  userId: string,
  dependencies: {
    store: ReminderApiStore;
    keyring: Pick<Keyring, "decryptSensitive">;
  },
): Promise<PublicReminder[]> {
  const rows = await dependencies.store.listOwned(userId, MAX_LISTED_REMINDERS);
  const reminders: PublicReminder[] = [];
  for (const row of rows) {
    const title = await dependencies.keyring.decryptSensitive(
      "reminder-title",
      row.id,
      row.title_key_version,
      {
        ciphertext: arrayBuffer(row.title_ciphertext),
        iv: arrayBuffer(row.title_iv),
      },
    );
    reminders.push({
      publicId: row.public_id,
      title,
      scheduledAt: row.scheduled_at,
      timezone: row.timezone,
      status: row.status,
    });
  }
  return reminders;
}

export function normalizeManualReminderTitle(value: string): string {
  return value
    .normalize("NFC")
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/gu, " ").trim())
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

export async function createManualReminder(
  input: {
    userId: string;
    title: string;
    scheduledAt: number;
    timezone: string;
  },
  dependencies: {
    store: ReminderApiStore;
    keyring: Pick<Keyring, "encryptSensitive" | "digestCode">;
    rateLimitStore: RateLimitStore;
    now?: Clock;
    randomBytes?: RandomBytes;
  },
): Promise<PublicReminder> {
  const now = dependencies.now ?? systemClock;
  const randomBytes = dependencies.randomBytes ?? cryptoRandomBytes;
  const createdAt = now();
  const title = typeof input.title === "string"
    ? normalizeManualReminderTitle(input.title)
    : "";
  if (
    input.userId.length === 0
    || title.length === 0
    || title.length > MAX_REMINDER_TITLE_CODE_UNITS
    || input.timezone !== VIETNAM_TIMEZONE
    || !Number.isSafeInteger(input.scheduledAt)
    || input.scheduledAt <= createdAt
    || input.scheduledAt - createdAt > MAX_SCHEDULE_AHEAD_MS
  ) {
    throw new InvalidReminderError();
  }

  const subjectDigest = await dependencies.keyring.digestCode(
    `rate-limit:reminder-create:${input.userId}`,
  );
  const rate = await consumeRateLimit(
    { subjectDigest, scope: "reminder-create", limit: 30, windowMs: 60_000 },
    { store: dependencies.rateLimitStore, now: () => createdAt },
  );
  if (!rate.allowed) {
    throw new RateLimitExceededError(
      Math.max(1, Math.ceil((rate.resetAt - createdAt) / 1_000)),
    );
  }

  const id = randomOpaqueId(randomBytes);
  const publicId = randomOpaqueId(randomBytes);
  const encryptedTitle = await dependencies.keyring.encryptSensitive(
    "reminder-title",
    id,
    REMINDER_TITLE_KEY_VERSION,
    title,
  );
  const committed = await dependencies.store.createManual({
    id,
    publicId,
    userId: input.userId,
    encryptedTitle,
    titleKeyVersion: REMINDER_TITLE_KEY_VERSION,
    scheduledAt: input.scheduledAt,
    timezone: VIETNAM_TIMEZONE,
    auditId: randomOpaqueId(randomBytes),
    now: createdAt,
  });
  if (!committed) throw new ReminderChannelUnavailableError();
  return {
    publicId,
    title,
    scheduledAt: input.scheduledAt,
    timezone: VIETNAM_TIMEZONE,
    status: "PENDING",
  };
}

function cancellationConflict(row: CancellationRow): ReminderNotCancellableError | null {
  if (row.status === "CANCELLED") return null;
  if (
    row.delivery_status === "SENDING"
    || row.delivery_status === "SENT"
    || row.delivery_status === "FAILED"
    || row.delivery_status === "UNCERTAIN"
    || row.delivery_status === "CANCELLED"
    || row.status === "SENT"
    || row.status === "FAILED"
    || row.status === "UNCERTAIN"
  ) {
    return new ReminderNotCancellableError();
  }
  return null;
}

export async function cancelPublicReminder(
  userId: string,
  publicId: string,
  dependencies: {
    store: ReminderApiStore;
    keyring: Pick<Keyring, "digestCode">;
    rateLimitStore: RateLimitStore;
    now?: Clock;
    randomBytes?: RandomBytes;
  },
): Promise<{ cancelled: true }> {
  const now = dependencies.now ?? systemClock;
  const cancellationTime = now();
  const subjectDigest = await dependencies.keyring.digestCode(
    `rate-limit:reminder-cancel:${userId}`,
  );
  const rate = await consumeRateLimit(
    { subjectDigest, scope: "reminder-cancel", limit: 30, windowMs: 60_000 },
    { store: dependencies.rateLimitStore, now: () => cancellationTime },
  );
  if (!rate.allowed) {
    throw new RateLimitExceededError(
      Math.max(1, Math.ceil((rate.resetAt - cancellationTime) / 1_000)),
    );
  }
  const current = await dependencies.store.findOwnedForCancellation(userId, publicId);
  if (!current) throw new ReminderNotFoundError();
  const conflict = cancellationConflict(current);
  if (conflict) throw conflict;
  if (current.status === "CANCELLED") return { cancelled: true };

  const randomBytes = dependencies.randomBytes ?? cryptoRandomBytes;
  const cancelled = await dependencies.store.cancelOwned({
    userId,
    publicId,
    marker: randomOpaqueId(randomBytes),
    deliveryId: randomOpaqueId(randomBytes),
    auditId: randomOpaqueId(randomBytes),
    now: cancellationTime,
  });
  if (cancelled) return { cancelled: true };

  const raced = await dependencies.store.findOwnedForCancellation(userId, publicId);
  if (!raced) throw new ReminderNotFoundError();
  if (raced.status === "CANCELLED") return { cancelled: true };
  throw cancellationConflict(raced) ?? new ReminderNotCancellableError();
}
