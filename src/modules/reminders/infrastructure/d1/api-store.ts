import { d1Changes } from "@/modules/platform/types";
import type {
  CancellationRow,
  ManualReminderRecord,
  OwnedReminderRow,
  ReminderApiStore,
} from "../../api-service";

function guardedReminderFailure(error: unknown): boolean {
  return error instanceof Error
    && /NOT NULL constraint failed:\s*audit_events\.id/iu.test(error.message);
}

export class D1ReminderApiStore implements ReminderApiStore {
  constructor(private readonly database: D1Database) {}

  async listOwned(userId: string, limit: number): Promise<OwnedReminderRow[]> {
    const result = await this.database
      .prepare(
        `SELECT r.id, r.public_id, r.title_ciphertext, r.title_iv,
                r.title_key_version, r.scheduled_at, r.timezone, r.status
         FROM memberships m
         JOIN workspaces w
           ON w.id = m.workspace_id AND w.kind = 'PERSONAL'
             AND w.owner_user_id = m.user_id
         JOIN reminders r ON r.workspace_id = w.id
         WHERE m.user_id = ? AND m.role = 'OWNER'
         ORDER BY
           CASE WHEN r.status IN ('PENDING', 'CLAIMED', 'RETRYABLE') THEN 0 ELSE 1 END,
           CASE WHEN r.status IN ('PENDING', 'CLAIMED', 'RETRYABLE') THEN r.scheduled_at END ASC,
           CASE WHEN r.status NOT IN ('PENDING', 'CLAIMED', 'RETRYABLE') THEN r.updated_at END DESC,
           r.public_id ASC
         LIMIT ?`,
      )
      .bind(userId, limit)
      .all<OwnedReminderRow>();
    return result.results;
  }

  async createManual(record: ManualReminderRecord): Promise<boolean> {
    const statements = [
      this.database
        .prepare(
          `INSERT INTO reminders (
             id, public_id, workspace_id, chat_identity_id, source_draft_id,
             title_ciphertext, title_iv, title_key_version, scheduled_at,
             timezone, status, claimed_at, cancelled_at, transition_marker,
             created_at, updated_at
           )
           SELECT ?, ?, eligible.workspace_id, eligible.chat_identity_id, NULL,
                  ?, ?, ?, ?, ?, 'PENDING', NULL, NULL, NULL, ?, ?
           FROM (
             SELECT MIN(w.id) AS workspace_id, MIN(ci.id) AS chat_identity_id
             FROM users u
             JOIN workspaces w
               ON w.owner_user_id = u.id AND w.kind = 'PERSONAL'
             JOIN memberships m
               ON m.workspace_id = w.id AND m.user_id = u.id AND m.role = 'OWNER'
             JOIN bot_connections c
               ON c.user_id = u.id AND c.state = 'ACTIVE_BOUND'
             JOIN chat_identities ci ON ci.connection_id = c.id
             WHERE u.id = ?
             GROUP BY u.id
             HAVING COUNT(*) = 1
           ) AS eligible`,
        )
        .bind(
          record.id,
          record.publicId,
          record.encryptedTitle.ciphertext,
          record.encryptedTitle.iv,
          record.titleKeyVersion,
          record.scheduledAt,
          record.timezone,
          record.now,
          record.now,
          record.userId,
        ),
      this.database
        .prepare(
          `INSERT INTO audit_events (
             id, actor_user_id, action, target_user_id, target_connection_id,
             target_reminder_id, result, created_at
           ) VALUES (
             COALESCE((
               SELECT ? FROM reminders r
               JOIN workspaces w ON w.id = r.workspace_id
               WHERE r.id = ? AND r.public_id = ? AND w.owner_user_id = ?
             ), NULL), ?, 'REMINDER_CREATED', ?,
             (SELECT ci.connection_id FROM reminders r
                JOIN chat_identities ci ON ci.id = r.chat_identity_id
                WHERE r.id = ?),
             ?, 'SUCCESS', ?
           )`,
        )
        .bind(
          record.auditId,
          record.id,
          record.publicId,
          record.userId,
          record.userId,
          record.userId,
          record.id,
          record.id,
          record.now,
        ),
    ];
    try {
      const results = await this.database.batch(statements);
      return results.length === statements.length
        && results.every((result) => d1Changes(result) === 1);
    } catch (error) {
      if (guardedReminderFailure(error)) return false;
      throw error;
    }
  }

  async findOwnedForCancellation(
    userId: string,
    publicId: string,
  ): Promise<CancellationRow | null> {
    return this.database
      .prepare(
        `SELECT r.id, r.status, d.status AS delivery_status
         FROM memberships m
         JOIN workspaces w
           ON w.id = m.workspace_id AND w.kind = 'PERSONAL'
             AND w.owner_user_id = m.user_id
         JOIN reminders r ON r.workspace_id = w.id
         LEFT JOIN reminder_deliveries d ON d.reminder_id = r.id
         WHERE m.user_id = ? AND m.role = 'OWNER' AND r.public_id = ?
         LIMIT 1`,
      )
      .bind(userId, publicId)
      .first<CancellationRow>();
  }

  async cancelOwned(input: {
    userId: string;
    publicId: string;
    marker: string;
    deliveryId: string;
    auditId: string;
    now: number;
  }): Promise<boolean> {
    const ownerGuard = `EXISTS (
      SELECT 1 FROM workspaces w
      JOIN memberships m ON m.workspace_id = w.id
      WHERE w.id = reminders.workspace_id AND w.kind = 'PERSONAL'
        AND w.owner_user_id = ? AND m.user_id = ? AND m.role = 'OWNER'
    )`;
    const statements = [
      this.database
        .prepare(
          `UPDATE reminders
           SET status = 'CANCELLED', cancelled_at = ?, claimed_at = NULL,
               transition_marker = ?, updated_at = ?
           WHERE public_id = ? AND status IN ('PENDING', 'CLAIMED', 'RETRYABLE')
             AND ${ownerGuard}
             AND NOT EXISTS (
               SELECT 1 FROM reminder_deliveries d
               WHERE d.reminder_id = reminders.id
                 AND d.status IN ('SENDING', 'SENT', 'FAILED', 'UNCERTAIN', 'CANCELLED')
             )`,
        )
        .bind(
          input.now,
          input.marker,
          input.now,
          input.publicId,
          input.userId,
          input.userId,
        ),
      this.database
        .prepare(
          `INSERT OR IGNORE INTO reminder_deliveries (
             id, reminder_id, status, attempt_count, provider_receipt,
             safe_error_code, sent_at, send_started_at, retry_not_before,
             transition_marker, created_at, updated_at
           )
           SELECT ?, r.id, 'CANCELLED', 0, NULL, NULL, NULL, NULL, NULL,
                  ?, ?, ?
           FROM reminders r
           JOIN workspaces w ON w.id = r.workspace_id
           JOIN memberships m ON m.workspace_id = w.id
           WHERE r.public_id = ? AND r.status = 'CANCELLED'
             AND r.cancelled_at = ? AND r.transition_marker = ?
             AND w.kind = 'PERSONAL' AND w.owner_user_id = ?
             AND m.user_id = ? AND m.role = 'OWNER'
             AND NOT EXISTS (
               SELECT 1 FROM reminder_deliveries d WHERE d.reminder_id = r.id
             )`,
        )
        .bind(
          input.deliveryId,
          input.marker,
          input.now,
          input.now,
          input.publicId,
          input.now,
          input.marker,
          input.userId,
          input.userId,
        ),
      this.database
        .prepare(
          `UPDATE reminder_deliveries
           SET status = 'CANCELLED', provider_receipt = NULL,
               safe_error_code = NULL, sent_at = NULL,
               retry_not_before = NULL, transition_marker = ?, updated_at = ?
           WHERE status IN ('PENDING', 'RETRYABLE')
             AND reminder_id = (
               SELECT r.id FROM reminders r
               JOIN workspaces w ON w.id = r.workspace_id
               JOIN memberships m ON m.workspace_id = w.id
               WHERE r.public_id = ? AND r.status = 'CANCELLED'
                 AND r.cancelled_at = ? AND r.transition_marker = ?
                 AND w.kind = 'PERSONAL' AND w.owner_user_id = ?
                 AND m.user_id = ? AND m.role = 'OWNER'
             )`,
        )
        .bind(
          input.marker,
          input.now,
          input.publicId,
          input.now,
          input.marker,
          input.userId,
          input.userId,
        ),
      this.database
        .prepare(
          `INSERT INTO audit_events (
             id, actor_user_id, action, target_user_id, target_connection_id,
             target_reminder_id, result, created_at
           ) VALUES (
             COALESCE((
               SELECT ? FROM reminders r
               JOIN workspaces w ON w.id = r.workspace_id
               JOIN memberships m ON m.workspace_id = w.id
               JOIN reminder_deliveries d ON d.reminder_id = r.id
               WHERE r.public_id = ? AND r.status = 'CANCELLED'
                 AND r.cancelled_at = ? AND r.transition_marker = ?
                 AND d.status = 'CANCELLED' AND d.transition_marker = ?
                 AND w.owner_user_id = ? AND m.user_id = ? AND m.role = 'OWNER'
             ), NULL), ?, 'REMINDER_CANCELLED', ?,
             (SELECT ci.connection_id FROM reminders r
                JOIN chat_identities ci ON ci.id = r.chat_identity_id
                WHERE r.public_id = ?),
             (SELECT id FROM reminders WHERE public_id = ?), 'SUCCESS', ?
           )`,
        )
        .bind(
          input.auditId,
          input.publicId,
          input.now,
          input.marker,
          input.marker,
          input.userId,
          input.userId,
          input.userId,
          input.userId,
          input.publicId,
          input.publicId,
          input.now,
        ),
    ];

    try {
      await this.database.batch(statements);
      return true;
    } catch (error) {
      if (guardedReminderFailure(error)) return false;
      throw error;
    }
  }
}
