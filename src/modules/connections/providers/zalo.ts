import type { BotProfile, ProviderFetch } from "../contracts";
import { ProviderVerificationError } from "../provider-error";
import { isSafeProviderToken } from "../token-policy";
import { isRecord, optionalBoolean, postProviderJson } from "./provider-http";

const ZALO_BOT_API_ORIGIN = "https://bot-api.zaloplatforms.com";

export async function verifyZaloBotToken(
  token: string,
  fetcher: ProviderFetch = fetch,
): Promise<BotProfile> {
  if (!isSafeProviderToken("zalo", token)) {
    throw new ProviderVerificationError("INVALID_TOKEN_FORMAT");
  }

  const payload = await postProviderJson(
    `${ZALO_BOT_API_ORIGIN}/bot${token}/getMe`,
    fetcher,
  );

  if (!isRecord(payload) || payload.ok !== true) {
    throw new ProviderVerificationError("PROVIDER_REJECTED");
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
