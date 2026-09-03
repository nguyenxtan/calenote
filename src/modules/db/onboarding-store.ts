import { D1OneTimeCodeStore } from "@/modules/db/code-store";
import {
  ConnectionStateError,
  OnboardingConflictError,
  type AccountGraph,
  type ActivationFailure,
  type ActivationSuccess,
  type ConnectCodeRotation,
  type OnboardingStore,
  type OwnedConnection,
  type RecoveryAccessCommit,
  type RecoveryConnection,
  type RecoveryFailureCommit,
  type SafeAuditEvent,
} from "@/modules/onboarding/service";
import { d1Changes } from "@/modules/platform/types";

interface OwnedConnectionRow {
  id: string;
  public_id: string;
  user_id: string;
  state: OwnedConnection["state"];
  updated_at: number;
  transition_marker: string | null;
}

interface RecoveryConnectionRow extends OwnedConnectionRow {
  provider: RecoveryConnection["provider"];
  provider_bot_id: string;
  display_name: string;
  handle: string | null;
  updated_at: number;
  transition_marker: string | null;
  has_private_chat: number;
  encrypted_token: unknown;
  encrypted_token_iv: unknown;
  credential_version: number;
}

function uniqueConstraint(error: unknown): boolean {
  return error instanceof Error && /\bUNIQUE constraint failed\b/iu.test(error.message);
}

function guardedConnectConstraint(error: unknown): boolean {
  return error instanceof Error && /NOT NULL constraint failed:\s*connect_codes\.connection_id\b/iu.test(error.message);
}

function guardedRecoveryConstraint(error: unknown): boolean {
  return error instanceof Error
    && /NOT NULL constraint failed:\s*(?:sessions\.user_id|connect_codes\.connection_id|audit_events\.id)\b/iu.test(error.message);
}

function persistedArrayBuffer(value: unknown): ArrayBuffer {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    return Uint8Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)).buffer;
  }
  throw new TypeError("Malformed encrypted credential");
}

function requireChange(result: D1Result<unknown>, message: string): void {
  if (d1Changes(result) !== 1) throw new Error(message);
}

export class D1OnboardingStore implements OnboardingStore {
  private readonly codes: D1OneTimeCodeStore;

  constructor(private readonly database: D1Database) {
    this.codes = new D1OneTimeCodeStore(database);
  }

  private prepareAudit(event: SafeAuditEvent): D1PreparedStatement {
    return this.database
      .prepare(
        `INSERT INTO audit_events (
          id, actor_user_id, action, target_user_id, target_connection_id, result, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        event.id,
        event.actorUserId,
        event.action,
        event.targetUserId,
        event.targetConnectionId,
        event.result,
        event.createdAt,
      );
  }

  private prepareGuardedConnectCode(
    code: ActivationSuccess["code"],
    transitionMarker?: string,
  ): D1PreparedStatement {
    const transitionGuard = transitionMarker === undefined
      ? ""
      : " AND transition_marker = ?";
    const statement = this.database.prepare(
      `INSERT INTO connect_codes (
        id, connection_id, user_id, digest, expires_at, consumed_at, created_at
      ) VALUES (
        ?, COALESCE((
          SELECT id FROM bot_connections
          WHERE id = ? AND user_id = ? AND state = 'ACTIVE_UNBOUND'${transitionGuard}
        ), NULL), ?, ?, ?, ?, ?
      )`,
    );
    const values: unknown[] = [code.id, code.connectionId, code.userId];
    if (transitionMarker !== undefined) values.push(transitionMarker);
    values.push(code.userId, code.digest, code.expiresAt, code.consumedAt, code.createdAt);
    return statement.bind(...values);
  }

  private prepareGuardedAudit(
    event: SafeAuditEvent,
    state: "ACTIVE_UNBOUND" | "WEBHOOK_FAILED" | "SUSPENDED",
    transitionMarker?: string,
  ): D1PreparedStatement {
    const transitionGuard = transitionMarker === undefined ? "" : " AND transition_marker = ?";
    const statement = this.database.prepare(
      `INSERT INTO audit_events (
        id, actor_user_id, action, target_user_id, target_connection_id, result, created_at
      ) VALUES (
        COALESCE((
          SELECT ? FROM bot_connections
          WHERE id = ? AND user_id = ? AND state = ?${transitionGuard}
        ), NULL), ?, ?, ?, ?, ?, ?
      )`,
    );
    const values: unknown[] = [event.id, event.targetConnectionId, event.targetUserId, state];
    if (transitionMarker !== undefined) values.push(transitionMarker);
    values.push(
      event.actorUserId,
      event.action,
      event.targetUserId,
      event.targetConnectionId,
      event.result,
      event.createdAt,
    );
    return statement.bind(...values);
  }

  async commitAccountGraph(graph: AccountGraph): Promise<void> {
    const statements = [
      this.database
        .prepare(
          "INSERT INTO users (id, email, display_name, timezone, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(
          graph.user.id,
          graph.user.email,
          graph.user.displayName,
          graph.user.timezone,
          graph.user.createdAt,
          graph.user.createdAt,
        ),
      this.database
        .prepare(
          "INSERT INTO workspaces (id, owner_user_id, kind, created_at, updated_at) VALUES (?, ?, 'PERSONAL', ?, ?)",
        )
        .bind(
          graph.workspace.id,
          graph.workspace.ownerUserId,
          graph.workspace.createdAt,
          graph.workspace.createdAt,
        ),
      this.database
        .prepare(
          "INSERT INTO memberships (workspace_id, user_id, role, created_at) VALUES (?, ?, 'OWNER', ?)",
        )
        .bind(graph.membership.workspaceId, graph.membership.userId, graph.membership.createdAt),
      this.database
        .prepare(
          `INSERT INTO bot_connections (
            id, user_id, provider, public_id, provider_bot_id, display_name, handle,
            account_type, can_join_groups, encrypted_token, encrypted_token_iv,
            token_fingerprint, credential_version, state, webhook_registered_at,
            created_at, updated_at, transition_marker
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
        )
        .bind(
          graph.connection.id,
          graph.connection.userId,
          graph.connection.provider,
          graph.connection.publicId,
          graph.connection.providerBotId,
          graph.connection.displayName,
          graph.connection.handle,
          graph.connection.accountType,
          graph.connection.canJoinGroups === null ? null : Number(graph.connection.canJoinGroups),
          graph.connection.encryptedToken,
          graph.connection.encryptedTokenIv,
          graph.connection.tokenFingerprint,
          graph.connection.credentialVersion,
          graph.connection.state,
          graph.connection.createdAt,
          graph.connection.createdAt,
          graph.connection.transitionMarker,
        ),
      this.database
        .prepare(
          "INSERT INTO sessions (id, user_id, digest, expires_at, revoked_at, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(
          graph.session.id,
          graph.session.userId,
          graph.session.digest,
          graph.session.expiresAt,
          graph.session.revokedAt,
          graph.session.createdAt,
        ),
      this.prepareAudit(graph.audit),
    ];

    try {
      const results = await this.database.batch(statements);
      if (results.length !== statements.length) throw new Error("Account graph batch result was incomplete");
      results.forEach((result) => requireChange(result, "Account graph insert did not commit"));
    } catch (error) {
      if (uniqueConstraint(error)) throw new OnboardingConflictError();
      throw error;
    }
  }

  async activateConnection(input: ActivationSuccess): Promise<void> {
    const codeStatements = this.codes.prepareIssue(input.code, input.registeredAt);
    const statements = [
      this.database
        .prepare(
          `UPDATE bot_connections
           SET state = 'ACTIVE_UNBOUND', transition_marker = ?, webhook_registered_at = ?, updated_at = ?
           WHERE id = ? AND user_id = ? AND state = 'VALIDATING'
             AND transition_marker = ?`,
        )
        .bind(input.audit.id, input.registeredAt, input.registeredAt, input.connectionId, input.userId, input.expectedMarker),
      codeStatements[0],
      this.prepareGuardedConnectCode(input.code, input.audit.id),
      this.prepareGuardedAudit(input.audit, "ACTIVE_UNBOUND", input.audit.id),
    ];
    const results = await this.database.batch(statements);
    if (results.length !== statements.length) throw new Error("Activation batch result was incomplete");
    requireChange(results[0], "Activation state transition did not commit");
    requireChange(results[2], "Activation code insert did not commit");
    requireChange(results[3], "Activation audit did not commit");
  }

  async failActivation(input: ActivationFailure): Promise<void> {
    const statements = [
      this.database
        .prepare(
          `UPDATE bot_connections SET state = ?, transition_marker = ?, updated_at = ?
           WHERE id = ? AND user_id = ? AND state = 'VALIDATING'
             AND transition_marker = ?`,
        )
        .bind(input.state, input.audit.id, input.failedAt, input.connectionId, input.userId, input.expectedMarker),
      this.prepareGuardedAudit(input.audit, input.state, input.audit.id),
    ];
    const results = await this.database.batch(statements);
    if (results.length !== statements.length) throw new Error("Activation failure batch result was incomplete");
    requireChange(results[0], "Activation failure transition did not commit");
    requireChange(results[1], "Activation failure audit did not commit");
  }

  async findOwnedConnection(userId: string, publicId: string): Promise<OwnedConnection | null> {
    const row = await this.database
      .prepare(
        `SELECT id, public_id, user_id, state, updated_at, transition_marker
         FROM bot_connections WHERE user_id = ? AND public_id = ? LIMIT 1`,
      )
      .bind(userId, publicId)
      .first<OwnedConnectionRow>();
    return row
      ? {
          id: row.id,
          publicId: row.public_id,
          userId: row.user_id,
          state: row.state,
          updatedAt: row.updated_at,
          transitionMarker: row.transition_marker,
        }
      : null;
  }

  async rotateConnectCode(input: ConnectCodeRotation): Promise<void> {
    if (input.connection.state !== "ACTIVE_UNBOUND") throw new ConnectionStateError();
    const codeStatements = this.codes.prepareIssue(input.code, input.rotatedAt);
    const statements = [
      this.database
        .prepare(
          `UPDATE bot_connections
           SET transition_marker = ?, updated_at = ?
           WHERE id = ? AND user_id = ? AND state = 'ACTIVE_UNBOUND'
             AND updated_at = ?
             AND ((transition_marker = ?) OR (transition_marker IS NULL AND ? IS NULL))`,
        )
        .bind(
          input.audit.id,
          input.rotatedAt,
          input.connection.id,
          input.connection.userId,
          input.connection.updatedAt,
          input.connection.transitionMarker,
          input.connection.transitionMarker,
        ),
      codeStatements[0],
      this.prepareGuardedConnectCode(input.code, input.audit.id),
      this.prepareGuardedAudit(input.audit, "ACTIVE_UNBOUND", input.audit.id),
    ];
    try {
      const results = await this.database.batch(statements);
      if (results.length !== statements.length) throw new Error("Connect-code rotation batch result was incomplete");
      requireChange(results[0], "Connect-code rotation state fence did not commit");
      requireChange(results[2], "Connect-code rotation insert did not commit");
      requireChange(results[3], "Connect-code rotation audit did not commit");
    } catch (error) {
      if (guardedConnectConstraint(error)) {
        throw new ConnectionStateError();
      }
      throw error;
    }
  }

  async findExactRecovery(input: {
    email: string;
    provider: RecoveryConnection["provider"];
    tokenFingerprint: string;
    providerBotId: string;
  }): Promise<RecoveryConnection | null> {
    const row = await this.database
      .prepare(
        `SELECT c.id, c.public_id, c.user_id, c.provider, c.provider_bot_id,
                c.display_name, c.handle, c.state, c.updated_at,
                c.transition_marker, c.encrypted_token, c.encrypted_token_iv,
                c.credential_version,
                EXISTS(SELECT 1 FROM chat_identities ci WHERE ci.connection_id = c.id) AS has_private_chat
         FROM users u
         JOIN bot_connections c ON c.user_id = u.id
         WHERE u.email = ? COLLATE NOCASE AND c.provider = ?
           AND c.token_fingerprint = ? AND c.provider_bot_id = ?
         LIMIT 1`,
      )
      .bind(input.email, input.provider, input.tokenFingerprint, input.providerBotId)
      .first<RecoveryConnectionRow>();
    return row ? this.recoveryConnection(row) : null;
  }

  async findOwnedRecovery(userId: string, publicId: string): Promise<RecoveryConnection | null> {
    const row = await this.database
      .prepare(
        `SELECT c.id, c.public_id, c.user_id, c.provider, c.provider_bot_id,
                c.display_name, c.handle, c.state, c.updated_at,
                c.transition_marker, c.encrypted_token, c.encrypted_token_iv,
                c.credential_version,
                EXISTS(SELECT 1 FROM chat_identities ci WHERE ci.connection_id = c.id) AS has_private_chat
         FROM bot_connections c
         WHERE c.user_id = ? AND c.public_id = ?
         LIMIT 1`,
      )
      .bind(userId, publicId)
      .first<RecoveryConnectionRow>();
    return row ? this.recoveryConnection(row) : null;
  }

  private recoveryConnection(row: RecoveryConnectionRow): RecoveryConnection {
    return {
      id: row.id,
      publicId: row.public_id,
      userId: row.user_id,
      provider: row.provider,
      providerBotId: row.provider_bot_id,
      displayName: row.display_name,
      handle: row.handle,
      state: row.state,
      updatedAt: row.updated_at,
      transitionMarker: row.transition_marker,
      hasPrivateChat: row.has_private_chat === 1,
      encryptedToken: persistedArrayBuffer(row.encrypted_token),
      encryptedTokenIv: persistedArrayBuffer(row.encrypted_token_iv),
      credentialVersion: row.credential_version,
    };
  }

  async claimRecovery(input: {
    connection: RecoveryConnection;
    marker: string;
    claimedAt: number;
  }): Promise<boolean> {
    const result = await this.database
      .prepare(
        `UPDATE bot_connections
         SET state = 'VALIDATING', transition_marker = ?, updated_at = ?
         WHERE id = ? AND user_id = ? AND state = ? AND updated_at = ?
           AND ((transition_marker = ?) OR (transition_marker IS NULL AND ? IS NULL))
           AND (
             state IN ('WEBHOOK_FAILED', 'SUSPENDED')
             OR (state = 'VALIDATING' AND updated_at < ?)
           )
         RETURNING id`,
      )
      .bind(
        input.marker,
        input.claimedAt,
        input.connection.id,
        input.connection.userId,
        input.connection.state,
        input.connection.updatedAt,
        input.connection.transitionMarker,
        input.connection.transitionMarker,
        input.claimedAt - 300_000,
      )
      .run<{ id: string }>();
    return d1Changes(result) === 1;
  }

  async commitRecoveredAccess(input: RecoveryAccessCommit): Promise<boolean> {
    const statements: D1PreparedStatement[] = [
      this.database
        .prepare(
          `UPDATE bot_connections
           SET state = ?, transition_marker = ?, webhook_registered_at = COALESCE(webhook_registered_at, ?),
               updated_at = ?
           WHERE id = ? AND user_id = ? AND state = ? AND updated_at = ?
             AND ((transition_marker = ?) OR (transition_marker IS NULL AND ? IS NULL))`,
        )
        .bind(
          input.targetState,
          input.newMarker,
          input.completedAt,
          input.completedAt,
          input.connection.id,
          input.connection.userId,
          input.connection.state,
          input.connection.updatedAt,
          input.expectedMarker,
          input.expectedMarker,
        ),
      this.database
        .prepare(
          `UPDATE connect_codes SET consumed_at = ?
           WHERE connection_id = ? AND consumed_at IS NULL`,
        )
        .bind(input.completedAt, input.connection.id),
    ];
    if (input.revokeExistingSessions) {
      statements.push(
        this.database
          .prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL")
          .bind(input.completedAt, input.connection.userId),
      );
    }
    if (input.session) {
      statements.push(
        this.database
          .prepare(
            `INSERT INTO sessions (id, user_id, digest, expires_at, revoked_at, created_at)
             VALUES (?, COALESCE((
               SELECT user_id FROM bot_connections
               WHERE id = ? AND user_id = ? AND state = ? AND transition_marker = ?
             ), NULL), ?, ?, ?, ?)`,
          )
          .bind(
            input.session.id,
            input.connection.id,
            input.connection.userId,
            input.targetState,
            input.newMarker,
            input.session.digest,
            input.session.expiresAt,
            input.session.revokedAt,
            input.session.createdAt,
          ),
      );
    }
    if (input.code) {
      statements.push(
        this.database
          .prepare(
            `INSERT INTO connect_codes (
               id, connection_id, user_id, digest, expires_at, consumed_at, created_at
             ) VALUES (?, COALESCE((
               SELECT id FROM bot_connections
               WHERE id = ? AND user_id = ? AND state = 'ACTIVE_UNBOUND'
                 AND transition_marker = ?
             ), NULL), ?, ?, ?, ?, ?)`,
          )
          .bind(
            input.code.id,
            input.connection.id,
            input.connection.userId,
            input.newMarker,
            input.code.userId,
            input.code.digest,
            input.code.expiresAt,
            input.code.consumedAt,
            input.code.createdAt,
          ),
      );
    }
    statements.push(
      this.database
        .prepare(
          `INSERT INTO audit_events (
             id, actor_user_id, action, target_user_id, target_connection_id, result, created_at
           ) VALUES (COALESCE((
             SELECT ? FROM bot_connections
             WHERE id = ? AND user_id = ? AND state = ? AND transition_marker = ?
           ), NULL), ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          input.audit.id,
          input.connection.id,
          input.connection.userId,
          input.targetState,
          input.newMarker,
          input.audit.actorUserId,
          input.audit.action,
          input.audit.targetUserId,
          input.audit.targetConnectionId,
          input.audit.result,
          input.audit.createdAt,
        ),
    );
    try {
      await this.database.batch(statements);
      return true;
    } catch (error) {
      if (guardedRecoveryConstraint(error)) return false;
      throw error;
    }
  }

  async failRecoveredActivation(input: RecoveryFailureCommit): Promise<boolean> {
    const statements: D1PreparedStatement[] = [
      this.database
        .prepare(
          `UPDATE bot_connections SET state = ?, transition_marker = ?, updated_at = ?
           WHERE id = ? AND user_id = ? AND state = 'VALIDATING'
             AND transition_marker = ? AND updated_at = ?`,
        )
        .bind(
          input.state,
          input.audit.id,
          input.failedAt,
          input.connection.id,
          input.connection.userId,
          input.marker,
          input.connection.updatedAt,
        ),
      this.database
        .prepare("UPDATE connect_codes SET consumed_at = ? WHERE connection_id = ? AND consumed_at IS NULL")
        .bind(input.failedAt, input.connection.id),
    ];
    if (input.revokeExistingSessions) {
      statements.push(
        this.database
          .prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL")
          .bind(input.failedAt, input.connection.userId),
      );
    }
    if (input.session) {
      statements.push(
        this.database
          .prepare(
            `INSERT INTO sessions (id, user_id, digest, expires_at, revoked_at, created_at)
             VALUES (?, COALESCE((
               SELECT user_id FROM bot_connections
               WHERE id = ? AND user_id = ? AND state = ? AND transition_marker = ?
             ), NULL), ?, ?, ?, ?)`,
          )
          .bind(
            input.session.id,
            input.connection.id,
            input.connection.userId,
            input.state,
            input.audit.id,
            input.session.digest,
            input.session.expiresAt,
            input.session.revokedAt,
            input.session.createdAt,
          ),
      );
    }
    statements.push(
      this.database
        .prepare(
          `INSERT INTO audit_events (
             id, actor_user_id, action, target_user_id, target_connection_id, result, created_at
           ) VALUES (COALESCE((
             SELECT ? FROM bot_connections
             WHERE id = ? AND user_id = ? AND state = ? AND transition_marker = ?
           ), NULL), ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          input.audit.id,
          input.connection.id,
          input.connection.userId,
          input.state,
          input.audit.id,
          input.audit.actorUserId,
          input.audit.action,
          input.audit.targetUserId,
          input.audit.targetConnectionId,
          input.audit.result,
          input.audit.createdAt,
        ),
    );
    try {
      await this.database.batch(statements);
      return true;
    } catch (error) {
      if (guardedRecoveryConstraint(error)) return false;
      throw error;
    }
  }
}

export function createD1OnboardingStore(database: D1Database): D1OnboardingStore {
  return new D1OnboardingStore(database);
}
