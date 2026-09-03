import type { Keyring } from "@/modules/security/keyring";
import {
  cryptoRandomBytes,
  randomOpaqueId,
  systemClock,
  type Clock,
  type RandomBytes,
} from "@/modules/platform/types";

export const ONE_TIME_CODE_TTL_MS = 10 * 60 * 1_000;
export const LOGIN_CODE_MAX_ATTEMPTS = 5;
const CONNECT_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const LOGIN_DIGIT_ACCEPTANCE_BOUND = 250;

export type OneTimeCodeKind = "connect" | "login";
export type CodeConsumeOutcome = "accepted" | "invalid" | "expired" | "consumed" | "exhausted";

interface CodeRecordBase {
  id: string;
  userId: string;
  digest: string;
  expiresAt: number;
  consumedAt: number | null;
  createdAt: number;
}

export interface ConnectCodeRecord extends CodeRecordBase {
  kind: "connect";
  connectionId: string;
}

export interface LoginCodeRecord extends CodeRecordBase {
  kind: "login";
  attempts: number;
}

export type OneTimeCodeRecord = ConnectCodeRecord | LoginCodeRecord;

export interface OneTimeCodeStore {
  issue(record: OneTimeCodeRecord, now: number): Promise<void>;
  consumeConnect(connectionId: string, digest: string, now: number): Promise<CodeConsumeOutcome>;
  consumeLogin(
    userId: string,
    digest: string,
    now: number,
    maxAttempts: number,
  ): Promise<CodeConsumeOutcome>;
}

export type IssueOneTimeCodeInput =
  | { kind: "connect"; userId: string; connectionId: string }
  | { kind: "login"; userId: string };

export type ConsumeOneTimeCodeInput =
  | { kind: "connect"; connectionId: string; code: string }
  | { kind: "login"; userId: string; code: string };

export interface OneTimeCodeDependencies {
  store: OneTimeCodeStore;
  keyring: Pick<Keyring, "digestCode">;
  now?: Clock;
  randomBytes?: RandomBytes;
}

export interface OneTimeCodePreparationDependencies {
  keyring: Pick<Keyring, "digestCode">;
  now?: Clock;
  randomBytes?: RandomBytes;
}

export interface OneTimeCodeIssuance {
  code: string;
  expiresAt: number;
}

export interface PreparedOneTimeCode extends OneTimeCodeIssuance {
  record: OneTimeCodeRecord;
  createdAt: number;
}

export type PublicCodeConsumeResult = { status: "accepted" } | { status: "invalid" };

function generateConnectCode(randomBytes: RandomBytes): string {
  const bytes = randomBytes(26);
  if (bytes.byteLength !== 26) throw new TypeError("Random source returned the wrong byte length");
  let code = "";
  for (const byte of bytes) code += CONNECT_ALPHABET[byte & 31];
  return code;
}

function generateLoginCode(randomBytes: RandomBytes): string {
  let code = "";
  while (code.length < 6) {
    const bytes = randomBytes(6 - code.length);
    if (bytes.byteLength === 0) throw new TypeError("Random source returned no bytes");
    for (const byte of bytes) {
      if (byte < LOGIN_DIGIT_ACCEPTANCE_BOUND) code += String(byte % 10);
      if (code.length === 6) break;
    }
  }
  return code;
}

function isValidCode(input: ConsumeOneTimeCodeInput): boolean {
  return input.kind === "connect"
    ? /^[A-HJ-NP-Z2-9]{26}$/u.test(input.code)
    : /^\d{6}$/u.test(input.code);
}

export async function prepareOneTimeCode(
  input: IssueOneTimeCodeInput,
  dependencies: OneTimeCodePreparationDependencies,
): Promise<PreparedOneTimeCode> {
  if (input.userId.length === 0 || (input.kind === "connect" && input.connectionId.length === 0)) {
    throw new TypeError("One-time code owner is required");
  }
  const randomBytes = dependencies.randomBytes ?? cryptoRandomBytes;
  const now = dependencies.now ?? systemClock;
  const createdAt = now();
  const expiresAt = createdAt + ONE_TIME_CODE_TTL_MS;
  const code = input.kind === "connect"
    ? generateConnectCode(randomBytes)
    : generateLoginCode(randomBytes);
  const digest = await dependencies.keyring.digestCode(code);
  const id = randomOpaqueId(randomBytes);
  const base = { id, userId: input.userId, digest, expiresAt, consumedAt: null, createdAt };
  const record: OneTimeCodeRecord = input.kind === "connect"
    ? { ...base, kind: "connect", connectionId: input.connectionId }
    : { ...base, kind: "login", attempts: 0 };

  return { code, expiresAt, record, createdAt };
}

export async function issueOneTimeCode(
  input: IssueOneTimeCodeInput,
  dependencies: OneTimeCodeDependencies,
): Promise<OneTimeCodeIssuance> {
  const prepared = await prepareOneTimeCode(input, dependencies);
  await dependencies.store.issue(prepared.record, prepared.createdAt);
  return { code: prepared.code, expiresAt: prepared.expiresAt };
}

export async function consumeOneTimeCodeDetailed(
  input: ConsumeOneTimeCodeInput,
  dependencies: Pick<OneTimeCodeDependencies, "store" | "keyring" | "now">,
): Promise<CodeConsumeOutcome> {
  if (!isValidCode(input)) return "invalid";
  const digest = await dependencies.keyring.digestCode(input.code);
  const now = (dependencies.now ?? systemClock)();
  return input.kind === "connect"
    ? dependencies.store.consumeConnect(input.connectionId, digest, now)
    : dependencies.store.consumeLogin(input.userId, digest, now, LOGIN_CODE_MAX_ATTEMPTS);
}

export async function consumeOneTimeCode(
  input: ConsumeOneTimeCodeInput,
  dependencies: Pick<OneTimeCodeDependencies, "store" | "keyring" | "now">,
): Promise<PublicCodeConsumeResult> {
  const outcome = await consumeOneTimeCodeDetailed(input, dependencies);
  return outcome === "accepted" ? { status: "accepted" } : { status: "invalid" };
}
