import type {
  BotProvider,
  ProviderRequester,
  SendReceipt,
} from "@/modules/connections/contracts";
import { sendTelegramText } from "@/modules/connections/providers/telegram";
import { sendZaloText } from "@/modules/connections/providers/zalo";
import {
  INBOUND_PROCESSING_LEASE_MS,
  type InboundState,
} from "@/modules/inbound/webhook";
import {
  cryptoRandomBytes,
  d1Changes,
  randomOpaqueId,
  systemClock,
  type Clock,
  type RandomBytes,
} from "@/modules/platform/types";
import {
  processBoundChatMessage,
  type BoundChatContext,
  type BoundChatMessage,
  type ConfirmDraftMutation,
  type CreateDraftMutation,
  type MutationResult,
  type PendingDraft,
  type ProcessBoundChatResult,
  type ReminderCommandStore,
} from "@/modules/reminders/command-service";
import { D1ReminderCommandStore } from "@/modules/reminders/infrastructure/d1/command-store";
import type { EncryptedValue, Keyring } from "@/modules/security/keyring";
import { MAX_INBOUND_PROCESS_ATTEMPTS } from "@/modules/reminders/scheduler";

const CONNECT_COMMAND = /^\/connect ([A-HJ-NP-Z2-9]{26})$/u;
const BIND_SUCCESS_REPLY = "Đã kết nối cuộc trò chuyện riêng này với Calenote.";
const BIND_FAILURE_REPLY = "Không thể kết nối. Mã không hợp lệ, đã hết hạn hoặc đã được sử dụng.";
const CONNECT_HELP_REPLY = "Hãy gửi đúng lệnh /connect <MÃ_26_KÝ_TỰ> từ trang Calenote.";

interface ClaimedRow {
  id: string;
  connection_id: string;
  provider: BotProvider;
  provider_message_id: string;
  provider_user_id: string;
  private_chat_id: string;
  display_name: string | null;
  message_ciphertext: unknown;
  message_iv: unknown;
  message_key_version: number;
  state: "PROCESSING";
  received_at: number;
  processing_started_at: number;
  attempt_count: number;
  processed_at: number | null;
  transition_marker: string;
  connection_user_id: string;
  connection_state: ConnectionState;
  encrypted_token: unknown;
  encrypted_token_iv: unknown;
  credential_version: number;
}

interface StateRow {
  state: InboundState;
  processing_started_at: number | null;
  attempt_count: number;
}

type ConnectionState = "VALIDATING" | "ACTIVE_UNBOUND" | "ACTIVE_BOUND" | "WEBHOOK_FAILED" | "SUSPENDED";

export interface ClaimedInboundMessage {
  id: string;
  connectionId: string;
  connectionUserId: string;
  connectionState: ConnectionState;
  provider: BotProvider;
  providerMessageId: string;
  providerUserId: string;
  privateChatId: string;
  displayName: string | null;
  text: string;
  receivedAt: number;
  processingStartedAt: number;
  attemptCount: number;
  claimMarker: string;
  encryptedToken: ArrayBuffer;
  encryptedTokenIv: ArrayBuffer;
  credentialVersion: number;
}

export type StoreClaimResult =
  | { status: "CLAIMED"; row: Omit<ClaimedInboundMessage, "text"> & { encryptedMessage: EncryptedValue; messageKeyVersion: number } }
  | { status: "RETRY_AFTER"; retryAfterMs: number }
  | { status: "TERMINAL" }
  | { status: "MISSING" };

export type ClaimInboundResult =
  | { status: "CLAIMED"; message: ClaimedInboundMessage }
  | Exclude<StoreClaimResult, { status: "CLAIMED" }>;

export interface BindPrivateChatInput {
  inboundId: string;
  connectionId: string;
  connectionUserId: string;
  providerUserId: string;
  privateChatId: string;
  displayName: string | null;
  codeDigest: string;
  claimMarker: string;
  chatIdentityId: string;
  auditId: string;
  now: number;
}

export interface InboundProcessorStore extends ReminderCommandStore {
  claim(inboundId: string, now: number, claimMarker: string): Promise<StoreClaimResult>;
  bindPrivateChat(input: BindPrivateChatInput): Promise<boolean>;
  reject(inboundId: string, claimMarker: string, now: number): Promise<boolean>;
  fail(inboundId: string, claimMarker: string, now: number): Promise<boolean>;
}

export interface ClaimInboundDependencies {
  store: Pick<InboundProcessorStore, "claim">;
  keyring: Pick<Keyring, "decryptSensitive">;
  now?: Clock;
  randomBytes?: RandomBytes;
}

type SendText = (
  provider: BotProvider,
  token: string,
  privateChatId: string,
  text: string,
) => Promise<SendReceipt>;

export interface ProcessInboundDependencies {
  store: InboundProcessorStore;
  keyring: Pick<Keyring, "decryptSensitive" | "encryptSensitive" | "digestCode" | "decryptCredential">;
  sendText?: SendText;
  now?: Clock;
  randomBytes?: RandomBytes;
}

export async function sendProviderText(
  provider: BotProvider,
  token: string,
  privateChatId: string,
  text: string,
  requester?: ProviderRequester,
): Promise<SendReceipt> {
  if (provider === "zalo") {
    return sendZaloText(token, privateChatId, text, requester);
  }
  return sendTelegramText(token, privateChatId, text, requester);
}

export type ProcessInboundResult =
  | { status: "BOUND" }
  | { status: "REJECTED" }
  | { status: "SUPERSEDED" }
  | ProcessBoundChatResult
  | Exclude<ClaimInboundResult, { status: "CLAIMED" }>;

function arrayBuffer(value: unknown): ArrayBuffer {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    return Uint8Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)).buffer;
  }
  throw new TypeError("Malformed encrypted database value");
}

function bindConflict(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /(?:UNIQUE constraint failed:\s*chat_identities\.|NOT NULL constraint failed:\s*(?:chat_identities\.connection_id|audit_events\.id))/iu.test(error.message);
}

function mapClaimed(row: ClaimedRow): StoreClaimResult & { status: "CLAIMED" } {
  return {
    status: "CLAIMED",
    row: {
      id: row.id,
      connectionId: row.connection_id,
      connectionUserId: row.connection_user_id,
      connectionState: row.connection_state,
      provider: row.provider,
      providerMessageId: row.provider_message_id,
      providerUserId: row.provider_user_id,
      privateChatId: row.private_chat_id,
      displayName: row.display_name,
      receivedAt: row.received_at,
      processingStartedAt: row.processing_started_at,
      attemptCount: row.attempt_count,
      claimMarker: row.transition_marker,
      encryptedMessage: {
        ciphertext: arrayBuffer(row.message_ciphertext),
        iv: arrayBuffer(row.message_iv),
      },
      messageKeyVersion: row.message_key_version,
      encryptedToken: arrayBuffer(row.encrypted_token),
      encryptedTokenIv: arrayBuffer(row.encrypted_token_iv),
      credentialVersion: row.credential_version,
    },
  };
}

export class D1InboundProcessorStore implements InboundProcessorStore {
  private readonly reminderCommands: ReminderCommandStore;

  constructor(
    private readonly database: D1Database,
    reminderCommands: ReminderCommandStore = new D1ReminderCommandStore(database),
  ) {
    this.reminderCommands = reminderCommands;
  }

  findBoundContext(message: BoundChatMessage): Promise<BoundChatContext | null> {
    return this.reminderCommands.findBoundContext(message);
  }

  findPendingDraft(message: BoundChatMessage, chatIdentityId: string): Promise<PendingDraft | null> {
    return this.reminderCommands.findPendingDraft(message, chatIdentityId);
  }

  createDraft(input: CreateDraftMutation): Promise<MutationResult> {
    return this.reminderCommands.createDraft(input);
  }

  confirmDraft(input: ConfirmDraftMutation): Promise<MutationResult> {
    return this.reminderCommands.confirmDraft(input);
  }

  cancelDraft(input: Parameters<ReminderCommandStore["cancelDraft"]>[0]): Promise<MutationResult> {
    return this.reminderCommands.cancelDraft(input);
  }

  expireDraft(input: Parameters<ReminderCommandStore["expireDraft"]>[0]): Promise<MutationResult> {
    return this.reminderCommands.expireDraft(input);
  }

  rejectMessage(...input: Parameters<ReminderCommandStore["rejectMessage"]>): Promise<boolean> {
    return this.reminderCommands.rejectMessage(...input);
  }

  async claim(inboundId: string, now: number, claimMarker: string): Promise<StoreClaimResult> {
    const claimed = await this.database
      .prepare(
        `UPDATE inbound_updates
         SET state = 'PROCESSING', processing_started_at = ?, attempt_count = attempt_count + 1,
             transition_marker = ?, dispatch_started_at = NULL, dispatch_marker = NULL
         WHERE id = ? AND (
           state = 'PENDING' OR
           (state = 'PROCESSING' AND (processing_started_at IS NULL OR processing_started_at <= ?))
         )
           AND attempt_count < ?
         RETURNING id`,
      )
      .bind(
        now,
        claimMarker,
        inboundId,
        now - INBOUND_PROCESSING_LEASE_MS,
        MAX_INBOUND_PROCESS_ATTEMPTS,
      )
      .run<{ id: string }>();

    if (d1Changes(claimed) === 1) {
      const row = await this.database
        .prepare(
          `SELECT i.*, c.user_id AS connection_user_id, c.state AS connection_state,
                  c.encrypted_token, c.encrypted_token_iv, c.credential_version
           FROM inbound_updates i
           JOIN bot_connections c ON c.id = i.connection_id AND c.provider = i.provider
           WHERE i.id = ? AND i.state = 'PROCESSING' AND i.transition_marker = ?
           LIMIT 1`,
        )
        .bind(inboundId, claimMarker)
        .first<ClaimedRow>();
      if (!row) throw new Error("Claimed inbound row was unavailable");
      return mapClaimed(row);
    }

    const current = await this.database
      .prepare("SELECT state, processing_started_at, attempt_count FROM inbound_updates WHERE id = ? LIMIT 1")
      .bind(inboundId)
      .first<StateRow>();
    if (!current) return { status: "MISSING" };
    if (current.state !== "PENDING" && current.state !== "PROCESSING") {
      return { status: "TERMINAL" };
    }
    if (current.state === "PROCESSING" && current.processing_started_at !== null) {
      if (current.processing_started_at <= now - INBOUND_PROCESSING_LEASE_MS) {
        if (current.attempt_count >= MAX_INBOUND_PROCESS_ATTEMPTS) {
          const exhausted = await this.database
            .prepare(
              `UPDATE inbound_updates
               SET state = 'FAILED', processed_at = ?,
                   safe_error_code = 'INBOUND_PROCESSING_EXHAUSTED'
               WHERE id = ? AND state = 'PROCESSING'
                 AND processing_started_at = ? AND attempt_count = ?
                 AND processing_started_at <= ?
               RETURNING id`,
            )
            .bind(
              now,
              inboundId,
              current.processing_started_at,
              current.attempt_count,
              now - INBOUND_PROCESSING_LEASE_MS,
            )
            .run<{ id: string }>();
          if (d1Changes(exhausted) === 1) return { status: "TERMINAL" };
        }
        throw new Error("Inbound claim state changed unexpectedly");
      }
      return {
        status: "RETRY_AFTER",
        retryAfterMs: Math.max(1, current.processing_started_at + INBOUND_PROCESSING_LEASE_MS - now),
      };
    }
    if (current.state === "PENDING" && current.attempt_count >= MAX_INBOUND_PROCESS_ATTEMPTS) {
      const exhausted = await this.database
        .prepare(
          `UPDATE inbound_updates
           SET state = 'FAILED', processed_at = ?,
               safe_error_code = 'INBOUND_PROCESSING_EXHAUSTED'
           WHERE id = ? AND state = 'PENDING' AND attempt_count = ?
           RETURNING id`,
        )
        .bind(now, inboundId, current.attempt_count)
        .run<{ id: string }>();
      if (d1Changes(exhausted) === 1) return { status: "TERMINAL" };
    }
    throw new Error("Inbound claim state changed unexpectedly");
  }

  async bindPrivateChat(input: BindPrivateChatInput): Promise<boolean> {
    const statements = [
      this.database
        .prepare(
          `UPDATE bot_connections
           SET state = 'ACTIVE_BOUND', transition_marker = ?, updated_at = ?
           WHERE id = ? AND user_id = ? AND state = 'ACTIVE_UNBOUND'
             AND NOT EXISTS (SELECT 1 FROM chat_identities WHERE connection_id = ?)
             AND EXISTS (
               SELECT 1 FROM inbound_updates
               WHERE id = ? AND connection_id = ? AND state = 'PROCESSING'
                 AND transition_marker = ? AND provider_user_id <> '' AND private_chat_id <> ''
             )
             AND EXISTS (
               SELECT 1 FROM connect_codes
               WHERE connection_id = ? AND user_id = ? AND digest = ?
                 AND consumed_at IS NULL AND expires_at > ?
             )`,
        )
        .bind(
          input.claimMarker, input.now, input.connectionId, input.connectionUserId,
          input.connectionId, input.inboundId, input.connectionId, input.claimMarker,
          input.connectionId, input.connectionUserId, input.codeDigest, input.now,
        ),
      this.database
        .prepare(
          `INSERT INTO chat_identities (
             id, connection_id, provider_user_id, private_chat_id, display_name, linked_at
           ) VALUES (
             ?, COALESCE((
               SELECT id FROM bot_connections
               WHERE id = ? AND state = 'ACTIVE_BOUND' AND transition_marker = ?
             ), NULL), ?, ?, ?, ?
           )`,
        )
        .bind(
          input.chatIdentityId, input.connectionId, input.claimMarker,
          input.providerUserId, input.privateChatId, input.displayName, input.now,
        ),
      this.database
        .prepare(
          `UPDATE connect_codes
           SET consumed_at = ?
           WHERE connection_id = ? AND user_id = ? AND digest = ?
             AND consumed_at IS NULL AND expires_at > ?
             AND EXISTS (
               SELECT 1 FROM bot_connections
               WHERE id = ? AND state = 'ACTIVE_BOUND' AND transition_marker = ?
             )`,
        )
        .bind(
          input.now, input.connectionId, input.connectionUserId, input.codeDigest,
          input.now, input.connectionId, input.claimMarker,
        ),
      this.database
        .prepare(
          `UPDATE inbound_updates
           SET state = 'PROCESSED', processed_at = ?
           WHERE id = ? AND connection_id = ? AND state = 'PROCESSING' AND transition_marker = ?
             AND EXISTS (
               SELECT 1 FROM bot_connections
               WHERE id = ? AND state = 'ACTIVE_BOUND' AND transition_marker = ?
             )
             AND EXISTS (
               SELECT 1 FROM chat_identities
               WHERE id = ? AND connection_id = ? AND provider_user_id = ? AND private_chat_id = ?
             )
             AND EXISTS (
               SELECT 1 FROM connect_codes
               WHERE connection_id = ? AND digest = ? AND consumed_at = ?
             )`,
        )
        .bind(
          input.now, input.inboundId, input.connectionId, input.claimMarker,
          input.connectionId, input.claimMarker, input.chatIdentityId, input.connectionId,
          input.providerUserId, input.privateChatId, input.connectionId, input.codeDigest, input.now,
        ),
      this.database
        .prepare(
          `INSERT INTO audit_events (
             id, actor_user_id, action, target_user_id, target_connection_id, result, created_at
           ) VALUES (
             COALESCE((
               SELECT ? FROM inbound_updates
               WHERE id = ? AND connection_id = ? AND state = 'PROCESSED' AND transition_marker = ?
             ), NULL), ?, 'CHAT_BOUND', ?, ?, 'SUCCESS', ?
           )`,
        )
        .bind(
          input.auditId, input.inboundId, input.connectionId, input.claimMarker,
          input.connectionUserId, input.connectionUserId, input.connectionId, input.now,
        ),
    ];

    try {
      const results = await this.database.batch(statements);
      if (results.length !== statements.length || results.some((result) => d1Changes(result) !== 1)) {
        throw new Error("Private chat binding batch was incomplete");
      }
      return true;
    } catch (error) {
      if (bindConflict(error)) return false;
      throw error;
    }
  }

  private async terminalize(
    inboundId: string,
    claimMarker: string,
    now: number,
    state: "REJECTED" | "FAILED",
  ): Promise<boolean> {
    const result = await this.database
      .prepare(
        `UPDATE inbound_updates SET state = ?, processed_at = ?
         WHERE id = ? AND state = 'PROCESSING' AND transition_marker = ?`,
      )
      .bind(state, now, inboundId, claimMarker)
      .run();
    return d1Changes(result) === 1;
  }

  reject(inboundId: string, claimMarker: string, now: number): Promise<boolean> {
    return this.terminalize(inboundId, claimMarker, now, "REJECTED");
  }

  fail(inboundId: string, claimMarker: string, now: number): Promise<boolean> {
    return this.terminalize(inboundId, claimMarker, now, "FAILED");
  }
}

export async function claimInbound(
  inboundId: string,
  dependencies: ClaimInboundDependencies,
): Promise<ClaimInboundResult> {
  const now = dependencies.now ?? systemClock;
  const randomBytes = dependencies.randomBytes ?? cryptoRandomBytes;
  const claim = await dependencies.store.claim(inboundId, now(), randomOpaqueId(randomBytes));
  if (claim.status !== "CLAIMED") return claim;
  const text = await dependencies.keyring.decryptSensitive(
    "inbound-message",
    claim.row.id,
    claim.row.messageKeyVersion,
    claim.row.encryptedMessage,
  );
  const { encryptedMessage, messageKeyVersion, ...message } = claim.row;
  void encryptedMessage;
  void messageKeyVersion;
  return { status: "CLAIMED", message: { ...message, text } };
}

function parseConnectCommand(text: string): string | null {
  return CONNECT_COMMAND.exec(text.trim())?.[1] ?? null;
}

async function replyAfterTerminal(
  message: ClaimedInboundMessage,
  text: string,
  dependencies: ProcessInboundDependencies,
): Promise<void> {
  try {
    const token = await dependencies.keyring.decryptCredential(
      message.connectionId,
      message.provider,
      message.credentialVersion,
      { ciphertext: message.encryptedToken, iv: message.encryptedTokenIv },
    );
    await (dependencies.sendText ?? sendProviderText)(
      message.provider,
      token,
      message.privateChatId,
      text,
    );
  } catch {
    // Binding/help replies are best effort after the terminal database transition.
  }
}

export async function processInbound(
  inboundId: string,
  dependencies: ProcessInboundDependencies,
): Promise<ProcessInboundResult> {
  const now = dependencies.now ?? systemClock;
  const randomBytes = dependencies.randomBytes ?? cryptoRandomBytes;
  let claim: ClaimInboundResult;
  try {
    claim = await claimInbound(inboundId, {
      store: dependencies.store,
      keyring: dependencies.keyring,
      now,
      randomBytes,
    });
  } catch {
    throw new Error("Unable to claim inbound message");
  }
  if (claim.status !== "CLAIMED") return claim;
  const message = claim.message;
  const commandCode = parseConnectCommand(message.text);

  if (commandCode !== null) {
    const digest = await dependencies.keyring.digestCode(commandCode);
    const bound = await dependencies.store.bindPrivateChat({
      inboundId: message.id,
      connectionId: message.connectionId,
      connectionUserId: message.connectionUserId,
      providerUserId: message.providerUserId,
      privateChatId: message.privateChatId,
      displayName: message.displayName,
      codeDigest: digest,
      claimMarker: message.claimMarker,
      chatIdentityId: randomOpaqueId(randomBytes),
      auditId: randomOpaqueId(randomBytes),
      now: now(),
    });
    if (bound) {
      await replyAfterTerminal(message, BIND_SUCCESS_REPLY, dependencies);
      return { status: "BOUND" };
    }
    if (!await dependencies.store.reject(message.id, message.claimMarker, now())) {
      return { status: "SUPERSEDED" };
    }
    await replyAfterTerminal(message, BIND_FAILURE_REPLY, dependencies);
    return { status: "REJECTED" };
  }

  if (message.connectionState === "ACTIVE_BOUND") {
    return processBoundChatMessage(message, {
      store: dependencies.store,
      keyring: dependencies.keyring,
      now,
      randomBytes,
      reply: (text) => replyAfterTerminal(message, text, dependencies),
    });
  }

  if (!await dependencies.store.reject(message.id, message.claimMarker, now())) {
    return { status: "SUPERSEDED" };
  }
  await replyAfterTerminal(message, CONNECT_HELP_REPLY, dependencies);
  return { status: "REJECTED" };
}
