import {
  cryptoRandomBytes,
  d1Changes,
  randomOpaqueId,
  type RandomBytes,
} from "@/modules/platform/types";

export const REMINDER_CLAIM_LEASE_MS = 5 * 60_000;
export const DELIVERY_SEND_LEASE_MS = 5 * 60_000;
export const INBOUND_DISPATCH_LEASE_MS = 5 * 60_000;
export const MAX_DELIVERY_ATTEMPTS = 4;
export const MAX_INBOUND_PROCESS_ATTEMPTS = 4;
export const MAX_INBOUND_DISPATCH_ATTEMPTS = 4;
export const MAX_SCHEDULER_LIMIT = 10;
export const CRON_REMINDER_LIMIT = 5;
export const CRON_INBOUND_LIMIT = 5;

export interface DeliverReminderJob {
  type: "DELIVER_REMINDER";
  reminderId: string;
}

export interface ProcessInboundJob {
  type: "PROCESS_INBOUND";
  inboundId: string;
}

type ReminderDispatchJob = DeliverReminderJob | ProcessInboundJob;

type ReminderClaimableState = "PENDING" | "CLAIMED" | "RETRYABLE";

interface ReminderCandidateRow {
  id: string;
  status: ReminderClaimableState;
  scheduled_at: number;
  claimed_at: number | null;
  transition_marker: string | null;
  updated_at: number;
}

export interface ReminderClaimReservation {
  reminderId: string;
  marker: string;
  previousState: ReminderClaimableState;
  previousClaimedAt: number | null;
  previousMarker: string | null;
  previousUpdatedAt: number;
}

export interface ReminderSchedulerStore {
  selectCandidates(now: number, limit: number): Promise<ReminderCandidateRow[]>;
  claim(
    candidate: ReminderCandidateRow,
    now: number,
    marker: string,
  ): Promise<ReminderClaimReservation | null>;
  rollback(reservation: ReminderClaimReservation): Promise<boolean>;
}

function boundedLimit(limit: number): number {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new TypeError("Scheduler limit must be a positive integer");
  }
  return Math.min(limit, MAX_SCHEDULER_LIMIT);
}

function assertNow(now: number): void {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new TypeError("Scheduler time must be a non-negative safe integer");
  }
}

export class D1ReminderSchedulerStore implements ReminderSchedulerStore {
  constructor(private readonly database: D1Database) {}

  async selectCandidates(now: number, limit: number): Promise<ReminderCandidateRow[]> {
    const result = await this.database
      .prepare(
        `SELECT r.id, r.status, r.scheduled_at, r.claimed_at,
                r.transition_marker, r.updated_at
         FROM reminders r
         LEFT JOIN reminder_deliveries d ON d.reminder_id = r.id
         WHERE (
           (r.status = 'PENDING' AND r.scheduled_at <= ?
             AND (d.reminder_id IS NULL OR d.status = 'PENDING'))
           OR
           (r.status = 'CLAIMED' AND r.claimed_at IS NOT NULL AND r.claimed_at <= ?
             AND (
               d.reminder_id IS NULL OR d.status IN ('PENDING', 'RETRYABLE')
               OR (d.status = 'SENDING' AND d.send_started_at IS NOT NULL
                 AND d.send_started_at < ?)
             ))
           OR
           (r.status = 'RETRYABLE' AND d.status = 'RETRYABLE'
             AND d.retry_not_before IS NOT NULL AND d.retry_not_before <= ?
             AND d.attempt_count < ?)
         )
         ORDER BY r.scheduled_at, r.id
         LIMIT ?`,
      )
      .bind(
        now,
        now - REMINDER_CLAIM_LEASE_MS,
        now - DELIVERY_SEND_LEASE_MS,
        now,
        MAX_DELIVERY_ATTEMPTS,
        limit,
      )
      .all<ReminderCandidateRow>();
    return result.results;
  }

  async claim(
    candidate: ReminderCandidateRow,
    now: number,
    marker: string,
  ): Promise<ReminderClaimReservation | null> {
    let stateEligibility: string;
    const stateBindings: unknown[] = [];
    if (candidate.status === "PENDING") {
      stateEligibility = `status = 'PENDING' AND scheduled_at <= ?
        AND (NOT EXISTS (
          SELECT 1 FROM reminder_deliveries d
          WHERE d.reminder_id = reminders.id
        ) OR EXISTS (
          SELECT 1 FROM reminder_deliveries d
          WHERE d.reminder_id = reminders.id AND d.status = 'PENDING'
        ))`;
      stateBindings.push(now);
    } else if (candidate.status === "CLAIMED") {
      stateEligibility = `status = 'CLAIMED' AND claimed_at IS NOT NULL AND claimed_at <= ?
        AND (
          NOT EXISTS (
            SELECT 1 FROM reminder_deliveries d
            WHERE d.reminder_id = reminders.id
          )
          OR EXISTS (
            SELECT 1 FROM reminder_deliveries d
            WHERE d.reminder_id = reminders.id AND d.status IN ('PENDING', 'RETRYABLE')
          )
          OR EXISTS (
            SELECT 1 FROM reminder_deliveries d
            WHERE d.reminder_id = reminders.id AND d.status = 'SENDING'
              AND d.send_started_at IS NOT NULL AND d.send_started_at < ?
          )
        )`;
      stateBindings.push(
        now - REMINDER_CLAIM_LEASE_MS,
        now - DELIVERY_SEND_LEASE_MS,
      );
    } else {
      stateEligibility = `status = 'RETRYABLE' AND EXISTS (
        SELECT 1 FROM reminder_deliveries d
        WHERE d.reminder_id = reminders.id AND d.status = 'RETRYABLE'
          AND d.retry_not_before IS NOT NULL AND d.retry_not_before <= ?
          AND d.attempt_count < ?
      )`;
      stateBindings.push(now, MAX_DELIVERY_ATTEMPTS);
    }

    const result = await this.database
      .prepare(
        `UPDATE reminders
         SET status = 'CLAIMED', claimed_at = ?, transition_marker = ?, updated_at = ?
         WHERE id = ? AND status = ? AND scheduled_at = ?
           AND claimed_at IS ? AND transition_marker IS ? AND updated_at = ?
           AND ${stateEligibility}
         RETURNING id`,
      )
      .bind(
        now,
        marker,
        now,
        candidate.id,
        candidate.status,
        candidate.scheduled_at,
        candidate.claimed_at,
        candidate.transition_marker,
        candidate.updated_at,
        ...stateBindings,
      )
      .run<{ id: string }>();

    if (d1Changes(result) !== 1) return null;
    return {
      reminderId: candidate.id,
      marker,
      previousState: candidate.status,
      previousClaimedAt: candidate.claimed_at,
      previousMarker: candidate.transition_marker,
      previousUpdatedAt: candidate.updated_at,
    };
  }

  async rollback(reservation: ReminderClaimReservation): Promise<boolean> {
    const result = await this.database
      .prepare(
        `UPDATE reminders
         SET status = ?, claimed_at = ?, transition_marker = ?, updated_at = ?
         WHERE id = ? AND status = 'CLAIMED' AND transition_marker = ?`,
      )
      .bind(
        reservation.previousState,
        reservation.previousClaimedAt,
        reservation.previousMarker,
        reservation.previousUpdatedAt,
        reservation.reminderId,
        reservation.marker,
      )
      .run();
    return d1Changes(result) === 1;
  }
}

export interface SchedulerDependencies {
  store: ReminderSchedulerStore;
  enqueue(job: DeliverReminderJob): Promise<unknown>;
  randomBytes?: RandomBytes;
}

export interface SchedulerResult {
  selected: number;
  published: number;
  publishFailed: number;
}

export async function claimDueReminders(
  now: number,
  limit: number,
  dependencies: SchedulerDependencies,
): Promise<SchedulerResult> {
  assertNow(now);
  const bounded = boundedLimit(limit);
  const candidates = await dependencies.store.selectCandidates(now, bounded);
  const randomBytes = dependencies.randomBytes ?? cryptoRandomBytes;
  let published = 0;
  let publishFailed = 0;

  for (const candidate of candidates) {
    const reservation = await dependencies.store.claim(
      candidate,
      now,
      randomOpaqueId(randomBytes),
    );
    if (!reservation) continue;
    try {
      await dependencies.enqueue({
        type: "DELIVER_REMINDER",
        reminderId: reservation.reminderId,
      });
      published += 1;
    } catch {
      publishFailed += 1;
      try {
        await dependencies.store.rollback(reservation);
      } catch {
        // The claim remains leased and Cron can recover it after the bounded lease.
      }
    }
  }

  return { selected: candidates.length, published, publishFailed };
}

type DispatchableInboundState = "PENDING" | "PROCESSING";

interface InboundDispatchRow {
  id: string;
  state: DispatchableInboundState;
  received_at: number;
  processing_started_at: number | null;
  attempt_count: number;
  dispatch_started_at: number | null;
  dispatch_attempt_count: number;
  dispatch_marker: string | null;
}

export interface InboundDispatchReservation {
  inboundId: string;
  marker: string;
  previousStartedAt: number | null;
  previousAttemptCount: number;
  previousMarker: string | null;
}

export type InboundDispatchResult =
  | { status: "RESERVED"; reservation: InboundDispatchReservation }
  | { status: "LEASED"; retryAfterMs: number }
  | { status: "EXHAUSTED" }
  | { status: "TERMINAL" }
  | { status: "MISSING" };

export interface InboundDispatchStore {
  selectOrphans(now: number, limit: number): Promise<string[]>;
  reserve(inboundId: string, now: number, marker: string): Promise<InboundDispatchResult>;
  rollback(reservation: InboundDispatchReservation): Promise<boolean>;
}

function isDispatchEligible(row: InboundDispatchRow, now: number): boolean {
  const dispatchExpired = row.dispatch_started_at === null
    || row.dispatch_started_at <= now - INBOUND_DISPATCH_LEASE_MS;
  if (row.state === "PENDING") return dispatchExpired;
  const processingExpired = row.processing_started_at === null
    || row.processing_started_at <= now - INBOUND_DISPATCH_LEASE_MS;
  return processingExpired && dispatchExpired;
}

function dispatchRetryAfter(row: InboundDispatchRow, now: number): number {
  const deadlines: number[] = [];
  if (row.dispatch_started_at !== null) {
    deadlines.push(row.dispatch_started_at + INBOUND_DISPATCH_LEASE_MS);
  }
  if (row.state === "PROCESSING" && row.processing_started_at !== null) {
    deadlines.push(row.processing_started_at + INBOUND_DISPATCH_LEASE_MS);
  }
  if (deadlines.length === 0) return 1;
  return Math.max(1, Math.max(...deadlines) - now);
}

export class D1InboundDispatchStore implements InboundDispatchStore {
  constructor(private readonly database: D1Database) {}

  private async read(inboundId: string): Promise<InboundDispatchRow | null> {
    return this.database
      .prepare(
        `SELECT id, state, received_at, processing_started_at, attempt_count,
                dispatch_started_at, dispatch_attempt_count, dispatch_marker
         FROM inbound_updates WHERE id = ? LIMIT 1`,
      )
      .bind(inboundId)
      .first<InboundDispatchRow>();
  }

  async selectOrphans(now: number, limit: number): Promise<string[]> {
    const result = await this.database
      .prepare(
        `SELECT id
         FROM inbound_updates
         WHERE (
           state = 'PENDING'
           AND (dispatch_started_at IS NULL OR dispatch_started_at <= ?)
         ) OR (
           state = 'PROCESSING'
           AND (processing_started_at IS NULL OR processing_started_at <= ?)
           AND (dispatch_started_at IS NULL OR dispatch_started_at <= ?)
         )
         ORDER BY received_at, id
         LIMIT ?`,
      )
      .bind(
        now - INBOUND_DISPATCH_LEASE_MS,
        now - INBOUND_DISPATCH_LEASE_MS,
        now - INBOUND_DISPATCH_LEASE_MS,
        limit,
      )
      .all<{ id: string }>();
    return result.results.map(({ id }) => id);
  }

  async reserve(inboundId: string, now: number, marker: string): Promise<InboundDispatchResult> {
    const prior = await this.read(inboundId);
    if (!prior) return { status: "MISSING" };
    if (prior.state !== "PENDING" && prior.state !== "PROCESSING") {
      return { status: "TERMINAL" };
    }

    if (!isDispatchEligible(prior, now)) {
      return { status: "LEASED", retryAfterMs: dispatchRetryAfter(prior, now) };
    }

    const exhaustedProcessing = prior.attempt_count >= MAX_INBOUND_PROCESS_ATTEMPTS;
    const exhaustedDispatch = prior.dispatch_attempt_count >= MAX_INBOUND_DISPATCH_ATTEMPTS;
    if (exhaustedProcessing || exhaustedDispatch) {
      const safeErrorCode = exhaustedProcessing
        ? "INBOUND_PROCESSING_EXHAUSTED"
        : "INBOUND_DISPATCH_EXHAUSTED";
      const exhausted = await this.database
        .prepare(
          `UPDATE inbound_updates
           SET state = 'FAILED', processed_at = ?, safe_error_code = ?,
               dispatch_started_at = NULL, dispatch_marker = NULL
           WHERE id = ? AND state = ? AND processing_started_at IS ?
             AND attempt_count = ? AND dispatch_started_at IS ?
             AND dispatch_attempt_count = ? AND dispatch_marker IS ?
             AND (
               (state = 'PENDING' AND (dispatch_started_at IS NULL OR dispatch_started_at <= ?))
               OR
               (state = 'PROCESSING'
                 AND (processing_started_at IS NULL OR processing_started_at <= ?)
                 AND (dispatch_started_at IS NULL OR dispatch_started_at <= ?))
             )
             AND (attempt_count >= ? OR dispatch_attempt_count >= ?)
           RETURNING id`,
        )
        .bind(
          now,
          safeErrorCode,
          prior.id,
          prior.state,
          prior.processing_started_at,
          prior.attempt_count,
          prior.dispatch_started_at,
          prior.dispatch_attempt_count,
          prior.dispatch_marker,
          now - INBOUND_DISPATCH_LEASE_MS,
          now - INBOUND_DISPATCH_LEASE_MS,
          now - INBOUND_DISPATCH_LEASE_MS,
          MAX_INBOUND_PROCESS_ATTEMPTS,
          MAX_INBOUND_DISPATCH_ATTEMPTS,
        )
        .run<{ id: string }>();
      if (d1Changes(exhausted) === 1) return { status: "EXHAUSTED" };
      const raced = await this.read(inboundId);
      if (!raced) return { status: "MISSING" };
      if (raced.state !== "PENDING" && raced.state !== "PROCESSING") {
        return { status: "TERMINAL" };
      }
      return { status: "LEASED", retryAfterMs: dispatchRetryAfter(raced, now) };
    }

    const reserved = await this.database
      .prepare(
        `UPDATE inbound_updates
         SET dispatch_started_at = ?, dispatch_attempt_count = dispatch_attempt_count + 1,
             dispatch_marker = ?
         WHERE id = ? AND state = ? AND processing_started_at IS ?
           AND attempt_count = ? AND dispatch_started_at IS ?
           AND dispatch_attempt_count = ? AND dispatch_marker IS ?
           AND attempt_count < ? AND dispatch_attempt_count < ?
           AND (
             (state = 'PENDING' AND (dispatch_started_at IS NULL OR dispatch_started_at <= ?))
             OR
             (state = 'PROCESSING'
               AND (processing_started_at IS NULL OR processing_started_at <= ?)
               AND (dispatch_started_at IS NULL OR dispatch_started_at <= ?))
           )
         RETURNING id`,
      )
      .bind(
        now,
        marker,
        prior.id,
        prior.state,
        prior.processing_started_at,
        prior.attempt_count,
        prior.dispatch_started_at,
        prior.dispatch_attempt_count,
        prior.dispatch_marker,
        MAX_INBOUND_PROCESS_ATTEMPTS,
        MAX_INBOUND_DISPATCH_ATTEMPTS,
        now - INBOUND_DISPATCH_LEASE_MS,
        now - INBOUND_DISPATCH_LEASE_MS,
        now - INBOUND_DISPATCH_LEASE_MS,
      )
      .run<{ id: string }>();
    if (d1Changes(reserved) === 1) {
      return {
        status: "RESERVED",
        reservation: {
          inboundId: prior.id,
          marker,
          previousStartedAt: prior.dispatch_started_at,
          previousAttemptCount: prior.dispatch_attempt_count,
          previousMarker: prior.dispatch_marker,
        },
      };
    }

    const raced = await this.read(inboundId);
    if (!raced) return { status: "MISSING" };
    if (raced.state !== "PENDING" && raced.state !== "PROCESSING") {
      return { status: "TERMINAL" };
    }
    return { status: "LEASED", retryAfterMs: dispatchRetryAfter(raced, now) };
  }

  async rollback(reservation: InboundDispatchReservation): Promise<boolean> {
    const result = await this.database
      .prepare(
        `UPDATE inbound_updates
         SET dispatch_started_at = ?, dispatch_attempt_count = ?, dispatch_marker = ?
         WHERE id = ? AND state IN ('PENDING', 'PROCESSING') AND dispatch_marker = ?`,
      )
      .bind(
        reservation.previousStartedAt,
        reservation.previousAttemptCount,
        reservation.previousMarker,
        reservation.inboundId,
        reservation.marker,
      )
      .run();
    return d1Changes(result) === 1;
  }
}

export interface InboundDispatchDependencies {
  store: InboundDispatchStore;
  enqueue(job: ProcessInboundJob): Promise<unknown>;
  randomBytes?: RandomBytes;
}

export type EnqueueInboundResult =
  | { status: "PUBLISHED" }
  | { status: "PUBLISH_FAILED" }
  | Exclude<InboundDispatchResult, { status: "RESERVED" }>;

export async function enqueueInboundWithReservation(
  inboundId: string,
  now: number,
  dependencies: InboundDispatchDependencies,
): Promise<EnqueueInboundResult> {
  assertNow(now);
  const randomBytes = dependencies.randomBytes ?? cryptoRandomBytes;
  const result = await dependencies.store.reserve(
    inboundId,
    now,
    randomOpaqueId(randomBytes),
  );
  if (result.status !== "RESERVED") return result;
  try {
    await dependencies.enqueue({ type: "PROCESS_INBOUND", inboundId });
    return { status: "PUBLISHED" };
  } catch {
    try {
      await dependencies.store.rollback(result.reservation);
    } catch {
      // The reservation remains leased and the orphan sweep can recover it later.
    }
    return { status: "PUBLISH_FAILED" };
  }
}

export interface InboundRedriveResult extends SchedulerResult {
  exhausted: number;
}

export async function redriveInboundOrphans(
  now: number,
  limit: number,
  dependencies: InboundDispatchDependencies,
): Promise<InboundRedriveResult> {
  assertNow(now);
  const bounded = boundedLimit(limit);
  const candidates = await dependencies.store.selectOrphans(now, bounded);
  let published = 0;
  let publishFailed = 0;
  let exhausted = 0;

  for (const inboundId of candidates) {
    const result = await enqueueInboundWithReservation(inboundId, now, dependencies);
    if (result.status === "PUBLISHED") published += 1;
    if (result.status === "PUBLISH_FAILED") publishFailed += 1;
    if (result.status === "EXHAUSTED") exhausted += 1;
  }

  return {
    selected: candidates.length,
    published,
    publishFailed,
    exhausted,
  };
}

export type { ReminderDispatchJob };
