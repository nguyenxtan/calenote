import {
  cryptoRandomBytes,
  randomOpaqueId,
  systemClock,
  type Clock,
  type RandomBytes,
} from "@/modules/platform/types";
import type { EncryptedValue, Keyring } from "@/modules/security/keyring";

export type SourceConnectionStatus = "ACTIVE" | "PAUSED" | "REVOKED";
export type ActionCandidateStatus = "PENDING" | "APPROVED" | "REJECTED";
export type ActionDecisionKind = "APPROVED" | "REJECTED";

// Sources describe where facts came from. They intentionally carry no delivery
// channel or bot reference; notification routing is derived at approval time.
export interface SourceConnection {
  id: string;
  workspaceId: string;
  provider: string;
  externalAccountId: string;
  displayName: string;
  status: SourceConnectionStatus;
}

export interface SourceItem {
  id: string;
  sourceConnectionId: string;
  workspaceId: string;
  externalItemId: string;
  itemType: string;
  observedAt: number;
}

export interface ActionCandidate {
  id: string;
  sourceItemId: string;
  workspaceId: string;
  status: ActionCandidateStatus;
  scheduledAt: number;
  timezone: "Asia/Ho_Chi_Minh";
}

export interface ActionDecision {
  id: string;
  actionCandidateId: string;
  workspaceId: string;
  decidedByUserId: string;
  decision: ActionDecisionKind;
  createdReminderId: string | null;
  decidedAt: number;
}

export interface ActionCandidateRow {
  id: string;
  workspace_id: string;
  status: ActionCandidateStatus;
  title_ciphertext: unknown;
  title_iv: unknown;
  title_key_version: number;
  scheduled_at: number;
  timezone: "Asia/Ho_Chi_Minh";
}

export interface CreateActionCandidateRecord {
  id: string;
  sourceItemId: string;
  workspaceId: string;
  encryptedTitle: EncryptedValue;
  titleKeyVersion: number;
  scheduledAt: number;
  timezone: "Asia/Ho_Chi_Minh";
  now: number;
}

export interface SourceActionStore {
  createCandidate(record: CreateActionCandidateRecord): Promise<boolean>;
  findOwnedCandidate(userId: string, candidateId: string): Promise<ActionCandidateRow | null>;
  approveCandidate(input: {
    userId: string;
    candidateId: string;
    decisionId: string;
    reminderId: string;
    reminderPublicId: string;
    encryptedTitle: EncryptedValue;
    titleKeyVersion: number;
    now: number;
  }): Promise<boolean>;
  rejectCandidate(input: {
    userId: string;
    candidateId: string;
    decisionId: string;
    now: number;
  }): Promise<boolean>;
}

export type CandidateDecisionResult =
  | { status: "APPROVED"; reminderPublicId: string }
  | { status: "REJECTED" }
  | { status: "NOT_FOUND" }
  | { status: "ALREADY_DECIDED" }
  | { status: "CHANNEL_UNAVAILABLE" };

const TITLE_KEY_VERSION = 1;
const MAX_TITLE_CODE_UNITS = 1_800;
const MAX_SCHEDULE_AHEAD_MS = 366 * 24 * 60 * 60_000;

function persistedArrayBuffer(value: unknown): ArrayBuffer {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    return Uint8Array.from(
      new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
    ).buffer;
  }
  throw new TypeError("Malformed encrypted action candidate title");
}

function normalizeTitle(value: string): string {
  return value
    .normalize("NFC")
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/gu, " ").trim())
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function validCandidateInput(input: {
  sourceItemId: string;
  workspaceId: string;
  title: string;
  scheduledAt: number;
  timezone: string;
}, now: number): input is typeof input & { timezone: "Asia/Ho_Chi_Minh" } {
  return input.sourceItemId.length > 0
    && input.workspaceId.length > 0
    && input.title.length > 0
    && input.title.length <= MAX_TITLE_CODE_UNITS
    && Number.isSafeInteger(input.scheduledAt)
    && input.scheduledAt > now
    && input.scheduledAt - now <= MAX_SCHEDULE_AHEAD_MS
    && input.timezone === "Asia/Ho_Chi_Minh";
}

export async function createReminderActionCandidate(
  input: {
    sourceItemId: string;
    workspaceId: string;
    title: string;
    scheduledAt: number;
    timezone: string;
  },
  dependencies: {
    store: SourceActionStore;
    keyring: Pick<Keyring, "encryptSensitive">;
    now?: Clock;
    randomBytes?: RandomBytes;
  },
): Promise<ActionCandidate> {
  const now = dependencies.now ?? systemClock;
  const randomBytes = dependencies.randomBytes ?? cryptoRandomBytes;
  const createdAt = now();
  const title = typeof input.title === "string" ? normalizeTitle(input.title) : "";
  const candidateInput = { ...input, title };
  if (!validCandidateInput(candidateInput, createdAt)) {
    throw new TypeError("Invalid action candidate");
  }

  const id = randomOpaqueId(randomBytes);
  const encryptedTitle = await dependencies.keyring.encryptSensitive(
    "action-candidate-title",
    id,
    TITLE_KEY_VERSION,
    title,
  );
  const created = await dependencies.store.createCandidate({
    id,
    sourceItemId: input.sourceItemId,
    workspaceId: input.workspaceId,
    encryptedTitle,
    titleKeyVersion: TITLE_KEY_VERSION,
    scheduledAt: input.scheduledAt,
    timezone: "Asia/Ho_Chi_Minh",
    now: createdAt,
  });
  if (!created) throw new TypeError("Source item is unavailable for this workspace");
  return {
    id,
    sourceItemId: input.sourceItemId,
    workspaceId: input.workspaceId,
    status: "PENDING",
    scheduledAt: input.scheduledAt,
    timezone: "Asia/Ho_Chi_Minh",
  };
}

export async function approveActionCandidate(
  input: { userId: string; candidateId: string },
  dependencies: {
    store: SourceActionStore;
    keyring: Pick<Keyring, "decryptSensitive" | "encryptSensitive">;
    now?: Clock;
    randomBytes?: RandomBytes;
  },
): Promise<CandidateDecisionResult> {
  const now = dependencies.now ?? systemClock;
  const randomBytes = dependencies.randomBytes ?? cryptoRandomBytes;
  const decidedAt = now();
  const candidate = await dependencies.store.findOwnedCandidate(input.userId, input.candidateId);
  if (!candidate) return { status: "NOT_FOUND" };
  if (candidate.status !== "PENDING") return { status: "ALREADY_DECIDED" };
  if (candidate.scheduled_at <= decidedAt) return { status: "CHANNEL_UNAVAILABLE" };

  const reminderId = randomOpaqueId(randomBytes);
  const reminderPublicId = randomOpaqueId(randomBytes);
  const title = await dependencies.keyring.decryptSensitive(
    "action-candidate-title",
    candidate.id,
    candidate.title_key_version,
    {
      ciphertext: persistedArrayBuffer(candidate.title_ciphertext),
      iv: persistedArrayBuffer(candidate.title_iv),
    },
  );
  const encryptedTitle = await dependencies.keyring.encryptSensitive(
    "reminder-title",
    reminderId,
    TITLE_KEY_VERSION,
    title,
  );
  const approved = await dependencies.store.approveCandidate({
    userId: input.userId,
    candidateId: candidate.id,
    decisionId: randomOpaqueId(randomBytes),
    reminderId,
    reminderPublicId,
    encryptedTitle,
    titleKeyVersion: TITLE_KEY_VERSION,
    now: decidedAt,
  });
  return approved
    ? { status: "APPROVED", reminderPublicId }
    : { status: "CHANNEL_UNAVAILABLE" };
}

export async function rejectActionCandidate(
  input: { userId: string; candidateId: string },
  dependencies: {
    store: SourceActionStore;
    now?: Clock;
    randomBytes?: RandomBytes;
  },
): Promise<CandidateDecisionResult> {
  const now = dependencies.now ?? systemClock;
  const randomBytes = dependencies.randomBytes ?? cryptoRandomBytes;
  const candidate = await dependencies.store.findOwnedCandidate(input.userId, input.candidateId);
  if (!candidate) return { status: "NOT_FOUND" };
  if (candidate.status !== "PENDING") return { status: "ALREADY_DECIDED" };
  const rejected = await dependencies.store.rejectCandidate({
    userId: input.userId,
    candidateId: candidate.id,
    decisionId: randomOpaqueId(randomBytes),
    now: now(),
  });
  return rejected ? { status: "REJECTED" } : { status: "ALREADY_DECIDED" };
}
