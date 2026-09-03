import { base64UrlToBytes } from "@/modules/security/encoding";
import { systemClock, type Clock } from "@/modules/platform/types";

export interface RateLimitStoreInput {
  subjectDigest: string;
  bucket: string;
  limit: number;
  now: number;
  resetAt: number;
}

export interface RateLimitResult {
  allowed: boolean;
  resetAt: number;
}

export interface RateLimitStore {
  consume(input: RateLimitStoreInput): Promise<RateLimitResult>;
}

export interface RateLimitInput {
  subjectDigest: string;
  scope: string;
  limit: number;
  windowMs: number;
}

export async function consumeRateLimit(
  input: RateLimitInput,
  dependencies: { store: RateLimitStore; now?: Clock },
): Promise<RateLimitResult> {
  const digestBytes = base64UrlToBytes(input.subjectDigest);
  if (input.subjectDigest.length !== 43 || digestBytes?.byteLength !== 32) {
    throw new TypeError("subjectDigest must be a pre-HMACed canonical 32-byte digest");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/u.test(input.scope)) {
    throw new TypeError("scope is invalid");
  }
  if (!Number.isSafeInteger(input.limit) || input.limit < 1) {
    throw new TypeError("limit must be a positive integer");
  }
  if (!Number.isSafeInteger(input.windowMs) || input.windowMs < 1) {
    throw new TypeError("windowMs must be a positive integer");
  }
  const now = (dependencies.now ?? systemClock)();
  if (!Number.isSafeInteger(now) || now < 0) throw new TypeError("clock returned an invalid time");
  const window = Math.floor(now / input.windowMs);
  const resetAt = (window + 1) * input.windowMs;
  if (!Number.isSafeInteger(resetAt)) throw new TypeError("rate-limit reset is out of range");
  return dependencies.store.consume({
    subjectDigest: input.subjectDigest,
    bucket: input.scope,
    limit: input.limit,
    now,
    resetAt,
  });
}
