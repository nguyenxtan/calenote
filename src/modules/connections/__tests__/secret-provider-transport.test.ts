// @vitest-environment node

import { isTracingSuppressed } from "@opentelemetry/core";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { describe, expect, it, vi } from "vitest";
import type { ProviderRequest } from "../contracts";
import { ProviderOperationError, ProviderVerificationError } from "../provider-error";
import {
  createSuppressedProviderContext,
  executeProviderRequest,
  postSecretProviderJson,
  type ProviderRequestExecutor,
} from "../providers/secret-provider-transport";

function serializeError(error: unknown): unknown {
  if (error instanceof Error) {
    return {
      ...error,
      name: error.name,
      message: error.message,
    };
  }

  return error;
}

async function captureTransportFailure(
  input: ProviderRequest,
  executor: ProviderRequestExecutor,
): Promise<{ caught: unknown; serialized: string }> {
  const exporter = new InMemorySpanExporter();
  const tracerProvider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  let caught: unknown;

  try {
    await postSecretProviderJson(
      input,
      executor,
      tracerProvider.getTracer("calenote-transport-failure-test"),
    );
  } catch (error) {
    caught = error;
  }

  await tracerProvider.forceFlush();
  const spans = exporter.getFinishedSpans().map((span) => ({
    name: span.name,
    attributes: span.attributes,
    status: span.status,
    events: span.events,
  }));
  await tracerProvider.shutdown();

  return {
    caught,
    serialized: JSON.stringify({ error: serializeError(caught), spans }),
  };
}

describe("secret-aware provider transport", () => {
  it("uses Worker fetch with a fixed host, POST JSON, redirects disabled, and an absolute deadline", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await expect(executeProviderRequest({ provider: "telegram", hostname: "api.telegram.org", path: "/botredacted/getMe", operation: "getMe" }, fetcher)).resolves.toEqual({ statusCode: 200, body: '{"ok":true}' });
    expect(fetcher).toHaveBeenCalledWith("https://api.telegram.org/botredacted/getMe", expect.objectContaining({ method: "POST", redirect: "error", body: "{}", signal: expect.any(AbortSignal) }));
  });

  it.each(["@attacker.example/x", "//attacker.example/x", "https://attacker.example/x", "relative"]) ("rejects hostile or relative path %s before fetch", async (path) => {
    const fetcher = vi.fn();
    await expect(executeProviderRequest({ provider: "telegram", hostname: "api.telegram.org", path, operation: "getMe" }, fetcher)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("cancels a streamed response that exceeds 64 KiB", async () => {
    let cancelled = false;
    const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(65 * 1024)); }, cancel() { cancelled = true; } });
    await expect(executeProviderRequest({ provider: "zalo", hostname: "bot-api.zaloplatforms.com", path: "/botx/getMe", operation: "getMe" }, async () => new Response(body))).rejects.toThrow();
    expect(cancelled).toBe(true);
  });

  it.each([
    {
      operation: "setWebhook",
      expected: new ProviderOperationError("INVALID_RESPONSE"),
    },
    {
      operation: "sendMessage",
      expected: new ProviderOperationError("INVALID_RESPONSE"),
    },
    {
      operation: "getMe",
      expected: new ProviderVerificationError("PROVIDER_UNAVAILABLE"),
    },
  ] as const)(
    "maps a streamed over-limit $operation response safely and cancels it",
    async ({ operation, expected }) => {
      const token = `stream-limit-token-${operation}`;
      const bodyMarker = `streamed-body-marker-${operation}`;
      const bytes = new TextEncoder().encode(`${bodyMarker}${"x".repeat(65 * 1_024)}`);
      let cancelled = false;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
        },
        cancel() {
          cancelled = true;
        },
      });
      const fetcher = async () => new Response(body, { status: 200 });

      const failure = await captureTransportFailure(
        {
          provider: "telegram",
          hostname: "api.telegram.org",
          path: `/bot${token}/${operation}`,
          operation,
        },
        (input) => executeProviderRequest(input, fetcher as typeof fetch),
      );

      expect(failure.caught).toEqual(expected);
      expect(cancelled).toBe(true);
      expect(failure.serialized).not.toContain(token);
      expect(failure.serialized).not.toContain(bodyMarker);
    },
  );

  it("keeps the local streamed-cap classification when cancellation rejects", async () => {
    const token = "stream-cancel-failure-token";
    const rawDescription = "stream-cancel-failure-description";
    const bodyMarker = "stream-cancel-failure-body-marker";
    const bytes = new TextEncoder().encode(`${bodyMarker}${"x".repeat(65 * 1_024)}`);
    let cancellationAttempted = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
      },
      cancel() {
        cancellationAttempted = true;
        throw new Error(`${rawDescription}:${token}`);
      },
    });
    const fetcher = async () => new Response(body, { status: 200 });

    const failure = await captureTransportFailure(
      {
        provider: "telegram",
        hostname: "api.telegram.org",
        path: `/bot${token}/sendMessage`,
        operation: "sendMessage",
      },
      (input) => executeProviderRequest(input, fetcher as typeof fetch),
    );

    expect(failure.caught).toEqual(
      new ProviderOperationError("INVALID_RESPONSE"),
    );
    expect(cancellationAttempted).toBe(true);
    expect(failure.serialized).not.toContain(token);
    expect(failure.serialized).not.toContain(rawDescription);
    expect(failure.serialized).not.toContain(bodyMarker);
  });

  it.each([
    {
      provider: "zalo",
      hostname: "bot-api.zaloplatforms.com",
      statusCode: 401,
    },
    {
      provider: "telegram",
      hostname: "api.telegram.org",
      statusCode: 401,
    },
    {
      provider: "telegram",
      hostname: "api.telegram.org",
      statusCode: 404,
    },
  ] as const)(
    "maps outbound $provider HTTP $statusCode to a rejected credential without leaking details",
    async ({ provider, hostname, statusCode }) => {
      const token = `rejected-token-${provider}-${statusCode}`;
      const rawDescription = `rejected-description-${provider}-${statusCode}`;
      const bodyMarker = `rejected-body-${provider}-${statusCode}`;
      const failure = await captureTransportFailure(
        {
          provider,
          hostname,
          path: `/bot${token}/sendMessage`,
          operation: "sendMessage",
        },
        async () => ({
          statusCode,
          body: JSON.stringify({
            description: rawDescription,
            marker: bodyMarker,
          }),
        }),
      );

      expect(failure.caught).toEqual(
        new ProviderOperationError("REJECTED_CREDENTIAL"),
      );
      expect(failure.serialized).not.toContain(token);
      expect(failure.serialized).not.toContain(rawDescription);
      expect(failure.serialized).not.toContain(bodyMarker);
    },
  );

  it.each([
    {
      provider: "zalo",
      hostname: "bot-api.zaloplatforms.com",
      statusCode: 404,
    },
    {
      provider: "zalo",
      hostname: "bot-api.zaloplatforms.com",
      statusCode: 500,
    },
    {
      provider: "telegram",
      hostname: "api.telegram.org",
      statusCode: 500,
    },
  ] as const)(
    "maps ordinary outbound $provider HTTP $statusCode to failed without leaking the body",
    async ({ provider, hostname, statusCode }) => {
      const token = `failed-token-${provider}-${statusCode}`;
      const rawDescription = `failed-description-${provider}-${statusCode}`;
      const bodyMarker = `failed-body-${provider}-${statusCode}`;
      const failure = await captureTransportFailure(
        {
          provider,
          hostname,
          path: `/bot${token}/setWebhook`,
          operation: "setWebhook",
        },
        async () => ({
          statusCode,
          body: JSON.stringify({
            description: rawDescription,
            marker: bodyMarker,
          }),
        }),
      );

      expect(failure.caught).toEqual(new ProviderOperationError("FAILED"));
      expect(failure.serialized).not.toContain(token);
      expect(failure.serialized).not.toContain(rawDescription);
      expect(failure.serialized).not.toContain(bodyMarker);
    },
  );

  it.each([
    { retryAfter: 1, expectedRetryAfter: 1 },
    { retryAfter: 23, expectedRetryAfter: 23 },
    { retryAfter: 86_400, expectedRetryAfter: 86_400 },
    { retryAfter: 0, expectedRetryAfter: null },
    { retryAfter: 1.5, expectedRetryAfter: null },
    { retryAfter: 86_401, expectedRetryAfter: null },
    { retryAfter: "23", expectedRetryAfter: null },
  ])(
    "bounds an HTTP 429 retry_after value of $retryAfter",
    async ({ retryAfter, expectedRetryAfter }) => {
      const token = `quota-token-${retryAfter}`;
      const rawDescription = `quota-description-${retryAfter}`;
      const bodyMarker = `quota-body-${retryAfter}`;
      const failure = await captureTransportFailure(
        {
          provider: "telegram",
          hostname: "api.telegram.org",
          path: `/bot${token}/sendMessage`,
          operation: "sendMessage",
        },
        async () => ({
          statusCode: 429,
          body: JSON.stringify({
            description: rawDescription,
            marker: bodyMarker,
            parameters: { retry_after: retryAfter },
          }),
        }),
      );

      expect(failure.caught).toEqual(
        new ProviderOperationError("QUOTA", expectedRetryAfter),
      );
      expect(failure.serialized).not.toContain(token);
      expect(failure.serialized).not.toContain(rawDescription);
      expect(failure.serialized).not.toContain(bodyMarker);
    },
  );

  it.each(["setWebhook", "sendMessage"] as const)(
    "maps malformed top-level JSON for $operation to invalid response without leaking it",
    async (operation) => {
      const token = `malformed-token-${operation}`;
      const rawDescription = `malformed-description-${operation}`;
      const bodyMarker = `malformed-body-${operation}`;
      const failure = await captureTransportFailure(
        {
          provider: "zalo",
          hostname: "bot-api.zaloplatforms.com",
          path: `/bot${token}/${operation}`,
          operation,
        },
        async () => ({
          statusCode: 200,
          body: `{"description":"${rawDescription}","marker":"${bodyMarker}"`,
        }),
      );

      expect(failure.caught).toEqual(
        new ProviderOperationError("INVALID_RESPONSE"),
      );
      expect(failure.serialized).not.toContain(token);
      expect(failure.serialized).not.toContain(rawDescription);
      expect(failure.serialized).not.toContain(bodyMarker);
    },
  );

  it("maps an outbound network failure to uncertain without leaking low-level details", async () => {
    const token = "network-token-unique";
    const rawDescription = "network-description-unique";
    const bodyMarker = "network-body-marker-unique";
    const failure = await captureTransportFailure(
      {
        provider: "telegram",
        hostname: "api.telegram.org",
        path: `/bot${token}/sendMessage`,
        operation: "sendMessage",
      },
      async () => {
        throw new Error(`${rawDescription}:${token}:${bodyMarker}`);
      },
    );

    expect(failure.caught).toEqual(new ProviderOperationError("UNCERTAIN"));
    expect(failure.serialized).not.toContain(token);
    expect(failure.serialized).not.toContain(rawDescription);
    expect(failure.serialized).not.toContain(bodyMarker);
  });

  it.each([
    {
      operation: "setWebhook",
      expected: new ProviderOperationError("INVALID_RESPONSE"),
    },
    {
      operation: "sendMessage",
      expected: new ProviderOperationError("INVALID_RESPONSE"),
    },
    {
      operation: "getMe",
      expected: new ProviderVerificationError("PROVIDER_UNAVAILABLE"),
    },
  ] as const)(
    "maps an injected over-limit $operation response to its safe category",
    async ({ operation, expected }) => {
      const token = `injected-limit-token-${operation}`;
      const bodyMarker = `injected-body-marker-${operation}`;
      const failure = await captureTransportFailure(
        {
          provider: "telegram",
          hostname: "api.telegram.org",
          path: `/bot${token}/${operation}`,
          operation,
        },
        async () => ({
          statusCode: 200,
          body: `${bodyMarker}${"x".repeat(65 * 1_024)}`,
        }),
      );

      expect(failure.caught).toEqual(expected);
      expect(failure.serialized).not.toContain(token);
      expect(failure.serialized).not.toContain(bodyMarker);
    },
  );

  it("returns a safe quota retry delay and operational invalid-response category", async () => {
    await expect(postSecretProviderJson({ provider: "telegram", hostname: "api.telegram.org", path: "/botx/sendMessage", operation: "sendMessage" }, async () => ({ statusCode: 429, body: JSON.stringify({ parameters: { retry_after: 23 }, description: "secret" }) }))).rejects.toEqual(new ProviderOperationError("QUOTA", 23));
    await expect(postSecretProviderJson({ provider: "telegram", hostname: "api.telegram.org", path: "/botx/sendMessage", operation: "sendMessage" }, async () => ({ statusCode: 200, body: "{" }))).rejects.toEqual(new ProviderOperationError("INVALID_RESPONSE"));
  });

  it("observes an injected absolute abort signal and classifies it as uncertain", async () => {
    const token = "abort-token-unique";
    const rawDescription = "abort-description-unique";
    const bodyMarker = "abort-body-marker-unique";
    const controller = new AbortController();
    const fetcher = vi.fn((_url: string, init?: RequestInit) => (
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException(
            `${rawDescription}:${token}:${bodyMarker}`,
            "AbortError",
          )),
          { once: true },
        );
      })
    ));
    const pending = captureTransportFailure(
      {
        provider: "telegram",
        hostname: "api.telegram.org",
        path: `/bot${token}/sendMessage`,
        operation: "sendMessage",
      },
      (input) => executeProviderRequest(
        input,
        fetcher as typeof fetch,
        controller.signal,
      ),
    );

    controller.abort();
    const failure = await pending;

    expect(failure.caught).toEqual(new ProviderOperationError("UNCERTAIN"));
    expect(failure.serialized).not.toContain(token);
    expect(failure.serialized).not.toContain(rawDescription);
    expect(failure.serialized).not.toContain(bodyMarker);
  });

  it("suppresses automatic HTTP tracing and exports only secret-free span metadata", async () => {
    const token = "123456789:AAExample_secret-token_123456789";
    const globalFetch = vi.fn();
    vi.stubGlobal("fetch", globalFetch);
    const exporter = new InMemorySpanExporter();
    const tracerProvider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    const executor = vi.fn(async () => ({
      statusCode: 200,
      body: JSON.stringify({ ok: true, result: { id: 1 } }),
    }));

    const result = await postSecretProviderJson(
      {
        provider: "telegram",
        hostname: "api.telegram.org",
        path: `/bot${token}/getMe`,
        operation: "getMe",
      },
      executor,
      tracerProvider.getTracer("calenote-transport-test"),
    );
    await tracerProvider.forceFlush();

    expect(result).toEqual({ ok: true, result: { id: 1 } });
    expect(globalFetch).not.toHaveBeenCalled();
    expect(isTracingSuppressed(createSuppressedProviderContext())).toBe(true);
    expect(executor).toHaveBeenCalledWith(
      expect.objectContaining({
        hostname: "api.telegram.org",
        path: `/bot${token}/getMe`,
      }),
    );

    const exported = exporter.getFinishedSpans().map((span) => ({
      name: span.name,
      attributes: span.attributes,
      status: span.status,
      events: span.events,
    }));
    expect(exported).toHaveLength(1);
    expect(exported[0]).toMatchObject({
      name: "provider.telegram.getMe",
      attributes: {
        "calenote.provider": "telegram",
        "rpc.method": "getMe",
        "server.address": "api.telegram.org",
      },
    });
    expect(JSON.stringify(exported)).not.toContain(token);
  });

  it("redacts a low-level error that contains the token", async () => {
    const token = "12345678:abc-xyz_789";
    const exporter = new InMemorySpanExporter();
    const tracerProvider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    const executor = vi.fn(async () => {
      throw new Error(`socket failed for /bot${token}/getMe`);
    });

    let caught: unknown;
    try {
      await postSecretProviderJson(
        {
          provider: "zalo",
          hostname: "bot-api.zaloplatforms.com",
          path: `/bot${token}/getMe`,
          operation: "getMe",
        },
        executor,
        tracerProvider.getTracer("calenote-transport-test"),
      );
    } catch (error) {
      caught = error;
    }
    await tracerProvider.forceFlush();

    expect(caught).toEqual(new ProviderVerificationError("PROVIDER_UNAVAILABLE"));
    expect(JSON.stringify(caught)).not.toContain(token);
    const exported = exporter.getFinishedSpans().map((span) => ({
      name: span.name,
      attributes: span.attributes,
      status: span.status,
      events: span.events,
    }));
    expect(JSON.stringify(exported)).not.toContain(token);
  });

  it("classifies a Telegram 404 getMe response as a rejected credential", async () => {
    const executor = vi.fn(async () => ({ statusCode: 404, body: "Not Found" }));

    await expect(
      postSecretProviderJson(
        {
          provider: "telegram",
          hostname: "api.telegram.org",
          path: "/bot123456789:AAExample_secret-token_123456789/getMe",
          operation: "getMe",
        },
        executor,
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_REJECTED" });
  });

  it("classifies a Zalo HTTP 401 response as a rejected credential", async () => {
    const executor = vi.fn(async () => ({ statusCode: 401, body: "{}" }));

    await expect(
      postSecretProviderJson(
        {
          provider: "zalo",
          hostname: "bot-api.zaloplatforms.com",
          path: "/botredacted/getMe",
          operation: "getMe",
        },
        executor,
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_REJECTED" });
  });

  it.each([
    ["zalo", "bot-api.zaloplatforms.com", 403],
    ["zalo", "bot-api.zaloplatforms.com", 429],
    ["zalo", "bot-api.zaloplatforms.com", 500],
    ["telegram", "api.telegram.org", 403],
    ["telegram", "api.telegram.org", 429],
    ["telegram", "api.telegram.org", 500],
  ] as const)("classifies %s HTTP %s as provider unavailable", async (provider, hostname, statusCode) => {
    const executor = vi.fn(async () => ({ statusCode, body: "{}" }));

    await expect(
      postSecretProviderJson(
        { provider, hostname, path: "/botredacted/getMe", operation: "getMe" },
        executor,
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
  });

  it("rejects malformed JSON returned with HTTP 200", async () => {
    const executor = vi.fn(async () => ({ statusCode: 200, body: "<html>oops</html>" }));

    await expect(
      postSecretProviderJson(
        {
          provider: "zalo",
          hostname: "bot-api.zaloplatforms.com",
          path: "/botredacted/getMe",
          operation: "getMe",
        },
        executor,
      ),
    ).rejects.toMatchObject({ code: "INVALID_PROVIDER_RESPONSE" });
  });

  it("rejects a provider response that exceeds the hard byte limit", async () => {
    const executor = vi.fn(async () => ({ statusCode: 200, body: "x".repeat(65 * 1_024) }));

    await expect(
      postSecretProviderJson(
        {
          provider: "telegram",
          hostname: "api.telegram.org",
          path: "/botredacted/getMe",
          operation: "getMe",
        },
        executor,
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
  });
});
