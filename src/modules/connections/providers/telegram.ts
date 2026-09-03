import type { BotProfile, InboundTextMessage, ProviderRequester, SendReceipt, WebhookRegistration } from "../contracts";
import { ProviderVerificationError } from "../provider-error";
import { isSafeProviderToken } from "../token-policy";
import { isRecord, optionalBoolean, providerFailureFromPayload, providerOperationFailureFromPayload } from "./provider-http";
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
  if (!isSafeProviderToken("telegram", token)) throw new ProviderVerificationError("INVALID_TOKEN_FORMAT");
  return `/bot${token}/${operation}`;
}

export async function setTelegramWebhook(token: string, input: WebhookRegistration, requester: ProviderRequester = postSecretProviderJson): Promise<void> {
  if (!/^[A-Za-z0-9_-]{1,256}$/u.test(input.secretToken)) throw new ProviderVerificationError("INVALID_PROVIDER_RESPONSE");
  const payload = await requester({ provider: "telegram", hostname: TELEGRAM_BOT_API_HOSTNAME, path: path(token, "setWebhook"), operation: "setWebhook", body: { url: input.url, secret_token: input.secretToken, allowed_updates: ["message"] } });
  if (!isRecord(payload) || payload.ok !== true) throw providerOperationFailureFromPayload("telegram", isRecord(payload) ? payload : {});
}
export async function sendTelegramText(token: string, chatId: string, text: string, requester: ProviderRequester = postSecretProviderJson): Promise<SendReceipt> { if (!chatId || text.length < 1 || text.length > 4096) throw new ProviderVerificationError("INVALID_PROVIDER_RESPONSE"); const payload = await requester({ provider: "telegram", hostname: TELEGRAM_BOT_API_HOSTNAME, path: path(token, "sendMessage"), operation: "sendMessage", body: { chat_id: chatId, text } }); if (!isRecord(payload) || payload.ok !== true) throw providerOperationFailureFromPayload("telegram", isRecord(payload) ? payload : {}); const result = isRecord(payload.result) ? payload.result : {}; return { providerMessageId: typeof result.message_id === "string" || typeof result.message_id === "number" ? String(result.message_id) : null }; }
export function parseTelegramWebhook(payload: unknown): InboundTextMessage | null { if (!isRecord(payload) || (typeof payload.update_id !== "number" && typeof payload.update_id !== "string") || !isRecord(payload.message)) return null; const m = payload.message; const from = isRecord(m.from) ? m.from : null; const chat = isRecord(m.chat) ? m.chat : null; if (!from || !chat || from.is_bot !== false || chat.type !== "private" || typeof m.text !== "string" || (typeof m.message_id !== "string" && typeof m.message_id !== "number") || (typeof from.id !== "string" && typeof from.id !== "number") || (typeof chat.id !== "string" && typeof chat.id !== "number") || typeof m.date !== "number") return null; return { provider: "telegram", providerMessageId: String(payload.update_id), providerUserId: String(from.id), privateChatId: String(chat.id), displayName: typeof from.first_name === "string" ? from.first_name : null, text: m.text, receivedAt: m.date * 1000 }; }
