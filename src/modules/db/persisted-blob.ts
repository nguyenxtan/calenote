function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return value instanceof ArrayBuffer || (
    typeof value === "object"
    && value !== null
    && Object.prototype.toString.call(value) === "[object ArrayBuffer]"
  );
}

function isByteArray(value: unknown): value is number[] {
  return Array.isArray(value)
    && value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255);
}

/** Copies a binary value returned by Cloudflare D1 into an owned ArrayBuffer. */
export function persistedD1Blob(value: unknown): ArrayBuffer {
  if (isArrayBuffer(value)) return Uint8Array.from(new Uint8Array(value)).buffer;
  if (ArrayBuffer.isView(value)) {
    return Uint8Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)).buffer;
  }
  if (isByteArray(value)) return Uint8Array.from(value).buffer;
  throw new TypeError("Malformed persisted D1 BLOB");
}
