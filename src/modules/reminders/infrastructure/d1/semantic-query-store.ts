import { persistedD1Blob } from "@/modules/db/persisted-blob";
import { SEMANTIC_QUERY_LIMIT, type QueriedReminder, type SemanticReminderQuery } from "../../semantic-query";

export class D1SemanticReminderQueryStore {
  constructor(private readonly database: D1Database) {}

  async list(input: SemanticReminderQuery): Promise<QueriedReminder[]> {
    const { start, end } = input.range;
    if (![start, end].every(Number.isSafeInteger) || end <= start || end - start > 30 * 86_400_000) return [];
    const rows = await this.database.prepare(
      `SELECT r.id,r.title_ciphertext,r.title_iv,r.title_key_version,r.scheduled_at
       FROM inbound_updates i
       JOIN bot_connections c ON c.id=i.connection_id AND c.state='ACTIVE_BOUND'
       JOIN chat_identities ci ON ci.connection_id=c.id
         AND ci.provider_user_id=i.provider_user_id AND ci.private_chat_id=i.private_chat_id
       JOIN workspaces w ON w.owner_user_id=c.user_id AND w.kind='PERSONAL'
       JOIN memberships m ON m.workspace_id=w.id AND m.user_id=c.user_id AND m.role='OWNER'
       JOIN reminders r ON r.workspace_id=w.id AND r.chat_identity_id=ci.id
       WHERE i.id=? AND i.connection_id=? AND i.provider_user_id=? AND i.private_chat_id=?
         AND i.state='PROCESSING' AND i.transition_marker=?
         AND c.user_id=? AND ci.id=? AND w.id=?
         AND r.scheduled_at>=? AND r.scheduled_at<?
         AND r.status IN ('PENDING','CLAIMED','RETRYABLE')
       ORDER BY r.scheduled_at,r.id LIMIT ?`,
    ).bind(input.message.id, input.message.connectionId, input.message.providerUserId,
      input.message.privateChatId, input.message.claimMarker, input.context.userId,
      input.context.chatIdentityId, input.context.workspaceId, start, end, SEMANTIC_QUERY_LIMIT)
      .all<{ id: string; title_ciphertext: unknown; title_iv: unknown; title_key_version: number; scheduled_at: number }>();
    return rows.results.map((row) => ({ id: row.id, titleKeyVersion: row.title_key_version,
      scheduledAt: row.scheduled_at, encryptedTitle: {
        ciphertext: persistedD1Blob(row.title_ciphertext), iv: persistedD1Blob(row.title_iv),
      } }));
  }
}
