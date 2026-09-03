import type { SessionRecord, SessionStore } from "@/modules/auth/session";
import { d1Changes } from "@/modules/platform/types";

interface SessionRow {
  id: string;
  user_id: string;
  digest: string;
  expires_at: number;
  revoked_at: number | null;
  created_at: number;
}

export class D1SessionStore implements SessionStore {
  constructor(private readonly database: D1Database) {}

  prepareInsert(record: SessionRecord): D1PreparedStatement {
    return this.database
      .prepare(
        "INSERT INTO sessions (id, user_id, digest, expires_at, revoked_at, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(record.id, record.userId, record.digest, record.expiresAt, record.revokedAt, record.createdAt);
  }

  async insert(record: SessionRecord): Promise<void> {
    const result = await this.prepareInsert(record).run();
    if (d1Changes(result) !== 1) throw new Error("Session insert did not commit");
  }

  async findByDigest(digest: string): Promise<SessionRecord | null> {
    const row = await this.database
      .prepare(
        "SELECT id, user_id, digest, expires_at, revoked_at, created_at FROM sessions WHERE digest = ? LIMIT 1",
      )
      .bind(digest)
      .first<SessionRow>();
    return row
      ? {
          id: row.id,
          userId: row.user_id,
          digest: row.digest,
          expiresAt: row.expires_at,
          revokedAt: row.revoked_at,
          createdAt: row.created_at,
        }
      : null;
  }

  async revokeByDigest(digest: string, revokedAt: number): Promise<boolean> {
    const result = await this.database
      .prepare("UPDATE sessions SET revoked_at = ? WHERE digest = ? AND revoked_at IS NULL")
      .bind(revokedAt, digest)
      .run();
    return d1Changes(result) === 1;
  }
}

export function createD1SessionStore(database: D1Database): D1SessionStore {
  return new D1SessionStore(database);
}
