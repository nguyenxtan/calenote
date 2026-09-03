function isBase64UrlCodeUnit(codeUnit: number): boolean {
  const isDigit = codeUnit >= 48 && codeUnit <= 57;
  const isUppercaseLetter = codeUnit >= 65 && codeUnit <= 90;
  const isLowercaseLetter = codeUnit >= 97 && codeUnit <= 122;
  const isHyphen = codeUnit === 45;
  const isUnderscore = codeUnit === 95;

  return isDigit || isUppercaseLetter || isLowercaseLetter || isHyphen || isUnderscore;
}

function hasOnlyBase64UrlCodeUnits(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (!isBase64UrlCodeUnit(value.charCodeAt(index))) {
      return false;
    }
  }

  return true;
}

function bytesToBinary(bytes: Uint8Array): string {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return binary;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return btoa(bytesToBinary(bytes))
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/u, "");
}

export function base64UrlToBytes(value: string): Uint8Array | null {
  if (!hasOnlyBase64UrlCodeUnits(value)) {
    return null;
  }

  if (value.length % 4 === 1) {
    return null;
  }

  try {
    const base64 = value
      .replace(/-/gu, "+")
      .replace(/_/gu, "/");
    const paddingLength = (4 - (value.length % 4)) % 4;
    const padded = base64 + "=".repeat(paddingLength);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));

    if (bytesToBase64Url(bytes) !== value) {
      return null;
    }

    return bytes;
  } catch {
    return null;
  }
}

export function isCanonicalBase64Url(value: string, minimumLength: number): boolean {
  if (value.length < minimumLength) {
    return false;
  }

  if (value.length > 256) {
    return false;
  }

  return base64UrlToBytes(value) !== null;
}

export function constantTimeEqual(left: string, right: string): boolean {
  if (left.length < 1) {
    return false;
  }

  if (right.length < 1) {
    return false;
  }

  if (left.length > 256) {
    return false;
  }

  if (right.length > 256) {
    return false;
  }

  let difference = left.length ^ right.length;
  let invalid = 0;

  for (let index = 0; index < 256; index += 1) {
    const leftCodeUnit = left.charCodeAt(index) || 0;
    const rightCodeUnit = right.charCodeAt(index) || 0;
    difference |= leftCodeUnit ^ rightCodeUnit;

    if (index < left.length) {
      if (!isBase64UrlCodeUnit(leftCodeUnit)) {
        invalid |= 1;
      }
    }

    if (index < right.length) {
      if (!isBase64UrlCodeUnit(rightCodeUnit)) {
        invalid |= 1;
      }
    }
  }

  if (difference !== 0) {
    return false;
  }

  return invalid === 0;
}
