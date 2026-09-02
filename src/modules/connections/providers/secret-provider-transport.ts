import { request as httpsRequest } from "node:https";
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
import { ProviderVerificationError } from "../provider-error";
import { providerFailureFromHttpStatus } from "./provider-http";

const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 64 * 1_024;

const allowedHostname: Record<BotProvider, ProviderRequest["hostname"]> = {
  zalo: "bot-api.zaloplatforms.com",
  telegram: "api.telegram.org",
};

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

export async function executeHttpsProviderRequest(
  input: ProviderRequest,
): Promise<RawProviderResponse> {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      {
        protocol: "https:",
        hostname: input.hostname,
        port: 443,
        path: input.path,
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "content-length": "2",
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let byteLength = 0;

        response.on("data", (chunk: Buffer | Uint8Array | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          byteLength += buffer.byteLength;
          if (byteLength > MAX_RESPONSE_BYTES) {
            response.destroy(new Error("provider response exceeded limit"));
            return;
          }
          chunks.push(buffer);
        });
        response.on("end", () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
        response.on("error", reject);
      },
    );

    request.on("timeout", () => request.destroy(new Error("provider request timed out")));
    request.on("error", reject);
    request.end("{}");
  });
}

export async function postSecretProviderJson(
  input: ProviderRequest,
  executor: ProviderRequestExecutor = executeHttpsProviderRequest,
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

        if (Buffer.byteLength(response.body, "utf8") > MAX_RESPONSE_BYTES) {
          throw new ProviderVerificationError("PROVIDER_UNAVAILABLE");
        }

        if (response.statusCode < 200 || response.statusCode >= 300) {
          throw providerFailureFromHttpStatus(input.provider, response.statusCode);
        }

        try {
          const payload: unknown = JSON.parse(response.body);
          span.setStatus({ code: SpanStatusCode.OK });
          return payload;
        } catch {
          throw new ProviderVerificationError("INVALID_PROVIDER_RESPONSE");
        }
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: "Provider request failed",
        });
        if (error instanceof ProviderVerificationError) throw error;
        throw new ProviderVerificationError("PROVIDER_UNAVAILABLE");
      } finally {
        span.end();
      }
    },
  );
}
