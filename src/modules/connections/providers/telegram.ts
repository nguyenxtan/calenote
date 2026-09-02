import type { BotProfile, ProviderRequester } from "../contracts";
import { ProviderVerificationError } from "../provider-error";
import { isSafeProviderToken } from "../token-policy";
import { isRecord, optionalBoolean, providerFailureFromPayload } from "./provider-http";
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
