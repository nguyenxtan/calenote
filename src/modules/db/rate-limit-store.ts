import { d1Changes } from "@/modules/platform/types";
import type { RateLimitResult, RateLimitStore, RateLimitStoreInput } from "@/modules/rate-limit/service";

interface ResetRow {
  expires_at: number;
}

export class D1RateLimitStore implements RateLimitStore {
  constructor(private readonly database: D1Database) {}

  async consume(input: RateLimitStoreInput): Promise<RateLimitResult> {
    const result = await this.database
      .prepare(
        `INSERT INTO rate_limits (subject_digest, bucket, count, expires_at)
         VALUES (?, ?, 1, ?)
         ON CONFLICT(subject_digest, bucket) DO UPDATE SET
           count = CASE WHEN rate_limits.expires_at <= ? THEN 1 ELSE rate_limits.count + 1 END,
           expires_at = CASE WHEN rate_limits.expires_at <= ? THEN excluded.expires_at ELSE rate_limits.expires_at END
         WHERE rate_limits.expires_at <= ? OR rate_limits.count < ?`,
      )
      .bind(
        input.subjectDigest,
        input.bucket,
        input.resetAt,
        input.now,
        input.now,
        input.now,
        input.limit,
      )
      .run();
    const row = await this.database
      .prepare("SELECT expires_at FROM rate_limits WHERE subject_digest = ? AND bucket = ? LIMIT 1")
      .bind(input.subjectDigest, input.bucket)
      .first<ResetRow>();
    if (!row) throw new Error("Rate-limit row was not persisted");
    return { allowed: d1Changes(result) === 1, resetAt: row.expires_at };
  }
}

export function createD1RateLimitStore(database: D1Database): D1RateLimitStore {
  return new D1RateLimitStore(database);
}
