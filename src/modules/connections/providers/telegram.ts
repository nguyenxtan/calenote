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

const TELEGRAM_BOT_API_HOSTNAME = "api.telegram.org";

export async function verifyTelegramBotToken(
  token: string,
  requester: ProviderRequester = postSecretProviderJson,
): Promise<BotProfile> {
  if (!isSafeProviderToken("telegram", token)) {
    throw new ProviderVerificationError("INVALID_TOKEN_FORMAT");
  }

  const payload = await requester({
    provider: "telegram",
    hostname: TELEGRAM_BOT_API_HOSTNAME,
    path: `/bot${token}/getMe`,
    operation: "getMe",
  });

  if (!isRecord(payload)) {
    throw new ProviderVerificationError("INVALID_PROVIDER_RESPONSE");
  }
  if (payload.ok !== true) {
    throw providerFailureFromPayload("telegram", payload);
  }

  const result = payload.result;
  if (
    !isRecord(result) ||
    (typeof result.id !== "string" && typeof result.id !== "number") ||
    result.is_bot !== true ||
    typeof result.first_name !== "string" ||
    result.first_name.trim().length === 0
  ) {
    throw new ProviderVerificationError("INVALID_PROVIDER_RESPONSE");
  }

  return {
    provider: "telegram",
    providerBotId: String(result.id),
    displayName: result.first_name,
    handle: typeof result.username === "string" ? `@${result.username}` : null,
    accountType: null,
    canJoinGroups: optionalBoolean(result.can_join_groups),
  };
}

function path(token: string, operation: "getMe" | "setWebhook" | "sendMessage"): string {
  if (!isSafeProviderToken("telegram", token)) {
    throw new ProviderVerificationError("INVALID_TOKEN_FORMAT");
  }

  return `/bot${token}/${operation}`;
}

export async function setTelegramWebhook(
  token: string,
  input: WebhookRegistration,
  requester: ProviderRequester = postSecretProviderJson,
): Promise<void> {
  if (!isCanonicalBase64Url(input.secretToken, 1)) {
    throw new ProviderVerificationError("INVALID_PROVIDER_RESPONSE");
  }

  const payload = await requester({
    provider: "telegram",
    hostname: TELEGRAM_BOT_API_HOSTNAME,
    path: path(token, "setWebhook"),
    operation: "setWebhook",
    body: {
      url: input.url,
      secret_token: input.secretToken,
      allowed_updates: ["message"],
    },
  });

  if (!isRecord(payload)) {
    throw new ProviderOperationError("INVALID_RESPONSE");
  }

  if (typeof payload.ok !== "boolean") {
    throw new ProviderOperationError("INVALID_RESPONSE");
  }

  if (!payload.ok) {
    throw providerOperationFailureFromPayload("telegram", payload);
  }

  if (payload.result !== true) {
    throw new ProviderOperationError("INVALID_RESPONSE");
  }
}

export async function sendTelegramText(
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

  if (text.length > 4096) {
    throw new ProviderVerificationError("INVALID_PROVIDER_RESPONSE");
  }

  const payload = await requester({
    provider: "telegram",
    hostname: TELEGRAM_BOT_API_HOSTNAME,
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
    throw providerOperationFailureFromPayload("telegram", payload);
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

export function parseTelegramWebhook(payload: unknown): InboundTextMessage | null {
  if (!isRecord(payload)) {
    return null;
  }

  if (typeof payload.update_id !== "number" && typeof payload.update_id !== "string") {
    return null;
  }

  const message = payload.message;
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

  if (chat.type !== "private") {
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

  return {
    provider: "telegram",
    providerMessageId: String(payload.update_id),
    providerUserId: String(from.id),
    privateChatId: String(chat.id),
    displayName: typeof from.first_name === "string" ? from.first_name : null,
    text: message.text,
    receivedAt: message.date * 1000,
  };
}
