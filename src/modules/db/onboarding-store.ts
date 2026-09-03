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
  type SafeAuditEvent,
} from "@/modules/onboarding/service";
import { d1Changes } from "@/modules/platform/types";

interface OwnedConnectionRow {
  id: string;
  public_id: string;
  user_id: string;
  state: OwnedConnection["state"];
}

function uniqueConstraint(error: unknown): boolean {
  return error instanceof Error && /\bUNIQUE constraint failed\b/iu.test(error.message);
}

function guardedConnectConstraint(error: unknown): boolean {
  return error instanceof Error && /NOT NULL constraint failed:\s*connect_codes\.connection_id\b/iu.test(error.message);
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
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
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
           WHERE id = ? AND user_id = ? AND state = 'VALIDATING'`,
        )
        .bind(input.audit.id, input.registeredAt, input.registeredAt, input.connectionId, input.userId),
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
          "UPDATE bot_connections SET state = ?, transition_marker = ?, updated_at = ? WHERE id = ? AND user_id = ? AND state = 'VALIDATING'",
        )
        .bind(input.state, input.audit.id, input.failedAt, input.connectionId, input.userId),
      this.prepareGuardedAudit(input.audit, input.state, input.audit.id),
    ];
    const results = await this.database.batch(statements);
    if (results.length !== statements.length) throw new Error("Activation failure batch result was incomplete");
    requireChange(results[0], "Activation failure transition did not commit");
    requireChange(results[1], "Activation failure audit did not commit");
  }

  async findOwnedConnection(userId: string, publicId: string): Promise<OwnedConnection | null> {
    const row = await this.database
      .prepare("SELECT id, public_id, user_id, state FROM bot_connections WHERE user_id = ? AND public_id = ? LIMIT 1")
      .bind(userId, publicId)
      .first<OwnedConnectionRow>();
    return row
      ? { id: row.id, publicId: row.public_id, userId: row.user_id, state: row.state }
      : null;
  }

  async rotateConnectCode(input: ConnectCodeRotation): Promise<void> {
    if (input.connection.state !== "ACTIVE_UNBOUND") throw new ConnectionStateError();
    const codeStatements = this.codes.prepareIssue(input.code, input.rotatedAt);
    const statements = [
      codeStatements[0],
      this.prepareGuardedConnectCode(input.code),
      this.prepareGuardedAudit(input.audit, "ACTIVE_UNBOUND"),
    ];
    try {
      const results = await this.database.batch(statements);
      if (results.length !== statements.length) throw new Error("Connect-code rotation batch result was incomplete");
      requireChange(results[1], "Connect-code rotation insert did not commit");
      requireChange(results[2], "Connect-code rotation audit did not commit");
    } catch (error) {
      if (guardedConnectConstraint(error)) {
        let current: OwnedConnection | null;
        try {
          current = await this.findOwnedConnection(input.connection.userId, input.connection.publicId);
        } catch {
          throw error;
        }
        if (current && current.state !== "ACTIVE_UNBOUND") throw new ConnectionStateError();
      }
      throw error;
    }
  }
}

export function createD1OnboardingStore(database: D1Database): D1OnboardingStore {
  return new D1OnboardingStore(database);
}
