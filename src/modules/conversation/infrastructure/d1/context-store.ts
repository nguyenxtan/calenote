import type { Keyring } from "@/modules/security/keyring";
import { persistedD1Blob } from "@/modules/db/persisted-blob";
import { newerConversationOutcomeSql } from "@/modules/semantic/infrastructure/d1/conversation-order";
import { ConversationSnapshotSchema, type ConversationScope, type ConversationSnapshot } from "../../contracts";
import { InvalidConversationContextError, type ConversationStore } from "../../context-store";

const active = "status IN ('CLARIFYING','DRAFT_READY')";
const newerV2 = `EXISTS (SELECT 1 FROM conversation_context_outcomes outcome
  JOIN inbound_updates later ON later.id = outcome.source_inbound_id
  WHERE later.connection_id = i.connection_id AND later.provider_user_id = i.provider_user_id
    AND later.private_chat_id = i.private_chat_id
    AND (later.received_at > i.received_at OR (later.received_at = i.received_at AND later.rowid > i.rowid)))`;
// Rechecked in every mutation statement, never a select-then-trust decision.
export const ownedInbound = `SELECT i.id FROM inbound_updates i
  JOIN chat_identities ci ON ci.connection_id = i.connection_id
    AND ci.provider_user_id = i.provider_user_id AND ci.private_chat_id = i.private_chat_id
  JOIN bot_connections c ON c.id = ci.connection_id AND c.state = 'ACTIVE_BOUND'
  WHERE i.id = ? AND i.transition_marker = ? AND i.state = 'PROCESSING'
    AND ci.id = ? AND c.user_id = ? AND i.received_at <= ?
    AND NOT ${newerConversationOutcomeSql("i")} AND NOT ${newerV2}
    AND NOT EXISTS (SELECT 1 FROM conversation_contexts wc WHERE wc.chat_identity_id = ci.id
      AND wc.owner_id = c.user_id AND wc.claim_marker LIKE 'web:%' AND wc.updated_at >= i.received_at)`;
const orderedAfter = `EXISTS (SELECT 1 FROM inbound_updates current JOIN inbound_updates prior
  ON prior.id = conversation_contexts.last_inbound_id
  WHERE current.id = ? AND (current.received_at > prior.received_at
    OR (current.received_at = prior.received_at AND current.rowid > prior.rowid)))`;
export function auth(scope: ConversationScope) {
  return [scope.sourceInboundId, scope.claimMarker, scope.chatIdentityId, scope.ownerId, scope.now];
}
const encryptionIdentity = (scope: ConversationScope, id: string) => JSON.stringify([scope.ownerId, scope.chatIdentityId, id]);
function validScope(scope: ConversationScope) {
  return Number.isSafeInteger(scope.now) && scope.now >= 0
    && [scope.ownerId, scope.chatIdentityId, scope.sourceInboundId, scope.claimMarker]
      .every(value => typeof value === "string" && value.length > 0 && value.length <= 128);
}
interface ContextRow {
  id: string; revision: number; status: string; created_at: number; expires_at: number;
  payload_ciphertext: unknown; payload_iv: unknown; key_version: number;
}

export class D1ConversationStore implements ConversationStore {
  constructor(private readonly database: D1Database, private readonly keyring: Keyring) {}

  async load(scope: ConversationScope): Promise<ConversationSnapshot | null> {
    if (!validScope(scope)) return null;
    const row = await this.database.prepare(`SELECT id, revision, status, created_at, expires_at,
      payload_ciphertext, payload_iv, key_version FROM conversation_contexts
      WHERE owner_id = ? AND chat_identity_id = ? AND ${active} AND expires_at > ?
        AND EXISTS (${ownedInbound}) LIMIT 1`).bind(scope.ownerId, scope.chatIdentityId, scope.now, ...auth(scope)).first<ContextRow>();
    if (!row) return null;
    try {
      const plaintext = await this.keyring.decryptSensitive("conversation-context", encryptionIdentity(scope, row.id), row.key_version, {
        ciphertext: persistedD1Blob(row.payload_ciphertext), iv: persistedD1Blob(row.payload_iv),
      });
      const snapshot = ConversationSnapshotSchema.parse(JSON.parse(plaintext));
      if (snapshot.id !== row.id || snapshot.revision !== row.revision || snapshot.status !== row.status
        || snapshot.createdAt !== row.created_at || snapshot.expiresAt !== row.expires_at) throw new Error("metadata");
      return snapshot;
    } catch { throw new InvalidConversationContextError(); }
  }

  async save(scope: ConversationScope, expectedRevision: number | null, next: ConversationSnapshot): Promise<"SAVED" | "STALE" | "INVALID"> {
    const parsed = ConversationSnapshotSchema.safeParse(next);
    if (!validScope(scope) || !parsed.success || !["CLARIFYING", "DRAFT_READY"].includes(next.status)
      || next.revision !== (expectedRevision ?? 0) + 1 || next.createdAt > scope.now || next.expiresAt <= scope.now
      || next.turns.some(turn => turn.receivedAt > scope.now)
      || (next.status === "DRAFT_READY" && next.expiresAt > scope.now + 600_000)) return "INVALID";
    const encrypted = await this.keyring.encryptSensitive("conversation-context", encryptionIdentity(scope, next.id), 1, JSON.stringify(parsed.data));
    const unusedSource = "NOT EXISTS (SELECT 1 FROM conversation_context_outcomes WHERE source_inbound_id = ? AND operation = 'SAVE')";
    const noLegacyDraft = "NOT EXISTS (SELECT 1 FROM command_drafts WHERE chat_identity_id = ? AND status = 'PENDING' AND expires_at > ?)";
    const statement = expectedRevision === null
      ? this.database.prepare(`INSERT INTO conversation_contexts
        (id, owner_id, chat_identity_id, source_inbound_id, last_inbound_id, claim_marker, revision, status,
         created_at, updated_at, expires_at, payload_ciphertext, payload_iv, key_version)
        SELECT ?,?,?,?,?,?,1,?,?,?,?,?,?,1 WHERE EXISTS (${ownedInbound}) AND ${unusedSource} AND ${noLegacyDraft}`)
        .bind(next.id, scope.ownerId, scope.chatIdentityId, scope.sourceInboundId, scope.sourceInboundId, scope.claimMarker,
          next.status, next.createdAt, scope.now, next.expiresAt, encrypted.ciphertext, encrypted.iv,
          ...auth(scope), scope.sourceInboundId, scope.chatIdentityId, scope.now)
      : this.database.prepare(`UPDATE conversation_contexts SET last_inbound_id = ?, claim_marker = ?, revision = ?, status = ?,
          updated_at = ?, expires_at = ?, payload_ciphertext = ?, payload_iv = ?, key_version = 1
        WHERE id = ? AND owner_id = ? AND chat_identity_id = ? AND revision = ? AND created_at = ?
          AND ${active} AND expires_at > ? AND EXISTS (${ownedInbound}) AND ${orderedAfter} AND ${unusedSource}
          AND (status <> 'DRAFT_READY' OR ? <> 'DRAFT_READY' OR ? <= expires_at)`)
        .bind(scope.sourceInboundId, scope.claimMarker, next.revision, next.status, scope.now, next.expiresAt,
          encrypted.ciphertext, encrypted.iv, next.id, scope.ownerId, scope.chatIdentityId, expectedRevision, next.createdAt,
          scope.now, ...auth(scope), scope.sourceInboundId, scope.sourceInboundId, next.status, next.expiresAt);
    try {
      const expiry = this.database.prepare(`UPDATE conversation_contexts SET status = 'EXPIRED',
        payload_ciphertext = NULL, payload_iv = NULL, key_version = NULL
        WHERE owner_id = ? AND chat_identity_id = ? AND ${active} AND expires_at <= ? AND EXISTS (${ownedInbound})`)
        .bind(scope.ownerId, scope.chatIdentityId, scope.now, ...auth(scope));
      const result = await this.database.batch([
        ...(expectedRevision === null ? [expiry] : []), statement, this.recordOutcome(scope, next.id, next.revision, "SAVE"),
        this.invalidateTransferredDraft(scope, next.id, next.revision),
      ]);
      return result[expectedRevision === null ? 1 : 0].meta.changes === 1 ? "SAVED" : "STALE";
    } catch (error) {
      if (error instanceof Error && /UNIQUE constraint failed/iu.test(error.message)) return "STALE";
      throw error;
    }
  }

  private recordOutcome(scope: ConversationScope, id: string, revision: number, operation: "SAVE" | "FINISH") {
    // D1 batch executes these statements sequentially in one transaction.
    // A no-op CAS must not record an outcome; failure rolls back the mutation.
    return this.database.prepare(`INSERT INTO conversation_context_outcomes
      (context_id, revision, source_inbound_id, operation, created_at)
      SELECT ?,?,?,?,? WHERE changes() = 1`).bind(id, revision, scope.sourceInboundId, operation, scope.now);
  }

  private invalidateTransferredDraft(scope: ConversationScope, id: string, revision: number) {
    // Runs in the context CAS transaction. A concurrent confirmation either
    // wins first (CAS fails), or sees the old draft already cancelled.
    // Prior SAVE lineage excludes unrelated V1 drafts; replay cannot cancel
    // its own replacement. No dependency on the later series migration.
    return this.database.prepare(`UPDATE command_drafts SET status = 'CANCELLED', resolution_inbound_id = ?, updated_at = ?
      WHERE changes() = 1 AND chat_identity_id = ? AND status = 'PENDING' AND source_inbound_id <> ?
        AND EXISTS (SELECT 1 FROM conversation_contexts c WHERE c.id = ? AND c.owner_id = ?
          AND c.chat_identity_id = ? AND c.revision = ? AND c.last_inbound_id = ?
          AND EXISTS (SELECT 1 FROM conversation_context_outcomes o WHERE o.context_id = c.id
            AND o.revision = c.revision AND o.source_inbound_id = c.last_inbound_id)
          AND EXISTS (SELECT 1 FROM conversation_context_outcomes prior WHERE prior.context_id = c.id
            AND prior.revision = c.revision - 1 AND prior.operation = 'SAVE'
            AND prior.source_inbound_id = command_drafts.source_inbound_id))`)
      .bind(scope.sourceInboundId, scope.now, scope.chatIdentityId, scope.sourceInboundId,
        id, scope.ownerId, scope.chatIdentityId, revision, scope.sourceInboundId);
  }

  async finish(scope: ConversationScope, id: string, expectedRevision: number,
    status: "COMPLETED" | "CANCELLED" | "INVALID"): Promise<boolean> {
    if (!validScope(scope) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1
      || !["COMPLETED", "CANCELLED", "INVALID"].includes(status)) return false;
    const result = await this.database.batch([
      this.database.prepare(`UPDATE conversation_contexts SET status = ?, revision = revision + 1, updated_at = ?,
        last_inbound_id = ?, claim_marker = ?, payload_ciphertext = NULL, payload_iv = NULL, key_version = NULL
        WHERE id = ? AND owner_id = ? AND chat_identity_id = ? AND revision = ? AND ${active}
          AND expires_at > ? AND EXISTS (${ownedInbound}) AND (${orderedAfter} OR last_inbound_id = ?)`)
        .bind(status, scope.now, scope.sourceInboundId, scope.claimMarker, id, scope.ownerId, scope.chatIdentityId,
          expectedRevision, scope.now, ...auth(scope), scope.sourceInboundId, scope.sourceInboundId),
      this.recordOutcome(scope, id, expectedRevision + 1, "FINISH"),
      this.invalidateTransferredDraft(scope, id, expectedRevision + 1),
    ]);
    if (result[0].meta.changes === 1) return true;
    return Boolean(await this.database.prepare(`SELECT 1 FROM conversation_contexts WHERE id = ? AND owner_id = ?
      AND chat_identity_id = ? AND status = ? AND revision = ? AND last_inbound_id = ? AND EXISTS (${ownedInbound})`)
      .bind(id, scope.ownerId, scope.chatIdentityId, status, expectedRevision + 1, scope.sourceInboundId, ...auth(scope)).first());
  }

  async purgeExpired(now: number, limit: number): Promise<number> {
    if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(limit) || limit < 1) throw new TypeError("Invalid purge bounds");
    const result = await this.database.prepare(`UPDATE conversation_contexts SET status = 'EXPIRED',
      payload_ciphertext = NULL, payload_iv = NULL, key_version = NULL
      WHERE id IN (SELECT id FROM conversation_contexts WHERE ${active} AND expires_at <= ? ORDER BY expires_at,id LIMIT ?)`)
      .bind(now, Math.min(limit, 100)).run();
    return result.meta.changes;
  }
}
