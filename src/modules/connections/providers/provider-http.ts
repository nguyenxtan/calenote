import type { ProviderFetch } from "../contracts";
import { ProviderVerificationError } from "../provider-error";

export async function postProviderJson(
  url: string,
  fetcher: ProviderFetch,
): Promise<unknown> {
  let response: Response;

  try {
    response = await fetcher(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: "{}",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
    });
  } catch (error) {
    if (error instanceof ProviderVerificationError) {
      throw error;
    }
    throw new ProviderVerificationError("PROVIDER_UNAVAILABLE");
  }

  if (!response.ok) {
    throw new ProviderVerificationError(
      response.status === 401 || response.status === 403
        ? "PROVIDER_REJECTED"
        : "PROVIDER_UNAVAILABLE",
    );
  }

  try {
    return await response.json();
  } catch {
    throw new ProviderVerificationError("INVALID_PROVIDER_RESPONSE");
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function optionalBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}
