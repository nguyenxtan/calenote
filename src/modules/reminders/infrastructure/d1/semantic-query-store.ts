import { persistedD1Blob } from "@/modules/db/persisted-blob";
import { newerConversationOutcomeSql } from "@/modules/semantic/infrastructure/d1/conversation-order";
import { SEMANTIC_QUERY_LIMIT, type QueriedReminder, type SemanticReminderQuery } from "../../semantic-query";
import { CONTEXT_QUERY_PARTIAL, CONTEXT_QUERY_SCOPE, CONTEXT_STATUS_LABELS, type ContextQueryResult, type ContextReminderQuery, type ContextReminderStatus } from "@/modules/conversation/context-contract/query";

export class D1SemanticReminderQueryStore {
  constructor(private readonly database: D1Database) {}

  /** Separate successor policy. One SELECT checks authority/order and rows at
   * the same database snapshot; no check-then-query race or empty-on-failure. */
  async listContext(input: ContextReminderQuery): Promise<ContextQueryResult> {
    const { start, end } = input.range;
    const day = 86400000, today = Math.floor((input.referenceTime + 7 * 3600000) / day) * day - 7 * 3600000;
    if (![start, end, input.referenceTime, input.message.receivedAt, input.context.inboundRowId].every(Number.isSafeInteger) || input.context.timezone !== "Asia/Ho_Chi_Minh" || end <= start || end - start > 366 * day || Math.abs(start - today) > 366 * day || Math.abs((end - 1) - today) >= 367 * day) return { status: "INVALID", reason: "INVALID_RANGE_OR_REFERENCE" };
    try {
      const rows = await this.database.prepare(`WITH authority AS (
        SELECT ci.id chat_identity_id,w.id workspace_id,
          (i.state<>'PROCESSING' OR i.transition_marker IS NULL OR i.transition_marker<>? OR i.received_at<>? OR i.rowid<>?
            OR ${newerConversationOutcomeSql("i")}
            OR EXISTS (SELECT 1 FROM conversation_context_outcomes outcome
              JOIN inbound_updates later ON later.id=outcome.source_inbound_id
              WHERE later.connection_id=i.connection_id AND later.provider_user_id=i.provider_user_id AND later.private_chat_id=i.private_chat_id
                AND (later.received_at>i.received_at OR (later.received_at=i.received_at AND later.rowid>i.rowid)))
            OR EXISTS (SELECT 1 FROM conversation_contexts wc WHERE wc.chat_identity_id=ci.id AND wc.owner_id=c.user_id
              AND wc.claim_marker LIKE 'web:%' AND wc.updated_at>=i.received_at)) stale
        FROM inbound_updates i
        JOIN bot_connections c ON c.id=i.connection_id AND c.state='ACTIVE_BOUND'
        JOIN chat_identities ci ON ci.connection_id=c.id AND ci.provider_user_id=i.provider_user_id AND ci.private_chat_id=i.private_chat_id
        JOIN workspaces w ON w.owner_user_id=c.user_id AND w.kind='PERSONAL'
        JOIN memberships m ON m.workspace_id=w.id AND m.user_id=c.user_id AND m.role='OWNER'
        WHERE i.id=? AND i.connection_id=? AND i.provider_user_id=? AND i.private_chat_id=?
          AND c.user_id=? AND ci.id=? AND w.id=?
      ) SELECT a.stale,r.id,r.title_ciphertext,r.title_iv,r.title_key_version,r.scheduled_at,r.status
        FROM authority a LEFT JOIN reminders r ON a.stale=0 AND r.workspace_id=a.workspace_id AND r.chat_identity_id=a.chat_identity_id
          AND r.scheduled_at>=? AND r.scheduled_at<?
          AND r.status IN ('PENDING','CLAIMED','RETRYABLE','SENT','FAILED','UNCERTAIN')
        ORDER BY r.scheduled_at,r.id LIMIT 6`)
        .bind(input.message.claimMarker, input.message.receivedAt, input.context.inboundRowId, input.message.id, input.message.connectionId, input.message.providerUserId, input.message.privateChatId, input.context.userId, input.context.chatIdentityId, input.context.workspaceId, start, end)
        .all<{ stale: number; id: string | null; title_ciphertext: unknown; title_iv: unknown; title_key_version: number; scheduled_at: number; status: ContextReminderStatus }>();
      if (!rows.results.length) return { status: "UNAUTHORIZED", reason: "SCOPE_NOT_BOUND" };
      if (rows.results[0].stale) return { status: "STALE", reason: "INBOUND_SUPERSEDED_OR_UNOWNED" };
      const selected = rows.results.filter(row => row.id !== null), hasMore = selected.length > 5;
      return {
        status: "RESULTS",
        rows: selected.slice(0, 5).map(row => ({
          id: row.id!, scheduledAt: row.scheduled_at, status: row.status,
          statusLabel: CONTEXT_STATUS_LABELS[row.status], titleKeyVersion: row.title_key_version,
          encryptedTitle: { ciphertext: persistedD1Blob(row.title_ciphertext), iv: persistedD1Blob(row.title_iv) },
        })),
        hasMore, partialNotice: hasMore ? CONTEXT_QUERY_PARTIAL : null,
        scopeLabel: CONTEXT_QUERY_SCOPE,
        calendarNotice: "Xem thêm trong Calendar sau khi đăng nhập; web có thể hiển thị các kênh khác bạn được phép xem và vẫn có giới hạn kết quả.",
      };
    } catch { return { status: "UNAVAILABLE", reason: "QUERY_FAILED" }; }
  }

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
         AND NOT ${newerConversationOutcomeSql("i")}
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
