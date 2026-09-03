import { describe, expect, it } from "vitest";
import { RequestBodyError, readBoundedJson } from "./body";
import { SameOriginError, jsonResponse, requireSameOrigin } from "./security";

describe("readBoundedJson", () => {
  it("accepts application/json parameters and returns only object payloads", async () => {
    const request = new Request("https://calenote.iconiclogs.com/api/example", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ value: 1 }),
    });

    await expect(readBoundedJson(request, 64)).resolves.toEqual({ value: 1 });
  });

  it.each([
    { body: "null", label: "null" },
    { body: "[]", label: "an array" },
    { body: "1", label: "a primitive" },
  ])("rejects $label JSON", async ({ body }) => {
    const request = new Request("https://calenote.iconiclogs.com/api/example", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });

    await expect(readBoundedJson(request, 64)).rejects.toMatchObject({
      code: "INVALID_JSON_OBJECT",
      status: 400,
    } satisfies Partial<RequestBodyError>);
  });

  it("rejects a non-JSON media type", async () => {
    const request = new Request("https://calenote.iconiclogs.com/api/example", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    });

    await expect(readBoundedJson(request, 64)).rejects.toMatchObject({
      code: "UNSUPPORTED_MEDIA_TYPE",
      status: 415,
    } satisfies Partial<RequestBodyError>);
  });

  it.each(["-1", "1.5", "NaN", "1, 2"])("rejects invalid Content-Length %s", async (value) => {
    const request = new Request("https://calenote.iconiclogs.com/api/example", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": value },
      body: "{}",
    });

    await expect(readBoundedJson(request, 64)).rejects.toMatchObject({
      code: "INVALID_CONTENT_LENGTH",
      status: 400,
    } satisfies Partial<RequestBodyError>);
  });

  it("pre-rejects an oversized declared body", async () => {
    const request = new Request("https://calenote.iconiclogs.com/api/example", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "65" },
      body: "{}",
    });

    await expect(readBoundedJson(request, 64)).rejects.toMatchObject({
      code: "REQUEST_TOO_LARGE",
      status: 413,
    } satisfies Partial<RequestBodyError>);
  });

  it("cancels a streamed body as soon as it crosses the cap", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(65));
      },
      cancel() {
        cancelled = true;
      },
    });
    const request = new Request("https://calenote.iconiclogs.com/api/example", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      // Node's Request implementation requires this for streaming request bodies.
      duplex: "half",
    } as RequestInit);

    await expect(readBoundedJson(request, 64)).rejects.toMatchObject({
      code: "REQUEST_TOO_LARGE",
      status: 413,
    } satisfies Partial<RequestBodyError>);
    expect(cancelled).toBe(true);
  });

  it("rejects malformed UTF-8 before parsing JSON", async () => {
    const request = new Request("https://calenote.iconiclogs.com/api/example", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: Uint8Array.from([0xc3, 0x28]),
    });

    await expect(readBoundedJson(request, 64)).rejects.toMatchObject({
      code: "INVALID_UTF8",
      status: 400,
    } satisfies Partial<RequestBodyError>);
  });
});

describe("browser request security", () => {
  it("accepts only an Origin whose parsed origin exactly matches APP_ORIGIN", () => {
    const request = new Request("https://calenote.iconiclogs.com/api/example", {
      headers: { origin: "https://calenote.iconiclogs.com" },
    });

    expect(requireSameOrigin(request, "https://calenote.iconiclogs.com")).toBeUndefined();
  });

  it.each([
    { label: "missing", headers: {} },
    { label: "null", headers: { origin: "null" } },
    { label: "malformed", headers: { origin: "://" } },
    { label: "path-bearing", headers: { origin: "https://calenote.iconiclogs.com/not-an-origin" } },
    { label: "multiple", headers: { origin: "https://calenote.iconiclogs.com, https://evil.example" } },
    { label: "mismatched", headers: { origin: "https://evil.example" } },
  ])("rejects a $label Origin without Host or Referer fallback", ({ headers }) => {
    const requestHeaders = new Headers({
      referer: "https://calenote.iconiclogs.com/",
      host: "calenote.iconiclogs.com",
    });
    if ("origin" in headers && headers.origin) requestHeaders.set("origin", headers.origin);
    const request = new Request("https://calenote.iconiclogs.com/api/example", {
      headers: requestHeaders,
    });

    expect(() => requireSameOrigin(request, "https://calenote.iconiclogs.com")).toThrowError(
      expect.objectContaining({ code: "ORIGIN_REJECTED", status: 403 } satisfies Partial<SameOriginError>),
    );
  });

  it("emits hardened JSON headers and a safe fallback when serialization fails", async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const response = jsonResponse(circular, { status: 201, headers: { "x-extra": "kept" } });

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-extra")).toBe("kept");
    await expect(response.json()).resolves.toEqual({
      error: { code: "RESPONSE_SERIALIZATION_FAILED", message: "Unable to serialize response." },
    });
  });
});
