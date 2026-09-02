import { describe, expect, it, vi } from "vitest";
import { ProviderVerificationError } from "../provider-error";
import { verifyTelegramBotToken } from "../providers/telegram";
import { verifyZaloBotToken } from "../providers/zalo";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Zalo Bot Platform adapter", () => {
  it("calls the official getMe endpoint and normalizes the bot profile", async () => {
    const token = "12345678:abc-xyz_789";
    const fetcher = vi.fn(async () =>
      jsonResponse({
        ok: true,
        result: {
          id: "97531",
          account_name: "Bé Lịch",
          account_type: "BASIC",
          can_join_groups: true,
        },
      }),
    );

    const profile = await verifyZaloBotToken(token, fetcher);

    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(
      `https://bot-api.zaloplatforms.com/bot${token}/getMe`,
      expect.objectContaining({
        method: "POST",
        redirect: "error",
        cache: "no-store",
      }),
    );
    expect(profile).toEqual({
      provider: "zalo",
      providerBotId: "97531",
      displayName: "Bé Lịch",
      handle: null,
      accountType: "BASIC",
      canJoinGroups: true,
    });
    expect(JSON.stringify(profile)).not.toContain(token);
  });

  it("rejects a path-shaped token before making a request", async () => {
    const fetcher = vi.fn();

    await expect(verifyZaloBotToken("12345678:abc/../../getMe", fetcher)).rejects.toMatchObject({
      code: "INVALID_TOKEN_FORMAT",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("Telegram Bot API adapter", () => {
  it("calls getMe and normalizes Telegram-specific identity fields", async () => {
    const token = "123456789:AAExample_secret-token_123456789";
    const fetcher = vi.fn(async () =>
      jsonResponse({
        ok: true,
        result: {
          id: 123456789,
          is_bot: true,
          first_name: "Calenote Demo",
          username: "calenote_demo_bot",
          can_join_groups: false,
        },
      }),
    );

    const profile = await verifyTelegramBotToken(token, fetcher);

    expect(fetcher).toHaveBeenCalledWith(
      `https://api.telegram.org/bot${token}/getMe`,
      expect.objectContaining({
        method: "POST",
        redirect: "error",
        cache: "no-store",
      }),
    );
    expect(profile).toEqual({
      provider: "telegram",
      providerBotId: "123456789",
      displayName: "Calenote Demo",
      handle: "@calenote_demo_bot",
      accountType: null,
      canJoinGroups: false,
    });
  });

  it("turns a provider rejection into a safe typed error", async () => {
    const token = "123456789:AAExample_secret-token_123456789";
    const fetcher = vi.fn(async () =>
      jsonResponse({
        ok: false,
        error_code: 401,
        description: `Unauthorized: token ${token} is invalid`,
      }),
    );

    await expect(verifyTelegramBotToken(token, fetcher)).rejects.toEqual(
      new ProviderVerificationError("PROVIDER_REJECTED"),
    );
  });

  it("rejects unexpected provider payloads", async () => {
    const token = "123456789:AAExample_secret-token_123456789";
    const fetcher = vi.fn(async () => jsonResponse({ ok: true, result: { is_bot: true } }));

    await expect(verifyTelegramBotToken(token, fetcher)).rejects.toMatchObject({
      code: "INVALID_PROVIDER_RESPONSE",
    });
  });
});
