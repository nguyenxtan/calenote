import { d1Changes } from "@/modules/platform/types";
import type {
  ActionCandidateRow,
  CreateActionCandidateRecord,
  SourceActionStore,
} from "../../service";

export class D1SourceActionStore implements SourceActionStore {
  constructor(private readonly database: D1Database) {}

  async createCandidate(record: CreateActionCandidateRecord): Promise<boolean> {
    const result = await this.database.prepare(
      `INSERT INTO action_candidates (
         id, source_item_id, workspace_id, action_type, title_ciphertext,
         title_iv, title_key_version, scheduled_at, timezone, status, created_at, updated_at
       )
       SELECT ?, item.id, item.workspace_id, 'REMINDER', ?, ?, ?, ?, ?, 'PENDING', ?, ?
       FROM source_items item
       JOIN source_connections source
         ON source.id = item.source_connection_id AND source.workspace_id = item.workspace_id
       WHERE item.id = ? AND item.workspace_id = ? AND source.status = 'ACTIVE'`,
    ).bind(
      record.id,
      record.encryptedTitle.ciphertext,
      record.encryptedTitle.iv,
      record.titleKeyVersion,
      record.scheduledAt,
      record.timezone,
      record.now,
      record.now,
      record.sourceItemId,
      record.workspaceId,
    ).run();
    return d1Changes(result) === 1;
  }

  async findOwnedCandidate(userId: string, candidateId: string): Promise<ActionCandidateRow | null> {
    return this.database.prepare(
      `SELECT candidate.id, candidate.workspace_id, candidate.status,
              candidate.title_ciphertext, candidate.title_iv, candidate.title_key_version,
              candidate.scheduled_at, candidate.timezone
       FROM action_candidates candidate
       JOIN workspaces workspace ON workspace.id = candidate.workspace_id
       JOIN memberships membership
         ON membership.workspace_id = workspace.id AND membership.user_id = workspace.owner_user_id
       WHERE candidate.id = ? AND workspace.kind = 'PERSONAL'
         AND workspace.owner_user_id = ? AND membership.role = 'OWNER'
       LIMIT 1`,
    ).bind(candidateId, userId).first<ActionCandidateRow>();
  }

  async approveCandidate(input: {
    userId: string;
    candidateId: string;
    decisionId: string;
    reminderId: string;
    reminderPublicId: string;
    encryptedTitle: { ciphertext: ArrayBuffer; iv: ArrayBuffer };
    titleKeyVersion: number;
    now: number;
  }): Promise<boolean> {
    const results = await this.database.batch([
      this.database.prepare(
        `INSERT INTO reminders (
           id, public_id, workspace_id, chat_identity_id, source_draft_id,
           title_ciphertext, title_iv, title_key_version, scheduled_at, timezone,
           status, claimed_at, cancelled_at, created_at, updated_at
         )
         SELECT ?, ?, candidate.workspace_id, MIN(identity.id), NULL, ?, ?, ?,
                candidate.scheduled_at, candidate.timezone, 'PENDING', NULL, NULL, ?, ?
         FROM action_candidates candidate
         JOIN workspaces workspace ON workspace.id = candidate.workspace_id
         JOIN memberships membership
           ON membership.workspace_id = workspace.id AND membership.user_id = workspace.owner_user_id
         JOIN bot_connections connection
           ON connection.user_id = workspace.owner_user_id AND connection.state = 'ACTIVE_BOUND'
         JOIN chat_identities identity ON identity.connection_id = connection.id
         WHERE candidate.id = ? AND candidate.status = 'PENDING'
           AND candidate.scheduled_at > ? AND workspace.kind = 'PERSONAL'
           AND workspace.owner_user_id = ? AND membership.role = 'OWNER'
           AND NOT EXISTS (
             SELECT 1 FROM action_decisions decision
             WHERE decision.action_candidate_id = candidate.id
           )
         GROUP BY candidate.id
         HAVING COUNT(identity.id) = 1`,
      ).bind(
        input.reminderId,
        input.reminderPublicId,
        input.encryptedTitle.ciphertext,
        input.encryptedTitle.iv,
        input.titleKeyVersion,
        input.now,
        input.now,
        input.candidateId,
        input.now,
        input.userId,
      ),
      this.database.prepare(
        `INSERT INTO action_decisions (
           id, action_candidate_id, workspace_id, decided_by_user_id,
           decision, created_reminder_id, decided_at
         )
         SELECT ?, candidate.id, candidate.workspace_id, ?, 'APPROVED', ?, ?
         FROM action_candidates candidate
         JOIN workspaces workspace ON workspace.id = candidate.workspace_id
         JOIN memberships membership
           ON membership.workspace_id = workspace.id AND membership.user_id = workspace.owner_user_id
         JOIN reminders reminder
           ON reminder.id = ? AND reminder.workspace_id = candidate.workspace_id
         WHERE candidate.id = ? AND candidate.status = 'PENDING'
           AND workspace.kind = 'PERSONAL' AND workspace.owner_user_id = ?
           AND membership.role = 'OWNER'`,
      ).bind(
        input.decisionId,
        input.userId,
        input.reminderId,
        input.now,
        input.reminderId,
        input.candidateId,
        input.userId,
      ),
      this.database.prepare(
        `UPDATE action_candidates
         SET status = 'APPROVED', updated_at = ?
         WHERE id = ? AND status = 'PENDING'
           AND EXISTS (
             SELECT 1 FROM action_decisions decision
             WHERE decision.id = ? AND decision.action_candidate_id = action_candidates.id
               AND decision.decision = 'APPROVED'
           )`,
      ).bind(input.now, input.candidateId, input.decisionId),
    ]);
    return results.length === 3 && results.every((result) => d1Changes(result) === 1);
  }

  async rejectCandidate(input: {
    userId: string;
    candidateId: string;
    decisionId: string;
    now: number;
  }): Promise<boolean> {
    const results = await this.database.batch([
      this.database.prepare(
        `INSERT INTO action_decisions (
           id, action_candidate_id, workspace_id, decided_by_user_id,
           decision, created_reminder_id, decided_at
         )
         SELECT ?, candidate.id, candidate.workspace_id, ?, 'REJECTED', NULL, ?
         FROM action_candidates candidate
         JOIN workspaces workspace ON workspace.id = candidate.workspace_id
         JOIN memberships membership
           ON membership.workspace_id = workspace.id AND membership.user_id = workspace.owner_user_id
         WHERE candidate.id = ? AND candidate.status = 'PENDING'
           AND workspace.kind = 'PERSONAL' AND workspace.owner_user_id = ?
           AND membership.role = 'OWNER'`,
      ).bind(input.decisionId, input.userId, input.now, input.candidateId, input.userId),
      this.database.prepare(
        `UPDATE action_candidates
         SET status = 'REJECTED', updated_at = ?
         WHERE id = ? AND status = 'PENDING'
           AND EXISTS (
             SELECT 1 FROM action_decisions decision
             WHERE decision.id = ? AND decision.action_candidate_id = action_candidates.id
               AND decision.decision = 'REJECTED'
           )`,
      ).bind(input.now, input.candidateId, input.decisionId),
    ]);
    return results.length === 2 && results.every((result) => d1Changes(result) === 1);
  }
}
