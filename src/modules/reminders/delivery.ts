import type {
  BotProvider,
  SendReceipt,
} from "@/modules/connections/contracts";
import { ProviderOperationError } from "@/modules/connections/provider-error";
import { sendProviderText } from "@/modules/inbound/processor";
import {
  cryptoRandomBytes,
  d1Changes,
  randomOpaqueId,
  systemClock,
  type Clock,
  type RandomBytes,
} from "@/modules/platform/types";
import type { EncryptedValue, Keyring } from "@/modules/security/keyring";
import { isSafeProviderToken } from "@/modules/connections/token-policy";
import { MAX_REMINDER_TITLE_CODE_UNITS } from "./parse-vietnamese";
import {
  MAX_DELIVERY_ATTEMPTS,
} from "./scheduler";

export const DELIVERY_SEND_LEASE_MS = 5 * 60_000;
export const QUOTA_FALLBACK_DELAYS_SECONDS = [60, 300, 1_800] as const;
const SAFE_PRE_PROVIDER_RETRY_SECONDS = 60;
const PROVIDER_TEXT_CODE_UNITS = 2_000;
const REMINDER_PREFIX = "⏰ Nhắc hẹn: ";

type ReminderStatus =
  | "PENDING"
  | "CLAIMED"
  | "SENT"
  | "CANCELLED"
  | "FAILED"
  | "RETRYABLE"
  | "UNCERTAIN";

type DeliveryStatus =
  | "PENDING"
  | "SENDING"
  | "SENT"
  | "RETRYABLE"
  | "FAILED"
  | "UNCERTAIN"
  | "CANCELLED";

interface DeliveryContextRow {
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

interface OwnedDelivery {
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

function arrayBuffer(value: unknown): ArrayBuffer {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    return Uint8Array.from(
      new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
    ).buffer;
  }
  throw new TypeError("Malformed encrypted database value");
}

function contextFromRow(row: DeliveryContextRow): ReminderDeliveryContext {
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

function expectedGuardConflict(error: unknown): boolean {
  return error instanceof Error
    && /NOT NULL constraint failed:\s*audit_events\.id/iu.test(error.message);
}

function secondsUntil(timestamp: number, now: number): number {
  return Math.min(86_400, Math.max(1, Math.ceil((timestamp - now) / 1_000)));
}

export class D1ReminderDeliveryStore implements ReminderDeliveryStore {
  constructor(private readonly database: D1Database) {}

  async read(reminderId: string): Promise<ReminderDeliveryContext | null> {
    const row = await this.database
      .prepare(
        `SELECT r.id AS reminder_id, r.status AS reminder_status, r.scheduled_at,
                r.title_ciphertext, r.title_iv, r.title_key_version,
                c.id AS connection_id, c.user_id AS connection_user_id,
                c.provider, c.state AS connection_state, c.encrypted_token,
                c.encrypted_token_iv, c.credential_version, ci.private_chat_id,
                d.id AS delivery_id, d.status AS delivery_status,
                d.attempt_count, d.send_started_at, d.retry_not_before,
                d.transition_marker AS delivery_marker
         FROM reminders r
         JOIN chat_identities ci ON ci.id = r.chat_identity_id
         JOIN bot_connections c ON c.id = ci.connection_id
         LEFT JOIN reminder_deliveries d ON d.reminder_id = r.id
         WHERE r.id = ?
         LIMIT 1`,
      )
      .bind(reminderId)
      .first<DeliveryContextRow>();
    return row ? contextFromRow(row) : null;
  }

  async acquire(
    reminderId: string,
    deliveryId: string,
    marker: string,
    now: number,
  ): Promise<AcquireDeliveryResult> {
    const inserted = await this.database
      .prepare(
        `INSERT OR IGNORE INTO reminder_deliveries (
           id, reminder_id, status, attempt_count, provider_receipt,
           safe_error_code, sent_at, send_started_at, retry_not_before,
           transition_marker, created_at, updated_at
         )
         SELECT ?, r.id, 'SENDING', 1, NULL, NULL, NULL, ?, NULL, ?, ?, ?
         FROM reminders r
         JOIN chat_identities ci ON ci.id = r.chat_identity_id
         JOIN bot_connections c ON c.id = ci.connection_id
         WHERE r.id = ? AND r.status IN ('CLAIMED', 'RETRYABLE')
           AND c.state = 'ACTIVE_BOUND'
           AND NOT EXISTS (
             SELECT 1 FROM reminder_deliveries d WHERE d.reminder_id = r.id
           )
         RETURNING id`,
      )
      .bind(deliveryId, now, marker, now, now, reminderId)
      .run<{ id: string }>();
    if (d1Changes(inserted) === 1) {
      return {
        status: "OWNED",
        delivery: { deliveryId, marker, attemptCount: 1 },
      };
    }

    const updated = await this.database
      .prepare(
        `UPDATE reminder_deliveries
         SET status = 'SENDING', attempt_count = attempt_count + 1,
             provider_receipt = NULL, safe_error_code = NULL, sent_at = NULL,
             send_started_at = ?, retry_not_before = NULL,
             transition_marker = ?, updated_at = ?
         WHERE reminder_id = ? AND attempt_count < ?
           AND (
             status = 'PENDING'
             OR (status = 'RETRYABLE' AND retry_not_before IS NOT NULL AND retry_not_before <= ?)
           )
           AND EXISTS (
             SELECT 1
             FROM reminders r
             JOIN chat_identities ci ON ci.id = r.chat_identity_id
             JOIN bot_connections c ON c.id = ci.connection_id
             WHERE r.id = reminder_deliveries.reminder_id
               AND r.status IN ('CLAIMED', 'RETRYABLE')
               AND c.state = 'ACTIVE_BOUND'
           )
         RETURNING id, attempt_count`,
      )
      .bind(now, marker, now, reminderId, MAX_DELIVERY_ATTEMPTS, now)
      .run<{ id: string; attempt_count: number }>();
    if (d1Changes(updated) === 1) {
      const row = updated.results[0];
      return {
        status: "OWNED",
        delivery: {
          deliveryId: row.id,
          marker,
          attemptCount: row.attempt_count,
        },
      };
    }

    const current = await this.read(reminderId);
    if (!current) return { status: "MISSING" };
    if (current.deliveryStatus === "SENT" || current.reminderStatus === "SENT") {
      return { status: "SENT" };
    }
    if (current.deliveryStatus === "FAILED" || current.reminderStatus === "FAILED") {
      return { status: "FAILED" };
    }
    if (current.deliveryStatus === "UNCERTAIN" || current.reminderStatus === "UNCERTAIN") {
      return { status: "UNCERTAIN" };
    }
    if (current.deliveryStatus === "CANCELLED" || current.reminderStatus === "CANCELLED") {
      return { status: "CANCELLED" };
    }
    if (
      current.deliveryStatus === "RETRYABLE"
      && current.retryNotBefore !== null
      && current.retryNotBefore > now
    ) {
      return {
        status: "RETRY_AFTER",
        retryAfterSeconds: secondsUntil(current.retryNotBefore, now),
      };
    }
    return { status: "NOOP" };
  }

  async finalizeSuccess(
    reminderId: string,
    marker: string,
    providerReceipt: string | null,
    auditId: string,
    now: number,
  ): Promise<void> {
    await this.database.batch([
      this.database
        .prepare(
          `UPDATE reminder_deliveries
           SET status = 'SENT', provider_receipt = ?, safe_error_code = NULL,
               sent_at = ?, retry_not_before = NULL, updated_at = ?
           WHERE reminder_id = ? AND status = 'SENDING' AND transition_marker = ?`,
        )
        .bind(providerReceipt, now, now, reminderId, marker),
      this.database
        .prepare(
          `UPDATE reminders
           SET status = 'SENT', updated_at = ?
           WHERE id = ? AND status IN ('CLAIMED', 'RETRYABLE')
             AND EXISTS (
               SELECT 1 FROM reminder_deliveries d
               WHERE d.reminder_id = reminders.id AND d.status = 'SENT'
                 AND d.transition_marker = ?
             )`,
        )
        .bind(now, reminderId, marker),
      this.database
        .prepare(
          `INSERT INTO audit_events (
             id, actor_user_id, action, target_user_id, target_connection_id,
             target_reminder_id, result, created_at
           ) VALUES (
             COALESCE((
               SELECT ? FROM reminders r
               JOIN reminder_deliveries d ON d.reminder_id = r.id
               WHERE r.id = ? AND r.status = 'SENT' AND d.status = 'SENT'
                 AND d.transition_marker = ?
             ), NULL),
             (SELECT w.owner_user_id FROM reminders r JOIN workspaces w ON w.id = r.workspace_id WHERE r.id = ?),
             'REMINDER_SENT',
             (SELECT w.owner_user_id FROM reminders r JOIN workspaces w ON w.id = r.workspace_id WHERE r.id = ?),
             (SELECT ci.connection_id FROM reminders r JOIN chat_identities ci ON ci.id = r.chat_identity_id WHERE r.id = ?),
             ?, 'SUCCESS', ?
           )`,
        )
        .bind(
          auditId,
          reminderId,
          marker,
          reminderId,
          reminderId,
          reminderId,
          reminderId,
          now,
        ),
    ]);
  }

  async finalizeTerminal(input: FinalizeTerminalInput): Promise<void> {
    const statements: D1PreparedStatement[] = [
      this.database
        .prepare(
          `UPDATE reminder_deliveries
           SET status = ?, provider_receipt = NULL, safe_error_code = ?,
               sent_at = NULL, retry_not_before = NULL, updated_at = ?
           WHERE reminder_id = ? AND status = 'SENDING' AND transition_marker = ?`,
        )
        .bind(
          input.status,
          input.safeErrorCode,
          input.now,
          input.reminderId,
          input.marker,
        ),
      this.database
        .prepare(
          `UPDATE reminders
           SET status = ?, updated_at = ?
           WHERE id = ? AND status IN ('CLAIMED', 'RETRYABLE')
             AND EXISTS (
               SELECT 1 FROM reminder_deliveries d
               WHERE d.reminder_id = reminders.id AND d.status = ?
                 AND d.safe_error_code = ? AND d.transition_marker = ?
             )`,
        )
        .bind(
          input.status,
          input.now,
          input.reminderId,
          input.status,
          input.safeErrorCode,
          input.marker,
        ),
    ];

    if (input.suspendConnection) {
      statements.push(
        this.database
          .prepare(
            `UPDATE bot_connections
             SET state = 'SUSPENDED', updated_at = ?
             WHERE id = ? AND state = 'ACTIVE_BOUND'
               AND EXISTS (
                 SELECT 1 FROM reminder_deliveries d
                 WHERE d.reminder_id = ? AND d.status = 'FAILED'
                   AND d.safe_error_code = 'REJECTED_CREDENTIAL'
                   AND d.transition_marker = ?
               )`,
          )
          .bind(input.now, input.connectionId, input.reminderId, input.marker),
      );
    }

    statements.push(
      this.database
        .prepare(
          `INSERT INTO audit_events (
             id, actor_user_id, action, target_user_id, target_connection_id,
             target_reminder_id, result, created_at
           ) VALUES (
             COALESCE((
               SELECT ? FROM reminders r
               JOIN reminder_deliveries d ON d.reminder_id = r.id
               JOIN chat_identities ci ON ci.id = r.chat_identity_id
               JOIN bot_connections c ON c.id = ci.connection_id
               WHERE r.id = ? AND r.status = ? AND d.status = ?
                 AND d.safe_error_code = ? AND d.transition_marker = ?
                 AND (? = 0 OR (c.id = ? AND c.state = 'SUSPENDED'))
             ), NULL),
             (SELECT w.owner_user_id FROM reminders r JOIN workspaces w ON w.id = r.workspace_id WHERE r.id = ?),
             ?,
             (SELECT w.owner_user_id FROM reminders r JOIN workspaces w ON w.id = r.workspace_id WHERE r.id = ?),
             (SELECT ci.connection_id FROM reminders r JOIN chat_identities ci ON ci.id = r.chat_identity_id WHERE r.id = ?),
             ?, 'FAILURE', ?
           )`,
        )
        .bind(
          input.auditId,
          input.reminderId,
          input.status,
          input.status,
          input.safeErrorCode,
          input.marker,
          input.suspendConnection ? 1 : 0,
          input.connectionId,
          input.reminderId,
          input.status === "UNCERTAIN" ? "REMINDER_DELIVERY_UNCERTAIN" : "REMINDER_DELIVERY_FAILED",
          input.reminderId,
          input.reminderId,
          input.reminderId,
          input.now,
        ),
    );

    await this.database.batch(statements);
  }

  async scheduleRetry(
    reminderId: string,
    marker: string,
    retryNotBefore: number,
    auditId: string,
    now: number,
  ): Promise<void> {
    await this.database.batch([
      this.database
        .prepare(
          `UPDATE reminder_deliveries
           SET status = 'RETRYABLE', provider_receipt = NULL,
               safe_error_code = 'QUOTA', sent_at = NULL,
               retry_not_before = ?, updated_at = ?
           WHERE reminder_id = ? AND status = 'SENDING' AND transition_marker = ?
             AND attempt_count < ?`,
        )
        .bind(retryNotBefore, now, reminderId, marker, MAX_DELIVERY_ATTEMPTS),
      this.database
        .prepare(
          `UPDATE reminders
           SET status = 'RETRYABLE', claimed_at = NULL,
               transition_marker = NULL, updated_at = ?
           WHERE id = ? AND status IN ('CLAIMED', 'RETRYABLE')
             AND EXISTS (
               SELECT 1 FROM reminder_deliveries d
               WHERE d.reminder_id = reminders.id AND d.status = 'RETRYABLE'
                 AND d.retry_not_before = ? AND d.transition_marker = ?
             )`,
        )
        .bind(now, reminderId, retryNotBefore, marker),
      this.database
        .prepare(
          `INSERT INTO audit_events (
             id, actor_user_id, action, target_user_id, target_connection_id,
             target_reminder_id, result, created_at
           ) VALUES (
             COALESCE((
               SELECT ? FROM reminders r
               JOIN reminder_deliveries d ON d.reminder_id = r.id
               WHERE r.id = ? AND r.status = 'RETRYABLE'
                 AND d.status = 'RETRYABLE' AND d.retry_not_before = ?
                 AND d.transition_marker = ?
             ), NULL),
             (SELECT w.owner_user_id FROM reminders r JOIN workspaces w ON w.id = r.workspace_id WHERE r.id = ?),
             'REMINDER_RETRY_SCHEDULED',
             (SELECT w.owner_user_id FROM reminders r JOIN workspaces w ON w.id = r.workspace_id WHERE r.id = ?),
             (SELECT ci.connection_id FROM reminders r JOIN chat_identities ci ON ci.id = r.chat_identity_id WHERE r.id = ?),
             ?, 'FAILURE', ?
           )`,
        )
        .bind(
          auditId,
          reminderId,
          retryNotBefore,
          marker,
          reminderId,
          reminderId,
          reminderId,
          reminderId,
          now,
        ),
    ]);
  }

  async failBeforeSend(input: FailBeforeSendInput): Promise<boolean> {
    try {
      await this.database.batch([
        this.database
          .prepare(
            `UPDATE reminders
             SET status = 'FAILED', claimed_at = NULL,
                 transition_marker = ?, updated_at = ?
             WHERE id = ? AND status IN ('PENDING', 'CLAIMED', 'RETRYABLE')
               AND NOT EXISTS (
                 SELECT 1 FROM reminder_deliveries d
                 WHERE d.reminder_id = reminders.id
                   AND d.status IN ('SENDING', 'SENT', 'FAILED', 'UNCERTAIN', 'CANCELLED')
               )`,
          )
          .bind(input.marker, input.now, input.reminderId),
        this.database
          .prepare(
            `INSERT OR IGNORE INTO reminder_deliveries (
               id, reminder_id, status, attempt_count, provider_receipt,
               safe_error_code, sent_at, send_started_at, retry_not_before,
               transition_marker, created_at, updated_at
             )
             SELECT ?, r.id, 'FAILED', 0, NULL, ?, NULL, NULL, NULL, ?, ?, ?
             FROM reminders r
             WHERE r.id = ? AND r.status = 'FAILED' AND r.transition_marker = ?
               AND NOT EXISTS (
                 SELECT 1 FROM reminder_deliveries d WHERE d.reminder_id = r.id
               )`,
          )
          .bind(
            input.deliveryId,
            input.safeErrorCode,
            input.marker,
            input.now,
            input.now,
            input.reminderId,
            input.marker,
          ),
        this.database
          .prepare(
            `UPDATE reminder_deliveries
             SET status = 'FAILED', provider_receipt = NULL,
                 safe_error_code = ?, sent_at = NULL, retry_not_before = NULL,
                 transition_marker = ?, updated_at = ?
             WHERE reminder_id = ? AND status IN ('PENDING', 'RETRYABLE')
               AND EXISTS (
                 SELECT 1 FROM reminders r
                 WHERE r.id = reminder_deliveries.reminder_id
                   AND r.status = 'FAILED' AND r.transition_marker = ?
               )`,
          )
          .bind(
            input.safeErrorCode,
            input.marker,
            input.now,
            input.reminderId,
            input.marker,
          ),
        this.database
          .prepare(
            `INSERT INTO audit_events (
               id, actor_user_id, action, target_user_id, target_connection_id,
               target_reminder_id, result, created_at
             ) VALUES (
               COALESCE((
                 SELECT ? FROM reminders r
                 JOIN reminder_deliveries d ON d.reminder_id = r.id
                 WHERE r.id = ? AND r.status = 'FAILED'
                   AND r.transition_marker = ? AND d.status = 'FAILED'
                   AND d.safe_error_code = ? AND d.transition_marker = ?
               ), NULL),
               (SELECT w.owner_user_id FROM reminders r JOIN workspaces w ON w.id = r.workspace_id WHERE r.id = ?),
               'REMINDER_DELIVERY_FAILED',
               (SELECT w.owner_user_id FROM reminders r JOIN workspaces w ON w.id = r.workspace_id WHERE r.id = ?),
               (SELECT ci.connection_id FROM reminders r JOIN chat_identities ci ON ci.id = r.chat_identity_id WHERE r.id = ?),
               ?, 'FAILURE', ?
             )`,
          )
          .bind(
            input.auditId,
            input.reminderId,
            input.marker,
            input.safeErrorCode,
            input.marker,
            input.reminderId,
            input.reminderId,
            input.reminderId,
            input.reminderId,
            input.now,
          ),
      ]);
      return true;
    } catch (error) {
      if (expectedGuardConflict(error)) return false;
      throw error;
    }
  }

  async reconcileStaleSending(
    reminderId: string,
    auditId: string,
    now: number,
  ): Promise<boolean> {
    const cutoff = now - DELIVERY_SEND_LEASE_MS;
    try {
      await this.database.batch([
        this.database
          .prepare(
            `UPDATE reminder_deliveries
             SET status = 'UNCERTAIN', safe_error_code = 'STALE_SENDING_LEASE',
                 retry_not_before = NULL, updated_at = ?
             WHERE reminder_id = ? AND status = 'SENDING'
               AND send_started_at IS NOT NULL AND send_started_at <= ?`,
          )
          .bind(now, reminderId, cutoff),
        this.database
          .prepare(
            `UPDATE reminders
             SET status = 'UNCERTAIN', updated_at = ?
             WHERE id = ? AND status IN ('CLAIMED', 'RETRYABLE')
               AND EXISTS (
                 SELECT 1 FROM reminder_deliveries d
                 WHERE d.reminder_id = reminders.id AND d.status = 'UNCERTAIN'
                   AND d.safe_error_code = 'STALE_SENDING_LEASE'
               )`,
          )
          .bind(now, reminderId),
        this.database
          .prepare(
            `INSERT INTO audit_events (
               id, actor_user_id, action, target_user_id, target_connection_id,
               target_reminder_id, result, created_at
             ) VALUES (
               COALESCE((
                 SELECT ? FROM reminders r
                 JOIN reminder_deliveries d ON d.reminder_id = r.id
                 WHERE r.id = ? AND r.status = 'UNCERTAIN'
                   AND d.status = 'UNCERTAIN'
                   AND d.safe_error_code = 'STALE_SENDING_LEASE'
               ), NULL),
               (SELECT w.owner_user_id FROM reminders r JOIN workspaces w ON w.id = r.workspace_id WHERE r.id = ?),
               'REMINDER_DELIVERY_UNCERTAIN',
               (SELECT w.owner_user_id FROM reminders r JOIN workspaces w ON w.id = r.workspace_id WHERE r.id = ?),
               (SELECT ci.connection_id FROM reminders r JOIN chat_identities ci ON ci.id = r.chat_identity_id WHERE r.id = ?),
               ?, 'FAILURE', ?
             )`,
          )
          .bind(
            auditId,
            reminderId,
            reminderId,
            reminderId,
            reminderId,
            reminderId,
            now,
          ),
      ]);
      return true;
    } catch (error) {
      if (expectedGuardConflict(error)) return false;
      throw error;
    }
  }

  async cancelBeforeSend(
    reminderId: string,
    marker: string,
    deliveryId: string,
    auditId: string,
    now: number,
  ): Promise<boolean> {
    try {
      await this.database.batch([
        this.database
          .prepare(
            `UPDATE reminders
             SET status = 'CANCELLED', cancelled_at = ?, claimed_at = NULL,
                 transition_marker = ?, updated_at = ?
             WHERE id = ? AND status IN ('PENDING', 'CLAIMED', 'RETRYABLE')
               AND NOT EXISTS (
                 SELECT 1 FROM reminder_deliveries d
                 WHERE d.reminder_id = reminders.id
                   AND d.status IN ('SENDING', 'SENT', 'FAILED', 'UNCERTAIN', 'CANCELLED')
               )`,
          )
          .bind(now, marker, now, reminderId),
        this.database
          .prepare(
            `INSERT OR IGNORE INTO reminder_deliveries (
               id, reminder_id, status, attempt_count, provider_receipt,
               safe_error_code, sent_at, send_started_at, retry_not_before,
               transition_marker, created_at, updated_at
             )
             SELECT ?, r.id, 'CANCELLED', 0, NULL, NULL, NULL, NULL, NULL, ?, ?, ?
             FROM reminders r
             WHERE r.id = ? AND r.status = 'CANCELLED'
               AND r.cancelled_at = ? AND r.transition_marker = ?
               AND NOT EXISTS (
                 SELECT 1 FROM reminder_deliveries d WHERE d.reminder_id = r.id
               )`,
          )
          .bind(deliveryId, marker, now, now, reminderId, now, marker),
        this.database
          .prepare(
            `UPDATE reminder_deliveries
             SET status = 'CANCELLED', provider_receipt = NULL,
                 safe_error_code = NULL, sent_at = NULL,
                 retry_not_before = NULL, transition_marker = ?, updated_at = ?
             WHERE reminder_id = ? AND status IN ('PENDING', 'RETRYABLE')
               AND EXISTS (
                 SELECT 1 FROM reminders r
                 WHERE r.id = reminder_deliveries.reminder_id
                   AND r.status = 'CANCELLED' AND r.cancelled_at = ?
                   AND r.transition_marker = ?
               )`,
          )
          .bind(marker, now, reminderId, now, marker),
        this.database
          .prepare(
            `INSERT INTO audit_events (
               id, actor_user_id, action, target_user_id, target_connection_id,
               target_reminder_id, result, created_at
             ) VALUES (
               COALESCE((
                 SELECT ? FROM reminders r
                 JOIN reminder_deliveries d ON d.reminder_id = r.id
                 WHERE r.id = ? AND r.status = 'CANCELLED'
                   AND r.cancelled_at = ? AND r.transition_marker = ?
                   AND d.status = 'CANCELLED' AND d.transition_marker = ?
               ), NULL),
               (SELECT w.owner_user_id FROM reminders r JOIN workspaces w ON w.id = r.workspace_id WHERE r.id = ?),
               'REMINDER_CANCELLED',
               (SELECT w.owner_user_id FROM reminders r JOIN workspaces w ON w.id = r.workspace_id WHERE r.id = ?),
               (SELECT ci.connection_id FROM reminders r JOIN chat_identities ci ON ci.id = r.chat_identity_id WHERE r.id = ?),
               ?, 'SUCCESS', ?
             )`,
          )
          .bind(
            auditId,
            reminderId,
            now,
            marker,
            marker,
            reminderId,
            reminderId,
            reminderId,
            reminderId,
            now,
          ),
      ]);
      return true;
    } catch (error) {
      if (expectedGuardConflict(error)) return false;
      throw error;
    }
  }
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
  if (!context) return { status: "MISSING" };
  const terminal = terminalOutcome(context);
  if (terminal) return terminal;

  if (context.deliveryStatus === "SENDING") {
    if (
      context.sendStartedAt !== null
      && context.sendStartedAt <= startedAt - DELIVERY_SEND_LEASE_MS
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
