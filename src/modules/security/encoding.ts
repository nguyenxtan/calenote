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

export function constantTimeEqual(left: string, right: string): boolean {
  const accepted = base64UrlPattern.test(left) && base64UrlPattern.test(right) && left.length >= 1 && right.length >= 1 && left.length <= 256 && right.length <= 256;
  let difference = left.length ^ right.length;

  for (let index = 0; index < 256; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }

  return accepted && difference === 0;
}
