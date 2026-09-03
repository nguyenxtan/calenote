import { prepareSession, type SessionRecord } from "@/modules/auth/session";
import type { BotProvider, SendReceipt } from "@/modules/connections/contracts";
import { ProviderOperationError, ProviderVerificationError } from "@/modules/connections/provider-error";
import { isSafeProviderToken } from "@/modules/connections/token-policy";
import { sendProviderText } from "@/modules/inbound/processor";
import {
  cryptoRandomBytes,
  d1Changes,
  randomOpaqueId,
  systemClock,
  type Clock,
  type RandomBytes,
} from "@/modules/platform/types";
import {
  DELIVERY_SEND_LEASE_MS,
  INBOUND_DISPATCH_LEASE_MS,
  MAX_DELIVERY_ATTEMPTS,
  MAX_SCHEDULER_LIMIT,
} from "@/modules/reminders/scheduler";
import type { EncryptedValue, Keyring } from "@/modules/security/keyring";

export const LOGIN_CODE_TTL_MS = 10 * 60_000;
export const MAX_LOGIN_CODE_ATTEMPTS = 5;
export const MAX_LOGIN_DISPATCH_ATTEMPTS = 4;
export const CRON_LOGIN_LIMIT = 5;
const LOGIN_CODE_KEY_VERSION = 1;
const DIGIT_ACCEPTANCE_BOUND = 250;
const SAFE_PRE_PROVIDER_RETRY_SECONDS = 60;
const QUOTA_FALLBACK_DELAYS_SECONDS = [60, 300, 1_800] as const;

export interface DeliverLoginCodeJob {
  type: "DELIVER_LOGIN_CODE";
  loginCodeId: string;
}

interface IssueLoginCodeInput {
  email: string;
  id: string;
  encryptedCode: EncryptedValue;
  codeKeyVersion: number;
  expiresAt: number;
  dispatchMarker: string;
  now: number;
}

interface VerifiableLoginCodeRow {
  id: string;
  user_id: string;
  code_ciphertext: unknown;
  code_iv: unknown;
  code_key_version: number;
}

export interface VerifiableLoginCode {
  id: string;
  userId: string;
  encryptedCode: EncryptedValue;
  codeKeyVersion: number;
}

interface DeliveryStateRow {
  delivery_status: string;
  retry_not_before: number | null;
}

interface LoginDeliverySnapshotRow {
  id: string;
  user_id: string;
  connection_id: string;
  provider: BotProvider;
  code_ciphertext: unknown;
  code_iv: unknown;
  code_key_version: number;
  encrypted_token: unknown;
  encrypted_token_iv: unknown;
  credential_version: number;
  connection_updated_at: number;
  connection_transition_marker: string | null;
  chat_identity_id: string;
  private_chat_id: string;
  expires_at: number;
  delivery_status: "PENDING" | "RETRYABLE";
  delivery_attempt_count: number;
  send_started_at: number | null;
  retry_not_before: number | null;
  transition_marker: string | null;
  dispatch_started_at: number | null;
  dispatch_attempt_count: number;
  dispatch_marker: string | null;
}

export interface LoginDeliverySnapshot {
  loginCodeId: string;
  userId: string;
  connectionId: string;
  provider: BotProvider;
  encryptedCode: EncryptedValue;
  codeKeyVersion: number;
  encryptedToken: EncryptedValue;
  credentialVersion: number;
  connectionUpdatedAt: number;
  connectionTransitionMarker: string | null;
  chatIdentityId: string;
  privateChatId: string;
  expiresAt: number;
  deliveryStatus: "PENDING" | "RETRYABLE";
  attemptCount: number;
  sendStartedAt: number | null;
  retryNotBefore: number | null;
  transitionMarker: string | null;
  dispatchStartedAt: number | null;
  dispatchAttemptCount: number;
  dispatchMarker: string | null;
}

type UnavailableLoginDeliveryResult =
  | { status: "RETRY_AFTER"; retryAfterSeconds: number }
  | { status: "SENT" | "FAILED" | "UNCERTAIN" | "CANCELLED" | "NOOP" | "MISSING" };

export type PrepareLoginDeliveryResult =
  | { status: "READY"; delivery: LoginDeliverySnapshot }
  | UnavailableLoginDeliveryResult;

export type AcquireLoginDeliveryResult =
  | { status: "OWNED" }
  | UnavailableLoginDeliveryResult;

interface DispatchCandidateRow {
  id: string;
}

interface LoginDispatchRow {
  id: string;
  delivery_status: string;
  retry_not_before: number | null;
  consumed_at: number | null;
  expires_at: number;
  dispatch_started_at: number | null;
  dispatch_attempt_count: number;
  dispatch_marker: string | null;
}

interface StaleSendingRow {
  id: string;
  transition_marker: string;
}

export interface LoginDispatchReservation {
  loginCodeId: string;
  marker: string;
  previousStartedAt: number | null;
  previousAttemptCount: number;
  previousMarker: string | null;
}

export type ReserveLoginDispatchResult =
  | { status: "RESERVED"; reservation: LoginDispatchReservation }
  | { status: "EXHAUSTED" | "NOOP" | "MISSING" };

export interface LoginCodeStore {
  issue(input: IssueLoginCodeInput): Promise<boolean>;
  releaseInitialDispatch(loginCodeId: string, marker: string): Promise<void>;
  findVerifiable(email: string, now: number): Promise<VerifiableLoginCode | null>;
  commitCorrectVerification(
    code: VerifiableLoginCode,
    marker: string,
    session: SessionRecord,
    auditId: string,
    now: number,
  ): Promise<boolean>;
  commitWrongVerification(code: VerifiableLoginCode, now: number): Promise<void>;
  prepareDelivery(loginCodeId: string, now: number): Promise<PrepareLoginDeliveryResult>;
  acquireDelivery(
    delivery: LoginDeliverySnapshot,
    marker: string,
    now: number,
  ): Promise<AcquireLoginDeliveryResult>;
  finalizePreProviderFailure(
    delivery: LoginDeliverySnapshot,
    terminalMarker: string,
    auditId: string,
    now: number,
  ): Promise<boolean>;
  finalizeDeliverySuccess(loginCodeId: string, marker: string, auditId: string, now: number): Promise<void>;
  finalizeDeliveryTerminal(input: {
    loginCodeId: string;
    connectionId: string;
    marker: string;
    status: "FAILED" | "UNCERTAIN";
    safeErrorCode: string;
    suspendConnection: boolean;
    auditId: string;
    now: number;
  }): Promise<void>;
  scheduleDeliveryRetry(
    loginCodeId: string,
    marker: string,
    retryNotBefore: number,
    auditId: string,
    now: number,
  ): Promise<void>;
  selectDispatchCandidates(now: number, limit: number): Promise<string[]>;
  reserveDispatch(loginCodeId: string, marker: string, now: number): Promise<ReserveLoginDispatchResult>;
  releaseDispatch(reservation: LoginDispatchReservation): Promise<boolean>;
  selectStaleSending(now: number, limit: number): Promise<StaleSendingRow[]>;
  terminalizeStaleSending(
    loginCodeId: string,
    marker: string,
    terminalMarker: string,
    auditId: string,
    now: number,
  ): Promise<boolean>;
}

function persistedArrayBuffer(value: unknown): ArrayBuffer {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    return Uint8Array.from(
      new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
    ).buffer;
  }
  throw new TypeError("Malformed encrypted login value");
}

function encrypted(ciphertext: unknown, iv: unknown): EncryptedValue {
  return {
    ciphertext: persistedArrayBuffer(ciphertext),
    iv: persistedArrayBuffer(iv),
  };
}

function secondsUntil(timestamp: number, now: number): number {
  return Math.min(86_400, Math.max(1, Math.ceil((timestamp - now) / 1_000)));
}

function expectedVerificationRace(error: unknown): boolean {
  return error instanceof Error
    && /NOT NULL constraint failed:\s*(?:sessions\.user_id|audit_events\.id)/iu.test(error.message);
}

function expectedDeliveryRace(error: unknown): boolean {
  return error instanceof Error
    && /NOT NULL constraint failed:\s*audit_events\.id/iu.test(error.message);
}

export class D1LoginCodeStore implements LoginCodeStore {
  constructor(private readonly database: D1Database) {}

  async issue(input: IssueLoginCodeInput): Promise<boolean> {
    const eligible = `SELECT u.id AS user_id, MIN(c.id) AS connection_id
      FROM users u
      JOIN bot_connections c ON c.user_id = u.id AND c.state = 'ACTIVE_BOUND'
      JOIN chat_identities ci ON ci.connection_id = c.id
      WHERE u.email = ? COLLATE NOCASE
      GROUP BY u.id
      HAVING COUNT(*) = 1`;
    const statements = [
      this.database
        .prepare(
          `UPDATE login_codes
           SET consumed_at = ?,
               delivery_status = CASE
                 WHEN delivery_status IN ('PENDING', 'RETRYABLE') THEN 'CANCELLED'
                 ELSE delivery_status
               END,
               retry_not_before = NULL,
               dispatch_started_at = NULL,
               dispatch_marker = NULL,
               updated_at = ?
           WHERE user_id = (SELECT user_id FROM (${eligible}))
             AND consumed_at IS NULL`,
        )
        .bind(input.now, input.now, input.email),
      this.database
        .prepare(
          `INSERT INTO login_codes (
             id, user_id, connection_id, code_ciphertext, code_iv,
             code_key_version, expires_at, attempt_count, consumed_at,
             verification_marker, delivery_status, delivery_attempt_count,
             send_started_at, retry_not_before, safe_error_code,
             transition_marker, dispatch_started_at, dispatch_attempt_count,
             dispatch_marker, created_at, updated_at
           )
           SELECT ?, eligible.user_id, eligible.connection_id, ?, ?, ?, ?, 0, NULL,
                  NULL, 'PENDING', 0, NULL, NULL, NULL, NULL, ?, 1, ?, ?, ?
           FROM (${eligible}) AS eligible`,
        )
        .bind(
          input.id,
          input.encryptedCode.ciphertext,
          input.encryptedCode.iv,
          input.codeKeyVersion,
          input.expiresAt,
          input.now,
          input.dispatchMarker,
          input.now,
          input.now,
          input.email,
        ),
    ];
    const results = await this.database.batch(statements);
    if (results.length !== statements.length) {
      throw new Error("Login issuance batch result was incomplete");
    }
    return d1Changes(results[1]) === 1;
  }

  async releaseInitialDispatch(loginCodeId: string, marker: string): Promise<void> {
    await this.releaseDispatch({
      loginCodeId,
      marker,
      previousStartedAt: null,
      previousAttemptCount: 0,
      previousMarker: null,
    });
  }

  async findVerifiable(email: string, now: number): Promise<VerifiableLoginCode | null> {
    const row = await this.database
      .prepare(
        `SELECT l.id, l.user_id, l.code_ciphertext, l.code_iv, l.code_key_version
         FROM users u
         JOIN login_codes l ON l.user_id = u.id
         WHERE u.email = ? COLLATE NOCASE
           AND l.consumed_at IS NULL AND l.expires_at > ? AND l.attempt_count < ?
         ORDER BY l.created_at DESC, l.rowid DESC
         LIMIT 1`,
      )
      .bind(email, now, MAX_LOGIN_CODE_ATTEMPTS)
      .first<VerifiableLoginCodeRow>();
    return row
      ? {
          id: row.id,
          userId: row.user_id,
          encryptedCode: encrypted(row.code_ciphertext, row.code_iv),
          codeKeyVersion: row.code_key_version,
        }
      : null;
  }

  async commitCorrectVerification(
    code: VerifiableLoginCode,
    marker: string,
    session: SessionRecord,
    auditId: string,
    now: number,
  ): Promise<boolean> {
    const statements = [
      this.database
        .prepare(
          `UPDATE login_codes
           SET consumed_at = ?, verification_marker = ?, updated_at = ?
           WHERE id = ? AND user_id = ? AND consumed_at IS NULL
             AND expires_at > ? AND attempt_count < ?`,
        )
        .bind(now, marker, now, code.id, code.userId, now, MAX_LOGIN_CODE_ATTEMPTS),
      this.database
        .prepare(
          `INSERT INTO sessions (id, user_id, digest, expires_at, revoked_at, created_at)
           VALUES (
             ?, COALESCE((
               SELECT user_id FROM login_codes
               WHERE id = ? AND user_id = ? AND consumed_at = ?
                 AND verification_marker = ?
             ), NULL), ?, ?, ?, ?
           )`,
        )
        .bind(
          session.id,
          code.id,
          code.userId,
          now,
          marker,
          session.digest,
          session.expiresAt,
          session.revokedAt,
          session.createdAt,
        ),
      this.database
        .prepare(
          `INSERT INTO audit_events (
             id, actor_user_id, action, target_user_id, target_connection_id,
             result, created_at
           ) VALUES (
             COALESCE((
               SELECT ? FROM login_codes l
               JOIN sessions s ON s.user_id = l.user_id
               WHERE l.id = ? AND l.user_id = ? AND l.consumed_at = ?
                 AND l.verification_marker = ? AND s.id = ?
             ), NULL), ?, 'LOGIN_VERIFIED', ?,
             (SELECT connection_id FROM login_codes WHERE id = ?),
             'SUCCESS', ?
           )`,
        )
        .bind(
          auditId,
          code.id,
          code.userId,
          now,
          marker,
          session.id,
          code.userId,
          code.userId,
          code.id,
          now,
        ),
    ];
    try {
      const results = await this.database.batch(statements);
      return results.length === statements.length
        && results.every((result) => d1Changes(result) === 1);
    } catch (error) {
      if (expectedVerificationRace(error)) return false;
      throw error;
    }
  }

  async commitWrongVerification(code: VerifiableLoginCode, now: number): Promise<void> {
    await this.database
      .prepare(
        `UPDATE login_codes
         SET attempt_count = attempt_count + 1,
             consumed_at = CASE
               WHEN attempt_count + 1 >= ? THEN ? ELSE consumed_at
             END,
             updated_at = ?
         WHERE id = ? AND user_id = ? AND consumed_at IS NULL
           AND expires_at > ? AND attempt_count < ?`,
      )
      .bind(
        MAX_LOGIN_CODE_ATTEMPTS,
        now,
        now,
        code.id,
        code.userId,
        now,
        MAX_LOGIN_CODE_ATTEMPTS,
      )
      .run();
  }

  private async currentDeliveryResult(
    loginCodeId: string,
    now: number,
  ): Promise<UnavailableLoginDeliveryResult> {
    const current = await this.database
      .prepare(
        `SELECT delivery_status, retry_not_before
         FROM login_codes WHERE id = ? LIMIT 1`,
      )
      .bind(loginCodeId)
      .first<DeliveryStateRow>();
    if (!current) return { status: "MISSING" };
    if (
      current.delivery_status === "SENT"
      || current.delivery_status === "FAILED"
      || current.delivery_status === "UNCERTAIN"
      || current.delivery_status === "CANCELLED"
    ) {
      return { status: current.delivery_status } as UnavailableLoginDeliveryResult;
    }
    if (
      current.delivery_status === "RETRYABLE"
      && current.retry_not_before !== null
      && current.retry_not_before > now
    ) {
      return {
        status: "RETRY_AFTER",
        retryAfterSeconds: secondsUntil(current.retry_not_before, now),
      };
    }
    return { status: "NOOP" };
  }

  async prepareDelivery(
    loginCodeId: string,
    now: number,
  ): Promise<PrepareLoginDeliveryResult> {
    const row = await this.database
      .prepare(
        `SELECT l.id, l.user_id, l.connection_id, c.provider,
                l.code_ciphertext, l.code_iv, l.code_key_version,
                c.encrypted_token, c.encrypted_token_iv, c.credential_version,
                c.updated_at AS connection_updated_at,
                c.transition_marker AS connection_transition_marker,
                ci.id AS chat_identity_id, ci.private_chat_id,
                l.expires_at, l.delivery_status, l.delivery_attempt_count,
                l.send_started_at, l.retry_not_before, l.transition_marker,
                l.dispatch_started_at, l.dispatch_attempt_count, l.dispatch_marker
         FROM login_codes l
         JOIN bot_connections c
           ON c.id = l.connection_id AND c.user_id = l.user_id
             AND c.state = 'ACTIVE_BOUND'
         JOIN chat_identities ci ON ci.connection_id = c.id
         WHERE l.id = ? AND l.consumed_at IS NULL AND l.expires_at > ?
           AND l.delivery_attempt_count < ?
           AND (
             l.delivery_status = 'PENDING'
             OR (l.delivery_status = 'RETRYABLE'
               AND l.retry_not_before IS NOT NULL AND l.retry_not_before <= ?)
           )
         LIMIT 1`,
      )
      .bind(loginCodeId, now, MAX_DELIVERY_ATTEMPTS, now)
      .first<LoginDeliverySnapshotRow>();
    if (!row) return this.currentDeliveryResult(loginCodeId, now);
    return {
      status: "READY",
      delivery: {
        loginCodeId: row.id,
        userId: row.user_id,
        connectionId: row.connection_id,
        provider: row.provider,
        encryptedCode: encrypted(row.code_ciphertext, row.code_iv),
        codeKeyVersion: row.code_key_version,
        encryptedToken: encrypted(row.encrypted_token, row.encrypted_token_iv),
        credentialVersion: row.credential_version,
        connectionUpdatedAt: row.connection_updated_at,
        connectionTransitionMarker: row.connection_transition_marker,
        chatIdentityId: row.chat_identity_id,
        privateChatId: row.private_chat_id,
        expiresAt: row.expires_at,
        deliveryStatus: row.delivery_status,
        attemptCount: row.delivery_attempt_count,
        sendStartedAt: row.send_started_at,
        retryNotBefore: row.retry_not_before,
        transitionMarker: row.transition_marker,
        dispatchStartedAt: row.dispatch_started_at,
        dispatchAttemptCount: row.dispatch_attempt_count,
        dispatchMarker: row.dispatch_marker,
      },
    };
  }

  private snapshotBindings(delivery: LoginDeliverySnapshot, now: number): unknown[] {
    return [
      delivery.loginCodeId,
      delivery.userId,
      delivery.connectionId,
      delivery.encryptedCode.ciphertext,
      delivery.encryptedCode.iv,
      delivery.codeKeyVersion,
      delivery.expiresAt,
      now,
      delivery.deliveryStatus,
      delivery.attemptCount,
      delivery.sendStartedAt,
      delivery.retryNotBefore,
      delivery.transitionMarker,
      delivery.dispatchStartedAt,
      delivery.dispatchAttemptCount,
      delivery.dispatchMarker,
      MAX_DELIVERY_ATTEMPTS,
      now,
      delivery.connectionId,
      delivery.userId,
      delivery.provider,
      delivery.credentialVersion,
      delivery.encryptedToken.ciphertext,
      delivery.encryptedToken.iv,
      delivery.connectionUpdatedAt,
      delivery.connectionTransitionMarker,
      delivery.chatIdentityId,
      delivery.privateChatId,
    ];
  }

  private deliverySnapshotPredicate(): string {
    return `id = ? AND user_id = ? AND connection_id = ?
      AND code_ciphertext = ? AND code_iv = ? AND code_key_version = ?
      AND consumed_at IS NULL AND expires_at = ? AND expires_at > ?
      AND delivery_status = ? AND delivery_attempt_count = ?
      AND send_started_at IS ? AND retry_not_before IS ?
      AND transition_marker IS ? AND dispatch_started_at IS ?
      AND dispatch_attempt_count = ? AND dispatch_marker IS ?
      AND delivery_attempt_count < ?
      AND (
        delivery_status = 'PENDING'
        OR (delivery_status = 'RETRYABLE'
          AND retry_not_before IS NOT NULL AND retry_not_before <= ?)
      )
      AND EXISTS (
        SELECT 1 FROM bot_connections c
        JOIN chat_identities ci ON ci.connection_id = c.id
        WHERE c.id = ? AND c.id = login_codes.connection_id
          AND c.user_id = ? AND c.user_id = login_codes.user_id
          AND c.provider = ? AND c.state = 'ACTIVE_BOUND'
          AND c.credential_version = ? AND c.encrypted_token = ?
          AND c.encrypted_token_iv = ? AND c.updated_at = ?
          AND c.transition_marker IS ? AND ci.id = ?
          AND ci.private_chat_id = ?
      )`;
  }

  async acquireDelivery(
    delivery: LoginDeliverySnapshot,
    marker: string,
    now: number,
  ): Promise<AcquireLoginDeliveryResult> {
    const claimed = await this.database
      .prepare(
        `UPDATE login_codes
         SET delivery_status = 'SENDING',
             delivery_attempt_count = delivery_attempt_count + 1,
             send_started_at = ?, retry_not_before = NULL,
             safe_error_code = NULL, transition_marker = ?,
             dispatch_started_at = NULL, dispatch_marker = NULL,
             updated_at = ?
         WHERE ${this.deliverySnapshotPredicate()}
         RETURNING id`,
      )
      .bind(
        now,
        marker,
        now,
        ...this.snapshotBindings(delivery, now),
      )
      .run<{ id: string }>();
    return d1Changes(claimed) === 1
      ? { status: "OWNED" }
      : this.currentDeliveryResult(delivery.loginCodeId, now);
  }

  async finalizePreProviderFailure(
    delivery: LoginDeliverySnapshot,
    terminalMarker: string,
    auditId: string,
    now: number,
  ): Promise<boolean> {
    try {
      await this.guardedDeliveryBatch(
        delivery.loginCodeId,
        terminalMarker,
        "FAILED",
        auditId,
        now,
        [
          this.database
            .prepare(
              `UPDATE login_codes
               SET delivery_status = 'FAILED', consumed_at = COALESCE(consumed_at, ?),
                   safe_error_code = 'INVALID_LOGIN_DATA', retry_not_before = NULL,
                   dispatch_started_at = NULL, dispatch_marker = NULL,
                   transition_marker = ?, updated_at = ?
               WHERE ${this.deliverySnapshotPredicate()}`,
            )
            .bind(
              now,
              terminalMarker,
              now,
              ...this.snapshotBindings(delivery, now),
            ),
        ],
        "LOGIN_CODE_DELIVERY_FAILED",
        "FAILURE",
      );
      return true;
    } catch (error) {
      if (error instanceof Error && error.message === "Login delivery ownership was lost") {
        return false;
      }
      throw error;
    }
  }

  async finalizeDeliverySuccess(
    loginCodeId: string,
    marker: string,
    auditId: string,
    now: number,
  ): Promise<void> {
    await this.guardedDeliveryBatch(
      loginCodeId,
      marker,
      "SENT",
      auditId,
      now,
      [
        this.database
          .prepare(
            `UPDATE login_codes
             SET delivery_status = 'SENT', safe_error_code = NULL,
                 retry_not_before = NULL, dispatch_started_at = NULL,
                 dispatch_marker = NULL, updated_at = ?
             WHERE id = ? AND delivery_status = 'SENDING'
               AND transition_marker = ?`,
          )
          .bind(now, loginCodeId, marker),
      ],
      "LOGIN_CODE_SENT",
      "SUCCESS",
    );
  }

  async finalizeDeliveryTerminal(input: {
    loginCodeId: string;
    connectionId: string;
    marker: string;
    status: "FAILED" | "UNCERTAIN";
    safeErrorCode: string;
    suspendConnection: boolean;
    auditId: string;
    now: number;
  }): Promise<void> {
    const statements: D1PreparedStatement[] = [
      this.database
        .prepare(
          `UPDATE login_codes
           SET delivery_status = ?, safe_error_code = ?,
               consumed_at = CASE
                 WHEN ? = 'FAILED' THEN COALESCE(consumed_at, ?)
                 ELSE consumed_at
               END,
               retry_not_before = NULL, dispatch_started_at = NULL,
               dispatch_marker = NULL, updated_at = ?
           WHERE id = ? AND delivery_status = 'SENDING'
             AND transition_marker = ?`,
        )
        .bind(
          input.status,
          input.safeErrorCode,
          input.status,
          input.now,
          input.now,
          input.loginCodeId,
          input.marker,
        ),
    ];
    if (input.suspendConnection) {
      statements.push(
        this.database
          .prepare(
            `UPDATE bot_connections
             SET state = 'SUSPENDED', updated_at = ?
             WHERE id = ? AND state = 'ACTIVE_BOUND'
               AND EXISTS (
                 SELECT 1 FROM login_codes
                 WHERE id = ? AND delivery_status = 'FAILED'
                   AND safe_error_code = 'REJECTED_CREDENTIAL'
                   AND transition_marker = ?
               )`,
          )
          .bind(
            input.now,
            input.connectionId,
            input.loginCodeId,
            input.marker,
          ),
      );
    }
    await this.guardedDeliveryBatch(
      input.loginCodeId,
      input.marker,
      input.status,
      input.auditId,
      input.now,
      statements,
      input.status === "UNCERTAIN" ? "LOGIN_CODE_DELIVERY_UNCERTAIN" : "LOGIN_CODE_DELIVERY_FAILED",
      "FAILURE",
      input.suspendConnection ? input.connectionId : null,
    );
  }

  async scheduleDeliveryRetry(
    loginCodeId: string,
    marker: string,
    retryNotBefore: number,
    auditId: string,
    now: number,
  ): Promise<void> {
    await this.guardedDeliveryBatch(
      loginCodeId,
      marker,
      "RETRYABLE",
      auditId,
      now,
      [
        this.database
          .prepare(
            `UPDATE login_codes
             SET delivery_status = 'RETRYABLE', safe_error_code = 'QUOTA',
                 send_started_at = NULL, retry_not_before = ?,
                 dispatch_started_at = NULL, dispatch_marker = NULL,
                 updated_at = ?
             WHERE id = ? AND delivery_status = 'SENDING'
               AND transition_marker = ? AND delivery_attempt_count < ?`,
          )
          .bind(
            retryNotBefore,
            now,
            loginCodeId,
            marker,
            MAX_DELIVERY_ATTEMPTS,
          ),
      ],
      "LOGIN_CODE_RETRY_SCHEDULED",
      "FAILURE",
    );
  }

  private async guardedDeliveryBatch(
    loginCodeId: string,
    marker: string,
    status: string,
    auditId: string,
    now: number,
    statements: D1PreparedStatement[],
    action: string,
    result: "SUCCESS" | "FAILURE",
    requiredSuspendedConnectionId: string | null = null,
  ): Promise<void> {
    statements.push(
      this.database
        .prepare(
          `INSERT INTO audit_events (
             id, actor_user_id, action, target_user_id, target_connection_id,
             result, created_at
           ) VALUES (
             COALESCE((
               SELECT ? FROM login_codes l
               JOIN bot_connections c ON c.id = l.connection_id AND c.user_id = l.user_id
               WHERE l.id = ? AND l.delivery_status = ?
                 AND l.transition_marker = ?
                 AND (? IS NULL OR (c.id = ? AND c.state = 'SUSPENDED'))
             ), NULL),
             (SELECT user_id FROM login_codes WHERE id = ?), ?,
             (SELECT user_id FROM login_codes WHERE id = ?),
             (SELECT connection_id FROM login_codes WHERE id = ?), ?, ?
           )`,
        )
        .bind(
          auditId,
          loginCodeId,
          status,
          marker,
          requiredSuspendedConnectionId,
          requiredSuspendedConnectionId,
          loginCodeId,
          action,
          loginCodeId,
          loginCodeId,
          result,
          now,
        ),
    );
    try {
      await this.database.batch(statements);
    } catch (error) {
      if (expectedDeliveryRace(error)) throw new Error("Login delivery ownership was lost");
      throw error;
    }
  }

  async selectDispatchCandidates(now: number, limit: number): Promise<string[]> {
    const result = await this.database
      .prepare(
        `SELECT id
         FROM login_codes
         WHERE consumed_at IS NULL AND expires_at > ?
           AND delivery_status IN ('PENDING', 'RETRYABLE')
           AND (
             delivery_status = 'PENDING'
             OR (delivery_status = 'RETRYABLE'
               AND retry_not_before IS NOT NULL AND retry_not_before <= ?)
           )
           AND (dispatch_started_at IS NULL OR dispatch_started_at <= ?)
         ORDER BY expires_at, created_at, id
         LIMIT ?`,
      )
      .bind(now, now, now - INBOUND_DISPATCH_LEASE_MS, limit)
      .all<DispatchCandidateRow>();
    return result.results.map(({ id }) => id);
  }

  async reserveDispatch(
    loginCodeId: string,
    marker: string,
    now: number,
  ): Promise<ReserveLoginDispatchResult> {
    const prior = await this.database
      .prepare(
        `SELECT id, delivery_status, retry_not_before, consumed_at, expires_at,
                dispatch_started_at, dispatch_attempt_count, dispatch_marker
         FROM login_codes WHERE id = ? LIMIT 1`,
      )
      .bind(loginCodeId)
      .first<LoginDispatchRow>();
    if (!prior) return { status: "MISSING" };
    const due = prior.delivery_status === "PENDING"
      || (
        prior.delivery_status === "RETRYABLE"
        && prior.retry_not_before !== null
        && prior.retry_not_before <= now
      );
    const dispatchAvailable = prior.dispatch_started_at === null
      || prior.dispatch_started_at <= now - INBOUND_DISPATCH_LEASE_MS;
    if (prior.consumed_at !== null || prior.expires_at <= now || !due || !dispatchAvailable) {
      return { status: "NOOP" };
    }

    if (prior.dispatch_attempt_count >= MAX_LOGIN_DISPATCH_ATTEMPTS) {
      const exhausted = await this.database
        .prepare(
          `UPDATE login_codes
           SET delivery_status = 'FAILED', consumed_at = ?,
               safe_error_code = 'LOGIN_DISPATCH_EXHAUSTED',
               dispatch_started_at = NULL, dispatch_marker = NULL,
               updated_at = ?
           WHERE id = ? AND consumed_at IS ? AND expires_at = ?
             AND delivery_status = ? AND retry_not_before IS ?
             AND dispatch_started_at IS ? AND dispatch_attempt_count = ?
             AND dispatch_marker IS ?
             AND (dispatch_started_at IS NULL OR dispatch_started_at <= ?)
             AND dispatch_attempt_count >= ?
           RETURNING id`,
        )
        .bind(
          now,
          now,
          prior.id,
          prior.consumed_at,
          prior.expires_at,
          prior.delivery_status,
          prior.retry_not_before,
          prior.dispatch_started_at,
          prior.dispatch_attempt_count,
          prior.dispatch_marker,
          now - INBOUND_DISPATCH_LEASE_MS,
          MAX_LOGIN_DISPATCH_ATTEMPTS,
        )
        .run<{ id: string }>();
      return d1Changes(exhausted) === 1 ? { status: "EXHAUSTED" } : { status: "NOOP" };
    }

    const reserved = await this.database
      .prepare(
        `UPDATE login_codes
         SET dispatch_started_at = ?,
             dispatch_attempt_count = dispatch_attempt_count + 1,
             dispatch_marker = ?, updated_at = ?
         WHERE id = ? AND consumed_at IS NULL AND expires_at > ?
           AND delivery_status = ? AND retry_not_before IS ?
           AND dispatch_started_at IS ? AND dispatch_attempt_count = ?
           AND dispatch_marker IS ?
           AND dispatch_attempt_count < ?
           AND (
             delivery_status = 'PENDING'
             OR (delivery_status = 'RETRYABLE'
               AND retry_not_before IS NOT NULL AND retry_not_before <= ?)
           )
           AND (dispatch_started_at IS NULL OR dispatch_started_at <= ?)
         RETURNING id`,
      )
      .bind(
        now,
        marker,
        now,
        loginCodeId,
        now,
        prior.delivery_status,
        prior.retry_not_before,
        prior.dispatch_started_at,
        prior.dispatch_attempt_count,
        prior.dispatch_marker,
        MAX_LOGIN_DISPATCH_ATTEMPTS,
        now,
        now - INBOUND_DISPATCH_LEASE_MS,
      )
      .run<{ id: string }>();
    if (d1Changes(reserved) !== 1) return { status: "NOOP" };
    return {
      status: "RESERVED",
      reservation: {
        loginCodeId: prior.id,
        marker,
        previousStartedAt: prior.dispatch_started_at,
        previousAttemptCount: prior.dispatch_attempt_count,
        previousMarker: prior.dispatch_marker,
      },
    };
  }

  async releaseDispatch(reservation: LoginDispatchReservation): Promise<boolean> {
    const result = await this.database
      .prepare(
        `UPDATE login_codes
         SET dispatch_started_at = ?, dispatch_attempt_count = ?, dispatch_marker = ?
         WHERE id = ? AND dispatch_marker = ?
           AND dispatch_attempt_count = ?
           AND consumed_at IS NULL AND delivery_status IN ('PENDING', 'RETRYABLE')`,
      )
      .bind(
        reservation.previousStartedAt,
        reservation.previousAttemptCount,
        reservation.previousMarker,
        reservation.loginCodeId,
        reservation.marker,
        reservation.previousAttemptCount + 1,
      )
      .run();
    return d1Changes(result) === 1;
  }

  async selectStaleSending(now: number, limit: number): Promise<StaleSendingRow[]> {
    const result = await this.database
      .prepare(
        `SELECT id, transition_marker
         FROM login_codes
         WHERE delivery_status = 'SENDING' AND send_started_at IS NOT NULL
           AND send_started_at < ? AND transition_marker IS NOT NULL
         ORDER BY send_started_at, id
         LIMIT ?`,
      )
      .bind(now - DELIVERY_SEND_LEASE_MS, limit)
      .all<StaleSendingRow>();
    return result.results;
  }

  async terminalizeStaleSending(
    loginCodeId: string,
    marker: string,
    terminalMarker: string,
    auditId: string,
    now: number,
  ): Promise<boolean> {
    try {
      await this.guardedDeliveryBatch(
        loginCodeId,
        terminalMarker,
        "UNCERTAIN",
        auditId,
        now,
        [
          this.database
            .prepare(
              `UPDATE login_codes
               SET delivery_status = 'UNCERTAIN',
                   safe_error_code = 'STALE_SENDING_LEASE',
                   retry_not_before = NULL, dispatch_started_at = NULL,
                   dispatch_marker = NULL, transition_marker = ?, updated_at = ?
               WHERE id = ? AND delivery_status = 'SENDING'
                 AND transition_marker = ? AND send_started_at IS NOT NULL
                 AND send_started_at < ?`,
            )
            .bind(terminalMarker, now, loginCodeId, marker, now - DELIVERY_SEND_LEASE_MS),
        ],
        "LOGIN_CODE_DELIVERY_UNCERTAIN",
        "FAILURE",
      );
      return true;
    } catch (error) {
      if (error instanceof Error && error.message === "Login delivery ownership was lost") {
        return false;
      }
      throw error;
    }
  }
}

export class InvalidLoginCodeError extends Error {
  readonly code = "INVALID_LOGIN_CODE";
  readonly status = 401;

  constructor() {
    super("Mã đăng nhập không hợp lệ hoặc đã hết hạn.");
    this.name = "InvalidLoginCodeError";
  }
}

function generateLoginCode(randomBytes: RandomBytes): string {
  let code = "";
  while (code.length < 6) {
    const bytes = randomBytes(6 - code.length);
    if (bytes.byteLength === 0) throw new TypeError("Random source returned no bytes");
    for (const byte of bytes) {
      if (byte < DIGIT_ACCEPTANCE_BOUND) code += String(byte % 10);
      if (code.length === 6) break;
    }
  }
  return code;
}

export interface RequestLoginCodeDependencies {
  store: LoginCodeStore;
  keyring: Pick<Keyring, "encryptSensitive">;
  enqueue(job: DeliverLoginCodeJob): Promise<unknown>;
  now?: Clock;
  randomBytes?: RandomBytes;
}

export async function requestLoginCode(
  email: string,
  dependencies: RequestLoginCodeDependencies,
): Promise<{ accepted: true }> {
  const now = dependencies.now ?? systemClock;
  const randomBytes = dependencies.randomBytes ?? cryptoRandomBytes;
  const createdAt = now();
  const loginCodeId = randomOpaqueId(randomBytes);
  const code = generateLoginCode(randomBytes);
  const encryptedCode = await dependencies.keyring.encryptSensitive(
    "login-code",
    loginCodeId,
    LOGIN_CODE_KEY_VERSION,
    code,
  );
  const dispatchMarker = randomOpaqueId(randomBytes);
  await dependencies.store.issue({
    email,
    id: loginCodeId,
    encryptedCode,
    codeKeyVersion: LOGIN_CODE_KEY_VERSION,
    expiresAt: createdAt + LOGIN_CODE_TTL_MS,
    dispatchMarker,
    now: createdAt,
  });

  try {
    await dependencies.enqueue({ type: "DELIVER_LOGIN_CODE", loginCodeId });
  } catch {
    try {
      await dependencies.store.releaseInitialDispatch(loginCodeId, dispatchMarker);
    } catch {
      // A real row remains durably leased for Cron, while a decoy follows the same path.
    }
  }
  return { accepted: true };
}

export interface VerifyLoginCodeDependencies {
  store: LoginCodeStore;
  keyring: Pick<Keyring, "decryptSensitive" | "digestSession" | "constantTimeEqual">;
  now?: Clock;
  randomBytes?: RandomBytes;
}

export async function verifyLoginCode(
  email: string,
  suppliedCode: string,
  dependencies: VerifyLoginCodeDependencies,
): Promise<{ cookie: string }> {
  const now = dependencies.now ?? systemClock;
  const randomBytes = dependencies.randomBytes ?? cryptoRandomBytes;
  const verificationTime = now();
  const code = await dependencies.store.findVerifiable(email, verificationTime);
  if (!code) throw new InvalidLoginCodeError();

  let expected: string;
  try {
    expected = await dependencies.keyring.decryptSensitive(
      "login-code",
      code.id,
      code.codeKeyVersion,
      code.encryptedCode,
    );
  } catch {
    throw new InvalidLoginCodeError();
  }
  const session = await prepareSession(code.userId, {
    keyring: dependencies.keyring,
    now: () => verificationTime,
    randomBytes,
  });
  if (!dependencies.keyring.constantTimeEqual(expected, suppliedCode)) {
    await dependencies.store.commitWrongVerification(code, verificationTime);
    throw new InvalidLoginCodeError();
  }

  const committed = await dependencies.store.commitCorrectVerification(
    code,
    randomOpaqueId(randomBytes),
    session.record,
    randomOpaqueId(randomBytes),
    verificationTime,
  );
  if (!committed) throw new InvalidLoginCodeError();
  return { cookie: session.cookie };
}

type SendText = (
  provider: BotProvider,
  token: string,
  privateChatId: string,
  text: string,
) => Promise<SendReceipt>;

export interface DeliverLoginCodeDependencies {
  store: LoginCodeStore;
  keyring: Pick<Keyring, "decryptSensitive" | "decryptCredential">;
  sendText?: SendText;
  now?: Clock;
  randomBytes?: RandomBytes;
}

export type DeliverLoginCodeResult =
  | { status: "SENT" | "FAILED" | "UNCERTAIN" | "CANCELLED" | "NOOP" | "MISSING" }
  | { status: "RETRYABLE" | "RETRY_AFTER"; retryAfterSeconds: number };

function quotaDelay(error: ProviderOperationError, attemptCount: number): number {
  if (
    error.retryAfterSeconds !== null
    && Number.isInteger(error.retryAfterSeconds)
    && error.retryAfterSeconds >= 1
    && error.retryAfterSeconds <= 86_400
  ) {
    return error.retryAfterSeconds;
  }
  return QUOTA_FALLBACK_DELAYS_SECONDS[Math.min(
    Math.max(attemptCount - 1, 0),
    QUOTA_FALLBACK_DELAYS_SECONDS.length - 1,
  )];
}

export async function deliverLoginCode(
  loginCodeId: string,
  dependencies: DeliverLoginCodeDependencies,
): Promise<DeliverLoginCodeResult> {
  const now = dependencies.now ?? systemClock;
  const randomBytes = dependencies.randomBytes ?? cryptoRandomBytes;
  const startedAt = now();
  const prepared = await dependencies.store.prepareDelivery(loginCodeId, startedAt);
  if (prepared.status !== "READY") return prepared;
  const delivery = prepared.delivery;

  let code: string;
  let token: string;
  try {
    code = await dependencies.keyring.decryptSensitive(
      "login-code",
      delivery.loginCodeId,
      delivery.codeKeyVersion,
      delivery.encryptedCode,
    );
    token = await dependencies.keyring.decryptCredential(
      delivery.connectionId,
      delivery.provider,
      delivery.credentialVersion,
      delivery.encryptedToken,
    );
    if (!isSafeProviderToken(delivery.provider, token)) {
      throw new ProviderVerificationError("INVALID_TOKEN_FORMAT");
    }
    if (!/^\d{6}$/u.test(code) || delivery.privateChatId.length === 0) {
      throw new ProviderVerificationError("INVALID_PROVIDER_RESPONSE");
    }
  } catch {
    const failedAt = now();
    try {
      const finalized = await dependencies.store.finalizePreProviderFailure(
        delivery,
        randomOpaqueId(randomBytes),
        randomOpaqueId(randomBytes),
        failedAt,
      );
      return finalized
        ? { status: "FAILED" }
        : { status: "RETRYABLE", retryAfterSeconds: SAFE_PRE_PROVIDER_RETRY_SECONDS };
    } catch {
      return { status: "RETRYABLE", retryAfterSeconds: SAFE_PRE_PROVIDER_RETRY_SECONDS };
    }
  }

  const marker = randomOpaqueId(randomBytes);
  const acquired = await dependencies.store.acquireDelivery(delivery, marker, now());
  if (acquired.status !== "OWNED") return acquired;
  const attemptCount = delivery.attemptCount + 1;

  const text = `Mã đăng nhập Calenote của bạn: ${code}. Mã có hiệu lực trong 10 phút.`;
  try {
    await (dependencies.sendText ?? sendProviderText)(
      delivery.provider,
      token,
      delivery.privateChatId,
      text,
    );
  } catch (error) {
    const completedAt = now();
    if (error instanceof ProviderOperationError && error.code === "QUOTA") {
      if (attemptCount >= MAX_DELIVERY_ATTEMPTS) {
        try {
          await dependencies.store.finalizeDeliveryTerminal({
            loginCodeId,
            connectionId: delivery.connectionId,
            marker,
            status: "FAILED",
            safeErrorCode: "QUOTA_RETRY_EXHAUSTED",
            suspendConnection: false,
            auditId: randomOpaqueId(randomBytes),
            now: completedAt,
          });
          return { status: "FAILED" };
        } catch {
          return { status: "UNCERTAIN" };
        }
      }
      const retryAfterSeconds = quotaDelay(error, attemptCount);
      try {
        await dependencies.store.scheduleDeliveryRetry(
          loginCodeId,
          marker,
          completedAt + retryAfterSeconds * 1_000,
          randomOpaqueId(randomBytes),
          completedAt,
        );
        return { status: "RETRYABLE", retryAfterSeconds };
      } catch {
        return { status: "UNCERTAIN" };
      }
    }

    const rejectedCredential = error instanceof ProviderOperationError
      && error.code === "REJECTED_CREDENTIAL";
    const uncertain = !(error instanceof ProviderOperationError)
      || error.code === "UNCERTAIN"
      || error.code === "INVALID_RESPONSE";
    const status = uncertain ? "UNCERTAIN" : "FAILED";
    try {
      await dependencies.store.finalizeDeliveryTerminal({
        loginCodeId,
        connectionId: delivery.connectionId,
        marker,
        status,
        safeErrorCode: error instanceof ProviderOperationError ? error.code : "UNCERTAIN",
        suspendConnection: rejectedCredential,
        auditId: randomOpaqueId(randomBytes),
        now: completedAt,
      });
      return { status };
    } catch {
      return { status: "UNCERTAIN" };
    }
  }

  try {
    await dependencies.store.finalizeDeliverySuccess(
      loginCodeId,
      marker,
      randomOpaqueId(randomBytes),
      now(),
    );
    return { status: "SENT" };
  } catch {
    return { status: "UNCERTAIN" };
  }
}

export interface RedriveLoginDependencies {
  store: LoginCodeStore;
  enqueue(job: DeliverLoginCodeJob): Promise<unknown>;
  randomBytes?: RandomBytes;
}

export interface RedriveLoginResult {
  selected: number;
  published: number;
  publishFailed: number;
  exhausted: number;
  staleTerminalized: number;
}

function boundedLimit(limit: number): number {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new TypeError("Login redrive limit must be a positive integer");
  }
  return Math.min(limit, MAX_SCHEDULER_LIMIT);
}

export async function redriveLoginCodes(
  now: number,
  limit: number,
  dependencies: RedriveLoginDependencies,
): Promise<RedriveLoginResult> {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new TypeError("Login redrive time must be a non-negative safe integer");
  }
  const bounded = boundedLimit(limit);
  const randomBytes = dependencies.randomBytes ?? cryptoRandomBytes;
  const stale = await dependencies.store.selectStaleSending(now, bounded);
  let staleTerminalized = 0;
  for (const candidate of stale) {
    if (await dependencies.store.terminalizeStaleSending(
      candidate.id,
      candidate.transition_marker,
      randomOpaqueId(randomBytes),
      randomOpaqueId(randomBytes),
      now,
    )) {
      staleTerminalized += 1;
    }
  }

  const candidates = await dependencies.store.selectDispatchCandidates(now, bounded);
  let published = 0;
  let publishFailed = 0;
  let exhausted = 0;
  for (const loginCodeId of candidates) {
    const marker = randomOpaqueId(randomBytes);
    const reservation = await dependencies.store.reserveDispatch(loginCodeId, marker, now);
    if (reservation.status === "EXHAUSTED") {
      exhausted += 1;
      continue;
    }
    if (reservation.status !== "RESERVED") continue;
    try {
      await dependencies.enqueue({ type: "DELIVER_LOGIN_CODE", loginCodeId });
      published += 1;
    } catch {
      publishFailed += 1;
      try {
        await dependencies.store.releaseDispatch(reservation.reservation);
      } catch {
        // A bounded dispatch lease remains recoverable by a later Cron invocation.
      }
    }
  }
  return {
    selected: candidates.length,
    published,
    publishFailed,
    exhausted,
    staleTerminalized,
  };
}

export const SAFE_LOGIN_QUEUE_RETRY_SECONDS = SAFE_PRE_PROVIDER_RETRY_SECONDS;
