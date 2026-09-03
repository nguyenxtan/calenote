import { describe, expect, it } from "vitest";
import {
  SESSION_COOKIE_NAME,
  SessionAuthError,
  createSession,
  prepareSession,
  requireSession,
  revokeSession,
  type SessionRecord,
  type SessionStore,
} from "./session";

class MemorySessionStore implements SessionStore {
  readonly records: SessionRecord[] = [];

  async insert(record: SessionRecord): Promise<void> {
    this.records.push({ ...record });
  }

  async findByDigest(digest: string): Promise<SessionRecord | null> {
    return this.records.find((record) => record.digest === digest) ?? null;
  }

  async revokeByDigest(digest: string, revokedAt: number): Promise<boolean> {
    const record = this.records.find((candidate) => candidate.digest === digest);
    if (!record || record.revokedAt !== null) return false;
    record.revokedAt = revokedAt;
    return true;
  }
}

const keyring = {
  digestSession: async () => "N8MKPqjdJlR9xUXwupHi_Z45pMG4W0IBZwgHR3SNo1g",
};

function randomBytes(length: number): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => (index * 17 + 3) % 256);
}

function requestWithCookie(cookie: string): Request {
  return new Request("https://calenote.iconiclogs.com/api/session", {
    headers: { cookie: cookie.split(";", 1)[0] },
  });
}

describe("sessions", () => {
  it("prepares a 30-day bearer session and a hardened host-only cookie without inserting", async () => {
    const store = new MemorySessionStore();
    const prepared = await prepareSession("user-1", {
      keyring,
      now: () => 1_700_000_000_000,
      randomBytes,
    });

    expect(store.records).toHaveLength(0);
    expect(prepared.bearer).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(prepared.record.digest).not.toBe(prepared.bearer);
    expect(JSON.stringify(prepared.record)).not.toContain(prepared.bearer);
    expect(prepared.record.expiresAt).toBe(1_702_592_000_000);
    expect(prepared.cookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(prepared.cookie).toContain("HttpOnly");
    expect(prepared.cookie).toContain("Secure");
    expect(prepared.cookie).toContain("SameSite=Lax");
    expect(prepared.cookie).toContain("Path=/");
    expect(prepared.cookie).toContain("Max-Age=2592000");
    expect(prepared.cookie).not.toMatch(/Domain=/iu);
  });

  it("stores only the digest and authenticates the issued bearer", async () => {
    const store = new MemorySessionStore();
    const issued = await createSession("user-1", {
      store,
      keyring,
      now: () => 1_700_000_000_000,
      randomBytes,
    });

    expect(store.records).toHaveLength(1);
    expect(JSON.stringify(store.records[0])).not.toContain(issued.bearer);
    await expect(
      requireSession(requestWithCookie(issued.cookie), {
        store,
        keyring,
        now: () => 1_700_000_000_001,
      }),
    ).resolves.toEqual({
      sessionId: issued.sessionId,
      userId: "user-1",
      expiresAt: issued.expiresAt,
    });
  });

  it.each([
    {
      label: "expired",
      expiresAt: 1_699_999_999_999,
      revokedAt: null,
      expectedRevokedAt: 1_700_000_000_000,
    },
    {
      label: "revoked",
      expiresAt: 1_700_000_001_000,
      revokedAt: 1_699_999_999_999,
      expectedRevokedAt: 1_699_999_999_999,
    },
  ])("rejects a $label session", async ({ expiresAt, revokedAt, expectedRevokedAt }) => {
    const store = new MemorySessionStore();
    const issued = await createSession("user-1", {
      store,
      keyring,
      now: () => 1_700_000_000_000,
      randomBytes,
    });
    store.records[0].expiresAt = expiresAt;
    store.records[0].revokedAt = revokedAt;

    await expect(
      requireSession(requestWithCookie(issued.cookie), {
        store,
        keyring,
        now: () => 1_700_000_000_000,
      }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" } satisfies Partial<SessionAuthError>);
    expect(store.records[0].revokedAt).toBe(expectedRevokedAt);
  });

  it("rejects malformed bearer cookies before database authentication", async () => {
    const store = new MemorySessionStore();
    const request = new Request("https://calenote.iconiclogs.com/api/session", {
      headers: { cookie: `${SESSION_COOKIE_NAME}=not-valid!` },
    });

    await expect(
      requireSession(request, { store, keyring, now: () => 1_700_000_000_000 }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" } satisfies Partial<SessionAuthError>);
  });

  it("revokes idempotently and always returns a clearing cookie", async () => {
    const store = new MemorySessionStore();
    const issued = await createSession("user-1", {
      store,
      keyring,
      now: () => 1_700_000_000_000,
      randomBytes,
    });
    const request = requestWithCookie(issued.cookie);

    const first = await revokeSession(request, {
      store,
      keyring,
      now: () => 1_700_000_000_100,
    });
    const replay = await revokeSession(request, {
      store,
      keyring,
      now: () => 1_700_000_000_200,
    });

    expect(first.revoked).toBe(true);
    expect(replay.revoked).toBe(false);
    expect(first.clearCookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(first.clearCookie).toContain("Max-Age=0");
    expect(first.clearCookie).toContain("HttpOnly");
    expect(first.clearCookie).toContain("Secure");
  });
});
