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

class ProviderResponseLimitError extends Error {
  constructor() {
    super("Provider response exceeded the local byte limit");
    this.name = "ProviderResponseLimitError";
  }
}

const allowedHostname: Record<BotProvider, ProviderRequest["hostname"]> = {
  zalo: "bot-api.zaloplatforms.com",
  telegram: "api.telegram.org",
};

function operationFailure(input: ProviderRequest, statusCode: number): Error {
  if (input.operation === "getMe") {
    return providerFailureFromHttpStatus(input.provider, statusCode);
  }

  const rejected = input.provider === "zalo"
    ? statusCode === 401
    : statusCode === 401 || statusCode === 404;

  if (rejected) {
    return new ProviderOperationError("REJECTED_CREDENTIAL");
  }

  if (statusCode === 429) {
    return new ProviderOperationError("QUOTA");
  }

  return new ProviderOperationError("FAILED");
}

function safeOperationFailure(input: ProviderRequest, response: RawProviderResponse): Error {
  const error = operationFailure(input, response.statusCode);
  if (!(error instanceof ProviderOperationError)) {
    return error;
  }

  if (error.code !== "QUOTA") {
    return error;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(response.body);
  } catch {
    return error;
  }

  if (typeof payload !== "object" || payload === null) {
    return new ProviderOperationError("QUOTA");
  }

  if (!("parameters" in payload)) {
    return new ProviderOperationError("QUOTA");
  }

  const parameters = payload.parameters;
  if (typeof parameters !== "object" || parameters === null) {
    return new ProviderOperationError("QUOTA");
  }

  if (!("retry_after" in parameters)) {
    return new ProviderOperationError("QUOTA");
  }

  const retryAfter = parameters.retry_after;
  if (typeof retryAfter !== "number") {
    return new ProviderOperationError("QUOTA");
  }

  if (!Number.isInteger(retryAfter)) {
    return new ProviderOperationError("QUOTA");
  }

  if (retryAfter < 1 || retryAfter > 86_400) {
    return new ProviderOperationError("QUOTA");
  }

  return new ProviderOperationError("QUOTA", retryAfter);
}

function responseLimitFailure(input: ProviderRequest): Error {
  if (input.operation === "getMe") {
    return new ProviderVerificationError("PROVIDER_UNAVAILABLE");
  }

  return new ProviderOperationError("INVALID_RESPONSE");
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
  if (input.hostname !== allowedHostname[input.provider]) {
    throw new ProviderVerificationError("PROVIDER_UNAVAILABLE");
  }

  if (!input.path.startsWith("/")) {
    throw new ProviderVerificationError("PROVIDER_UNAVAILABLE");
  }

  const base = new URL(`https://${input.hostname}`);
  const url = new URL(input.path, base);

  if (url.protocol !== "https:") {
    throw new ProviderVerificationError("PROVIDER_UNAVAILABLE");
  }

  if (url.hostname !== input.hostname) {
    throw new ProviderVerificationError("PROVIDER_UNAVAILABLE");
  }

  if (url.port !== "") {
    throw new ProviderVerificationError("PROVIDER_UNAVAILABLE");
  }

  if (url.origin !== base.origin) {
    throw new ProviderVerificationError("PROVIDER_UNAVAILABLE");
  }

  const response = await fetcher(url.toString(), {
    method: "POST",
    redirect: "error",
    signal,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(input.body ?? {}),
  });
  const reader = response.body?.getReader();

  if (!reader) {
    return {
      statusCode: response.status,
      body: "",
    };
  }

  const chunks: Uint8Array[] = [];
  let bytes = 0;

  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) {
        break;
      }

      bytes += part.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        chunks.length = 0;

        try {
          await reader.cancel();
        } catch {
          // The locally detected limit remains authoritative if cancellation fails.
        }
        throw new ProviderResponseLimitError();
      }

      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }

  const all = new Uint8Array(bytes);
  let offset = 0;

  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return {
    statusCode: response.status,
    body: new TextDecoder().decode(all),
  };
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

        const responseBytes = new TextEncoder().encode(response.body).byteLength;
        if (responseBytes > MAX_RESPONSE_BYTES) {
          throw responseLimitFailure(input);
        }

        if (response.statusCode < 200 || response.statusCode >= 300) {
          throw safeOperationFailure(input, response);
        }

        try {
          const payload: unknown = JSON.parse(response.body);
          span.setStatus({ code: SpanStatusCode.OK });
          return payload;
        } catch {
          if (input.operation === "getMe") {
            throw new ProviderVerificationError("INVALID_PROVIDER_RESPONSE");
          }

          throw new ProviderOperationError("INVALID_RESPONSE");
        }
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: "Provider request failed",
        });
        if (error instanceof ProviderResponseLimitError) {
          throw responseLimitFailure(input);
        }

        if (error instanceof ProviderVerificationError) {
          throw error;
        }

        if (error instanceof ProviderOperationError) {
          throw error;
        }

        if (input.operation !== "getMe") {
          throw new ProviderOperationError("UNCERTAIN");
        }

        throw new ProviderVerificationError("PROVIDER_UNAVAILABLE");
      } finally {
        span.end();
      }
    },
  );
}
