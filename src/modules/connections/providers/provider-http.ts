import type { BotProvider } from "../contracts";
import { ProviderOperationError, ProviderVerificationError } from "../provider-error";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function optionalBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function providerFailureFromPayload(
  provider: BotProvider,
  payload: Record<string, unknown>,
): ProviderVerificationError {
  const code = typeof payload.error_code === "number" ? payload.error_code : null;
  const rejectedCredential =
    provider === "zalo" ? code === 401 : code === 401 || code === 404;

  return new ProviderVerificationError(
    rejectedCredential ? "PROVIDER_REJECTED" : "PROVIDER_UNAVAILABLE",
  );
}

export function providerFailureFromHttpStatus(
  provider: BotProvider,
  statusCode: number,
): ProviderVerificationError {
  const rejectedCredential =
    provider === "zalo"
      ? statusCode === 401
      : statusCode === 401 || statusCode === 404;

  return new ProviderVerificationError(
    rejectedCredential ? "PROVIDER_REJECTED" : "PROVIDER_UNAVAILABLE",
  );
}

export function providerOperationFailureFromPayload(
  provider: BotProvider,
  payload: Record<string, unknown>,
): ProviderOperationError {
  const code = typeof payload.error_code === "number" ? payload.error_code : 0;
  const rejected = provider === "zalo" ? code === 401 : code === 401 || code === 404;
  const retryAfter = isRecord(payload.parameters) && typeof payload.parameters.retry_after === "number"
    && Number.isInteger(payload.parameters.retry_after) && payload.parameters.retry_after >= 1 && payload.parameters.retry_after <= 86_400
    ? payload.parameters.retry_after : null;
  return new ProviderOperationError(rejected ? "REJECTED_CREDENTIAL" : code === 429 ? "QUOTA" : "FAILED", retryAfter);
}
