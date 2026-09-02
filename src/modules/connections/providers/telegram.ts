import type { BotProfile, ProviderFetch } from "../contracts";
import { ProviderVerificationError } from "../provider-error";
import { isSafeProviderToken } from "../token-policy";
import { isRecord, optionalBoolean, postProviderJson } from "./provider-http";

const TELEGRAM_BOT_API_ORIGIN = "https://api.telegram.org";

export async function verifyTelegramBotToken(
  token: string,
  fetcher: ProviderFetch = fetch,
): Promise<BotProfile> {
  if (!isSafeProviderToken("telegram", token)) {
    throw new ProviderVerificationError("INVALID_TOKEN_FORMAT");
  }

  const payload = await postProviderJson(
    `${TELEGRAM_BOT_API_ORIGIN}/bot${token}/getMe`,
    fetcher,
  );

  if (!isRecord(payload) || payload.ok !== true) {
    throw new ProviderVerificationError("PROVIDER_REJECTED");
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
