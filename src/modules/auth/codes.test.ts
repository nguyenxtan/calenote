import { describe, expect, it } from "vitest";
import type { Keyring } from "@/modules/security/keyring";
import {
  consumeOneTimeCode,
  consumeOneTimeCodeDetailed,
  issueOneTimeCode,
  type CodeConsumeOutcome,
  type ConnectCodeRecord,
  type LoginCodeRecord,
  type OneTimeCodeRecord,
  type OneTimeCodeStore,
} from "./codes";

class MemoryCodeStore implements OneTimeCodeStore {
  readonly records: OneTimeCodeRecord[] = [];

  async issue(record: OneTimeCodeRecord, now: number): Promise<void> {
    for (const existing of this.records) {
      const sameOwner = record.kind === "connect"
        ? existing.kind === "connect" && existing.connectionId === record.connectionId
        : existing.kind === "login" && existing.userId === record.userId;
      if (sameOwner && existing.consumedAt === null && existing.expiresAt > now) {
        existing.consumedAt = now;
      }
    }
    this.records.push({ ...record });
  }

  async consumeConnect(digest: string, now: number): Promise<CodeConsumeOutcome> {
    const record = this.records.find(
      (candidate): candidate is ConnectCodeRecord => candidate.kind === "connect" && candidate.digest === digest,
    );
    if (!record) return "invalid";
    if (record.consumedAt !== null) return "consumed";
    if (record.expiresAt <= now) return "expired";
    record.consumedAt = now;
    return "accepted";
  }

  async consumeLogin(
    userId: string,
    digest: string,
    now: number,
    maxAttempts: number,
  ): Promise<CodeConsumeOutcome> {
    const record = [...this.records].reverse().find(
      (candidate): candidate is LoginCodeRecord => candidate.kind === "login" && candidate.userId === userId,
    );
    if (!record) return "invalid";
    if (record.consumedAt !== null) return record.attempts >= maxAttempts ? "exhausted" : "consumed";
    if (record.expiresAt <= now) return "expired";
    if (record.digest === digest) {
      record.consumedAt = now;
      return "accepted";
    }
    record.attempts += 1;
    if (record.attempts >= maxAttempts) {
      record.consumedAt = now;
      return "exhausted";
    }
    return "invalid";
  }
}

const keyring = {
  digestCode: async (value: string) => `digest-${value.length}-${value.charCodeAt(0)}`,
} as Keyring;

function incrementingRandom(): (length: number) => Uint8Array {
  let seed = 0;
  return (length) => Uint8Array.from({ length }, (_, index) => (seed++ + index * 13) % 256);
}

describe("one-time codes", () => {
  it("issues an unambiguous eight-character connect code and stores only its digest", async () => {
    const store = new MemoryCodeStore();
    const issued = await issueOneTimeCode(
      { kind: "connect", userId: "user-1", connectionId: "connection-1" },
      { store, keyring, now: () => 1_700_000_000_000, randomBytes: incrementingRandom() },
    );

    expect(issued.code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/u);
    expect(issued.expiresAt).toBe(1_700_000_600_000);
    expect(JSON.stringify(store.records)).not.toContain(issued.code);
  });

  it("rotates a prior active connect code and consumes the replacement once", async () => {
    const store = new MemoryCodeStore();
    const randomBytes = incrementingRandom();
    const first = await issueOneTimeCode(
      { kind: "connect", userId: "user-1", connectionId: "connection-1" },
      { store, keyring, now: () => 1_700_000_000_000, randomBytes },
    );
    const replacement = await issueOneTimeCode(
      { kind: "connect", userId: "user-1", connectionId: "connection-1" },
      { store, keyring, now: () => 1_700_000_000_100, randomBytes },
    );

    await expect(
      consumeOneTimeCodeDetailed(
        { kind: "connect", code: first.code },
        { store, keyring, now: () => 1_700_000_000_200 },
      ),
    ).resolves.toBe("consumed");
    await expect(
      consumeOneTimeCode(
        { kind: "connect", code: replacement.code },
        { store, keyring, now: () => 1_700_000_000_200 },
      ),
    ).resolves.toEqual({ status: "accepted" });
    await expect(
      consumeOneTimeCode(
        { kind: "connect", code: replacement.code },
        { store, keyring, now: () => 1_700_000_000_201 },
      ),
    ).resolves.toEqual({ status: "invalid" });
  });

  it("issues an exactly six-digit login code using rejection sampling", async () => {
    const store = new MemoryCodeStore();
    const chunks = [
      Uint8Array.from([250, 251, 252, 253, 254, 255]),
      Uint8Array.from([9, 8, 7, 6, 5, 4]),
      Uint8Array.from({ length: 16 }, (_, index) => index),
    ];
    const randomBytes = (length: number) => {
      const chunk = chunks.shift();
      return chunk ? chunk.slice(0, length) : new Uint8Array(length);
    };

    const issued = await issueOneTimeCode(
      { kind: "login", userId: "user-1" },
      { store, keyring, now: () => 1_700_000_000_000, randomBytes },
    );

    expect(issued.code).toBe("987654");
    expect(issued.code).toMatch(/^\d{6}$/u);
    expect(JSON.stringify(store.records)).not.toContain(issued.code);
  });

  it("atomically exhausts a login code after five wrong attempts", async () => {
    const store = new MemoryCodeStore();
    const issued = await issueOneTimeCode(
      { kind: "login", userId: "user-1" },
      { store, keyring, now: () => 1_700_000_000_000, randomBytes: incrementingRandom() },
    );

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(
        consumeOneTimeCode(
          { kind: "login", userId: "user-1", code: "999999" },
          { store, keyring, now: () => 1_700_000_000_100 + attempt },
        ),
      ).resolves.toEqual({ status: "invalid" });
    }
    await expect(
      consumeOneTimeCodeDetailed(
        { kind: "login", userId: "user-1", code: "999999" },
        { store, keyring, now: () => 1_700_000_000_200 },
      ),
    ).resolves.toBe("exhausted");
    await expect(
      consumeOneTimeCode(
        { kind: "login", userId: "user-1", code: issued.code },
        { store, keyring, now: () => 1_700_000_000_300 },
      ),
    ).resolves.toEqual({ status: "invalid" });

    const login = store.records.find((record): record is LoginCodeRecord => record.kind === "login");
    expect(login).toMatchObject({ attempts: 5, consumedAt: 1_700_000_000_200 });
  });

  it("collapses invalid, expired, consumed, and exhausted outcomes to one public failure", async () => {
    class OutcomeStore extends MemoryCodeStore {
      constructor(private readonly outcome: CodeConsumeOutcome) {
        super();
      }

      override async consumeLogin(): Promise<CodeConsumeOutcome> {
        return this.outcome;
      }
    }

    const results = await Promise.all(
      (["invalid", "expired", "consumed", "exhausted"] as const).map((outcome) =>
        consumeOneTimeCode(
          { kind: "login", userId: "user-1", code: "123456" },
          {
            store: new OutcomeStore(outcome),
            keyring,
            now: () => 1_700_000_000_000,
          },
        ),
      ),
    );

    expect(results).toEqual(Array.from({ length: 4 }, () => ({ status: "invalid" })));
  });
});
