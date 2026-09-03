import { base64UrlToBytes, bytesToBase64Url } from "@/modules/security/encoding";
import type { Keyring } from "@/modules/security/keyring";
import {
  cryptoRandomBytes,
  randomOpaqueId,
  systemClock,
  type Clock,
  type RandomBytes,
} from "@/modules/platform/types";

export const SESSION_COOKIE_NAME = "__Host-calenote_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const SESSION_BEARER_BYTES = 32;
const SESSION_MAX_AGE_SECONDS = SESSION_TTL_MS / 1_000;

export interface SessionRecord {
  id: string;
  userId: string;
  digest: string;
  expiresAt: number;
  revokedAt: number | null;
  createdAt: number;
}

export interface SessionStore {
  insert(record: SessionRecord): Promise<void>;
  findByDigest(digest: string): Promise<SessionRecord | null>;
  revokeByDigest(digest: string, revokedAt: number): Promise<boolean>;
}

export interface SessionPreparationDependencies {
  keyring: Pick<Keyring, "digestSession">;
  now?: Clock;
  randomBytes?: RandomBytes;
}

export interface SessionDependencies extends SessionPreparationDependencies {
  store: SessionStore;
}

export interface PreparedSession {
  record: SessionRecord;
  sessionId: string;
  bearer: string;
  cookie: string;
  expiresAt: number;
}

export interface SessionIssuance {
  sessionId: string;
  bearer: string;
  cookie: string;
  expiresAt: number;
}

export interface SessionPrincipal {
  sessionId: string;
  userId: string;
  expiresAt: number;
}

export class SessionAuthError extends Error {
  readonly code = "UNAUTHENTICATED";
  readonly status = 401;

  constructor() {
    super("Authentication required.");
    this.name = "SessionAuthError";
  }
}

export function serializeSessionCookie(bearer: string, expiresAt: number): string {
  return [
    `${SESSION_COOKIE_NAME}=${bearer}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
    `Expires=${new Date(expiresAt).toUTCString()}`,
  ].join("; ");
}

export function clearSessionCookie(): string {
  return [
    `${SESSION_COOKIE_NAME}=`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Path=/",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ].join("; ");
}

export function parseSessionCookie(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;

  const values: string[] = [];
  for (const segment of header.split(";")) {
    const separator = segment.indexOf("=");
    if (separator < 0) continue;
    const name = segment.slice(0, separator).trim();
    if (name === SESSION_COOKIE_NAME) {
      values.push(segment.slice(separator + 1).trim());
    }
  }

  if (values.length !== 1) return null;
  const bytes = base64UrlToBytes(values[0]);
  return bytes?.byteLength === SESSION_BEARER_BYTES ? values[0] : null;
}

export async function prepareSession(
  userId: string,
  dependencies: SessionPreparationDependencies,
): Promise<PreparedSession> {
  if (userId.length === 0) throw new TypeError("userId is required");
  const now = dependencies.now ?? systemClock;
  const randomBytes = dependencies.randomBytes ?? cryptoRandomBytes;
  const createdAt = now();
  const expiresAt = createdAt + SESSION_TTL_MS;
  const bearerBytes = randomBytes(SESSION_BEARER_BYTES);
  if (bearerBytes.byteLength !== SESSION_BEARER_BYTES) {
    throw new TypeError("Session random source must return exactly 32 bytes");
  }
  const bearer = bytesToBase64Url(bearerBytes);
  const digest = await dependencies.keyring.digestSession(bearer);
  const sessionId = randomOpaqueId(randomBytes);
  const record: SessionRecord = {
    id: sessionId,
    userId,
    digest,
    expiresAt,
    revokedAt: null,
    createdAt,
  };

  return {
    record,
    sessionId,
    bearer,
    cookie: serializeSessionCookie(bearer, expiresAt),
    expiresAt,
  };
}

export async function createSession(
  userId: string,
  dependencies: SessionDependencies,
): Promise<SessionIssuance> {
  const prepared = await prepareSession(userId, dependencies);
  await dependencies.store.insert(prepared.record);
  return {
    sessionId: prepared.sessionId,
    bearer: prepared.bearer,
    cookie: prepared.cookie,
    expiresAt: prepared.expiresAt,
  };
}

export async function requireSession(
  request: Request,
  dependencies: Pick<SessionDependencies, "store" | "keyring" | "now">,
): Promise<SessionPrincipal> {
  const bearer = parseSessionCookie(request);
  if (!bearer) throw new SessionAuthError();

  const digest = await dependencies.keyring.digestSession(bearer);
  const record = await dependencies.store.findByDigest(digest);
  const now = (dependencies.now ?? systemClock)();
  if (!record || record.revokedAt !== null) throw new SessionAuthError();
  if (record.expiresAt <= now) {
    await dependencies.store.revokeByDigest(digest, now);
    throw new SessionAuthError();
  }

  return { sessionId: record.id, userId: record.userId, expiresAt: record.expiresAt };
}

export async function revokeSession(
  request: Request,
  dependencies: Pick<SessionDependencies, "store" | "keyring" | "now">,
): Promise<{ revoked: boolean; clearCookie: string }> {
  const bearer = parseSessionCookie(request);
  if (!bearer) return { revoked: false, clearCookie: clearSessionCookie() };

  const digest = await dependencies.keyring.digestSession(bearer);
  const revoked = await dependencies.store.revokeByDigest(
    digest,
    (dependencies.now ?? systemClock)(),
  );
  return { revoked, clearCookie: clearSessionCookie() };
}
