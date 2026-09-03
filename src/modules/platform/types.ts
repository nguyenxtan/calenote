import { bytesToBase64Url } from "@/modules/security/encoding";

export type Clock = () => number;
export type RandomBytes = (length: number) => Uint8Array;

export const systemClock: Clock = () => Date.now();

export const cryptoRandomBytes: RandomBytes = (length) => {
  if (!Number.isSafeInteger(length) || length < 1) {
    throw new TypeError("Random byte length must be a positive integer");
  }

  return crypto.getRandomValues(new Uint8Array(length));
};

export function randomOpaqueId(randomBytes: RandomBytes = cryptoRandomBytes): string {
  return bytesToBase64Url(randomBytes(16));
}

export function d1Changes(result: D1Result<unknown>): number {
  return typeof result.meta.changes === "number" ? result.meta.changes : 0;
}
