export type ProviderVerificationErrorCode =
  | "INVALID_TOKEN_FORMAT"
  | "PROVIDER_REJECTED"
  | "PROVIDER_UNAVAILABLE"
  | "INVALID_PROVIDER_RESPONSE";

export class ProviderVerificationError extends Error {
  readonly code: ProviderVerificationErrorCode;

  constructor(code: ProviderVerificationErrorCode) {
    super(code);
    this.name = "ProviderVerificationError";
    this.code = code;
  }
}
