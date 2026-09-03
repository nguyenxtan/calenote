import {
  context,
  SpanKind,
  SpanStatusCode,
  trace,
  type Context,
  type Tracer,
} from "@opentelemetry/api";
import { suppressTracing } from "@opentelemetry/core";
import type { BotProvider, ProviderRequest } from "../contracts";
import { ProviderOperationError, ProviderVerificationError } from "../provider-error";
import { providerFailureFromHttpStatus } from "./provider-http";

const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 64 * 1_024;

const allowedHostname: Record<BotProvider, ProviderRequest["hostname"]> = {
  zalo: "bot-api.zaloplatforms.com",
  telegram: "api.telegram.org",
};

function operationFailure(input: ProviderRequest, statusCode: number): Error {
  if (input.operation === "getMe") return providerFailureFromHttpStatus(input.provider, statusCode);
  const rejected = input.provider === "zalo" ? statusCode === 401 : statusCode === 401 || statusCode === 404;
  return new ProviderOperationError(rejected ? "REJECTED_CREDENTIAL" : statusCode === 429 ? "QUOTA" : "FAILED");
}

function safeOperationFailure(input: ProviderRequest, response: RawProviderResponse): Error {
  const error = operationFailure(input, response.statusCode);
  if (!(error instanceof ProviderOperationError) || error.code !== "QUOTA") return error;
  try {
    const payload: unknown = JSON.parse(response.body);
    const retryAfter = typeof payload === "object" && payload !== null && "parameters" in payload
      && typeof payload.parameters === "object" && payload.parameters !== null && "retry_after" in payload.parameters
      && typeof payload.parameters.retry_after === "number" && Number.isInteger(payload.parameters.retry_after)
      && payload.parameters.retry_after >= 1 && payload.parameters.retry_after <= 86_400 ? payload.parameters.retry_after : null;
    return new ProviderOperationError("QUOTA", retryAfter);
  } catch { return error; }
}

export interface RawProviderResponse {
  statusCode: number;
  body: string;
}

export type ProviderRequestExecutor = (
  input: ProviderRequest,
) => Promise<RawProviderResponse>;

export function createSuppressedProviderContext(): Context {
  return suppressTracing(context.active());
}

export async function executeProviderRequest(
  input: ProviderRequest,
  fetcher: typeof fetch = fetch,
  signal: AbortSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS),
): Promise<RawProviderResponse> {
  if (input.hostname !== allowedHostname[input.provider]) throw new ProviderVerificationError("PROVIDER_UNAVAILABLE");
  if (!input.path.startsWith("/")) throw new ProviderVerificationError("PROVIDER_UNAVAILABLE");
  const base = new URL(`https://${input.hostname}`);
  const url = new URL(input.path, base);
  if (url.protocol !== "https:" || url.hostname !== input.hostname || url.port !== "" || url.origin !== base.origin) throw new ProviderVerificationError("PROVIDER_UNAVAILABLE");
  const response = await fetcher(url.toString(), {
    method: "POST", redirect: "error", signal,
    headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify(input.body ?? {}),
  });
  const reader = response.body?.getReader();
  if (!reader) return { statusCode: response.status, body: "" };
  const chunks: Uint8Array[] = []; let bytes = 0;
  try { for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new Error("response-limit"); } chunks.push(part.value); } }
  finally { reader.releaseLock(); }
  const all = new Uint8Array(bytes); let offset = 0; for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.byteLength; }
  return { statusCode: response.status, body: new TextDecoder().decode(all) };
}

export async function postSecretProviderJson(
  input: ProviderRequest,
  executor: ProviderRequestExecutor = executeProviderRequest,
  tracer: Tracer = trace.getTracer("calenote.provider-transport"),
): Promise<unknown> {
  if (input.hostname !== allowedHostname[input.provider]) {
    throw new ProviderVerificationError("PROVIDER_UNAVAILABLE");
  }

  return tracer.startActiveSpan(
    `provider.${input.provider}.${input.operation}`,
    {
      kind: SpanKind.CLIENT,
      attributes: {
        "calenote.provider": input.provider,
        "rpc.method": input.operation,
        "server.address": input.hostname,
        "http.request.method": "POST",
      },
    },
    async (span) => {
      try {
        const response = await context.with(
          createSuppressedProviderContext(),
          () => executor(input),
        );
        span.setAttribute("http.response.status_code", response.statusCode);

        if (new TextEncoder().encode(response.body).byteLength > MAX_RESPONSE_BYTES) {
          throw new ProviderVerificationError("PROVIDER_UNAVAILABLE");
        }

        if (response.statusCode < 200 || response.statusCode >= 300) {
          throw safeOperationFailure(input, response);
        }

        try {
          const payload: unknown = JSON.parse(response.body);
          span.setStatus({ code: SpanStatusCode.OK });
          return payload;
        } catch {
          throw input.operation === "getMe"
            ? new ProviderVerificationError("INVALID_PROVIDER_RESPONSE")
            : new ProviderOperationError("INVALID_RESPONSE");
        }
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: "Provider request failed",
        });
        if (error instanceof ProviderVerificationError || error instanceof ProviderOperationError) throw error;
        if (input.operation !== "getMe") throw new ProviderOperationError("UNCERTAIN");
        throw new ProviderVerificationError("PROVIDER_UNAVAILABLE");
      } finally {
        span.end();
      }
    },
  );
}
