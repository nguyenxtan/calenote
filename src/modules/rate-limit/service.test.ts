import { describe, expect, it } from "vitest";
import { consumeRateLimit, type RateLimitStore } from "./service";

describe("fixed-window rate limits", () => {
  it("passes only a pre-HMACed subject digest to the store and returns its reset", async () => {
    const seen: Array<{ subjectDigest: string; bucket: string }> = [];
    const store: RateLimitStore = {
      consume: async (input) => {
        seen.push({ subjectDigest: input.subjectDigest, bucket: input.bucket });
        return { allowed: true, resetAt: 120_000 };
      },
    };
    const subjectDigest = "N8MKPqjdJlR9xUXwupHi_Z45pMG4W0IBZwgHR3SNo1g";

    await expect(
      consumeRateLimit(
        { subjectDigest, scope: "login-request", limit: 3, windowMs: 60_000 },
        { store, now: () => 119_999 },
      ),
    ).resolves.toEqual({ allowed: true, resetAt: 120_000 });
    expect(seen).toEqual([{ subjectDigest, bucket: "login-request" }]);
  });

  it.each([
    { now: 59_999, expectedResetAt: 60_000 },
    { now: 60_000, expectedResetAt: 120_000 },
  ])("keeps a stable storage bucket and aligns reset at $now", async ({ now, expectedResetAt }) => {
    const subjectDigest = "N8MKPqjdJlR9xUXwupHi_Z45pMG4W0IBZwgHR3SNo1g";
    const store: RateLimitStore = {
      consume: async (input) => ({ allowed: true, resetAt: input.resetAt }),
    };
    let bucket = "";
    store.consume = async (input) => {
      bucket = input.bucket;
      return { allowed: true, resetAt: input.resetAt };
    };

    await expect(
      consumeRateLimit(
        { subjectDigest, scope: "verify", limit: 2, windowMs: 60_000 },
        { store, now: () => now },
      ),
    ).resolves.toEqual({ allowed: true, resetAt: expectedResetAt });
    expect(bucket).toBe("verify");
  });

  it("keeps independent scopes on independent stable storage keys", async () => {
    const subjectDigest = "N8MKPqjdJlR9xUXwupHi_Z45pMG4W0IBZwgHR3SNo1g";
    const buckets: string[] = [];
    const store: RateLimitStore = {
      consume: async (input) => {
        buckets.push(input.bucket);
        return { allowed: true, resetAt: input.resetAt };
      },
    };

    await consumeRateLimit(
      { subjectDigest, scope: "login-request", limit: 2, windowMs: 60_000 },
      { store, now: () => 59_999 },
    );
    await consumeRateLimit(
      { subjectDigest, scope: "login-verify", limit: 2, windowMs: 60_000 },
      { store, now: () => 60_000 },
    );

    expect(buckets).toEqual(["login-request", "login-verify"]);
  });

  it.each(["raw@example.com", "", "not a digest"])("rejects a raw or malformed subject %s", async (subjectDigest) => {
    const store: RateLimitStore = {
      consume: async () => ({ allowed: true, resetAt: 1_700_000_060_000 }),
    };

    await expect(
      consumeRateLimit(
        { subjectDigest, scope: "login-request", limit: 3, windowMs: 60_000 },
        { store, now: () => 1_700_000_000_000 },
      ),
    ).rejects.toThrow("pre-HMACed");
  });

  it("rejects a canonical base64url value that is not exactly 32 bytes", async () => {
    const store: RateLimitStore = {
      consume: async () => ({ allowed: true, resetAt: 60_000 }),
    };

    await expect(
      consumeRateLimit(
        { subjectDigest: "A".repeat(44), scope: "verify", limit: 2, windowMs: 60_000 },
        { store, now: () => 1 },
      ),
    ).rejects.toThrow("32-byte");
  });
});
