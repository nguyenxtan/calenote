import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const telegramToken = "123456789:AAExample_secret-token_123456789";

function request(body: unknown, headers?: HeadersInit) {
  return new Request("http://localhost/api/v1/bot-connections/verify", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/v1/bot-connections/verify", () => {
  it("returns a normalized bot identity without retaining or echoing the token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            ok: true,
            result: {
              id: 987654321,
              is_bot: true,
              first_name: "Thư ký Mây",
              username: "may_calendar_bot",
              can_join_groups: true,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    const response = await POST(request({ provider: "telegram", token: telegramToken }));
    const raw = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(JSON.parse(raw)).toEqual({
      data: {
        bot: {
          provider: "telegram",
          providerBotId: "987654321",
          displayName: "Thư ký Mây",
          handle: "@may_calendar_bot",
          accountType: null,
          canJoinGroups: true,
        },
      },
      meta: { tokenStored: false },
    });
    expect(raw).not.toContain(telegramToken);
  });

  it("rejects unsupported providers before calling the network", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);

    const response = await POST(request({ provider: "zalo-oa", token: telegramToken }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "INVALID_REQUEST",
        message: "Thông tin kết nối chưa đúng. Hãy kiểm tra lại kênh và token.",
      },
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns a safe error when the provider rejects a token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ ok: false, error_code: 401, description: `bad ${telegramToken}` }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    const response = await POST(request({ provider: "telegram", token: telegramToken }));
    const raw = await response.text();

    expect(response.status).toBe(422);
    expect(JSON.parse(raw)).toEqual({
      error: {
        code: "BOT_TOKEN_REJECTED",
        message: "Provider không chấp nhận token này. Hãy tạo hoặc sao chép lại token rồi thử lại.",
      },
    });
    expect(raw).not.toContain(telegramToken);
  });

  it("rejects malformed JSON", async () => {
    const response = await POST(request("{not-json"));

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_REQUEST");
  });

  it("rejects an oversized body before parsing it", async () => {
    const response = await POST(
      request({ provider: "telegram", token: telegramToken }, { "content-length": "4096" }),
    );

    expect(response.status).toBe(413);
    expect((await response.json()).error.code).toBe("REQUEST_TOO_LARGE");
  });
});
