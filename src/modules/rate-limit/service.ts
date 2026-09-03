import { isCanonicalBase64Url } from "@/modules/security/encoding";
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
  bucket: string;
  limit: number;
  windowMs: number;
}

export async function consumeRateLimit(
  input: RateLimitInput,
  dependencies: { store: RateLimitStore; now?: Clock },
): Promise<RateLimitResult> {
  if (!isCanonicalBase64Url(input.subjectDigest, 43)) {
    throw new TypeError("subjectDigest must be a pre-HMACed canonical digest");
  }
  if (input.bucket.length === 0 || input.bucket.length > 128) {
    throw new TypeError("bucket is invalid");
  }
  if (!Number.isSafeInteger(input.limit) || input.limit < 1) {
    throw new TypeError("limit must be a positive integer");
  }
  if (!Number.isSafeInteger(input.windowMs) || input.windowMs < 1) {
    throw new TypeError("windowMs must be a positive integer");
  }
  const now = (dependencies.now ?? systemClock)();
  return dependencies.store.consume({ ...input, now, resetAt: now + input.windowMs });
}
