import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { AccountGraph, ActivationSuccess, ConnectCodeRotation } from "@/modules/onboarding/service";
import { OnboardingConflictError } from "@/modules/onboarding/service";
import { D1OnboardingStore } from "./onboarding-store";

class Statement {
  private values: SQLInputValue[] = [];
  constructor(private readonly database: DatabaseSync, private readonly sql: string) {}
  bind(...values: unknown[]): D1PreparedStatement {
    this.values = values.map((value) => value instanceof ArrayBuffer ? new Uint8Array(value) : value) as SQLInputValue[];
    return this as unknown as D1PreparedStatement;
  }
  async run<T>(): Promise<D1Result<T>> {
    const statement = this.database.prepare(this.sql);
    const results = /\bRETURNING\b/iu.test(this.sql) ? statement.all(...this.values) as T[] : [];
    const changes = results.length > 0 ? results.length : Number(statement.run(...this.values).changes);
    return { success: true, results, meta: { changes } } as D1Result<T>;
  }
  async first<T>(): Promise<T | null> {
    return (this.database.prepare(this.sql).get(...this.values) as T | undefined) ?? null;
  }
}

class Database {
  readonly sqlite = new DatabaseSync(":memory:");
  constructor() {
    this.sqlite.exec(readFileSync(resolve(process.cwd(), "migrations/0001_production_mvp.sql"), "utf8"));
  }
  prepare(sql: string): D1PreparedStatement {
    return new Statement(this.sqlite, sql) as unknown as D1PreparedStatement;
  }
  async batch<T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    this.sqlite.exec("BEGIN");
    try {
      const results = [];
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
afterEach(() => { while (databases.length) databases.pop()?.close(); });

function setup() {
  const database = new Database();
  databases.push(database.sqlite);
  return { database, store: new D1OnboardingStore(database as unknown as D1Database) };
}

function graph(suffix = "1"): AccountGraph {
  return {
    user: { id: `user-${suffix}`, email: `owner-${suffix}@example.com`, displayName: "Owner", timezone: "Asia/Ho_Chi_Minh", createdAt: 100 },
    workspace: { id: `workspace-${suffix}`, ownerUserId: `user-${suffix}`, createdAt: 100 },
    membership: { workspaceId: `workspace-${suffix}`, userId: `user-${suffix}`, createdAt: 100 },
    connection: {
      id: `connection-${suffix}`, userId: `user-${suffix}`, provider: "telegram", publicId: `public-${suffix}`,
      providerBotId: `bot-${suffix}`, displayName: "Bot", handle: "@bot", accountType: null,
      canJoinGroups: true, encryptedToken: Uint8Array.from([1, 2, 3]).buffer,
      encryptedTokenIv: new Uint8Array(12).buffer, tokenFingerprint: `fingerprint-${suffix}`,
      credentialVersion: 1, state: "VALIDATING", createdAt: 100,
    },
    session: { id: `session-${suffix}`, userId: `user-${suffix}`, digest: `session-digest-${suffix}`, expiresAt: 1_000, revokedAt: null, createdAt: 100 },
    audit: {
      id: `audit-${suffix}`, actorUserId: `user-${suffix}`, action: "ONBOARDING_CREATED", targetUserId: `user-${suffix}`,
      targetConnectionId: `connection-${suffix}`, result: "SUCCESS", createdAt: 100,
    },
  };
}

function activation(): ActivationSuccess {
  return {
    connectionId: "connection-1", userId: "user-1", registeredAt: 200,
    code: { kind: "connect", id: "code-1", connectionId: "connection-1", userId: "user-1", digest: "code-digest", expiresAt: 800, consumedAt: null, createdAt: 200 },
    audit: {
      id: "audit-2", actorUserId: "user-1", action: "WEBHOOK_ACTIVATED", targetUserId: "user-1",
      targetConnectionId: "connection-1", result: "SUCCESS", createdAt: 200,
    },
  };
}

describe("D1 onboarding persistence", () => {
  it("atomically persists the account graph and activates it with a digest-only connect code", async () => {
    const { database, store } = setup();
    await store.commitAccountGraph(graph());
    await store.activateConnection(activation());

    expect(database.sqlite.prepare("SELECT state, webhook_registered_at FROM bot_connections").get()).toEqual({
      state: "ACTIVE_UNBOUND", webhook_registered_at: 200,
    });
    expect(database.sqlite.prepare("SELECT digest, consumed_at FROM connect_codes").get()).toEqual({ digest: "code-digest", consumed_at: null });
    expect(database.sqlite.prepare("SELECT action, result FROM audit_events ORDER BY created_at").all()).toEqual([
      { action: "ONBOARDING_CREATED", result: "SUCCESS" },
      { action: "WEBHOOK_ACTIVATED", result: "SUCCESS" },
    ]);
  });

  it("maps unique email, fingerprint, and provider-bot races to the same safe conflict", async () => {
    const { store } = setup();
    await store.commitAccountGraph(graph());

    const duplicateEmail = graph("2");
    duplicateEmail.user.email = "owner-1@example.com";
    const duplicateFingerprint = graph("3");
    duplicateFingerprint.connection.tokenFingerprint = "fingerprint-1";
    const duplicateProviderBot = graph("4");
    duplicateProviderBot.connection.providerBotId = "bot-1";

    for (const candidate of [duplicateEmail, duplicateFingerprint, duplicateProviderBot]) {
      await expect(store.commitAccountGraph(candidate)).rejects.toBeInstanceOf(OnboardingConflictError);
    }
  });

  it("owner-scopes lookup and rotates the previous code with its audit in one batch", async () => {
    const { database, store } = setup();
    await store.commitAccountGraph(graph());
    await store.activateConnection(activation());
    await expect(store.findOwnedConnection("other-user", "public-1")).resolves.toBeNull();
    const connection = await store.findOwnedConnection("user-1", "public-1");
    expect(connection).toMatchObject({ id: "connection-1", state: "ACTIVE_UNBOUND" });

    const rotation: ConnectCodeRotation = {
      connection: connection!, rotatedAt: 300,
      code: { kind: "connect", id: "code-2", connectionId: "connection-1", userId: "user-1", digest: "replacement-digest", expiresAt: 900, consumedAt: null, createdAt: 300 },
      audit: {
        id: "audit-3", actorUserId: "user-1", action: "CONNECT_CODE_ROTATED", targetUserId: "user-1",
        targetConnectionId: "connection-1", result: "SUCCESS", createdAt: 300,
      },
    };
    await store.rotateConnectCode(rotation);

    expect(database.sqlite.prepare("SELECT digest, consumed_at FROM connect_codes ORDER BY created_at").all()).toEqual([
      { digest: "code-digest", consumed_at: 300 },
      { digest: "replacement-digest", consumed_at: null },
    ]);
    expect(database.sqlite.prepare("SELECT action FROM audit_events ORDER BY created_at DESC LIMIT 1").get()).toEqual({ action: "CONNECT_CODE_ROTATED" });
  });

  it("does not partially issue or audit when a state transition loses a race", async () => {
    const { database, store } = setup();
    await store.commitAccountGraph(graph());
    database.sqlite.prepare("UPDATE bot_connections SET state = 'SUSPENDED' WHERE id = 'connection-1'").run();

    await expect(store.activateConnection(activation())).rejects.toThrow();
    expect(database.sqlite.prepare("SELECT COUNT(*) AS count FROM connect_codes").get()).toEqual({ count: 0 });
    expect(database.sqlite.prepare("SELECT COUNT(*) AS count FROM audit_events").get()).toEqual({ count: 1 });

    const staleConnection = { id: "connection-1", publicId: "public-1", userId: "user-1", state: "ACTIVE_UNBOUND" as const };
    await expect(store.rotateConnectCode({
      connection: staleConnection,
      rotatedAt: 300,
      code: { kind: "connect", id: "code-2", connectionId: "connection-1", userId: "user-1", digest: "replacement-digest", expiresAt: 900, consumedAt: null, createdAt: 300 },
      audit: {
        id: "audit-3", actorUserId: "user-1", action: "CONNECT_CODE_ROTATED", targetUserId: "user-1",
        targetConnectionId: "connection-1", result: "SUCCESS", createdAt: 300,
      },
    })).rejects.toThrow();
    expect(database.sqlite.prepare("SELECT COUNT(*) AS count FROM connect_codes").get()).toEqual({ count: 0 });
    expect(database.sqlite.prepare("SELECT COUNT(*) AS count FROM audit_events").get()).toEqual({ count: 1 });
  });
});
