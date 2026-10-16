import {
  cryptoRandomBytes,
  randomOpaqueId,
  systemClock,
  type Clock,
  type RandomBytes,
} from "@/modules/platform/types";
import type { EncryptedValue, Keyring } from "@/modules/security/keyring";
import { persistedD1Blob } from "@/modules/db/persisted-blob";
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
  intentId?: string;
  payloadDigest?: string;
  now: number;
}

export interface ReminderApiStore {
  listOwned(userId: string, limit: number, after?: string | null): Promise<OwnedReminderRow[]>;
  findManualIntent(userId: string, intentId: string): Promise<{ payload_digest: string | null; state: "CREATED" | "ABANDONED"; public_id: string; status: PublicReminderStatus } | null>;
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

class ReminderApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class ReminderIntentConflictError extends ReminderApiError {
  constructor(code: "REMINDER_INTENT_ABANDONED" | "REMINDER_INTENT_MISMATCH") {
    super(code, 409, code === "REMINDER_INTENT_ABANDONED"
      ? "Yêu cầu trước đã đóng. Hãy thử tạo lại."
      : "Yêu cầu này đã được dùng cho nội dung khác. Hãy kiểm tra danh sách nhắc hẹn.");
    this.name = "ReminderIntentConflictError";
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
  options: { after?: string; limit: number } = { limit: MAX_LISTED_REMINDERS },
): Promise<PublicReminder[]> {
  if ((options.after !== undefined && !/^[A-Za-z0-9_-]{1,128}$/u.test(options.after)) || !Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 101) throw new InvalidReminderError();
  const rows = await dependencies.store.listOwned(userId, options.limit, options.after ?? null);
  const reminders: PublicReminder[] = [];
  for (const row of rows) {
    const title = await dependencies.keyring.decryptSensitive(
      "reminder-title",
      row.id,
      row.title_key_version,
      {
        ciphertext: persistedD1Blob(row.title_ciphertext),
        iv: persistedD1Blob(row.title_iv),
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
    intentId?: string;
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
    || title.length > Math.min(MAX_REMINDER_TITLE_CODE_UNITS, 500)
    || (input.intentId !== undefined && !/^[A-Za-z0-9_-]{16,80}$/u.test(input.intentId))
    || input.timezone !== VIETNAM_TIMEZONE
    || !Number.isSafeInteger(input.scheduledAt)

  ) {
    throw new InvalidReminderError();
  }

  const payloadDigest = input.intentId ? await dependencies.keyring.digestCode(
    JSON.stringify(["manual-reminder-intent-v1", input.userId, title, input.scheduledAt, input.timezone]),
  ) : undefined;
  const replay = async (): Promise<PublicReminder | null> => {
    if (!input.intentId) return null;
    const existing = await dependencies.store.findManualIntent(input.userId, input.intentId);
    if (!existing) return null;
    if (existing.state === "ABANDONED") throw new ReminderIntentConflictError("REMINDER_INTENT_ABANDONED");
    if (existing.payload_digest !== payloadDigest) throw new ReminderIntentConflictError("REMINDER_INTENT_MISMATCH");
    return { publicId: existing.public_id, title, scheduledAt: input.scheduledAt, timezone: VIETNAM_TIMEZONE, status: existing.status };
  };
  const existing = await replay();
  if (existing) return existing;
  if (input.scheduledAt <= createdAt || input.scheduledAt - createdAt > MAX_SCHEDULE_AHEAD_MS) throw new InvalidReminderError();

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
  let committed: boolean;
  try { committed = await dependencies.store.createManual({
    id,
    publicId,
    userId: input.userId,
    encryptedTitle,
    titleKeyVersion: REMINDER_TITLE_KEY_VERSION,
    scheduledAt: input.scheduledAt,
    timezone: VIETNAM_TIMEZONE,
    auditId: randomOpaqueId(randomBytes),
    intentId: input.intentId,
    payloadDigest,
    now: createdAt,
  }); } catch (error) {
    const raced = await replay();
    if (raced) return raced;
    throw error;
  }
  if (!committed) throw new ReminderChannelUnavailableError();
  return {
    publicId,
    title,
    scheduledAt: input.scheduledAt,
    timezone: VIETNAM_TIMEZONE,
    status: "PENDING",
  };
}

export async function resolveManualReminderIntent(
  input: { userId: string; intentId: string },
  dependencies: { store: ReminderApiStore & { resolveManualIntent(userId: string, intentId: string): Promise<{ state: "CREATED" | "ABANDONED"; publicId?: string }> }; keyring: Pick<Keyring, "digestCode">; rateLimitStore: RateLimitStore; now?: Clock },
): Promise<{ state: "CREATED" | "ABANDONED"; publicId?: string }> {
  if (!/^[A-Za-z0-9_-]{16,80}$/u.test(input.intentId)) throw new InvalidReminderError();
  const existing = await dependencies.store.findManualIntent(input.userId, input.intentId);
  if (existing) return existing.state === "CREATED" ? { state: "CREATED", publicId: existing.public_id } : { state: "ABANDONED" };
  const now = dependencies.now ?? systemClock;
  const at = now();
  const subjectDigest = await dependencies.keyring.digestCode(`rate-limit:reminder-resolve:${input.userId}`);
  const rate = await consumeRateLimit({ subjectDigest, scope: "reminder-resolve", limit: 30, windowMs: 60_000 }, { store: dependencies.rateLimitStore, now: () => at });
  if (!rate.allowed) throw new RateLimitExceededError(Math.max(1, Math.ceil((rate.resetAt - at) / 1000)));
  return dependencies.store.resolveManualIntent(input.userId, input.intentId);
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
