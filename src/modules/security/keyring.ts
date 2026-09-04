import type { BotProvider } from "@/modules/connections/contracts";
import { base64UrlToBytes, bytesToBase64Url, constantTimeEqual } from "./encoding";

const encoder = new TextEncoder();
const MASTER_KEY_BYTES = 32;
const IV_BYTES = 12;
const GCM_TAG_BYTES = 16;
const HKDF_SALT = encoder.encode("calenote/v1");
type WebBytes = Uint8Array<ArrayBuffer>;

function webBytes(value: Uint8Array): WebBytes {
  return Uint8Array.from(value) as WebBytes;
}

export type SensitiveContentPurpose =
  | "inbound-message"
  | "draft-title"
  | "action-candidate-title"
  | "reminder-title"
  | "login-code";

export interface EncryptedValue {
  ciphertext: ArrayBuffer;
  iv: ArrayBuffer;
}

export interface WebhookSecrets {
  pathSecret: string;
  headerSecret: string;
}

export interface Keyring {
  encryptCredential(
    connectionId: string,
    provider: BotProvider,
    credentialVersion: number,
    token: string,
  ): Promise<EncryptedValue>;
  decryptCredential(
    connectionId: string,
    provider: BotProvider,
    credentialVersion: number,
    encrypted: EncryptedValue,
  ): Promise<string>;
  encryptSensitive(
    purpose: SensitiveContentPurpose,
    entityId: string,
    keyVersion: number,
    plaintext: string,
  ): Promise<EncryptedValue>;
  decryptSensitive(
    purpose: SensitiveContentPurpose,
    entityId: string,
    keyVersion: number,
    encrypted: EncryptedValue,
  ): Promise<string>;
  fingerprintToken(token: string): Promise<string>;
  digestSession(value: string): Promise<string>;
  digestCode(value: string): Promise<string>;
  webhookSecrets(connectionPublicId: string): Promise<WebhookSecrets>;
  constantTimeEqual(left: string, right: string): boolean;
}

function isPositiveVersion(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function asBytes(value: ArrayBuffer): WebBytes | null {
  return Object.prototype.toString.call(value) === "[object ArrayBuffer]"
    ? webBytes(new Uint8Array(value))
    : null;
}

function assertBoundInput(entityId: string, version: number): void {
  if (entityId.length === 0 || !isPositiveVersion(version)) {
    throw new TypeError("Invalid encryption binding");
  }
}

function aad(purpose: string, entityId: string, version: number): WebBytes {
  return webBytes(encoder.encode(JSON.stringify(["calenote", 1, purpose, entityId, version])));
}

async function deriveKey(masterKey: CryptoKey, label: string, algorithm: HmacImportParams | AesKeyGenParams): Promise<CryptoKey> {
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: HKDF_SALT, info: encoder.encode(label) },
    masterKey,
    256,
  );
  return crypto.subtle.importKey("raw", bits, algorithm, false, [algorithm.name === "AES-GCM" ? "encrypt" : "sign", algorithm.name === "AES-GCM" ? "decrypt" : "verify"]);
}

async function hmac(key: CryptoKey, value: string): Promise<string> {
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))));
}

async function encrypt(
  key: CryptoKey,
  purpose: string,
  entityId: string,
  version: number,
  plaintext: string,
): Promise<EncryptedValue> {
  assertBoundInput(entityId, version);
  const iv = webBytes(crypto.getRandomValues(new Uint8Array(IV_BYTES)));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad(purpose, entityId, version), tagLength: 128 },
    key,
    webBytes(encoder.encode(plaintext)),
  );
  return { ciphertext, iv: iv.buffer };
}

async function decrypt(
  key: CryptoKey,
  purpose: string,
  entityId: string,
  version: number,
  encrypted: EncryptedValue,
): Promise<string> {
  assertBoundInput(entityId, version);
  const iv = asBytes(encrypted.iv);
  const ciphertext = asBytes(encrypted.ciphertext);
  if (!iv || !ciphertext || iv.byteLength !== IV_BYTES || ciphertext.byteLength < GCM_TAG_BYTES) {
    throw new TypeError("Malformed ciphertext");
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv, additionalData: aad(purpose, entityId, version), tagLength: 128 },
        key,
        ciphertext,
      ),
    );
  } catch {
    throw new TypeError("Unable to decrypt ciphertext");
  }
}

export async function createKeyring(master: string): Promise<Keyring> {
  const masterBytes = base64UrlToBytes(master);
  if (!masterBytes || masterBytes.byteLength !== MASTER_KEY_BYTES) {
    throw new TypeError("CALENOTE_MASTER_KEY must be a canonical 32-byte base64url value");
  }

  const masterKey = await crypto.subtle.importKey("raw", webBytes(masterBytes), "HKDF", false, ["deriveBits"]);
  const credentialKey = await deriveKey(masterKey, "credential-encryption", { name: "AES-GCM", length: 256 });
  const sensitiveKey = await deriveKey(masterKey, "sensitive-content-encryption", { name: "AES-GCM", length: 256 });
  const fingerprintKey = await deriveKey(masterKey, "token-fingerprint", { name: "HMAC", hash: "SHA-256", length: 256 });
  const sessionKey = await deriveKey(masterKey, "session-digest", { name: "HMAC", hash: "SHA-256", length: 256 });
  const codeKey = await deriveKey(masterKey, "code-digest", { name: "HMAC", hash: "SHA-256", length: 256 });
  const webhookPathKey = await deriveKey(masterKey, "webhook-path-secret", { name: "HMAC", hash: "SHA-256", length: 256 });
  const webhookHeaderKey = await deriveKey(masterKey, "webhook-header-secret", { name: "HMAC", hash: "SHA-256", length: 256 });

  return {
    encryptCredential: (connectionId, provider, version, token) =>
      encrypt(credentialKey, `credential:${provider}`, connectionId, version, token),
    decryptCredential: (connectionId, provider, version, encrypted) =>
      decrypt(credentialKey, `credential:${provider}`, connectionId, version, encrypted),
    encryptSensitive: (purpose, entityId, version, plaintext) =>
      encrypt(sensitiveKey, purpose, entityId, version, plaintext),
    decryptSensitive: (purpose, entityId, version, encrypted) =>
      decrypt(sensitiveKey, purpose, entityId, version, encrypted),
    fingerprintToken: (token) => hmac(fingerprintKey, token),
    digestSession: (value) => hmac(sessionKey, value),
    digestCode: (value) => hmac(codeKey, value),
    webhookSecrets: async (connectionPublicId) => ({
      pathSecret: await hmac(webhookPathKey, connectionPublicId),
      headerSecret: await hmac(webhookHeaderKey, connectionPublicId),
    }),
    constantTimeEqual,
  };
}
