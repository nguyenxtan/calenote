import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

function sqliteValue(value: unknown): SQLInputValue {
  if (Object.prototype.toString.call(value) === "[object ArrayBuffer]") {
    return new Uint8Array(value as ArrayBuffer);
  }
  if (ArrayBuffer.isView(value)) {
    return Uint8Array.from(
      new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
    );
  }
  return value as SQLInputValue;
}

class SqliteD1Statement {
  private values: SQLInputValue[] = [];

  constructor(
    private readonly database: DatabaseSync,
    private readonly sql: string,
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.values = values.map(sqliteValue);
    return this as unknown as D1PreparedStatement;
  }

  async run<T>(): Promise<D1Result<T>> {
    const statement = this.database.prepare(this.sql);
    const returnsRows = /\bRETURNING\b/iu.test(this.sql);
    const results = returnsRows ? statement.all(...this.values) as T[] : [];
    const changes = returnsRows
      ? results.length
      : Number(statement.run(...this.values).changes);
    return { success: true, results, meta: { changes } } as D1Result<T>;
  }

  async first<T>(column?: string): Promise<T | null> {
    const row = this.database.prepare(this.sql).get(...this.values) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    if (column !== undefined) return (row[column] as T | undefined) ?? null;
    return row as T;
  }

  async all<T>(): Promise<D1Result<T>> {
    const results = this.database.prepare(this.sql).all(...this.values) as T[];
    return {
      success: true,
      results,
      meta: { changes: 0 },
    } as D1Result<T>;
  }
}

export class SqliteD1Database {
  readonly sqlite = new DatabaseSync(":memory:");

  constructor() {
    this.sqlite.exec(
      readFileSync(resolve(process.cwd(), "migrations/0001_production_mvp.sql"), "utf8"),
    );
    this.sqlite.exec(
      readFileSync(
        resolve(process.cwd(), "migrations/0002_onboarding_transition_marker.sql"),
        "utf8",
      ),
    );
  }

  prepare(sql: string): D1PreparedStatement {
    return new SqliteD1Statement(this.sqlite, sql) as unknown as D1PreparedStatement;
  }

  async batch<T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    this.sqlite.exec("BEGIN IMMEDIATE");
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

  close(): void {
    this.sqlite.close();
  }
}

export function deterministicRandomBytes(): (length: number) => Uint8Array {
  let value = 0;
  return (length) => new Uint8Array(length).fill(++value);
}
