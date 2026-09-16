import type { Keyring } from "@/modules/security/keyring";
import { persistedD1Blob } from "@/modules/db/persisted-blob";
import { newerConversationOutcomeSql } from "./conversation-order";
import {
  SemanticContextSlotsSchema,
  type CreateSemanticContextInput,
  type PendingSemanticContext,
  type ResolveSemanticContextInput,
  type SemanticContextScope,
  type SemanticContextStore,
} from "../../context-store";

const boundIdentity = `SELECT ci.id FROM chat_identities ci
  JOIN bot_connections c ON c.id = ci.connection_id AND c.state = 'ACTIVE_BOUND'
  WHERE ci.id = ? AND c.user_id = ?`;
const ownedInbound = `SELECT i.id FROM inbound_updates i
  JOIN chat_identities ci ON ci.connection_id = i.connection_id
    AND ci.provider_user_id = i.provider_user_id AND ci.private_chat_id = i.private_chat_id
  JOIN bot_connections c ON c.id = ci.connection_id AND c.state = 'ACTIVE_BOUND'
  WHERE i.id = ? AND i.state = 'PROCESSING' AND i.transition_marker = ?
    AND ci.id = ? AND c.user_id = ?
    AND NOT ${newerConversationOutcomeSql("i")}`;

export class D1SemanticContextStore implements SemanticContextStore {
  constructor(private readonly database: D1Database, private readonly keyring: Keyring) {}

  async createPending(input: CreateSemanticContextInput): Promise<"CREATED" | "ALREADY_EXISTS" | "CONFLICT"> {
    if (!Number.isSafeInteger(input.now) || !Number.isSafeInteger(input.expiresAt)
      || input.expiresAt <= input.now || input.expiresAt - input.now > 1_800_000) {
      throw new TypeError("Invalid semantic context TTL");
    }
    const slots = SemanticContextSlotsSchema.parse(input.slots);
    const encrypted = await this.keyring.encryptSensitive("semantic-context", input.id, 1, JSON.stringify(slots));
    try {
      const result = await this.database.batch([
        this.expiryStatement(input),
        this.database.prepare(
          `INSERT INTO semantic_contexts
           (id, owner_id, chat_identity_id, source_inbound_id, target_intent,
            context_ciphertext, context_iv, context_key_version, status, expires_at, created_at, updated_at)
           VALUES (?, ?, ?, (${ownedInbound}), ?, ?, ?, 1, 'PENDING', ?, ?, ?)
           ON CONFLICT (source_inbound_id) DO NOTHING`,
        ).bind(input.id, input.ownerId, input.chatIdentityId,
          input.sourceInboundId, input.claimMarker, input.chatIdentityId, input.ownerId,
          slots.targetIntent, encrypted.ciphertext, encrypted.iv, input.expiresAt, input.now, input.now),
      ]);
      if (result[1].meta.changes === 1) return "CREATED";
      return await this.existingSource(input) ? "ALREADY_EXISTS" : "CONFLICT";
    } catch (error) {
      if (!(error instanceof Error) || !/constraint failed/iu.test(error.message)) throw error;
      return await this.existingSource(input) ? "ALREADY_EXISTS" : "CONFLICT";
    }
  }

  private async existingSource(input: CreateSemanticContextInput): Promise<boolean> {
    return Boolean(await this.database.prepare(
      `SELECT 1 FROM semantic_contexts WHERE source_inbound_id = ? AND owner_id = ?
       AND chat_identity_id = (${boundIdentity})`,
    ).bind(input.sourceInboundId, input.ownerId, input.chatIdentityId, input.ownerId).first());
  }

  private expiryStatement(input: SemanticContextScope): D1PreparedStatement {
    return this.database.prepare(
      `UPDATE semantic_contexts SET status = 'EXPIRED', updated_at = ?
       WHERE owner_id = ? AND chat_identity_id = ? AND status = 'PENDING' AND expires_at <= ?`,
    ).bind(input.now, input.ownerId, input.chatIdentityId, input.now);
  }

  async findPending(input: SemanticContextScope): Promise<PendingSemanticContext | null> {
    const result = await this.database.batch([
      this.expiryStatement(input),
      this.database.prepare(
        `SELECT id, source_inbound_id, context_ciphertext, context_iv, context_key_version, expires_at
         FROM semantic_contexts WHERE owner_id = ? AND chat_identity_id = (${boundIdentity})
           AND status = 'PENDING' AND expires_at > ? LIMIT 1`,
      ).bind(input.ownerId, input.chatIdentityId, input.ownerId, input.now),
    ]);
    const row = result[1].results[0] as {
      id: string; source_inbound_id: string; context_ciphertext: unknown;
      context_iv: unknown; context_key_version: number; expires_at: number;
    } | undefined;
    if (!row) return null;
    const plaintext = await this.keyring.decryptSensitive("semantic-context", row.id, row.context_key_version, {
      ciphertext: persistedD1Blob(row.context_ciphertext), iv: persistedD1Blob(row.context_iv),
    });
    return { id: row.id, sourceInboundId: row.source_inbound_id,
      expiresAt: row.expires_at, slots: SemanticContextSlotsSchema.parse(JSON.parse(plaintext)) };
  }

  async resolve(input: ResolveSemanticContextInput): Promise<boolean> {
    try {
      const result = await this.database.prepare(
        `UPDATE semantic_contexts SET status = ?, resolution_inbound_id = ?, updated_at = ?
         WHERE id = ? AND owner_id = ? AND chat_identity_id = ? AND status = 'PENDING'
           AND expires_at > ? AND EXISTS (${ownedInbound})
           AND EXISTS (SELECT 1 FROM inbound_updates source JOIN inbound_updates current ON current.id = ?
             WHERE source.id = semantic_contexts.source_inbound_id
               AND (current.received_at > source.received_at
                 OR (current.received_at = source.received_at AND current.rowid > source.rowid)))`,
      ).bind(input.status, input.resolutionInboundId, input.now, input.id, input.ownerId,
        input.chatIdentityId, input.now, input.resolutionInboundId, input.claimMarker,
        input.chatIdentityId, input.ownerId, input.resolutionInboundId).run();
      if (result.meta.changes === 1) return true;
      return Boolean(await this.database.prepare(
        `SELECT 1 FROM semantic_contexts WHERE id = ? AND owner_id = ?
         AND chat_identity_id = (${boundIdentity}) AND status = ? AND resolution_inbound_id = ?`,
      ).bind(input.id, input.ownerId, input.chatIdentityId, input.ownerId,
        input.status, input.resolutionInboundId).first());
    } catch (error) {
      if (error instanceof Error && /UNIQUE constraint failed:\s*semantic_contexts\.resolution_inbound_id/iu.test(error.message)) return false;
      throw error;
    }
  }
}
