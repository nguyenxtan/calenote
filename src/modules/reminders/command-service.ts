import {
  cryptoRandomBytes,
  randomOpaqueId,
  systemClock,
  type Clock,
  type RandomBytes,
} from "@/modules/platform/types";
import type { EncryptedValue, Keyring } from "@/modules/security/keyring";
import {
  interpretReminderDeterministicallyFirst,
  type IntelligenceResolution,
} from "@/modules/intelligence/service";
import type { IntelligenceGateway, IntelligenceMode } from "@/modules/intelligence/contracts";
import type { createSemanticService } from "@/modules/semantic/service";
import type { SemanticContextStore, SemanticContextSlots } from "@/modules/semantic/context-store";
import { semanticQueryRange, type QueriedReminder, type SemanticReminderQuery } from "./semantic-query";
import {
  MAX_REMINDER_TITLE_CODE_UNITS,
  parseVietnameseReminder,
  type ParsedReminderCandidate,
} from "./parse-vietnamese";

const CONFIRM_WORDS = new Set(["có", "ok", "1", "xác nhận"]);
const CANCEL_WORDS = new Set(["hủy", "huỷ", "không", "2"]);
const HELP_WORDS = new Set(["help", "/help", "trợ giúp", "hướng dẫn"]);
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
  enforceConversationOrder?: boolean;
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
  rejectMessage(message: BoundChatMessage, auditId: string, now: number, enforceConversationOrder?: boolean): Promise<boolean>;
}

export interface ProcessBoundChatDependencies {
  store: ReminderCommandStore;
  keyring: Pick<Keyring, "encryptSensitive" | "decryptSensitive">;
  reply(text: string): Promise<void>;
  now?: Clock;
  randomBytes?: RandomBytes;
  intelligence?: { mode: IntelligenceMode; gateway: IntelligenceGateway; sensitiveValues?: readonly string[] };
  semantic?: BoundChatSemanticDependencies;
  processingFeedback?: () => Promise<void>;
}

export interface BoundChatSemanticDependencies {
  service: ReturnType<typeof createSemanticService>;
  contextStore: SemanticContextStore;
  complete(message: BoundChatMessage, context: BoundChatContext, now: number): Promise<boolean>;
  list(input: SemanticReminderQuery): Promise<QueriedReminder[]>;
}

export type ProcessBoundChatResult =
  | { status: "DRAFT_CREATED" }
  | { status: "CLARIFICATION_REQUESTED" }
  | { status: "REMINDERS_LISTED" }
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
    dependencies.semantic !== undefined,
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

async function semanticCommand(
  message: BoundChatMessage,
  context: BoundChatContext,
  dependencies: ProcessBoundChatDependencies,
  semantic: BoundChatSemanticDependencies,
  now: Clock,
  randomBytes: RandomBytes,
): Promise<ParsedReminderCandidate | ProcessBoundChatResult> {
  const scope = { ownerId: context.userId, chatIdentityId: context.chatIdentityId, now: now() };
  if (context.timezone !== "Asia/Ho_Chi_Minh") {
    return rejectWithReply(message, HELP_REPLY, now(), dependencies, randomBytes);
  }
  const pending = await semantic.contextStore.findPending(scope);
  try {
    await dependencies.processingFeedback?.();
  } catch {
    // Provider UX feedback is intentionally best effort and never changes semantics.
  }
  const result = await semantic.service.interpret({
    text: message.text, interpretationReferenceTime: message.receivedAt,
    processingNow: now(), timezone: "Asia/Ho_Chi_Minh",
    ownerId: context.userId, sourceInboundId: message.id,
    ...(pending ? { previousContext: pending.slots } : {}),
  });
  if (result.kind === "SAFE_HELP" || result.kind === "SAFE_CLARIFICATION") {
    const reply = result.kind === "SAFE_CLARIFICATION" && result.code === "PAST_TIME"
      ? "Thời điểm nhắc đã qua. Hãy gửi lại ngày và giờ trong tương lai."
      : HELP_REPLY;
    return rejectWithReply(message, reply, now(), dependencies, randomBytes);
  }

  // Resolve under the current inbound claim before applying the accepted outcome.
  // A stale/older continuation cannot create a draft or expose a query result.
  if (pending && !await semantic.contextStore.resolve({ ...scope, now: now(), id: pending.id,
    resolutionInboundId: message.id, claimMarker: message.claimMarker, status: "RESOLVED" })) {
    return rejectResolutionConflict(message, now(), dependencies, randomBytes);
  }
  if (result.kind === "CREATE") return result.candidate;
  if (result.kind === "QUERY") {
    const range = semanticQueryRange(result, message.receivedAt);
    if (!range) return rejectWithReply(message, HELP_REPLY, now(), dependencies, randomBytes);
    const reminders = await semantic.list({ message, context, range });
    const lines: string[] = [];
    for (const reminder of reminders) {
      const title = await dependencies.keyring.decryptSensitive(
        "reminder-title", reminder.id, reminder.titleKeyVersion, reminder.encryptedTitle,
      );
      const local = new Date(reminder.scheduledAt + 7 * 3_600_000).toISOString();
      const briefTitle = title.replace(/[\r\n]+/gu, " ").slice(0, 240);
      lines.push(`${local.slice(8, 10)}/${local.slice(5, 7)} ${local.slice(11, 16)} — ${briefTitle}`);
    }
    if (!await semantic.complete(message, context, now())) return { status: "SUPERSEDED" };
    await bestEffortReply(dependencies, lines.length
      ? `Lời nhắc trong khoảng bạn hỏi (tối đa 5):\n${lines.join("\n")}`
      : "Không có lời nhắc sắp tới trong khoảng bạn hỏi.");
    return { status: "REMINDERS_LISTED" };
  }

  const { targetIntent, missingFields } = result.clarification;
  // The approved clarification contract has no newly extracted slot values.
  // Retain only prior typed slots, never infer slots from or persist a transcript.
  const slots: SemanticContextSlots = targetIntent === "CREATE_REMINDER"
    ? { targetIntent, title: null, localDate: null, localTime: null,
      ...(pending?.slots.targetIntent === targetIntent ? pending.slots : {}), missingFields }
    : { targetIntent, rangeKind: null, localDate: null,
      ...(pending?.slots.targetIntent === targetIntent ? pending.slots : {}), missingFields };
  const createdAt = now();
  const saved = await semantic.contextStore.createPending({ ...scope, now: createdAt,
    id: randomOpaqueId(randomBytes), sourceInboundId: message.id, claimMarker: message.claimMarker,
    slots, expiresAt: createdAt + DRAFT_LIFETIME_MS,
  });
  if (saved === "CONFLICT") return rejectResolutionConflict(message, now(), dependencies, randomBytes);
  if (!await semantic.complete(message, context, now())) return { status: "SUPERSEDED" };
  await bestEffortReply(dependencies, result.clarification.question);
  return { status: "CLARIFICATION_REQUESTED" };
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
  if (dependencies.semantic && (HELP_WORDS.has(normalized) || normalized.startsWith("/connect"))) {
    return rejectWithReply(message, HELP_REPLY, processingNow, dependencies, randomBytes);
  }
  if (CONFIRM_WORDS.has(normalized) || CANCEL_WORDS.has(normalized)) {
    let cancelledContext = false;
    if (dependencies.semantic && CANCEL_WORDS.has(normalized)) {
      try {
        const scope = { ownerId: context.userId, chatIdentityId: context.chatIdentityId, now: processingNow };
        const pending = await dependencies.semantic.contextStore.findPending(scope);
        if (pending) {
          cancelledContext = await dependencies.semantic.contextStore.resolve({ ...scope, id: pending.id,
            resolutionInboundId: message.id, claimMarker: message.claimMarker, status: "CANCELLED" });
          if (!cancelledContext) return rejectResolutionConflict(message, processingNow, dependencies, randomBytes);
        }
      } catch {
        return rejectWithReply(message, HELP_REPLY, processingNow, dependencies, randomBytes);
      }
    }
    const draft = await dependencies.store.findPendingDraft(message, context.chatIdentityId);
    if (!draft) {
      if (cancelledContext && dependencies.semantic) {
        if (!await dependencies.semantic.complete(message, context, processingNow)) return { status: "SUPERSEDED" };
        await bestEffortReply(dependencies, CANCELLED_REPLY);
        return { status: "CANCELLED" };
      }
      return rejectResolutionConflict(message, processingNow, dependencies, randomBytes);
    }
    const mutationBase: ResolveDraftMutation = {
      message,
      context,
      draft,
      now: processingNow,
      auditId: randomOpaqueId(randomBytes),
      enforceConversationOrder: dependencies.semantic !== undefined,
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

  let candidate: ParsedReminderCandidate | null;
  if (dependencies.semantic) {
    try {
      const resolved = await semanticCommand(message, context, dependencies, dependencies.semantic, now, randomBytes);
      if ("status" in resolved) return resolved;
      candidate = resolved;
    } catch {
      return rejectWithReply(message, HELP_REPLY, now(), dependencies, randomBytes);
    }
  } else {
    // Compatibility path until a separately reviewed runtime cutover supplies semantic.
    const parsed = parseVietnameseReminder(message.text, message.receivedAt, context.timezone);
    candidate = parsed.ok ? parsed.candidate : null;
  }
  if (!dependencies.semantic && (!candidate || candidate.scheduledAt <= processingNow) && dependencies.intelligence && context.timezone === "Asia/Ho_Chi_Minh") {
    const resolution: IntelligenceResolution = await interpretReminderDeterministicallyFirst({
      text: message.text, now: message.receivedAt, timezone: "Asia/Ho_Chi_Minh",
    }, {
      ...dependencies.intelligence,
      deterministic: () => ({ status: "AMBIGUOUS" }),
    });
    candidate = resolution.status === "PROPOSED" ? resolution.proposal : null;
  }
  const mutationNow = dependencies.semantic ? now() : processingNow;
  if (!candidate || candidate.scheduledAt <= mutationNow) {
    return rejectWithReply(message, HELP_REPLY, processingNow, dependencies, randomBytes);
  }

  const draftId = randomOpaqueId(randomBytes);
  const encryptedTitle = await dependencies.keyring.encryptSensitive(
    "draft-title",
    draftId,
    TITLE_KEY_VERSION,
    candidate.title,
  );
  const result = await dependencies.store.createDraft({
    message,
    context,
    draftId,
    encryptedTitle,
    titleKeyVersion: TITLE_KEY_VERSION,
    scheduledAt: candidate.scheduledAt,
    timezone: candidate.timezone,
    expiresAt: Math.min(mutationNow + DRAFT_LIFETIME_MS, candidate.scheduledAt),
    now: mutationNow,
    auditId: randomOpaqueId(randomBytes),
    enforceConversationOrder: dependencies.semantic !== undefined,
  });
  if (result === "SUPERSEDED") return { status: "SUPERSEDED" };
  if (result === "CONFLICT") {
    return rejectWithReply(message, HELP_REPLY, processingNow, dependencies, randomBytes);
  }
  await bestEffortReply(dependencies, draftReply(candidate));
  return { status: "DRAFT_CREATED" };
}
