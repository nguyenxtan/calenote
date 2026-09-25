import type { ConversationScope } from "../../contracts";
import { ownedInbound, auth } from "./context-store";

export interface ConversationRuntimeStore {
  claimAttempt(scope: ConversationScope): Promise<boolean>;
  complete(scope: ConversationScope): Promise<boolean>;
}

export class D1ConversationRuntimeStore implements ConversationRuntimeStore {
  constructor(private readonly db: D1Database) {}
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
