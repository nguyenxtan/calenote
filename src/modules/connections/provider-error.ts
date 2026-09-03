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

export type ProviderOperationErrorCode =
  | "REJECTED_CREDENTIAL"
  | "QUOTA"
  | "UNCERTAIN"
  | "FAILED"
  | "INVALID_RESPONSE";

export class ProviderOperationError extends Error {
  readonly code: ProviderOperationErrorCode;
  readonly retryAfterSeconds: number | null;

  constructor(code: ProviderOperationErrorCode, retryAfterSeconds: number | null = null) {
    super(code);
    this.name = "ProviderOperationError";
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
