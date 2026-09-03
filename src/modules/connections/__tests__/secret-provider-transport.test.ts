// @vitest-environment node

import { isTracingSuppressed } from "@opentelemetry/core";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { describe, expect, it, vi } from "vitest";
import { ProviderVerificationError } from "../provider-error";
import { ProviderOperationError } from "../provider-error";
import {
  createSuppressedProviderContext,
  executeProviderRequest,
  postSecretProviderJson,
} from "../providers/secret-provider-transport";

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

  it("returns a safe quota retry delay and operational invalid-response category", async () => {
    await expect(postSecretProviderJson({ provider: "telegram", hostname: "api.telegram.org", path: "/botx/sendMessage", operation: "sendMessage" }, async () => ({ statusCode: 429, body: JSON.stringify({ parameters: { retry_after: 23 }, description: "secret" }) }))).rejects.toEqual(new ProviderOperationError("QUOTA", 23));
    await expect(postSecretProviderJson({ provider: "telegram", hostname: "api.telegram.org", path: "/botx/sendMessage", operation: "sendMessage" }, async () => ({ statusCode: 200, body: "{" }))).rejects.toEqual(new ProviderOperationError("INVALID_RESPONSE"));
  });

  it("observes an injected absolute abort signal and classifies it as uncertain", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true })));
    const pending = postSecretProviderJson({ provider: "telegram", hostname: "api.telegram.org", path: "/botx/sendMessage", operation: "sendMessage" }, (input) => executeProviderRequest(input, fetcher as typeof fetch, controller.signal));
    controller.abort();
    await expect(pending).rejects.toEqual(new ProviderOperationError("UNCERTAIN"));
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
