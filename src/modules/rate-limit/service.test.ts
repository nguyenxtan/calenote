import { describe, expect, it } from "vitest";
import { consumeRateLimit, type RateLimitStore } from "./service";

describe("fixed-window rate limits", () => {
  it("passes only a pre-HMACed subject digest to the store and returns its reset", async () => {
    const seen: string[] = [];
    const store: RateLimitStore = {
      consume: async (input) => {
        seen.push(input.subjectDigest);
        return { allowed: true, resetAt: 1_700_000_060_000 };
      },
    };
    const subjectDigest = "N8MKPqjdJlR9xUXwupHi_Z45pMG4W0IBZwgHR3SNo1g";

    await expect(
      consumeRateLimit(
        { subjectDigest, bucket: "login-request", limit: 3, windowMs: 60_000 },
        { store, now: () => 1_700_000_000_000 },
      ),
    ).resolves.toEqual({ allowed: true, resetAt: 1_700_000_060_000 });
    expect(seen).toEqual([subjectDigest]);
  });

  it.each(["raw@example.com", "", "not a digest"])("rejects a raw or malformed subject %s", async (subjectDigest) => {
    const store: RateLimitStore = {
      consume: async () => ({ allowed: true, resetAt: 1_700_000_060_000 }),
    };

    await expect(
      consumeRateLimit(
        { subjectDigest, bucket: "login-request", limit: 3, windowMs: 60_000 },
        { store, now: () => 1_700_000_000_000 },
      ),
    ).rejects.toThrow("pre-HMACed");
  });
});
