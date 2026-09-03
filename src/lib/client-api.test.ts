import { describe, expect, it, vi } from "vitest";
import {
  AmbiguousMutationError,
  ApiResponseError,
  apiRequest,
} from "./client-api";

function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("apiRequest", () => {
  it("uses a same-origin no-store credentialed request and unwraps data", async () => {
    const fetcher = vi.fn(async () => json({ data: { accepted: true } }, 202));
    vi.stubGlobal("fetch", fetcher);

    await expect(apiRequest<{ accepted: true }>("/api/auth/request-code", {
      method: "POST",
      body: { email: "owner@example.com" },
    })).resolves.toEqual({ accepted: true });

    expect(fetcher).toHaveBeenCalledWith("/api/auth/request-code", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({ email: "owner@example.com" }),
      signal: undefined,
    });
  });

  it.each([
    "https://evil.example/api/session",
    "//evil.example/api/session",
    "/docs",
    "/api/session?code=secret",
    "/api/session#secret",
  ])("rejects the non-canonical API path %s before fetch", async (path) => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);

    await expect(apiRequest(path)).rejects.toThrow("Đường dẫn API không hợp lệ");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("runs centralized unauthorized erasure before exposing an authenticated 401", async () => {
    const events: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async () => json({
      error: { code: "UNAUTHENTICATED", message: "Bạn cần đăng nhập để tiếp tục." },
    }, 401)));

    const request = apiRequest("/api/session", {
      authenticated: true,
      onUnauthorized: () => { events.push("erased"); },
    }).catch((error: unknown) => {
      events.push("rejected");
      throw error;
    });

    await expect(request).rejects.toMatchObject({
      name: "ApiResponseError",
      status: 401,
      code: "UNAUTHENTICATED",
    });
    expect(events).toEqual(["erased", "rejected"]);
  });

  it("keeps a public login-code 401 in the form instead of treating it as session expiry", async () => {
    const onUnauthorized = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => json({
      error: {
        code: "INVALID_LOGIN_CODE",
        message: "Mã đăng nhập không hợp lệ hoặc đã hết hạn.",
      },
    }, 401)));

    await expect(apiRequest("/api/auth/verify-code", {
      method: "POST",
      body: { email: "owner@example.com", code: "123456" },
      onUnauthorized,
    })).rejects.toMatchObject({ code: "INVALID_LOGIN_CODE", status: 401 });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("rejects oversized and malformed JSON responses without reflecting their body", async () => {
    const oversized = "x".repeat(131_073);
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(oversized, {
        headers: { "content-type": "application/json", "content-length": "131073" },
      }))
      .mockResolvedValueOnce(new Response("not-json", {
        headers: { "content-type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetcher);

    await expect(apiRequest("/api/session")).rejects.toMatchObject({
      name: "ApiResponseError",
      code: "INVALID_RESPONSE",
    });
    await expect(apiRequest("/api/session")).rejects.toMatchObject({
      name: "ApiResponseError",
      code: "INVALID_RESPONSE",
    });
  });

  it("classifies an unsettled mutation as ambiguous and never retries it", async () => {
    const fetcher = vi.fn(async () => { throw new TypeError("connection reset"); });
    vi.stubGlobal("fetch", fetcher);

    await expect(apiRequest("/api/reminders", {
      method: "POST",
      body: { title: "Gọi cho mẹ" },
    })).rejects.toBeInstanceOf(AmbiguousMutationError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("treats an unreadable successful mutation response as ambiguous", async () => {
    const fetcher = vi.fn(async () => new Response("truncated", {
      status: 201,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetcher);

    await expect(apiRequest("/api/reminders", {
      method: "POST",
      body: { title: "Có thể đã được lưu" },
    })).rejects.toBeInstanceOf(AmbiguousMutationError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("preserves aborts and forwards the caller signal", async () => {
    const controller = new AbortController();
    controller.abort();
    const aborted = new DOMException("Aborted", "AbortError");
    const fetcher = vi.fn(async () => { throw aborted; });
    vi.stubGlobal("fetch", fetcher);

    await expect(apiRequest("/api/onboarding", {
      method: "POST",
      body: {},
      signal: controller.signal,
    })).rejects.toBe(aborted);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/onboarding",
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it("uses a safe fallback when an error envelope is malformed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: { detail: "secret body" } }, 500)));

    try {
      await apiRequest("/api/session");
      throw new Error("Expected request to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiResponseError);
      expect((error as Error).message).toBe("Calenote chưa thể hoàn tất yêu cầu.");
      expect((error as Error).message).not.toContain("secret body");
    }
  });
});
