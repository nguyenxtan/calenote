import { d1Changes } from "@/modules/platform/types";
import {
  DELIVERY_SEND_LEASE_MS,
  MAX_DELIVERY_ATTEMPTS,
  REMINDER_CLAIM_LEASE_MS,
  type ReminderCandidateRow,
  type ReminderClaimReservation,
  type ReminderSchedulerStore,
} from "../../scheduler";

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
