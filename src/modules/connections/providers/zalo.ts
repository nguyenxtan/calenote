import type { BotProfile, ProviderRequester } from "../contracts";
import { ProviderVerificationError } from "../provider-error";
import { isSafeProviderToken } from "../token-policy";
import { isRecord, optionalBoolean, providerFailureFromPayload } from "./provider-http";
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
