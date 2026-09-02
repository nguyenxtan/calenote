import { describe, expect, it, vi } from "vitest";
import { ProviderVerificationError } from "@/modules/connections/provider-error";
import { createVerifyRoute } from "./route";

const telegramToken = "123456789:AAExample_secret-token_123456789";
const telegramBot = {
  provider: "telegram" as const,
  providerBotId: "987654321",
  displayName: "Thư ký Mây",
  handle: "@may_calendar_bot",
  accountType: null,
  canJoinGroups: true,
};

function request(body: unknown, headers?: HeadersInit) {
  return new Request("http://localhost/api/v1/bot-connections/verify", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/v1/bot-connections/verify", () => {
  it("returns a normalized bot identity without retaining or echoing the token", async () => {
    const verifier = vi.fn(async () => telegramBot);
    const post = createVerifyRoute(verifier);

    const response = await post(request({ provider: "telegram", token: telegramToken }));
    const raw = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(JSON.parse(raw)).toEqual({ data: { bot: telegramBot }, meta: { tokenStored: false } });
    expect(verifier).toHaveBeenCalledWith("telegram", telegramToken);
    expect(raw).not.toContain(telegramToken);
  });

  it("rejects unsupported providers before calling the verifier", async () => {
    const verifier = vi.fn();
    const post = createVerifyRoute(verifier);

    const response = await post(request({ provider: "zalo-oa", token: telegramToken }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "INVALID_REQUEST",
        message: "Thông tin kết nối chưa đúng. Hãy kiểm tra lại kênh và token.",
      },
    });
    expect(verifier).not.toHaveBeenCalled();
  });

  it("returns a safe error when the provider rejects a token", async () => {
    const verifier = vi.fn(async () => {
      throw new ProviderVerificationError("PROVIDER_REJECTED");
    });
    const post = createVerifyRoute(verifier);

    const response = await post(request({ provider: "telegram", token: telegramToken }));
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

  it("asks for a retry when the provider is temporarily unavailable", async () => {
    const verifier = vi.fn(async () => {
      throw new ProviderVerificationError("PROVIDER_UNAVAILABLE");
    });
    const response = await createVerifyRoute(verifier)(
      request({ provider: "telegram", token: telegramToken }),
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: {
        code: "PROVIDER_UNAVAILABLE",
        message: "Chưa liên hệ được provider. Hãy đợi một chút rồi thử lại.",
      },
    });
  });

  it("rejects malformed JSON", async () => {
    const verifier = vi.fn();
    const response = await createVerifyRoute(verifier)(request("{not-json"));

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_REQUEST");
    expect(verifier).not.toHaveBeenCalled();
  });

  it("rejects an oversized declared body before parsing it", async () => {
    const verifier = vi.fn();
    const response = await createVerifyRoute(verifier)(
      request({ provider: "telegram", token: telegramToken }, { "content-length": "4096" }),
    );

    expect(response.status).toBe(413);
    expect((await response.json()).error.code).toBe("REQUEST_TOO_LARGE");
    expect(verifier).not.toHaveBeenCalled();
  });

  it("cancels an undeclared oversized stream before reading the remaining body", async () => {
    let pulls = 0;
    let canceled = false;
    const verifier = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls <= 2) {
          controller.enqueue(new Uint8Array(1_200).fill(65));
          return;
        }
        throw new Error("The route read beyond its byte limit");
      },
      cancel() {
        canceled = true;
      },
    });
    const streamedRequest = new Request(
      "http://localhost/api/v1/bot-connections/verify",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        duplex: "half",
      } as RequestInit & { duplex: "half" },
    );

    const response = await createVerifyRoute(verifier)(streamedRequest);

    expect(response.status).toBe(413);
    expect((await response.json()).error.code).toBe("REQUEST_TOO_LARGE");
    expect(canceled).toBe(true);
    expect(pulls).toBe(2);
    expect(verifier).not.toHaveBeenCalled();
  });
});
