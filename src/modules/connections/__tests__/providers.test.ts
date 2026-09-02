import { describe, expect, it, vi } from "vitest";
import { ProviderVerificationError } from "../provider-error";
import { verifyTelegramBotToken } from "../providers/telegram";
import { verifyZaloBotToken } from "../providers/zalo";

describe("Zalo Bot Platform adapter", () => {
  it("requests the official getMe operation and normalizes the bot profile", async () => {
    const token = "12345678:abc-xyz_789";
    const requester = vi.fn(async () => ({
      ok: true,
      result: {
        id: "97531",
        account_name: "Bé Lịch",
        account_type: "BASIC",
        can_join_groups: true,
      },
    }));

    const profile = await verifyZaloBotToken(token, requester);

    expect(requester).toHaveBeenCalledOnce();
    expect(requester).toHaveBeenCalledWith({
      provider: "zalo",
      hostname: "bot-api.zaloplatforms.com",
      path: `/bot${token}/getMe`,
      operation: "getMe",
    });
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
    const requester = vi.fn();

    await expect(verifyZaloBotToken("12345678:abc/../../getMe", requester)).rejects.toMatchObject({
      code: "INVALID_TOKEN_FORMAT",
    });
    expect(requester).not.toHaveBeenCalled();
  });

  it("does not infer a strict Zalo token regex from the documentation example", async () => {
    const futureSafeToken = "bot.v2:secret~!$&'()*+,;=@";
    const requester = vi.fn(async () => ({
      ok: true,
      result: { id: "1", account_name: "Future-safe bot" },
    }));

    await expect(verifyZaloBotToken(futureSafeToken, requester)).resolves.toMatchObject({
      displayName: "Future-safe bot",
    });
    expect(requester).toHaveBeenCalledOnce();
  });

  it("classifies the documented Zalo 401 as a rejected credential", async () => {
    const requester = vi.fn(async () => ({ ok: false, error_code: 401 }));

    await expect(verifyZaloBotToken("12345678:abc-xyz_789", requester)).rejects.toMatchObject({
      code: "PROVIDER_REJECTED",
    });
  });

  it.each([403, 429, 500])("treats Zalo error code %s as retryable/unavailable", async (code) => {
    const requester = vi.fn(async () => ({ ok: false, error_code: code }));

    await expect(verifyZaloBotToken("12345678:abc-xyz_789", requester)).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
    });
  });
});

describe("Telegram Bot API adapter", () => {
  it("requests getMe and normalizes Telegram-specific identity fields", async () => {
    const token = "123456789:AAExample_secret-token_123456789";
    const requester = vi.fn(async () => ({
      ok: true,
      result: {
        id: 123456789,
        is_bot: true,
        first_name: "Calenote Demo",
        username: "calenote_demo_bot",
        can_join_groups: false,
      },
    }));

    const profile = await verifyTelegramBotToken(token, requester);

    expect(requester).toHaveBeenCalledWith({
      provider: "telegram",
      hostname: "api.telegram.org",
      path: `/bot${token}/getMe`,
      operation: "getMe",
    });
    expect(profile).toEqual({
      provider: "telegram",
      providerBotId: "123456789",
      displayName: "Calenote Demo",
      handle: "@calenote_demo_bot",
      accountType: null,
      canJoinGroups: false,
    });
  });

  it("turns documented authentication failures into a safe typed error", async () => {
    const token = "123456789:AAExample_secret-token_123456789";
    const requester = vi.fn(async () => ({
      ok: false,
      error_code: 401,
      description: `Unauthorized: token ${token} is invalid`,
    }));

    await expect(verifyTelegramBotToken(token, requester)).rejects.toEqual(
      new ProviderVerificationError("PROVIDER_REJECTED"),
    );
  });

  it("classifies Telegram error code 404 as a rejected credential", async () => {
    const requester = vi.fn(async () => ({ ok: false, error_code: 404 }));

    await expect(
      verifyTelegramBotToken("123456789:AAExample_secret-token_123456789", requester),
    ).rejects.toMatchObject({ code: "PROVIDER_REJECTED" });
  });

  it.each([403, 429, 500])("treats Telegram error code %s as retryable/unavailable", async (code) => {
    const requester = vi.fn(async () => ({ ok: false, error_code: code }));

    await expect(
      verifyTelegramBotToken("123456789:AAExample_secret-token_123456789", requester),
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
  });

  it("rejects an unexpected successful provider payload", async () => {
    const requester = vi.fn(async () => ({ ok: true, result: { is_bot: true } }));

    await expect(
      verifyTelegramBotToken("123456789:AAExample_secret-token_123456789", requester),
    ).rejects.toMatchObject({ code: "INVALID_PROVIDER_RESPONSE" });
  });

  it("rejects a malformed 2xx body as an invalid provider response", async () => {
    const requester = vi.fn(async () => "not-an-object");

    await expect(
      verifyTelegramBotToken("123456789:AAExample_secret-token_123456789", requester),
    ).rejects.toMatchObject({ code: "INVALID_PROVIDER_RESPONSE" });
  });
});
