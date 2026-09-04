import {
  cryptoRandomBytes,
  randomOpaqueId,
  systemClock,
  type Clock,
  type RandomBytes,
} from "@/modules/platform/types";
import type { EncryptedValue, Keyring } from "@/modules/security/keyring";
import {
  MAX_REMINDER_TITLE_CODE_UNITS,
  parseVietnameseReminder,
  type ParsedReminderCandidate,
} from "./parse-vietnamese";

const CONFIRM_WORDS = new Set(["có", "ok", "1", "xác nhận"]);
const CANCEL_WORDS = new Set(["hủy", "huỷ", "không", "2"]);
const DRAFT_LIFETIME_MS = 10 * 60 * 1_000;
const MAX_PROVIDER_CLOCK_SKEW_MS = 5 * 60 * 1_000;
const MAX_PROVIDER_REPLY_LENGTH = 2_000;
const TITLE_KEY_VERSION = 1;

const HELP_REPLY = [
  "Chưa hiểu lời nhắc. Ví dụ: mai 8h nhắc tôi gọi cho mẹ.",
  "Calenote hỗ trợ hôm nay, mai, ngày kia hoặc DD/MM, cùng giờ dạng 8h hoặc 15:30.",
].join(" ");
const IDENTITY_REPLY = "Cuộc trò chuyện này chưa được liên kết đúng với Calenote. Hãy tạo mã /connect mới trên trang Calenote.";
const NO_PENDING_REPLY = "Không còn lời nhắc nào đang chờ xác nhận.";
const EXPIRED_REPLY = "Lời nhắc chờ xác nhận đã hết hạn. Hãy gửi lại nội dung nhắc.";
const CONFIRMED_REPLY = "Đã xác nhận lời nhắc.";
const CANCELLED_REPLY = "Đã hủy lời nhắc đang chờ xác nhận.";

export interface BoundChatMessage {
  id: string;
  connectionId: string;
  providerUserId: string;
  privateChatId: string;
  text: string;
  receivedAt: number;
  claimMarker: string;
}

export interface BoundChatContext {
  chatIdentityId: string;
  userId: string;
  workspaceId: string;
  timezone: string;
  inboundRowId: number;
}

export interface PendingDraft {
  id: string;
  chatIdentityId: string;
  sourceInboundId: string;
  encryptedTitle: EncryptedValue;
  titleKeyVersion: number;
  scheduledAt: number;
  timezone: string;
  expiresAt: number;
}

interface CommandMutationBase {
  message: BoundChatMessage;
  context: BoundChatContext;
  now: number;
  auditId: string;
}

export interface CreateDraftMutation extends CommandMutationBase {
  draftId: string;
  encryptedTitle: EncryptedValue;
  titleKeyVersion: number;
  scheduledAt: number;
  timezone: string;
  expiresAt: number;
}

export interface ConfirmDraftMutation extends CommandMutationBase {
  draft: PendingDraft;
  reminderId: string;
  reminderPublicId: string;
  encryptedTitle: EncryptedValue;
  titleKeyVersion: number;
}

export interface ResolveDraftMutation extends CommandMutationBase {
  draft: PendingDraft;
}

export type MutationResult = "COMMITTED" | "CONFLICT" | "SUPERSEDED";

export interface ReminderCommandStore {
  findBoundContext(message: BoundChatMessage): Promise<BoundChatContext | null>;
  findPendingDraft(message: BoundChatMessage, chatIdentityId: string): Promise<PendingDraft | null>;
  createDraft(input: CreateDraftMutation): Promise<MutationResult>;
  confirmDraft(input: ConfirmDraftMutation): Promise<MutationResult>;
  cancelDraft(input: ResolveDraftMutation): Promise<MutationResult>;
  expireDraft(input: ResolveDraftMutation): Promise<MutationResult>;
  rejectMessage(message: BoundChatMessage, auditId: string, now: number): Promise<boolean>;
}

export interface ProcessBoundChatDependencies {
  store: ReminderCommandStore;
  keyring: Pick<Keyring, "encryptSensitive" | "decryptSensitive">;
  reply(text: string): Promise<void>;
  now?: Clock;
  randomBytes?: RandomBytes;
}

export type ProcessBoundChatResult =
  | { status: "DRAFT_CREATED" }
  | { status: "CONFIRMED" }
  | { status: "CANCELLED" }
  | { status: "EXPIRED" }
  | { status: "REJECTED" }
  | { status: "SUPERSEDED" };

function normalizeWholeMessage(text: string): string {
  return text
    .normalize("NFC")
    .trim()
    .toLocaleLowerCase("vi-VN");
}

function draftReply(candidate: ParsedReminderCandidate): string {
  if (candidate.title.length > MAX_REMINDER_TITLE_CODE_UNITS) {
    throw new TypeError("Reminder title exceeds reply-safe limit");
  }
  const local = new Date(candidate.scheduledAt + 7 * 60 * 60 * 1_000);
  const day = String(local.getUTCDate()).padStart(2, "0");
  const month = String(local.getUTCMonth() + 1).padStart(2, "0");
  const year = String(local.getUTCFullYear());
  const hour = String(local.getUTCHours()).padStart(2, "0");
  const minute = String(local.getUTCMinutes()).padStart(2, "0");
  const reply = `Calenote hiểu: ${hour}:${minute} ${day}/${month}/${year} — ${candidate.title}. Gửi “có” để xác nhận hoặc “hủy” để bỏ.`;
  if (reply.length > MAX_PROVIDER_REPLY_LENGTH) {
    throw new TypeError("Provider reply exceeds safe limit");
  }
  return reply;
}

async function bestEffortReply(
  dependencies: ProcessBoundChatDependencies,
  text: string,
): Promise<void> {
  try {
    await dependencies.reply(text);
  } catch {
    // The database is already terminal. Ambiguous provider outcomes are not retried.
  }
}

async function rejectWithReply(
  message: BoundChatMessage,
  reply: string,
  now: number,
  dependencies: ProcessBoundChatDependencies,
  randomBytes: RandomBytes,
): Promise<ProcessBoundChatResult> {
  const rejected = await dependencies.store.rejectMessage(
    message,
    randomOpaqueId(randomBytes),
    now,
  );
  if (!rejected) return { status: "SUPERSEDED" };
  await bestEffortReply(dependencies, reply);
  return { status: "REJECTED" };
}

async function rejectResolutionConflict(
  message: BoundChatMessage,
  now: number,
  dependencies: ProcessBoundChatDependencies,
  randomBytes: RandomBytes,
): Promise<ProcessBoundChatResult> {
  return rejectWithReply(message, NO_PENDING_REPLY, now, dependencies, randomBytes);
}

export async function processBoundChatMessage(
  message: BoundChatMessage,
  dependencies: ProcessBoundChatDependencies,
): Promise<ProcessBoundChatResult> {
  const now = dependencies.now ?? systemClock;
  const randomBytes = dependencies.randomBytes ?? cryptoRandomBytes;
  const processingNow = now();
  const context = await dependencies.store.findBoundContext(message);
  if (!context) {
    return rejectWithReply(message, IDENTITY_REPLY, processingNow, dependencies, randomBytes);
  }
  if (message.receivedAt > processingNow + MAX_PROVIDER_CLOCK_SKEW_MS) {
    return rejectWithReply(message, HELP_REPLY, processingNow, dependencies, randomBytes);
  }

  const normalized = normalizeWholeMessage(message.text);
  if (CONFIRM_WORDS.has(normalized) || CANCEL_WORDS.has(normalized)) {
    const draft = await dependencies.store.findPendingDraft(message, context.chatIdentityId);
    if (!draft) {
      return rejectResolutionConflict(message, processingNow, dependencies, randomBytes);
    }
    const mutationBase: ResolveDraftMutation = {
      message,
      context,
      draft,
      now: processingNow,
      auditId: randomOpaqueId(randomBytes),
    };
    if (draft.expiresAt <= processingNow || draft.scheduledAt <= processingNow) {
      const result = await dependencies.store.expireDraft(mutationBase);
      if (result === "SUPERSEDED") return { status: "SUPERSEDED" };
      if (result === "CONFLICT") {
        return rejectResolutionConflict(message, processingNow, dependencies, randomBytes);
      }
      await bestEffortReply(dependencies, EXPIRED_REPLY);
      return { status: "EXPIRED" };
    }

    if (CANCEL_WORDS.has(normalized)) {
      const result = await dependencies.store.cancelDraft(mutationBase);
      if (result === "SUPERSEDED") return { status: "SUPERSEDED" };
      if (result === "CONFLICT") {
        return rejectResolutionConflict(message, processingNow, dependencies, randomBytes);
      }
      await bestEffortReply(dependencies, CANCELLED_REPLY);
      return { status: "CANCELLED" };
    }

    const title = await dependencies.keyring.decryptSensitive(
      "draft-title",
      draft.id,
      draft.titleKeyVersion,
      draft.encryptedTitle,
    );
    if (title.length > MAX_REMINDER_TITLE_CODE_UNITS) {
      throw new TypeError("Stored reminder title exceeds safe limit");
    }
    const reminderId = randomOpaqueId(randomBytes);
    const reminderPublicId = randomOpaqueId(randomBytes);
    const encryptedTitle = await dependencies.keyring.encryptSensitive(
      "reminder-title",
      reminderId,
      TITLE_KEY_VERSION,
      title,
    );
    const result = await dependencies.store.confirmDraft({
      ...mutationBase,
      reminderId,
      reminderPublicId,
      encryptedTitle,
      titleKeyVersion: TITLE_KEY_VERSION,
    });
    if (result === "SUPERSEDED") return { status: "SUPERSEDED" };
    if (result === "CONFLICT") {
      return rejectResolutionConflict(message, processingNow, dependencies, randomBytes);
    }
    await bestEffortReply(dependencies, CONFIRMED_REPLY);
    return { status: "CONFIRMED" };
  }

  const parsed = parseVietnameseReminder(message.text, message.receivedAt, context.timezone);
  if (!parsed.ok || parsed.candidate.scheduledAt <= processingNow) {
    return rejectWithReply(message, HELP_REPLY, processingNow, dependencies, randomBytes);
  }

  const draftId = randomOpaqueId(randomBytes);
  const encryptedTitle = await dependencies.keyring.encryptSensitive(
    "draft-title",
    draftId,
    TITLE_KEY_VERSION,
    parsed.candidate.title,
  );
  const result = await dependencies.store.createDraft({
    message,
    context,
    draftId,
    encryptedTitle,
    titleKeyVersion: TITLE_KEY_VERSION,
    scheduledAt: parsed.candidate.scheduledAt,
    timezone: parsed.candidate.timezone,
    expiresAt: Math.min(processingNow + DRAFT_LIFETIME_MS, parsed.candidate.scheduledAt),
    now: processingNow,
    auditId: randomOpaqueId(randomBytes),
  });
  if (result === "SUPERSEDED") return { status: "SUPERSEDED" };
  if (result === "CONFLICT") {
    return rejectWithReply(message, HELP_REPLY, processingNow, dependencies, randomBytes);
  }
  await bestEffortReply(dependencies, draftReply(parsed.candidate));
  return { status: "DRAFT_CREATED" };
}
