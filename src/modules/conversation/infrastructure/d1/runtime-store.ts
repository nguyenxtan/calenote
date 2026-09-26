import type { ConversationScope } from "../../contracts";
import { ownedInbound, auth } from "./context-store";

export interface ConversationRuntimeStore {
  ownsPendingDraft(scope: ConversationScope, draftId: string): Promise<boolean>;
  claimAttempt(scope: ConversationScope): Promise<boolean>;
  complete(scope: ConversationScope): Promise<boolean>;
}

export class D1ConversationRuntimeStore implements ConversationRuntimeStore {
  constructor(private readonly db: D1Database) {}
  async ownsPendingDraft(scope: ConversationScope, draftId: string): Promise<boolean> {
    return Boolean(await this.db.prepare(`SELECT 1 FROM command_drafts d
      JOIN conversation_contexts c ON c.chat_identity_id = d.chat_identity_id AND c.last_inbound_id = d.source_inbound_id
      JOIN command_draft_calendar_facts f ON f.draft_id = d.id
      WHERE d.id = ? AND d.status = 'PENDING' AND d.expires_at > ?
        AND c.owner_id = ? AND c.chat_identity_id = ? AND c.status = 'DRAFT_READY'
        AND c.expires_at > ? AND EXISTS (${ownedInbound})`)
      .bind(draftId, scope.now, scope.ownerId, scope.chatIdentityId, scope.now, ...auth(scope)).first());
  }
  async claimAttempt(scope: ConversationScope): Promise<boolean> {
    const result = await this.db.prepare(`INSERT INTO audit_events
      (id,actor_user_id,action,target_user_id,result,created_at)
      SELECT ?,?,'SEMANTIC_ATTEMPT_CLAIMED',?,'SUCCESS',? WHERE EXISTS (${ownedInbound})
      ON CONFLICT (id) DO NOTHING`).bind(`semantic-attempt:${scope.sourceInboundId}`, scope.ownerId, scope.ownerId,
      scope.now, ...auth(scope)).run();
    return result.meta.changes === 1;
  }
  async complete(scope: ConversationScope): Promise<boolean> {
    const result = await this.db.prepare(`UPDATE inbound_updates SET state = 'PROCESSED', processed_at = ?
      WHERE id = ? AND EXISTS (${ownedInbound})`).bind(scope.now, scope.sourceInboundId, ...auth(scope)).run();
    return result.meta.changes === 1;
  }
}
