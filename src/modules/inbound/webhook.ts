import type { BotProvider, InboundTextMessage } from "@/modules/connections/contracts";
import { RequestBodyError, readBoundedJson } from "@/modules/http/body";
import {
  cryptoRandomBytes,
  d1Changes,
  randomOpaqueId,
  systemClock,
  type Clock,
  type RandomBytes,
} from "@/modules/platform/types";
import type { Keyring } from "@/modules/security/keyring";

export const WEBHOOK_MAX_BODY_BYTES = 32 * 1_024;
export const WEBHOOK_BODY_TIMEOUT_MS = 5_000;
export const INBOUND_PROCESSING_LEASE_MS = 5 * 60 * 1_000;

export type InboundState = "PENDING" | "PROCESSING" | "PROCESSED" | "REJECTED" | "FAILED";

export interface WebhookConnection {
  id: string;
  provider: BotProvider;
  publicId: string;
}

export interface InboundRecord {
  id: string;
  connectionId: string;
  provider: BotProvider;
  providerMessageId: string;
  providerUserId: string;
  privateChatId: string;
  displayName: string | null;
  messageCiphertext: ArrayBuffer;
  messageIv: ArrayBuffer;
  messageKeyVersion: number;
  state: InboundState;
  receivedAt: number;
  processingStartedAt: number | null;
  attemptCount: number;
  processedAt: number | null;
}

export interface InboundStore {
  findDuplicate(
    provider: BotProvider,
    connectionId: string,
    privateChatId: string,
    providerMessageId: string,
  ): Promise<InboundRecord | null>;
  insert(record: InboundRecord): Promise<boolean>;
}

interface WebhookConnectionRow {
  id: string;
  provider: BotProvider;
  public_id: string;
}

interface InboundRow {
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
  state: InboundState;
  received_at: number;
  processing_started_at: number | null;
  attempt_count: number;
  processed_at: number | null;
}

function persistedArrayBuffer(value: unknown): ArrayBuffer {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    return Uint8Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)).buffer;
  }
  throw new TypeError("Malformed encrypted inbound value");
}

function inboundRecord(row: InboundRow): InboundRecord {
  return {
    id: row.id,
    connectionId: row.connection_id,
    provider: row.provider,
    providerMessageId: row.provider_message_id,
    providerUserId: row.provider_user_id,
    privateChatId: row.private_chat_id,
    displayName: row.display_name,
    messageCiphertext: persistedArrayBuffer(row.message_ciphertext),
    messageIv: persistedArrayBuffer(row.message_iv),
    messageKeyVersion: row.message_key_version,
    state: row.state,
    receivedAt: row.received_at,
    processingStartedAt: row.processing_started_at,
    attemptCount: row.attempt_count,
    processedAt: row.processed_at,
  };
}

export class D1InboundWebhookStore implements InboundStore {
  constructor(private readonly database: D1Database) {}

  async findConnection(provider: BotProvider, publicId: string): Promise<WebhookConnection | null> {
    const row = await this.database
      .prepare(
        `SELECT id, provider, public_id FROM bot_connections
         WHERE provider = ? AND public_id = ?
           AND state IN ('VALIDATING', 'ACTIVE_UNBOUND', 'ACTIVE_BOUND', 'WEBHOOK_FAILED')
         LIMIT 1`,
      )
      .bind(provider, publicId)
      .first<WebhookConnectionRow>();
    return row ? { id: row.id, provider: row.provider, publicId: row.public_id } : null;
  }

  async findDuplicate(
    provider: BotProvider,
    connectionId: string,
    privateChatId: string,
    providerMessageId: string,
  ): Promise<InboundRecord | null> {
    const row = await this.database
      .prepare(
        `SELECT id, connection_id, provider, provider_message_id, provider_user_id,
                private_chat_id, display_name, message_ciphertext, message_iv,
                message_key_version, state, received_at, processing_started_at,
                attempt_count, processed_at
         FROM inbound_updates
         WHERE provider = ? AND connection_id = ? AND private_chat_id = ?
           AND provider_message_id = ?
         LIMIT 1`,
      )
      .bind(provider, connectionId, privateChatId, providerMessageId)
      .first<InboundRow>();
    return row ? inboundRecord(row) : null;
  }

  async insert(record: InboundRecord): Promise<boolean> {
    const result = await this.database
      .prepare(
        `INSERT OR IGNORE INTO inbound_updates (
           id, connection_id, provider, provider_message_id, provider_user_id,
           private_chat_id, display_name, message_ciphertext, message_iv,
           message_key_version, state, received_at, processing_started_at,
           attempt_count, processed_at, transition_marker
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .bind(
        record.id,
        record.connectionId,
        record.provider,
        record.providerMessageId,
        record.providerUserId,
        record.privateChatId,
        record.displayName,
        record.messageCiphertext,
        record.messageIv,
        record.messageKeyVersion,
        record.state,
        record.receivedAt,
        record.processingStartedAt,
        record.attemptCount,
        record.processedAt,
      )
      .run();
    return d1Changes(result) === 1;
  }
}

export interface ProcessInboundJob {
  type: "PROCESS_INBOUND";
  inboundId: string;
}

export interface AcceptWebhookDependencies {
  store: InboundStore;
  enqueue(job: ProcessInboundJob): Promise<void>;
  parseWebhook(payload: unknown): InboundTextMessage | null;
  keyring: Pick<Keyring, "encryptSensitive">;
  now?: Clock;
  randomBytes?: RandomBytes;
  readJson?: typeof readBoundedJson;
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/gu, "\n").normalize("NFC");
}

function normalizeIdentifier(value: string): string {
  return value.normalize("NFC");
}

function shouldPublish(record: InboundRecord, now: number): boolean {
  if (record.state === "PENDING") return true;
  if (record.state !== "PROCESSING") return false;
  if (record.processingStartedAt === null) return true;
  return record.processingStartedAt <= now - INBOUND_PROCESSING_LEASE_MS;
}

async function publishOrUnavailable(
  enqueue: AcceptWebhookDependencies["enqueue"],
  inboundId: string,
): Promise<Response> {
  try {
    await enqueue({ type: "PROCESS_INBOUND", inboundId });
    return new Response(null, { status: 200 });
  } catch {
    return new Response(null, { status: 503 });
  }
}

function bodyErrorResponse(error: RequestBodyError): Response {
  return new Response(null, { status: error.status });
}

export async function acceptWebhook(
  request: Request,
  connection: WebhookConnection,
  dependencies: AcceptWebhookDependencies,
): Promise<Response> {
  const now = dependencies.now ?? systemClock;
  const readJson = dependencies.readJson ?? readBoundedJson;
  let payload: Record<string, unknown>;
  try {
    payload = await readJson(request, WEBHOOK_MAX_BODY_BYTES, {
      timeoutMs: WEBHOOK_BODY_TIMEOUT_MS,
    });
  } catch (error) {
    if (error instanceof RequestBodyError) return bodyErrorResponse(error);
    throw error;
  }

  const parsed = dependencies.parseWebhook(payload);
  if (!parsed || parsed.provider !== connection.provider) {
    return new Response(null, { status: 204 });
  }

  const providerMessageId = normalizeIdentifier(parsed.providerMessageId);
  const providerUserId = normalizeIdentifier(parsed.providerUserId);
  const privateChatId = normalizeIdentifier(parsed.privateChatId);
  const displayName = parsed.displayName?.normalize("NFC") ?? null;
  const text = normalizeLineEndings(parsed.text);
  const duplicate = await dependencies.store.findDuplicate(
    connection.provider,
    connection.id,
    privateChatId,
    providerMessageId,
  );
  const receivedNow = now();
  if (duplicate) {
    return shouldPublish(duplicate, receivedNow)
      ? publishOrUnavailable(dependencies.enqueue, duplicate.id)
      : new Response(null, { status: 200 });
  }

  const randomBytes = dependencies.randomBytes ?? cryptoRandomBytes;
  const inboundId = randomOpaqueId(randomBytes);
  const encrypted = await dependencies.keyring.encryptSensitive(
    "inbound-message",
    inboundId,
    1,
    text,
  );
  const record: InboundRecord = {
    id: inboundId,
    connectionId: connection.id,
    provider: connection.provider,
    providerMessageId,
    providerUserId,
    privateChatId,
    displayName,
    messageCiphertext: encrypted.ciphertext,
    messageIv: encrypted.iv,
    messageKeyVersion: 1,
    state: "PENDING",
    receivedAt: parsed.receivedAt,
    processingStartedAt: null,
    attemptCount: 0,
    processedAt: null,
  };

  if (await dependencies.store.insert(record)) {
    return publishOrUnavailable(dependencies.enqueue, inboundId);
  }

  const raced = await dependencies.store.findDuplicate(
    connection.provider,
    connection.id,
    privateChatId,
    providerMessageId,
  );
  if (!raced) throw new Error("Inbound dedupe result was unavailable");
  return shouldPublish(raced, receivedNow)
    ? publishOrUnavailable(dependencies.enqueue, raced.id)
    : new Response(null, { status: 200 });
}
