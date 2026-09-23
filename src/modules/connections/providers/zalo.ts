import { isCanonicalBase64Url } from "@/modules/security/encoding";
import type {
  BotProfile,
  InboundTextMessage,
  ProviderRequester,
  SendReceipt,
  WebhookRegistration,
} from "../contracts";
import { ProviderOperationError, ProviderVerificationError } from "../provider-error";
import { isSafeProviderToken } from "../token-policy";
import {
  isRecord,
  optionalBoolean,
  providerFailureFromPayload,
  providerOperationFailureFromPayload,
} from "./provider-http";
import { postSecretProviderJson } from "./secret-provider-transport";

const ZALO_BOT_API_HOSTNAME = "bot-api.zaloplatforms.com";

export async function verifyZaloBotToken(
  token: string,
  requester: ProviderRequester = postSecretProviderJson,
): Promise<BotProfile> {
  if (!isSafeProviderToken("zalo", token)) {
    throw new ProviderVerificationError("INVALID_TOKEN_FORMAT");
  }

  const payload = await requester({
    provider: "zalo",
    hostname: ZALO_BOT_API_HOSTNAME,
    path: `/bot${token}/getMe`,
    operation: "getMe",
  });

  if (!isRecord(payload)) {
    throw new ProviderVerificationError("INVALID_PROVIDER_RESPONSE");
  }
  if (payload.ok !== true) {
    throw providerFailureFromPayload("zalo", payload);
  }

  const result = payload.result;
  if (
    !isRecord(result) ||
    (typeof result.id !== "string" && typeof result.id !== "number") ||
    typeof result.account_name !== "string" ||
    result.account_name.trim().length === 0
  ) {
    throw new ProviderVerificationError("INVALID_PROVIDER_RESPONSE");
  }

  return {
    provider: "zalo",
    providerBotId: String(result.id),
    displayName: result.account_name,
    handle: null,
    accountType: typeof result.account_type === "string" ? result.account_type : null,
    canJoinGroups: optionalBoolean(result.can_join_groups),
  };
}

function path(
  token: string,
  operation: "getMe" | "setWebhook" | "sendMessage" | "sendChatAction" | "getWebhookInfo" | "testWebhook",
): string {
  if (!isSafeProviderToken("zalo", token)) {
    throw new ProviderVerificationError("INVALID_TOKEN_FORMAT");
  }

  return `/bot${token}/${operation}`;
}

function operationPayload(payload: unknown): Record<string, unknown> {
  if (!isRecord(payload) || typeof payload.ok !== "boolean") {
    throw new ProviderOperationError("INVALID_RESPONSE");
  }
  if (!payload.ok) throw providerOperationFailureFromPayload("zalo", payload);
  return payload;
}

export interface SafeZaloWebhookInfo {
  configured: boolean;
  exactMatch: boolean;
  hostMatch: boolean;
  pathPrefixMatch: boolean;
}

export interface SafeZaloWebhookParserDiagnostic {
  payload_object: boolean;
  payload_ok_true: boolean;
  result_object: boolean;
  event_name_present: boolean;
  event_is_text_received: boolean;
  message_object: boolean;
  from_object: boolean;
  from_is_bot_present: boolean;
  from_is_bot_false: boolean;
  chat_object: boolean;
  chat_type_present: boolean;
  chat_is_private: boolean;
  text_present: boolean;
  text_is_string: boolean;
  message_id_present: boolean;
  from_id_present: boolean;
  chat_id_present: boolean;
  date_present: boolean;
  date_is_number: boolean;
  date_is_safe_integer: boolean;
  parser_accepted: boolean;
}

function supportedIdentifier(value: unknown): boolean {
  return typeof value === "string" || typeof value === "number";
}

function normalizeZaloWebhookEvent(payload: unknown): Record<string, unknown> | null {
  if (!isRecord(payload)) return null;

  if (payload.ok === true && isRecord(payload.result)) {
    return payload.result;
  }

  if (Object.hasOwn(payload, "event_name") && isRecord(payload.message)) {
    return payload;
  }

  return null;
}

export function diagnoseZaloWebhookPayload(payload: unknown): SafeZaloWebhookParserDiagnostic {
  const payloadObject = isRecord(payload);
  const result = payloadObject && isRecord(payload.result) ? payload.result : null;
  const event = normalizeZaloWebhookEvent(payload);
  const message = event && isRecord(event.message) ? event.message : null;
  const from = message && isRecord(message.from) ? message.from : null;
  const chat = message && isRecord(message.chat) ? message.chat : null;
  const date = message?.date;

  return {
    payload_object: payloadObject,
    payload_ok_true: payloadObject && payload.ok === true,
    result_object: result !== null,
    event_name_present: event !== null && typeof event.event_name === "string",
    event_is_text_received: event?.event_name === "message.text.received",
    message_object: message !== null,
    from_object: from !== null,
    from_is_bot_present: typeof from?.is_bot === "boolean",
    from_is_bot_false: from?.is_bot === false,
    chat_object: chat !== null,
    chat_type_present: typeof chat?.chat_type === "string",
    chat_is_private: chat?.chat_type === "PRIVATE",
    text_present: message !== null && Object.hasOwn(message, "text"),
    text_is_string: typeof message?.text === "string",
    message_id_present: supportedIdentifier(message?.message_id),
    from_id_present: supportedIdentifier(from?.id),
    chat_id_present: supportedIdentifier(chat?.id),
    date_present: message !== null && Object.hasOwn(message, "date"),
    date_is_number: typeof date === "number",
    date_is_safe_integer: typeof date === "number" && Number.isSafeInteger(date),
    parser_accepted: parseZaloWebhook(payload) !== null,
  };
}

export async function getZaloWebhookInfo(
  token: string,
  expected: WebhookRegistration,
  requester: ProviderRequester = postSecretProviderJson,
): Promise<SafeZaloWebhookInfo> {
  const payload = operationPayload(await requester({
    provider: "zalo",
    hostname: ZALO_BOT_API_HOSTNAME,
    path: path(token, "getWebhookInfo"),
    operation: "getWebhookInfo",
  }));
  const result = isRecord(payload.result) ? payload.result : null;
  const configuredUrl = result && (typeof result.url === "string" ? result.url : typeof result.webhook_url === "string" ? result.webhook_url : null);
  if (!configuredUrl) return { configured: false, exactMatch: false, hostMatch: false, pathPrefixMatch: false };
  try {
    const actual = new URL(configuredUrl);
    const canonical = new URL(expected.url);
    const hostMatch = actual.protocol === canonical.protocol && actual.hostname === canonical.hostname && actual.port === canonical.port;
    const pathPrefixMatch = actual.pathname.startsWith("/webhooks/zalo/");
    return {
      configured: true,
      exactMatch: actual.href === canonical.href,
      hostMatch,
      pathPrefixMatch,
    };
  } catch {
    return { configured: false, exactMatch: false, hostMatch: false, pathPrefixMatch: false };
  }
}

export async function testZaloWebhook(
  token: string,
  requester: ProviderRequester = postSecretProviderJson,
): Promise<{ apiOk: boolean; resultOk: boolean }> {
  const payload = operationPayload(await requester({
    provider: "zalo",
    hostname: ZALO_BOT_API_HOSTNAME,
    path: path(token, "testWebhook"),
    operation: "testWebhook",
  }));
  const result = isRecord(payload.result) ? payload.result : null;
  return { apiOk: true, resultOk: result?.ok === true };
}

export async function setZaloWebhook(
  token: string,
  input: WebhookRegistration,
  requester: ProviderRequester = postSecretProviderJson,
): Promise<void> {
  if (!isCanonicalBase64Url(input.secretToken, 8)) {
    throw new ProviderVerificationError("INVALID_PROVIDER_RESPONSE");
  }

  const payload = await requester({
    provider: "zalo",
    hostname: ZALO_BOT_API_HOSTNAME,
    path: path(token, "setWebhook"),
    operation: "setWebhook",
    body: {
      url: input.url,
      secret_token: input.secretToken,
    },
  });

  if (!isRecord(payload)) {
    throw new ProviderOperationError("INVALID_RESPONSE");
  }

  if (typeof payload.ok !== "boolean") {
    throw new ProviderOperationError("INVALID_RESPONSE");
  }

  if (!payload.ok) {
    throw providerOperationFailureFromPayload("zalo", payload);
  }

  const result = payload.result;
  if (!isRecord(result)) {
    throw new ProviderOperationError("INVALID_RESPONSE");
  }

  const verification = result.verification;
  if (!isRecord(verification)) {
    throw new ProviderOperationError("INVALID_RESPONSE");
  }

  if (typeof verification.ok !== "boolean") {
    throw new ProviderOperationError("INVALID_RESPONSE");
  }

  if (!verification.ok) {
    throw new ProviderOperationError("FAILED");
  }
}

export async function sendZaloText(
  token: string,
  chatId: string,
  text: string,
  requester: ProviderRequester = postSecretProviderJson,
): Promise<SendReceipt> {
  if (!chatId) {
    throw new ProviderVerificationError("INVALID_PROVIDER_RESPONSE");
  }

  if (text.length < 1) {
    throw new ProviderVerificationError("INVALID_PROVIDER_RESPONSE");
  }

  if (text.length > 2000) {
    throw new ProviderVerificationError("INVALID_PROVIDER_RESPONSE");
  }

  const payload = await requester({
    provider: "zalo",
    hostname: ZALO_BOT_API_HOSTNAME,
    path: path(token, "sendMessage"),
    operation: "sendMessage",
    body: {
      chat_id: chatId,
      text,
    },
  });

  if (!isRecord(payload)) {
    throw new ProviderOperationError("INVALID_RESPONSE");
  }

  if (typeof payload.ok !== "boolean") {
    throw new ProviderOperationError("INVALID_RESPONSE");
  }

  if (!payload.ok) {
    throw providerOperationFailureFromPayload("zalo", payload);
  }

  const result = payload.result;
  if (!isRecord(result)) {
    throw new ProviderOperationError("INVALID_RESPONSE");
  }

  const providerMessageId = result.message_id;
  if (typeof providerMessageId !== "string" && typeof providerMessageId !== "number") {
    throw new ProviderOperationError("INVALID_RESPONSE");
  }

  return {
    providerMessageId: String(providerMessageId),
  };
}

export async function sendZaloTyping(
  token: string,
  chatId: string,
  requester: ProviderRequester = postSecretProviderJson,
): Promise<void> {
  if (!chatId) {
    throw new ProviderVerificationError("INVALID_PROVIDER_RESPONSE");
  }

  const payload = await requester({
    provider: "zalo",
    hostname: ZALO_BOT_API_HOSTNAME,
    path: path(token, "sendChatAction"),
    operation: "sendChatAction",
    timeoutMs: 1_000,
    body: { chat_id: chatId, action: "typing" },
  });

  operationPayload(payload);
}

export function parseZaloWebhook(payload: unknown): InboundTextMessage | null {
  const event = normalizeZaloWebhookEvent(payload);
  if (!event) return null;

  if (event.event_name !== "message.text.received") {
    return null;
  }

  const message = event.message;
  if (!isRecord(message)) {
    return null;
  }

  const from = isRecord(message.from) ? message.from : null;
  if (!from) {
    return null;
  }

  const chat = isRecord(message.chat) ? message.chat : null;
  if (!chat) {
    return null;
  }

  if (from.is_bot !== false) {
    return null;
  }

  if (chat.chat_type !== "PRIVATE") {
    return null;
  }

  if (typeof message.text !== "string") {
    return null;
  }

  if (typeof message.message_id !== "string" && typeof message.message_id !== "number") {
    return null;
  }

  if (typeof from.id !== "string" && typeof from.id !== "number") {
    return null;
  }

  if (typeof chat.id !== "string" && typeof chat.id !== "number") {
    return null;
  }

  if (typeof message.date !== "number") {
    return null;
  }

  if (!Number.isSafeInteger(message.date)) {
    return null;
  }

  if (message.date < 0) {
    return null;
  }

  return {
    provider: "zalo",
    providerMessageId: String(message.message_id),
    providerUserId: String(from.id),
    privateChatId: String(chat.id),
    displayName: typeof from.display_name === "string" ? from.display_name : null,
    text: message.text,
    receivedAt: message.date,
  };
}
