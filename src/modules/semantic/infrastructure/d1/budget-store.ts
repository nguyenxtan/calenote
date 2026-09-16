import type { FinalizeUsageInput, PaidCallReservation, ReleaseReservationInput, ReservePaidCallInput, SemanticBudgetLimits, SemanticBudgetStore } from "../../budget-store";

export class D1SemanticBudgetStore implements SemanticBudgetStore {
  private readonly limits: Readonly<SemanticBudgetLimits>;
  private readonly maximumCost: number;

  constructor(private readonly database: D1Database, limits: SemanticBudgetLimits) {
    const numerator = limits.maxInputTokens * limits.promptPriceMicrounitsPerMillionTokens
      + limits.maxOutputTokens * limits.completionPriceMicrounitsPerMillionTokens;
    if (Object.values(limits).some((value) => !Number.isSafeInteger(value) || value < 0)
      || limits.maxInputTokens === 0 || limits.maxOutputTokens === 0
      || limits.reservationTtlMs === 0 || limits.reservationTtlMs > 900_000
      || !Number.isSafeInteger(numerator) || numerator <= 0) {
      throw new TypeError("Invalid semantic budget configuration");
    }
    this.limits = Object.freeze({ ...limits });
    this.maximumCost = Number((BigInt(numerator) + 999_999n) / 1_000_000n);
  }

  async reservePaidCall(input: ReservePaidCallInput): Promise<PaidCallReservation> {
    const denied = { status: "BUDGET_EXHAUSTED" } as const;
    if (!validNow(input.now) || !input.ownerId || !input.sourceInboundId) return denied;
    const day = new Date(input.now).toISOString().slice(0, 10);
    const month = day.slice(0, 7);
    const scopes = [
      ["USER_DAILY", input.ownerId, day],
      ["USER_MONTHLY", input.ownerId, month],
      ["GLOBAL_DAILY", "global", day],
    ];
    try {
      await this.reapExpiredReservations(input.now);
      // Seed rows before the reservation transaction. Seeding consumes no capacity.
      await this.database.batch(scopes.map((scope) => this.database.prepare(
        `INSERT INTO semantic_budget_windows (kind, scope_id, window_key)
         VALUES (?, ?, ?) ON CONFLICT (kind, scope_id, window_key) DO NOTHING`,
      ).bind(...scope)));
      const reservationId = crypto.randomUUID();
      const increments = scopes.map((scope, index) => this.database.prepare(
        `UPDATE semantic_budget_windows
         SET reserved_calls = reserved_calls + 1,
             reserved_microunits = reserved_microunits + ?
         WHERE kind = ? AND scope_id = ? AND window_key = ?
           AND ${index === 0
            ? `reserved_calls + finalized_calls < ?
               AND NOT EXISTS (SELECT 1 FROM semantic_budget_reservations WHERE source_inbound_id = ?)`
            : "reserved_microunits + finalized_microunits <= ? - ? AND changes() = 1"}`,
      ).bind(this.maximumCost, ...scope, ...(index === 0
        ? [this.limits.ownerDailyFallbackLimit, input.sourceInboundId]
        : [index === 1 ? this.limits.ownerMonthlyCostMicrounits : this.limits.globalDailyCostMicrounits, this.maximumCost])));
      // changes() carries each guard to the next statement. The NOT NULL id is
      // the final assertion: any miss (including ownership) aborts the full batch.
      // Never inspect per-statement results after committing a partial reservation.
      const result = await this.database.batch([
        ...increments,
        this.database.prepare(
          `INSERT INTO semantic_budget_reservations
           (id, owner_id, source_inbound_id, daily_window_key, monthly_window_key,
            reserved_maximum_microunits, state, expires_at, created_at, updated_at)
           VALUES ((SELECT ? FROM inbound_updates i
             JOIN bot_connections c ON c.id = i.connection_id AND c.state = 'ACTIVE_BOUND'
             JOIN chat_identities ci ON ci.connection_id = c.id
               AND ci.provider_user_id = i.provider_user_id AND ci.private_chat_id = i.private_chat_id
             WHERE i.id = ? AND c.user_id = ? AND changes() = 1),
             ?, ?, ?, ?, ?, 'RESERVED', ?, ?, ?)`,
        ).bind(reservationId, input.sourceInboundId, input.ownerId,
          input.ownerId, input.sourceInboundId, day, month, this.maximumCost,
          input.now + this.limits.reservationTtlMs, input.now, input.now),
      ]);
      if (result.length !== 4 || result.some((item) => !item.success || item.meta.changes !== 1)) return denied;
      return { status: "RESERVED", reservationId, reservedMaximumMicrounits: this.maximumCost };
    } catch {
      // No raw SQL, owner identity, or database error is exposed to the router.
      // Ambiguous commits remain reserved and cannot authorize another attempt.
      return denied;
    }
  }

  async finalizeUsage(input: FinalizeUsageInput): Promise<boolean> {
    const amount = Number.isSafeInteger(input.actualCostMicrounits)
      && input.actualCostMicrounits !== null && input.actualCostMicrounits >= 0
      ? input.actualCostMicrounits : null;
    return this.settle(input.ownerId, input.reservationId, input.now, "FINALIZED", amount);
  }

  async releaseOrExpireReservation(input: ReleaseReservationInput): Promise<boolean> {
    return this.settle(input.ownerId, input.reservationId, input.now,
      input.reason === "EXPIRED" ? "EXPIRED" : "RELEASED", null);
  }

  private async settle(ownerId: string, id: string, now: number,
    state: "FINALIZED" | "RELEASED" | "EXPIRED", actual: number | null): Promise<boolean> {
    if (!validNow(now)) return false;
    const selector = `SELECT * FROM semantic_budget_reservations
      WHERE id = ? AND owner_id = ? AND state = 'RESERVED'
        AND (? <> 'EXPIRED' OR expires_at <= ?)`;
    const finalized = state === "FINALIZED" ? 1 : 0;
    const cost = "CASE WHEN ? IS NULL OR ? > reserved_maximum_microunits THEN reserved_maximum_microunits ELSE ? END";
    const result = await this.database.batch([
      this.database.prepare(
        `WITH reservation AS (${selector})
         UPDATE semantic_budget_windows
         SET reserved_calls = reserved_calls - 1,
             reserved_microunits = reserved_microunits - (SELECT reserved_maximum_microunits FROM reservation),
             finalized_calls = finalized_calls + ?,
             finalized_microunits = finalized_microunits + ? * (SELECT ${cost} FROM reservation)
         WHERE EXISTS (SELECT 1 FROM reservation r WHERE
           (kind = 'USER_DAILY' AND scope_id = r.owner_id AND window_key = r.daily_window_key)
           OR (kind = 'USER_MONTHLY' AND scope_id = r.owner_id AND window_key = r.monthly_window_key)
           OR (kind = 'GLOBAL_DAILY' AND scope_id = 'global' AND window_key = r.daily_window_key))`,
      ).bind(id, ownerId, state, now, finalized, finalized, actual, actual, actual),
      this.database.prepare(
        `UPDATE semantic_budget_reservations
         SET state = CASE WHEN changes() = 3 THEN ? ELSE NULL END,
             finalized_microunits = CASE WHEN ? = 'FINALIZED' THEN ${cost} ELSE NULL END,
             updated_at = ?
         WHERE id = ? AND owner_id = ? AND state = 'RESERVED'
           AND (? <> 'EXPIRED' OR expires_at <= ?)`,
      ).bind(state, state, actual, actual, actual, now, id, ownerId, state, now),
    ]);
    return result[1].meta.changes === 1;
  }

  async reapExpiredReservations(now: number, limit = 32): Promise<number> {
    if (!validNow(now) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) return 0;
    const expired = await this.database.prepare(
      `SELECT id, owner_id FROM semantic_budget_reservations
       WHERE state = 'RESERVED' AND expires_at <= ? ORDER BY expires_at, id LIMIT ?`,
    ).bind(now, limit).all<{ id: string; owner_id: string }>();
    let recovered = 0;
    for (const row of expired.results) {
      if (await this.releaseOrExpireReservation({ ownerId: row.owner_id, reservationId: row.id, now, reason: "EXPIRED" })) recovered++;
    }
    return recovered;
  }
}

function validNow(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value < 8_640_000_000_000_000 - 900_000;
}
