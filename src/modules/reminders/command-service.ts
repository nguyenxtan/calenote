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

interface ContextRow {
  chat_identity_id: string;
  user_id: string;
  workspace_id: string;
  timezone: string;
  inbound_rowid: number;
}

interface DraftRow {
  id: string;
  chat_identity_id: string;
  source_inbound_id: string;
  title_ciphertext: unknown;
  title_iv: unknown;
  title_key_version: number;
  scheduled_at: number;
  timezone: string;
  expires_at: number;
}

interface InboundOwnershipRow {
  state: string;
  transition_marker: string | null;
}

interface ResolutionStateRow {
  status: string;
  resolution_inbound_id: string | null;
  has_reminder: number;
  resolution_is_later: number;
}

function persistedArrayBuffer(value: unknown): ArrayBuffer {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    return Uint8Array.from(
      new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
    ).buffer;
  }
  throw new TypeError("Malformed encrypted reminder value");
}

function pendingDraft(row: DraftRow): PendingDraft {
  return {
    id: row.id,
    chatIdentityId: row.chat_identity_id,
    sourceInboundId: row.source_inbound_id,
    encryptedTitle: {
      ciphertext: persistedArrayBuffer(row.title_ciphertext),
      iv: persistedArrayBuffer(row.title_iv),
    },
    titleKeyVersion: row.title_key_version,
    scheduledAt: row.scheduled_at,
    timezone: row.timezone,
    expiresAt: row.expires_at,
  };
}

function expectedMutationConflict(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /(?:NOT NULL constraint failed:\s*(?:command_drafts\.chat_identity_id|reminders\.(?:workspace_id|chat_identity_id)|audit_events\.id)|UNIQUE constraint failed:\s*(?:command_drafts\.(?:chat_identity_id|source_inbound_id|resolution_inbound_id)|reminders\.source_draft_id))/iu.test(error.message);
}

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

export class D1ReminderCommandStore implements ReminderCommandStore {
  constructor(protected readonly database: D1Database) {}

  async findBoundContext(message: BoundChatMessage): Promise<BoundChatContext | null> {
    const row = await this.database
      .prepare(
        `SELECT ci.id AS chat_identity_id, c.user_id, w.id AS workspace_id,
                u.timezone, i.rowid AS inbound_rowid
         FROM inbound_updates i
         JOIN bot_connections c
           ON c.id = i.connection_id AND c.state = 'ACTIVE_BOUND'
         JOIN chat_identities ci
           ON ci.connection_id = c.id
          AND ci.provider_user_id = i.provider_user_id
          AND ci.private_chat_id = i.private_chat_id
         JOIN users u ON u.id = c.user_id
         JOIN workspaces w
           ON w.owner_user_id = c.user_id AND w.kind = 'PERSONAL'
         JOIN memberships m
           ON m.workspace_id = w.id AND m.user_id = c.user_id AND m.role = 'OWNER'
         WHERE i.id = ? AND i.connection_id = ?
           AND i.provider_user_id = ? AND i.private_chat_id = ?
           AND i.state = 'PROCESSING' AND i.transition_marker = ?
         LIMIT 1`,
      )
      .bind(
        message.id,
        message.connectionId,
        message.providerUserId,
        message.privateChatId,
        message.claimMarker,
      )
      .first<ContextRow>();
    if (!row) return null;
    return {
      chatIdentityId: row.chat_identity_id,
      userId: row.user_id,
      workspaceId: row.workspace_id,
      timezone: row.timezone,
      inboundRowId: row.inbound_rowid,
    };
  }

  async findPendingDraft(
    message: BoundChatMessage,
    chatIdentityId: string,
  ): Promise<PendingDraft | null> {
    const row = await this.database
      .prepare(
        `SELECT draft.id, draft.chat_identity_id, draft.source_inbound_id,
                draft.title_ciphertext, draft.title_iv, draft.title_key_version,
                draft.scheduled_at, draft.timezone, draft.expires_at
         FROM command_drafts draft
         JOIN inbound_updates source ON source.id = draft.source_inbound_id
         JOIN inbound_updates current ON current.id = ?
         WHERE draft.chat_identity_id = ? AND draft.status = 'PENDING'
           AND current.connection_id = ?
           AND current.provider_user_id = ? AND current.private_chat_id = ?
           AND current.state = 'PROCESSING' AND current.transition_marker = ?
           AND (
             source.received_at < current.received_at OR
             (source.received_at = current.received_at AND source.rowid < current.rowid)
           )
         ORDER BY draft.created_at DESC, draft.rowid DESC
         LIMIT 1`,
      )
      .bind(
        message.id,
        chatIdentityId,
        message.connectionId,
        message.providerUserId,
        message.privateChatId,
        message.claimMarker,
      )
      .first<DraftRow>();
    return row ? pendingDraft(row) : null;
  }

  private boundIdentityExpression(): string {
    return `SELECT ci.id
            FROM inbound_updates current
            JOIN bot_connections c
              ON c.id = current.connection_id AND c.state = 'ACTIVE_BOUND'
            JOIN chat_identities ci
              ON ci.connection_id = c.id
             AND ci.provider_user_id = current.provider_user_id
             AND ci.private_chat_id = current.private_chat_id
            JOIN users u ON u.id = c.user_id
            JOIN workspaces w
              ON w.owner_user_id = c.user_id AND w.kind = 'PERSONAL'
            JOIN memberships m
              ON m.workspace_id = w.id AND m.user_id = c.user_id AND m.role = 'OWNER'
            WHERE current.id = ? AND current.connection_id = ?
              AND current.provider_user_id = ? AND current.private_chat_id = ?
              AND current.state = 'PROCESSING' AND current.transition_marker = ?`;
  }

  private ownershipBindings(message: BoundChatMessage): unknown[] {
    return [
      message.id,
      message.connectionId,
      message.providerUserId,
      message.privateChatId,
      message.claimMarker,
    ];
  }

  private async inboundOwnership(message: BoundChatMessage): Promise<InboundOwnershipRow | null> {
    return this.database
      .prepare("SELECT state, transition_marker FROM inbound_updates WHERE id = ? LIMIT 1")
      .bind(message.id)
      .first<InboundOwnershipRow>();
  }

  private async stillOwned(message: BoundChatMessage): Promise<boolean> {
    const row = await this.inboundOwnership(message);
    return row?.state === "PROCESSING" && row.transition_marker === message.claimMarker;
  }

  async createDraft(input: CreateDraftMutation): Promise<MutationResult> {
    const identitySql = this.boundIdentityExpression();
    const ownership = this.ownershipBindings(input.message);
    const statements = [
      this.database
        .prepare(
          `UPDATE command_drafts
           SET status = 'CANCELLED', resolution_inbound_id = ?, updated_at = ?
           WHERE status = 'PENDING'
             AND chat_identity_id = (${identitySql})
             AND EXISTS (
               SELECT 1
               FROM inbound_updates current
               JOIN inbound_updates source ON source.id = command_drafts.source_inbound_id
               WHERE current.id = ? AND current.state = 'PROCESSING'
                 AND current.transition_marker = ?
                 AND (
                   source.received_at < current.received_at OR
                   (source.received_at = current.received_at AND source.rowid < current.rowid)
                 )
             )`,
        )
        .bind(
          input.message.id,
          input.now,
          ...ownership,
          input.message.id,
          input.message.claimMarker,
        ),
      this.database
        .prepare(
          `INSERT INTO command_drafts (
             id, chat_identity_id, source_inbound_id, resolution_inbound_id,
             title_ciphertext, title_iv, title_key_version, scheduled_at, timezone,
             status, expires_at, created_at, updated_at
           ) VALUES (
             ?, COALESCE((
               ${identitySql}
               AND NOT EXISTS (
                 SELECT 1
                 FROM command_drafts history
                 JOIN inbound_updates source ON source.id = history.source_inbound_id
                 JOIN inbound_updates current ON current.id = ?
                 WHERE history.chat_identity_id = ?
                   AND (
                     source.received_at > current.received_at OR
                     (source.received_at = current.received_at AND source.rowid >= current.rowid)
                   )
               )
             ), NULL), ?, NULL, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?
           )`,
        )
        .bind(
          input.draftId,
          ...ownership,
          input.message.id,
          input.context.chatIdentityId,
          input.message.id,
          input.encryptedTitle.ciphertext,
          input.encryptedTitle.iv,
          input.titleKeyVersion,
          input.scheduledAt,
          input.timezone,
          input.expiresAt,
          input.now,
          input.now,
        ),
      this.database
        .prepare(
          `UPDATE inbound_updates
           SET state = 'PROCESSED', processed_at = ?
           WHERE id = ? AND state = 'PROCESSING' AND transition_marker = ?
             AND EXISTS (
               SELECT 1 FROM command_drafts
               WHERE id = ? AND source_inbound_id = ? AND status = 'PENDING'
             )`,
        )
        .bind(
          input.now,
          input.message.id,
          input.message.claimMarker,
          input.draftId,
          input.message.id,
        ),
      this.database
        .prepare(
          `INSERT INTO audit_events (
             id, actor_user_id, action, target_user_id, target_connection_id, result, created_at
           ) VALUES (
             COALESCE((
               SELECT ? FROM inbound_updates i
               JOIN command_drafts d ON d.source_inbound_id = i.id
               WHERE i.id = ? AND i.state = 'PROCESSED' AND i.transition_marker = ?
                 AND d.id = ? AND d.status = 'PENDING'
             ), NULL), ?, 'REMINDER_DRAFT_CREATED', ?, ?, 'SUCCESS', ?
           )`,
        )
        .bind(
          input.auditId,
          input.message.id,
          input.message.claimMarker,
          input.draftId,
          input.context.userId,
          input.context.userId,
          input.message.connectionId,
          input.now,
        ),
    ];

    try {
      await this.database.batch(statements);
      return "COMMITTED";
    } catch (error) {
      if (!expectedMutationConflict(error)) throw error;
      if (!await this.stillOwned(input.message)) return "SUPERSEDED";
      const newer = await this.database
        .prepare(
          `SELECT 1
           FROM command_drafts history
           JOIN inbound_updates source ON source.id = history.source_inbound_id
           JOIN inbound_updates current ON current.id = ?
           WHERE history.chat_identity_id = ?
             AND (
               source.received_at > current.received_at OR
               (source.received_at = current.received_at AND source.rowid >= current.rowid)
             )
           LIMIT 1`,
        )
        .bind(input.message.id, input.context.chatIdentityId)
        .first<{ 1: number }>();
      if (newer) return "CONFLICT";
      throw error;
    }
  }

  async confirmDraft(input: ConfirmDraftMutation): Promise<MutationResult> {
    const identitySql = this.boundIdentityExpression();
    const ownership = this.ownershipBindings(input.message);
    const statements = [
      this.database
        .prepare(
          `UPDATE command_drafts
           SET status = 'CONFIRMED', resolution_inbound_id = ?, updated_at = ?
           WHERE id = ? AND chat_identity_id = (${identitySql})
             AND status = 'PENDING'
             AND EXISTS (
               SELECT 1
               FROM inbound_updates source
               JOIN inbound_updates current ON current.id = ?
               WHERE source.id = command_drafts.source_inbound_id
                 AND current.state = 'PROCESSING' AND current.transition_marker = ?
                 AND (
                   source.received_at < current.received_at OR
                   (source.received_at = current.received_at AND source.rowid < current.rowid)
                 )
             )
             AND expires_at > ? AND scheduled_at > ?`,
        )
        .bind(
          input.message.id,
          input.now,
          input.draft.id,
          ...ownership,
          input.message.id,
          input.message.claimMarker,
          input.now,
          input.now,
        ),
      this.database
        .prepare(
          `INSERT INTO reminders (
             id, public_id, workspace_id, chat_identity_id, source_draft_id,
             title_ciphertext, title_iv, title_key_version, scheduled_at, timezone,
             status, claimed_at, cancelled_at, created_at, updated_at
           ) VALUES (
             ?, ?, COALESCE((
               SELECT w.id
               FROM command_drafts d
               JOIN chat_identities ci ON ci.id = d.chat_identity_id
               JOIN bot_connections c
                 ON c.id = ci.connection_id AND c.state = 'ACTIVE_BOUND'
               JOIN workspaces w
                 ON w.owner_user_id = c.user_id AND w.kind = 'PERSONAL'
               JOIN memberships m
                 ON m.workspace_id = w.id AND m.user_id = c.user_id AND m.role = 'OWNER'
               JOIN inbound_updates i ON i.id = d.resolution_inbound_id
               WHERE d.id = ? AND d.status = 'CONFIRMED'
                 AND d.resolution_inbound_id = ?
                 AND i.state = 'PROCESSING' AND i.transition_marker = ?
                 AND ci.id = ? AND c.id = ?
                 AND ci.provider_user_id = ? AND ci.private_chat_id = ?
             ), NULL), COALESCE((
               SELECT ci.id
               FROM command_drafts d
               JOIN chat_identities ci ON ci.id = d.chat_identity_id
               JOIN inbound_updates i ON i.id = d.resolution_inbound_id
               WHERE d.id = ? AND d.status = 'CONFIRMED'
                 AND d.resolution_inbound_id = ?
                 AND i.state = 'PROCESSING' AND i.transition_marker = ?
                 AND ci.id = ?
             ), NULL), ?, ?, ?, ?, ?, ?, 'PENDING', NULL, NULL, ?, ?
           )`,
        )
        .bind(
          input.reminderId,
          input.reminderPublicId,
          input.draft.id,
          input.message.id,
          input.message.claimMarker,
          input.context.chatIdentityId,
          input.message.connectionId,
          input.message.providerUserId,
          input.message.privateChatId,
          input.draft.id,
          input.message.id,
          input.message.claimMarker,
          input.context.chatIdentityId,
          input.draft.id,
          input.encryptedTitle.ciphertext,
          input.encryptedTitle.iv,
          input.titleKeyVersion,
          input.draft.scheduledAt,
          input.draft.timezone,
          input.now,
          input.now,
        ),
      this.database
        .prepare(
          `UPDATE inbound_updates
           SET state = 'PROCESSED', processed_at = ?
           WHERE id = ? AND state = 'PROCESSING' AND transition_marker = ?
             AND EXISTS (
               SELECT 1 FROM reminders
               WHERE id = ? AND source_draft_id = ? AND status = 'PENDING'
             )`,
        )
        .bind(
          input.now,
          input.message.id,
          input.message.claimMarker,
          input.reminderId,
          input.draft.id,
        ),
      this.database
        .prepare(
          `INSERT INTO audit_events (
             id, actor_user_id, action, target_user_id, target_connection_id,
             target_reminder_id, result, created_at
           ) VALUES (
             COALESCE((
               SELECT ? FROM inbound_updates i
               JOIN reminders r ON r.id = ? AND r.source_draft_id = ?
               WHERE i.id = ? AND i.state = 'PROCESSED' AND i.transition_marker = ?
             ), NULL), ?, 'REMINDER_CONFIRMED', ?, ?, ?, 'SUCCESS', ?
           )`,
        )
        .bind(
          input.auditId,
          input.reminderId,
          input.draft.id,
          input.message.id,
          input.message.claimMarker,
          input.context.userId,
          input.context.userId,
          input.message.connectionId,
          input.reminderId,
          input.now,
        ),
    ];

    return this.runResolutionBatch(input, statements);
  }

  async cancelDraft(input: ResolveDraftMutation): Promise<MutationResult> {
    return this.resolveWithoutReminder(input, "CANCELLED", "REMINDER_CANCELLED", "PROCESSED");
  }

  async expireDraft(input: ResolveDraftMutation): Promise<MutationResult> {
    return this.resolveWithoutReminder(input, "EXPIRED", "REMINDER_DRAFT_EXPIRED", "REJECTED");
  }

  private async resolveWithoutReminder(
    input: ResolveDraftMutation,
    draftStatus: "CANCELLED" | "EXPIRED",
    action: string,
    inboundState: "PROCESSED" | "REJECTED",
  ): Promise<MutationResult> {
    const identitySql = this.boundIdentityExpression();
    const ownership = this.ownershipBindings(input.message);
    const timeGuard = draftStatus === "EXPIRED"
      ? "AND (expires_at <= ? OR scheduled_at <= ?)"
      : "AND expires_at > ? AND scheduled_at > ?";
    const statements = [
      this.database
        .prepare(
          `UPDATE command_drafts
           SET status = ?, resolution_inbound_id = ?, updated_at = ?
           WHERE id = ? AND chat_identity_id = (${identitySql})
             AND status = 'PENDING'
             AND EXISTS (
               SELECT 1
               FROM inbound_updates source
               JOIN inbound_updates current ON current.id = ?
               WHERE source.id = command_drafts.source_inbound_id
                 AND current.state = 'PROCESSING' AND current.transition_marker = ?
                 AND (
                   source.received_at < current.received_at OR
                   (source.received_at = current.received_at AND source.rowid < current.rowid)
                 )
             )
             ${timeGuard}`,
        )
        .bind(
          draftStatus,
          input.message.id,
          input.now,
          input.draft.id,
          ...ownership,
          input.message.id,
          input.message.claimMarker,
          input.now,
          input.now,
        ),
      this.database
        .prepare(
          `UPDATE inbound_updates
           SET state = ?, processed_at = ?
           WHERE id = ? AND state = 'PROCESSING' AND transition_marker = ?
             AND EXISTS (
               SELECT 1 FROM command_drafts
               WHERE id = ? AND status = ? AND resolution_inbound_id = ?
             )`,
        )
        .bind(
          inboundState,
          input.now,
          input.message.id,
          input.message.claimMarker,
          input.draft.id,
          draftStatus,
          input.message.id,
        ),
      this.database
        .prepare(
          `INSERT INTO audit_events (
             id, actor_user_id, action, target_user_id, target_connection_id, result, created_at
           ) VALUES (
             COALESCE((
               SELECT ? FROM inbound_updates i
               JOIN command_drafts d ON d.resolution_inbound_id = i.id
               WHERE i.id = ? AND i.state = ? AND i.transition_marker = ?
                 AND d.id = ? AND d.status = ?
             ), NULL), ?, ?, ?, ?, 'SUCCESS', ?
           )`,
        )
        .bind(
          input.auditId,
          input.message.id,
          inboundState,
          input.message.claimMarker,
          input.draft.id,
          draftStatus,
          input.context.userId,
          action,
          input.context.userId,
          input.message.connectionId,
          input.now,
        ),
    ];
    return this.runResolutionBatch(input, statements);
  }

  private async runResolutionBatch(
    input: ResolveDraftMutation,
    statements: D1PreparedStatement[],
  ): Promise<MutationResult> {
    try {
      await this.database.batch(statements);
      return "COMMITTED";
    } catch (error) {
      if (!expectedMutationConflict(error)) throw error;
      if (!await this.stillOwned(input.message)) return "SUPERSEDED";
      const draft = await this.database
        .prepare(
          `SELECT status, resolution_inbound_id,
                  EXISTS(SELECT 1 FROM reminders WHERE source_draft_id = draft.id) AS has_reminder,
                  EXISTS(
                    SELECT 1
                    FROM inbound_updates source
                    JOIN inbound_updates current ON current.id = ?
                    WHERE source.id = draft.source_inbound_id
                      AND current.state = 'PROCESSING' AND current.transition_marker = ?
                      AND (
                        source.received_at < current.received_at OR
                        (source.received_at = current.received_at AND source.rowid < current.rowid)
                      )
                  ) AS resolution_is_later
           FROM command_drafts draft WHERE draft.id = ? LIMIT 1`,
        )
        .bind(input.message.id, input.message.claimMarker, input.draft.id)
        .first<ResolutionStateRow>();
      const reusedInbound = await this.database
        .prepare(
          `SELECT 1 FROM command_drafts
           WHERE resolution_inbound_id = ? AND id <> ? LIMIT 1`,
        )
        .bind(input.message.id, input.draft.id)
        .first<{ 1: number }>();
      if (
        !draft
        || draft.status !== "PENDING"
        || draft.resolution_inbound_id !== null
        || draft.has_reminder === 1
        || draft.resolution_is_later !== 1
        || reusedInbound
        || !await this.findBoundContext(input.message)
      ) {
        return "CONFLICT";
      }
      throw error;
    }
  }

  async rejectMessage(message: BoundChatMessage, auditId: string, now: number): Promise<boolean> {
    const statements = [
      this.database
        .prepare(
          `UPDATE inbound_updates
           SET state = 'REJECTED', processed_at = ?
           WHERE id = ? AND state = 'PROCESSING' AND transition_marker = ?`,
        )
        .bind(now, message.id, message.claimMarker),
      this.database
        .prepare(
          `INSERT INTO audit_events (
             id, actor_user_id, action, target_user_id, target_connection_id, result, created_at
           ) VALUES (
             COALESCE((
               SELECT ? FROM inbound_updates
               WHERE id = ? AND state = 'REJECTED' AND transition_marker = ?
             ), NULL),
             (SELECT c.user_id FROM inbound_updates i JOIN bot_connections c ON c.id = i.connection_id WHERE i.id = ?),
             'REMINDER_COMMAND_REJECTED',
             (SELECT c.user_id FROM inbound_updates i JOIN bot_connections c ON c.id = i.connection_id WHERE i.id = ?),
             (SELECT connection_id FROM inbound_updates WHERE id = ?),
             'FAILURE', ?
           )`,
        )
        .bind(
          auditId,
          message.id,
          message.claimMarker,
          message.id,
          message.id,
          message.id,
          now,
        ),
    ];
    try {
      await this.database.batch(statements);
      return true;
    } catch (error) {
      if (!expectedMutationConflict(error)) throw error;
      if (!await this.stillOwned(message)) return false;
      throw error;
    }
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
