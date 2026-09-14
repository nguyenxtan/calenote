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

export interface ProviderTransportDiagnosticEvent {
  provider: BotProvider;
  operation: ProviderRequest["operation"];
  hostname: ProviderRequest["hostname"];
  elapsed_ms: number;
  upstream_http_status: number | null;
  response_received: boolean;
  response_parse_reached: boolean;
  timeout: boolean;
  abort: boolean;
  safe_exception_name: "AbortError" | "Error" | "ProviderOperationError" | "ProviderResponseLimitError" | "ProviderVerificationError" | "TimeoutError" | null;
  safe_failure_category: "ABORT" | "FETCH_EXCEPTION" | "RESPONSE_LIMIT" | "RESPONSE_PARSE_FAILURE" | "TIMEOUT" | "UPSTREAM_HTTP_FAILURE" | null;
}

export type ProviderTransportDiagnosticLogger = (event: ProviderTransportDiagnosticEvent) => void;

function defaultProviderTransportDiagnosticLogger(event: ProviderTransportDiagnosticEvent): void {
  if (event.provider === "zalo" && event.operation === "getMe") {
    console.log(JSON.stringify(event));
  }
}

function safeExceptionName(error: unknown): ProviderTransportDiagnosticEvent["safe_exception_name"] {
  if (error instanceof ProviderResponseLimitError) return "ProviderResponseLimitError";
  if (error instanceof ProviderVerificationError) return "ProviderVerificationError";
  if (error instanceof ProviderOperationError) return "ProviderOperationError";
  if (!(error instanceof Error)) return null;
  if (error.name === "TimeoutError") return "TimeoutError";
  if (error.name === "AbortError") return "AbortError";
  return "Error";
}

function failureCategory(error: unknown): NonNullable<ProviderTransportDiagnosticEvent["safe_failure_category"]> {
  if (error instanceof ProviderResponseLimitError) return "RESPONSE_LIMIT";
  if (error instanceof Error && error.name === "TimeoutError") return "TIMEOUT";
  if (error instanceof Error && error.name === "AbortError") return "ABORT";
  return "FETCH_EXCEPTION";
}

function emitDiagnostic(
  logger: ProviderTransportDiagnosticLogger,
  event: ProviderTransportDiagnosticEvent,
): void {
  try {
    logger(event);
  } catch {
    // Diagnostics never alter provider request behavior.
  }
}

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
  diagnosticLogger: ProviderTransportDiagnosticLogger = defaultProviderTransportDiagnosticLogger,
): Promise<unknown> {
  if (input.hostname !== allowedHostname[input.provider]) {
    throw new ProviderVerificationError("PROVIDER_UNAVAILABLE");
  }

  const startedAt = performance.now();
  let upstreamHttpStatus: number | null = null;
  let responseReceived = false;
  let responseParseReached = false;
  let timeout = false;
  let abort = false;
  let exceptionName: ProviderTransportDiagnosticEvent["safe_exception_name"] = null;
  let failure: ProviderTransportDiagnosticEvent["safe_failure_category"] = null;

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
        responseReceived = true;
        upstreamHttpStatus = response.statusCode;
        span.setAttribute("http.response.status_code", response.statusCode);

        const responseBytes = new TextEncoder().encode(response.body).byteLength;
        if (responseBytes > MAX_RESPONSE_BYTES) {
          failure = "RESPONSE_LIMIT";
          throw responseLimitFailure(input);
        }

        if (response.statusCode < 200 || response.statusCode >= 300) {
          failure = "UPSTREAM_HTTP_FAILURE";
          throw safeOperationFailure(input, response);
        }

        try {
          responseParseReached = true;
          const payload: unknown = JSON.parse(response.body);
          span.setStatus({ code: SpanStatusCode.OK });
          return payload;
        } catch {
          failure = "RESPONSE_PARSE_FAILURE";
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
        exceptionName = safeExceptionName(error);
        if (failure === null) {
          failure = failureCategory(error);
        }
        timeout = failure === "TIMEOUT";
        abort = failure === "ABORT";
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
        emitDiagnostic(diagnosticLogger, {
          provider: input.provider,
          operation: input.operation,
          hostname: input.hostname,
          elapsed_ms: Math.max(0, Math.round(performance.now() - startedAt)),
          upstream_http_status: upstreamHttpStatus,
          response_received: responseReceived,
          response_parse_reached: responseParseReached,
          timeout,
          abort,
          safe_exception_name: exceptionName,
          safe_failure_category: failure,
        });
        span.end();
      }
    },
  );
}
