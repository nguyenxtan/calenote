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
import type { SemanticContextStore } from "@/modules/semantic/context-store";
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
const RECURRENCE_UNSUPPORTED_REPLY = "Hiện Calenote chưa hỗ trợ lời nhắc lặp lại. Mình chưa tạo lời nhắc nào; hãy gửi một ngày và giờ cụ thể.";
const RETRY_PENDING_REPLY = "Mình chưa xử lý được câu trả lời này lúc này. Lời nhắc chưa được tạo; bạn có thể gửi lại câu trả lời cho câu hỏi trước.";
const RETRY_NEW_REQUEST_REPLY = "Mình chưa xử lý được yêu cầu này lúc này. Chưa có lời nhắc nào được tạo; bạn có thể gửi lại yêu cầu sau ít phút.";
const CONTEXT_CONFLICT_REPLY = "Mình chưa thể áp dụng câu trả lời này vào lời nhắc đang chờ. Hãy trả lời đúng phần mình vừa hỏi hoặc gửi “hủy” để bắt đầu lại.";
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
  conversationFence?: { id: string; revision: number };
  draftId: string;
  encryptedTitle: EncryptedValue;
  titleKeyVersion: number;
  scheduledAt: number;
  timezone: string;
  expiresAt: number;
  /** Optional V2 metadata encrypted against owner/chat/draft, not provider data. */
  encryptedCalendarFacts?: EncryptedValue;
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
  conversation?: {
    handle(message: BoundChatMessage, context: BoundChatContext): Promise<ProcessBoundChatResult>;
    ownsPendingDraft?(message: BoundChatMessage, context: BoundChatContext, draftId: string): Promise<boolean>;
  };
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

/**
 * V1 deliberately has no recurrence storage or occurrence lifecycle. This is
 * a small cadence grammar, not a list of example sentences. A frequency or
 * continuous marker must lead through at most two temporal connectors into a
 * cadence, numeric date, or clock expression; a marker later in ordinary
 * title text cannot borrow a preceding temporal expression.
 */
function requestsUnsupportedRecurrence(text: string): boolean {
  const folded = text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("vi-VN");
  if (/(?:^|[^\p{L}\p{N}])lap\s+lai(?=$|[^\p{L}\p{N}])/u.test(folded)) return true;
  const marker = /(?:^|[^\p{L}\p{N}])(moi|hang|lien\s+tuc)(?=$|[^\p{L}\p{N}])/gu;
  const temporalAtom = "(?:(?:\\d+\\s*)?(?:gio|ngay|tuan|thang|nam)(?=$|[^\\p{L}\\p{N}])|\\d{1,2}\\s*(?:(?:h|gio)(?=$|[^\\p{L}\\p{N}])|:\\s*\\d{2}(?=$|[^\\p{L}\\p{N}]))|\\d{1,4}\\s*[/.-]\\s*\\d{1,2}(?:\\s*[/.-]\\s*\\d{2,4})?(?=$|[^\\p{L}\\p{N}])|thu\\s*[2-8](?=$|[^\\p{L}\\p{N}]))";
  const directCadence = new RegExp(`^\\s*${temporalAtom}`, "u");
  const connectorCadence = new RegExp(`^\\s*(?:(?:trong|vao|luc)\\s+){1,2}${temporalAtom}`, "u");
  const VietnameseNumberWord = "(?:mot|hai|ba|bon|nam|sau|bay|tam|chin|muoi)";
  const cadenceUnit = "(?:gio|ngay|tuan|thang|nam)(?=$|[^\\p{L}\\p{N}])";
  const wordCadence = new RegExp(`^\\s*${VietnameseNumberWord}\\s+${cadenceUnit}`, "u");
  const connectorWordCadence = new RegExp(`^\\s*(?:(?:trong|vao|luc)\\s+){1,2}${VietnameseNumberWord}\\s+${cadenceUnit}`, "u");
  for (const match of folded.matchAll(marker)) {
    const markerText = match[1];
    const start = match.index ?? 0;
    const following = folded.slice(start + match[0].length);
    if (directCadence.test(following) || wordCadence.test(following)) return true;
    // An uppercase/proper-name-like `Hằng` may appear after normal title text.
    // Only let it cross a connector if it begins a new clause; the other
    // recurrence markers remain valid in ordinary imperative wording.
    const previousNonSpace = folded.slice(0, start).trimEnd().at(-1);
    const followsTitleWord = markerText === "hang" && previousNonSpace !== undefined && /[\p{L}\p{N}]/u.test(previousNonSpace);
    if (!followsTitleWord && (connectorCadence.test(following) || connectorWordCadence.test(following))) return true;
  }
  return false;
}

function semanticSafeReply(result: { kind: "SAFE_HELP" | "SAFE_CLARIFICATION"; code: string }, pending: boolean): string {
  if (result.kind === "SAFE_CLARIFICATION" && result.code === "PAST_TIME") {
    return "Thời điểm nhắc đã qua. Hãy gửi lại ngày và giờ trong tương lai.";
  }
  if (result.kind === "SAFE_CLARIFICATION" && result.code === "CONFLICTING_CONTEXT") {
    return CONTEXT_CONFLICT_REPLY;
  }
  const transient = new Set(["AI_DISABLED", "AI_UNAVAILABLE", "BUDGET_EXHAUSTED", "ALREADY_ATTEMPTED"]);
  if (transient.has(result.code)) return pending ? RETRY_PENDING_REPLY : RETRY_NEW_REQUEST_REPLY;
  return pending
    ? "Mình chưa thể áp dụng câu trả lời này vào lời nhắc đang chờ. Hãy gửi lại phần thông tin mình vừa hỏi."
    : "Mình chưa xác định được yêu cầu một cách an toàn. Chưa có lời nhắc nào được tạo.";
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
  if (requestsUnsupportedRecurrence(message.text)) {
    return rejectWithReply(message, RECURRENCE_UNSUPPORTED_REPLY, now(), dependencies, randomBytes);
  }
  const pending = await semantic.contextStore.findPending(scope);
  const result = await semantic.service.interpret({
    text: message.text, referenceTime: message.receivedAt,
    processingNow: now(), timezone: "Asia/Ho_Chi_Minh",
    ownerId: context.userId, sourceInboundId: message.id,
    ...(pending ? { previousContext: pending.slots } : {}),
  }, dependencies.processingFeedback);
  if (result.kind === "SAFE_HELP" || result.kind === "SAFE_CLARIFICATION") {
    return rejectWithReply(message, semanticSafeReply(result, pending !== null), now(), dependencies, randomBytes);
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

  const createdAt = now();
  const saved = await semantic.contextStore.createPending({ ...scope, now: createdAt,
    id: randomOpaqueId(randomBytes), sourceInboundId: message.id, claimMarker: message.claimMarker,
    slots: result.contextSlots, expiresAt: createdAt + DRAFT_LIFETIME_MS,
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
  if (dependencies.conversation && !normalized.startsWith("/connect")) {
    // Confirmation remains canonical. Only an authenticated V2-owned draft
    // may re-enter contextual dialogue; legacy drafts retain their drain guard.
    const pending = await dependencies.store.findPendingDraft(message, context.chatIdentityId);
    if (!pending) return dependencies.conversation.handle(message, context);
    if (!CONFIRM_WORDS.has(normalized) && !CANCEL_WORDS.has(normalized)) {
      try {
        if (await dependencies.conversation.ownsPendingDraft?.(message, context, pending.id)) {
          return dependencies.conversation.handle(message, context);
        }
      } catch { /* Unknown ownership must not bypass the legacy draft fence. */ }
      return rejectWithReply(message, "Bạn còn một lời nhắc đang chờ. Gửi “có” để xác nhận hoặc “hủy” để bỏ trước nhé.", processingNow, dependencies, randomBytes);
    }
  }
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
        return rejectWithReply(message, RETRY_PENDING_REPLY, processingNow, dependencies, randomBytes);
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
      return rejectWithReply(message, RETRY_NEW_REQUEST_REPLY, now(), dependencies, randomBytes);
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
