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
            "UPDATE connect_codes SET consumed_at = ? WHERE connection_id = ? AND consumed_at IS NULL",
          )
          .bind(now, record.connectionId),
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

    throw new TypeError("Encrypted login codes must use D1LoginCodeStore");
  }

  async issue(record: OneTimeCodeRecord, now: number): Promise<void> {
    const results = await this.database.batch(this.prepareIssue(record, now));
    if (results.length !== 2 || d1Changes(results[1]) !== 1) {
      throw new Error("One-time code insert did not commit");
    }
  }

  async consumeConnect(
    connectionId: string,
    digest: string,
    now: number,
  ): Promise<CodeConsumeOutcome> {
    const result = await this.database
      .prepare(
        "UPDATE connect_codes SET consumed_at = ? WHERE connection_id = ? AND digest = ? AND consumed_at IS NULL AND expires_at > ?",
      )
      .bind(now, connectionId, digest, now)
      .run();
    if (d1Changes(result) === 1) return "accepted";

    const row = await this.database
      .prepare(
        "SELECT consumed_at, expires_at FROM connect_codes WHERE connection_id = ? AND digest = ? LIMIT 1",
      )
      .bind(connectionId, digest)
      .first<CodeStateRow>();
    return classify(row, now);
  }

  async consumeLogin(
    userId: string,
    digest: string,
    now: number,
    maxAttempts: number,
  ): Promise<CodeConsumeOutcome> {
    void userId;
    void digest;
    void now;
    void maxAttempts;
    throw new TypeError("Encrypted login codes must use D1LoginCodeStore");
  }
}

export function createD1OneTimeCodeStore(database: D1Database): D1OneTimeCodeStore {
  return new D1OneTimeCodeStore(database);
}
