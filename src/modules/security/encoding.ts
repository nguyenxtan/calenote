const base64UrlPattern = /^[A-Za-z0-9_-]*$/u;

function bytesToBinary(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return binary;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return btoa(bytesToBinary(bytes)).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

export function base64UrlToBytes(value: string): Uint8Array | null {
  if (!base64UrlPattern.test(value) || value.length % 4 === 1) return null;

  try {
    const padded = value.replace(/-/gu, "+").replace(/_/gu, "/") + "=".repeat((4 - (value.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return bytesToBase64Url(bytes) === value ? bytes : null;
  } catch {
    return null;
  }
}
export function isCanonicalBase64Url(value: string, minimumLength: number): boolean {
  return value.length >= minimumLength && value.length <= 256 && base64UrlToBytes(value) !== null;
}

export function constantTimeEqual(left: string, right: string): boolean {
  if (left.length < 1 || right.length < 1 || left.length > 256 || right.length > 256) return false;
  let difference = left.length ^ right.length;
  let invalid = 0;

  for (let index = 0; index < 256; index += 1) {
    const a = left.charCodeAt(index) || 0; const b = right.charCodeAt(index) || 0;
    difference |= a ^ b;
    if (index < left.length && !((a >= 48 && a <= 57) || (a >= 65 && a <= 90) || (a >= 97 && a <= 122) || a === 45 || a === 95)) invalid |= 1;
    if (index < right.length && !((b >= 48 && b <= 57) || (b >= 65 && b <= 90) || (b >= 97 && b <= 122) || b === 45 || b === 95)) invalid |= 1;
  }

  return difference === 0 && invalid === 0;
}
