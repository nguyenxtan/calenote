import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { ConnectCodeRecord, LoginCodeRecord } from "@/modules/auth/codes";
import { consumeRateLimit } from "@/modules/rate-limit/service";
import { D1OneTimeCodeStore } from "./code-store";
import { D1RateLimitStore } from "./rate-limit-store";

class SqliteStatement {
  private values: SQLInputValue[] = [];

  constructor(
    private readonly database: DatabaseSync,
    private readonly sql: string,
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.values = values as SQLInputValue[];
    return this as unknown as D1PreparedStatement;
  }

  async run<T>(): Promise<D1Result<T>> {
    const statement = this.database.prepare(this.sql);
    const returnsRows = /\bRETURNING\b/iu.test(this.sql);
    const results = returnsRows
      ? statement.all(...this.values) as T[]
      : [];
    const changes = returnsRows
      ? results.length
      : Number(statement.run(...this.values).changes);
    return { success: true, results, meta: { changes } } as D1Result<T>;
  }

  async first<T>(): Promise<T | null> {
    return (this.database.prepare(this.sql).get(...this.values) as T | undefined) ?? null;
  }
}

class SqliteD1Database {
  constructor(readonly sqlite = new DatabaseSync(":memory:")) {}

  prepare(sql: string): D1PreparedStatement {
    return new SqliteStatement(this.sqlite, sql) as unknown as D1PreparedStatement;
  }

  async batch<T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    this.sqlite.exec("BEGIN");
    try {
      const results: D1Result<T>[] = [];
      for (const statement of statements) results.push(await statement.run<T>());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

const databases: DatabaseSync[] = [];

function migratedDatabase(): SqliteD1Database {
  const database = new SqliteD1Database();
  databases.push(database.sqlite);
  const migrationPath = resolve(process.cwd(), "migrations/0001_production_mvp.sql");
  database.sqlite.exec(readFileSync(migrationPath, "utf8"));
  database.sqlite.prepare(
    "INSERT INTO users (id, email, display_name, timezone, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run("user-1", "one@example.test", "One", "Asia/Ho_Chi_Minh", 1, 1);
  const insertConnection = database.sqlite.prepare(
    `INSERT INTO bot_connections (
      id, user_id, provider, public_id, provider_bot_id, display_name,
      encrypted_token, encrypted_token_iv, token_fingerprint, credential_version,
      state, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insertConnection.run(
    "connection-1", "user-1", "telegram", "public-1", "bot-1", "Bot One",
    new Uint8Array([1]), new Uint8Array([1]), "fingerprint-1", 1, "ACTIVE_UNBOUND", 1, 1,
  );
  insertConnection.run(
    "connection-2", "user-1", "telegram", "public-2", "bot-2", "Bot Two",
    new Uint8Array([2]), new Uint8Array([2]), "fingerprint-2", 1, "ACTIVE_UNBOUND", 1, 1,
  );
  return database;
}

function loginRecord(id: string, digest: string, createdAt: number): LoginCodeRecord {
  return {
    kind: "login",
    id,
    userId: "user-1",
    digest,
    expiresAt: createdAt + 600_000,
    attempts: 0,
    consumedAt: null,
    createdAt,
  };
}

function connectRecord(createdAt: number): ConnectCodeRecord {
  return {
    kind: "connect",
    id: "connect-code-1",
    connectionId: "connection-1",
    userId: "user-1",
    digest: "connect-digest",
    expiresAt: createdAt + 600_000,
    consumedAt: null,
    createdAt,
  };
}

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

describe("D1 one-time code adapter", () => {
  it("allows a login digest to recur after historical consumption", async () => {
    const database = migratedDatabase();
    const store = new D1OneTimeCodeStore(database as unknown as D1Database);
    const now = 1_700_000_000_000;

    await store.issue(loginRecord("login-1", "same-digest", now), now);
    await expect(store.consumeLogin("user-1", "same-digest", now + 1, 5)).resolves.toBe("accepted");
    await expect(store.issue(loginRecord("login-2", "same-digest", now + 2), now + 2)).resolves.toBeUndefined();
  });

  it("targets the newest active login code when rotation shares a timestamp", async () => {
    const database = migratedDatabase();
    const store = new D1OneTimeCodeStore(database as unknown as D1Database);
    const now = 1_700_000_000_000;

    await store.issue(loginRecord("login-1", "digest-1", now), now);
    await store.issue(loginRecord("login-2", "digest-2", now), now);
    await expect(store.consumeLogin("user-1", "wrong-digest", now + 1, 5)).resolves.toBe("invalid");

    const rows = database.sqlite.prepare(
      "SELECT id, attempts, consumed_at FROM login_codes ORDER BY rowid",
    ).all() as Array<{ id: string; attempts: number; consumed_at: number | null }>;
    expect(rows).toEqual([
      { id: "login-1", attempts: 0, consumed_at: now },
      { id: "login-2", attempts: 1, consumed_at: null },
    ]);
  });

  it("binds connect consumption to one connection and allows one replay winner", async () => {
    const database = migratedDatabase();
    const store = new D1OneTimeCodeStore(database as unknown as D1Database);
    const now = 1_700_000_000_000;
    await store.issue(connectRecord(now), now);

    await expect(
      store.consumeConnect("connection-2", "connect-digest", now + 1),
    ).resolves.toBe("invalid");
    const outcomes = await Promise.all([
      store.consumeConnect("connection-1", "connect-digest", now + 2),
      store.consumeConnect("connection-1", "connect-digest", now + 2),
    ]);
    expect(outcomes).toContain("accepted");
    expect(outcomes).toContain("consumed");
  });
});

describe("D1 rate-limit adapter", () => {
  it("reuses one row across aligned windows and keeps independent scopes separate", async () => {
    const database = migratedDatabase();
    const store = new D1RateLimitStore(database as unknown as D1Database);
    const subjectDigest = "N8MKPqjdJlR9xUXwupHi_Z45pMG4W0IBZwgHR3SNo1g";
    const input = { subjectDigest, scope: "verify", limit: 1, windowMs: 60_000 };
    const at = (now: number) => consumeRateLimit(input, { store, now: () => now });

    await expect(at(59_999)).resolves.toEqual({ allowed: true, resetAt: 60_000 });
    await expect(at(59_999)).resolves.toEqual({ allowed: false, resetAt: 60_000 });
    await expect(at(60_000)).resolves.toEqual({ allowed: true, resetAt: 120_000 });
    for (let window = 2; window < 12; window += 1) {
      await expect(at(window * 60_000)).resolves.toEqual({
        allowed: true,
        resetAt: (window + 1) * 60_000,
      });
    }

    const stableRows = database.sqlite.prepare(
      "SELECT bucket, count, expires_at FROM rate_limits WHERE subject_digest = ?",
    ).all(subjectDigest) as Array<{ bucket: string; count: number; expires_at: number }>;
    expect(stableRows).toEqual([{ bucket: "verify", count: 1, expires_at: 720_000 }]);

    await expect(
      consumeRateLimit(
        { subjectDigest, scope: "request", limit: 1, windowMs: 60_000 },
        { store, now: () => 660_000 },
      ),
    ).resolves.toEqual({ allowed: true, resetAt: 720_000 });
    const scopes = database.sqlite.prepare(
      "SELECT bucket FROM rate_limits WHERE subject_digest = ? ORDER BY bucket",
    ).all(subjectDigest) as Array<{ bucket: string }>;
    expect(scopes).toEqual([{ bucket: "request" }, { bucket: "verify" }]);
  });
});
