import type {
  CodeConsumeOutcome,
  OneTimeCodeRecord,
  OneTimeCodeStore,
} from "@/modules/auth/codes";
import { d1Changes } from "@/modules/platform/types";

interface CodeStateRow {
  consumed_at: number | null;
  expires_at: number;
  attempts?: number;
}

function classify(row: CodeStateRow | null, now: number, maxAttempts?: number): CodeConsumeOutcome {
  if (!row) return "invalid";
  if (maxAttempts !== undefined && (row.attempts ?? 0) >= maxAttempts) return "exhausted";
  if (row.consumed_at !== null) return "consumed";
  if (row.expires_at <= now) return "expired";
  return "invalid";
}

export class D1OneTimeCodeStore implements OneTimeCodeStore {
  constructor(private readonly database: D1Database) {}

  prepareIssue(record: OneTimeCodeRecord, now: number): D1PreparedStatement[] {
    if (record.kind === "connect") {
      return [
        this.database
          .prepare(
            "UPDATE connect_codes SET consumed_at = ? WHERE connection_id = ? AND consumed_at IS NULL AND expires_at > ?",
          )
          .bind(now, record.connectionId, now),
        this.database
          .prepare(
            "INSERT INTO connect_codes (id, connection_id, user_id, digest, expires_at, consumed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          )
          .bind(
            record.id,
            record.connectionId,
            record.userId,
            record.digest,
            record.expiresAt,
            record.consumedAt,
            record.createdAt,
          ),
      ];
    }

    return [
      this.database
        .prepare(
          "UPDATE login_codes SET consumed_at = ? WHERE user_id = ? AND consumed_at IS NULL AND expires_at > ?",
        )
        .bind(now, record.userId, now),
      this.database
        .prepare(
          "INSERT INTO login_codes (id, user_id, digest, expires_at, attempts, consumed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          record.id,
          record.userId,
          record.digest,
          record.expiresAt,
          record.attempts,
          record.consumedAt,
          record.createdAt,
        ),
    ];
  }

  async issue(record: OneTimeCodeRecord, now: number): Promise<void> {
    const results = await this.database.batch(this.prepareIssue(record, now));
    if (results.length !== 2 || d1Changes(results[1]) !== 1) {
      throw new Error("One-time code insert did not commit");
    }
  }

  async consumeConnect(digest: string, now: number): Promise<CodeConsumeOutcome> {
    const result = await this.database
      .prepare(
        "UPDATE connect_codes SET consumed_at = ? WHERE digest = ? AND consumed_at IS NULL AND expires_at > ?",
      )
      .bind(now, digest, now)
      .run();
    if (d1Changes(result) === 1) return "accepted";

    const row = await this.database
      .prepare("SELECT consumed_at, expires_at FROM connect_codes WHERE digest = ? LIMIT 1")
      .bind(digest)
      .first<CodeStateRow>();
    return classify(row, now);
  }

  async consumeLogin(
    userId: string,
    digest: string,
    now: number,
    maxAttempts: number,
  ): Promise<CodeConsumeOutcome> {
    const consumed = await this.database
      .prepare(
        "UPDATE login_codes SET consumed_at = ? WHERE user_id = ? AND digest = ? AND consumed_at IS NULL AND expires_at > ? AND attempts < ?",
      )
      .bind(now, userId, digest, now, maxAttempts)
      .run();
    if (d1Changes(consumed) === 1) return "accepted";

    const failed = await this.database
      .prepare(
        `UPDATE login_codes
         SET attempts = attempts + 1,
             consumed_at = CASE WHEN attempts + 1 >= ? THEN ? ELSE consumed_at END
         WHERE id = (
           SELECT id FROM login_codes WHERE user_id = ? ORDER BY created_at DESC LIMIT 1
         )
           AND digest <> ?
           AND consumed_at IS NULL
           AND expires_at > ?
           AND attempts < ?`,
      )
      .bind(maxAttempts, now, userId, digest, now, maxAttempts)
      .run();

    const row = await this.database
      .prepare(
        "SELECT consumed_at, expires_at, attempts FROM login_codes WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
      )
      .bind(userId)
      .first<CodeStateRow>();
    if (d1Changes(failed) === 1 && (row?.attempts ?? 0) < maxAttempts) return "invalid";
    return classify(row, now, maxAttempts);
  }
}

export function createD1OneTimeCodeStore(database: D1Database): D1OneTimeCodeStore {
  return new D1OneTimeCodeStore(database);
}
