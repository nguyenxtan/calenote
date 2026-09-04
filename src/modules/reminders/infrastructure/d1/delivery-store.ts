import type {
  AcquireDeliveryResult,
  FailBeforeSendInput,
  FinalizeTerminalInput,
  ReminderDeliveryContext,
  ReminderDeliveryStore,
} from "../../delivery";
import { contextFromRow, expectedGuardConflict, secondsUntil, type DeliveryContextRow, type OwnedDelivery } from "../../delivery";
import { DELIVERY_SEND_LEASE_MS, MAX_DELIVERY_ATTEMPTS } from "../../scheduler";

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
         JOIN workspaces w ON w.id = r.workspace_id
         JOIN chat_identities ci ON ci.id = r.chat_identity_id
         JOIN bot_connections c ON c.id = ci.connection_id
           AND c.user_id = w.owner_user_id
         LEFT JOIN reminder_deliveries d ON d.reminder_id = r.id
         WHERE r.id = ?
         LIMIT 1`,
      )
      .bind(reminderId)
      .first<DeliveryContextRow>();
    return row ? contextFromRow(row) : null;
  }

  private async commitOwnership(
    mutation: D1PreparedStatement,
    reminderId: string,
    marker: string,
    now: number,
  ): Promise<OwnedDelivery | null> {
    try {
      await this.database.batch([
        mutation,
        this.database
          .prepare(
            `UPDATE reminders
             SET status = 'CLAIMED', claimed_at = ?, transition_marker = ?, updated_at = ?
             WHERE id = ? AND status IN ('CLAIMED', 'RETRYABLE')
               AND EXISTS (
                 SELECT 1
                 FROM reminder_deliveries d
                 JOIN chat_identities ci ON ci.id = reminders.chat_identity_id
                 JOIN bot_connections c ON c.id = ci.connection_id
                 JOIN workspaces w ON w.id = reminders.workspace_id
                   AND w.owner_user_id = c.user_id
                 WHERE d.reminder_id = reminders.id AND d.status = 'SENDING'
                   AND d.send_started_at = ? AND d.transition_marker = ?
                   AND c.state = 'ACTIVE_BOUND'
               )`,
          )
          .bind(now, marker, now, reminderId, now, marker),
        this.database
          .prepare(
            `INSERT INTO audit_events (
               id, actor_user_id, action, target_user_id, target_connection_id,
               target_reminder_id, result, created_at
             ) VALUES (
               COALESCE((
                 SELECT ? FROM reminders r
                 JOIN workspaces w ON w.id = r.workspace_id
                 JOIN chat_identities ci ON ci.id = r.chat_identity_id
                 JOIN bot_connections c ON c.id = ci.connection_id
                   AND c.user_id = w.owner_user_id
                 JOIN reminder_deliveries d ON d.reminder_id = r.id
                 WHERE r.id = ? AND r.status = 'CLAIMED' AND r.claimed_at = ?
                   AND r.transition_marker = ? AND d.status = 'SENDING'
                   AND d.send_started_at = ? AND d.transition_marker = ?
                   AND c.state = 'ACTIVE_BOUND'
               ), NULL),
               (SELECT w.owner_user_id FROM reminders r JOIN workspaces w ON w.id = r.workspace_id WHERE r.id = ?),
               'REMINDER_DELIVERY_STARTED',
               (SELECT w.owner_user_id FROM reminders r JOIN workspaces w ON w.id = r.workspace_id WHERE r.id = ?),
               (SELECT ci.connection_id FROM reminders r JOIN chat_identities ci ON ci.id = r.chat_identity_id WHERE r.id = ?),
               ?, 'SUCCESS', ?
             )`,
          )
          .bind(
            marker,
            reminderId,
            now,
            marker,
            now,
            marker,
            reminderId,
            reminderId,
            reminderId,
            reminderId,
            now,
          ),
      ]);
    } catch (error) {
      if (expectedGuardConflict(error)) return null;
      throw error;
    }

    const owned = await this.database
      .prepare(
        `SELECT id, attempt_count
         FROM reminder_deliveries
         WHERE reminder_id = ? AND status = 'SENDING'
           AND send_started_at = ? AND transition_marker = ?
         LIMIT 1`,
      )
      .bind(reminderId, now, marker)
      .first<{ id: string; attempt_count: number }>();
    if (!owned) throw new Error("Owned reminder delivery was unavailable");
    return {
      deliveryId: owned.id,
      marker,
      attemptCount: owned.attempt_count,
    };
  }

  async acquire(
    reminderId: string,
    deliveryId: string,
    marker: string,
    now: number,
  ): Promise<AcquireDeliveryResult> {
    const inserted = await this.commitOwnership(
      this.database.prepare(
        `INSERT OR IGNORE INTO reminder_deliveries (
           id, reminder_id, status, attempt_count, provider_receipt,
           safe_error_code, sent_at, send_started_at, retry_not_before,
           transition_marker, created_at, updated_at
         )
         SELECT ?, r.id, 'SENDING', 1, NULL, NULL, NULL, ?, NULL, ?, ?, ?
         FROM reminders r
         JOIN workspaces w ON w.id = r.workspace_id
         JOIN chat_identities ci ON ci.id = r.chat_identity_id
         JOIN bot_connections c ON c.id = ci.connection_id
           AND c.user_id = w.owner_user_id
         WHERE r.id = ? AND r.status IN ('CLAIMED', 'RETRYABLE')
           AND c.state = 'ACTIVE_BOUND'
           AND NOT EXISTS (
             SELECT 1 FROM reminder_deliveries d WHERE d.reminder_id = r.id
           )
         `,
      )
        .bind(deliveryId, now, marker, now, now, reminderId),
      reminderId,
      marker,
      now,
    );
    if (inserted) return { status: "OWNED", delivery: inserted };

    const updated = await this.commitOwnership(
      this.database.prepare(
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
             JOIN workspaces w ON w.id = r.workspace_id
             JOIN chat_identities ci ON ci.id = r.chat_identity_id
             JOIN bot_connections c ON c.id = ci.connection_id
               AND c.user_id = w.owner_user_id
             WHERE r.id = reminder_deliveries.reminder_id
               AND r.status IN ('CLAIMED', 'RETRYABLE')
               AND c.state = 'ACTIVE_BOUND'
           )`,
      )
        .bind(now, marker, now, reminderId, MAX_DELIVERY_ATTEMPTS, now),
      reminderId,
      marker,
      now,
    );
    if (updated) return { status: "OWNED", delivery: updated };

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
             AND transition_marker = ?
             AND EXISTS (
               SELECT 1 FROM reminder_deliveries d
               WHERE d.reminder_id = reminders.id AND d.status = 'SENT'
                 AND d.transition_marker = ?
             )`,
        )
        .bind(now, reminderId, marker, marker),
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
                 AND r.transition_marker = ?
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
             AND transition_marker = ?
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
          input.marker,
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
                 AND r.transition_marker = ?
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
          input.marker,
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
             AND transition_marker = ?
             AND EXISTS (
               SELECT 1 FROM reminder_deliveries d
               WHERE d.reminder_id = reminders.id AND d.status = 'RETRYABLE'
                 AND d.retry_not_before = ? AND d.transition_marker = ?
             )`,
        )
        .bind(now, reminderId, marker, retryNotBefore, marker),
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
               AND send_started_at IS NOT NULL AND send_started_at < ?`,
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
