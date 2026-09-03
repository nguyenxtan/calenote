import type { BotProfile, InboundTextMessage, ProviderRequester, SendReceipt, WebhookRegistration } from "../contracts";
import { ProviderVerificationError } from "../provider-error";
import { isSafeProviderToken } from "../token-policy";
import { isRecord, optionalBoolean, providerFailureFromPayload, providerOperationFailureFromPayload } from "./provider-http";
import { postSecretProviderJson } from "./secret-provider-transport";
import { isCanonicalBase64Url } from "@/modules/security/encoding";
import { ProviderOperationError } from "../provider-error";

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

function path(token: string, operation: "getMe" | "setWebhook" | "sendMessage"): string {
  if (!isSafeProviderToken("zalo", token)) throw new ProviderVerificationError("INVALID_TOKEN_FORMAT");
  return `/bot${token}/${operation}`;
}

export async function setZaloWebhook(token: string, input: WebhookRegistration, requester: ProviderRequester = postSecretProviderJson): Promise<void> {
  if (!isCanonicalBase64Url(input.secretToken, 8)) throw new ProviderVerificationError("INVALID_PROVIDER_RESPONSE");
  const payload = await requester({ provider: "zalo", hostname: ZALO_BOT_API_HOSTNAME, path: path(token, "setWebhook"), operation: "setWebhook", body: { url: input.url, secret_token: input.secretToken } });
  if (!isRecord(payload) || payload.ok !== true) throw providerOperationFailureFromPayload("zalo", isRecord(payload) ? payload : {});
  if (!isRecord(payload.result) || !isRecord(payload.result.verification) || payload.result.verification.ok !== true) throw new ProviderOperationError("INVALID_RESPONSE");
}
export async function sendZaloText(token: string, chatId: string, text: string, requester: ProviderRequester = postSecretProviderJson): Promise<SendReceipt> { if (!chatId || text.length < 1 || text.length > 2000) throw new ProviderVerificationError("INVALID_PROVIDER_RESPONSE"); const payload = await requester({ provider: "zalo", hostname: ZALO_BOT_API_HOSTNAME, path: path(token, "sendMessage"), operation: "sendMessage", body: { chat_id: chatId, text } }); if (!isRecord(payload) || payload.ok !== true) throw providerOperationFailureFromPayload("zalo", isRecord(payload) ? payload : {}); const result = isRecord(payload.result) ? payload.result : null; if (!result || (typeof result.message_id !== "string" && typeof result.message_id !== "number")) throw new ProviderOperationError("INVALID_RESPONSE"); return { providerMessageId: String(result.message_id) }; }
export function parseZaloWebhook(payload: unknown): InboundTextMessage | null { if (!isRecord(payload) || payload.ok !== true || !isRecord(payload.result) || payload.result.event_name !== "message.text.received" || !isRecord(payload.result.message)) return null; const m = payload.result.message; const from = isRecord(m.from) ? m.from : null; const chat = isRecord(m.chat) ? m.chat : null; if (!from || !chat || from.is_bot !== false || chat.chat_type !== "PRIVATE" || typeof m.text !== "string" || (typeof m.message_id !== "string" && typeof m.message_id !== "number") || (typeof from.id !== "string" && typeof from.id !== "number") || (typeof chat.id !== "string" && typeof chat.id !== "number") || typeof m.date !== "number" || !Number.isSafeInteger(m.date) || m.date < 0) return null; return { provider: "zalo", providerMessageId: String(m.message_id), providerUserId: String(from.id), privateChatId: String(chat.id), displayName: typeof from.display_name === "string" ? from.display_name : null, text: m.text, receivedAt: m.date }; }
