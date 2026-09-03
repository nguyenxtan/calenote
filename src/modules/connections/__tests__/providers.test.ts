import { describe, expect, it, vi } from "vitest";
import { ProviderOperationError, ProviderVerificationError } from "../provider-error";
import { parseTelegramWebhook, sendTelegramText, setTelegramWebhook, verifyTelegramBotToken } from "../providers/telegram";
import { parseZaloWebhook, sendZaloText, setZaloWebhook, verifyZaloBotToken } from "../providers/zalo";

async function captureAdapterFailure(
  operation: () => Promise<unknown>,
): Promise<{ caught: unknown; serialized: string }> {
  let caught: unknown;

  try {
    await operation();
  } catch (error) {
    caught = error;
  }

  const serialized = caught instanceof ProviderOperationError
    ? JSON.stringify({
        ...caught,
        name: caught.name,
        message: caught.message,
      })
    : JSON.stringify(caught);

  return { caught, serialized };
}

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

describe("provider webhook and outbound adapters", () => {
  it("rejects malformed successful webhook and send payloads instead of returning a null receipt", async () => {
    const token = "12345678:abc-xyz_789";
    await expect(setZaloWebhook(token, { url: "https://calenote.iconiclogs.com/a", secretToken: "abcdefgh" }, async () => ({ ok: true, result: {} }))).rejects.toEqual(new ProviderOperationError("INVALID_RESPONSE"));
    await expect(sendZaloText(token, "chat", "text", async () => ({ ok: true, result: {} }))).rejects.toEqual(new ProviderOperationError("INVALID_RESPONSE"));
    await expect(setTelegramWebhook("123456789:AAExample_secret-token_123456789", { url: "https://calenote.iconiclogs.com/a", secretToken: "AAAAAAAA" }, async () => ({ ok: true, result: {} }))).rejects.toEqual(new ProviderOperationError("INVALID_RESPONSE"));
    await expect(sendTelegramText("123456789:AAExample_secret-token_123456789", "chat", "text", async () => ({ ok: true, result: {} }))).rejects.toEqual(new ProviderOperationError("INVALID_RESPONSE"));
  });

  it.each([
    { provider: "zalo", errorCode: 401, expectedCode: "REJECTED_CREDENTIAL" },
    { provider: "telegram", errorCode: 401, expectedCode: "REJECTED_CREDENTIAL" },
    { provider: "telegram", errorCode: 404, expectedCode: "REJECTED_CREDENTIAL" },
    { provider: "zalo", errorCode: 404, expectedCode: "FAILED" },
    { provider: "zalo", errorCode: 500, expectedCode: "FAILED" },
    { provider: "telegram", errorCode: 500, expectedCode: "FAILED" },
  ] as const)(
    "maps $provider ok:false error $errorCode to $expectedCode without leaking payload details",
    async ({ provider, errorCode, expectedCode }) => {
      const token = provider === "zalo"
        ? "12345678:adapter-safe-zalo-token"
        : "123456789:adapter-safe-telegram-token";
      const rawDescription = `adapter-description-${provider}-${errorCode}`;
      const bodyMarker = `adapter-body-marker-${provider}-${errorCode}`;
      const requester = async () => ({
        ok: false,
        error_code: errorCode,
        description: `${rawDescription}:${token}`,
        marker: bodyMarker,
      });
      const failure = await captureAdapterFailure(() => (
        provider === "zalo"
          ? sendZaloText(token, "chat-1", "text", requester)
          : sendTelegramText(token, "chat-1", "text", requester)
      ));

      expect(failure.caught).toEqual(new ProviderOperationError(expectedCode));
      expect(failure.serialized).not.toContain(token);
      expect(failure.serialized).not.toContain(rawDescription);
      expect(failure.serialized).not.toContain(bodyMarker);
    },
  );

  it.each([
    { provider: "zalo", retryAfter: 23, expectedRetryAfter: 23 },
    { provider: "telegram", retryAfter: 23, expectedRetryAfter: 23 },
    { provider: "telegram", retryAfter: 0, expectedRetryAfter: null },
    { provider: "telegram", retryAfter: 1.5, expectedRetryAfter: null },
    { provider: "telegram", retryAfter: 86_401, expectedRetryAfter: null },
  ] as const)(
    "bounds $provider ok:false quota retry_after $retryAfter",
    async ({ provider, retryAfter, expectedRetryAfter }) => {
      const token = provider === "zalo"
        ? "12345678:adapter-quota-zalo-token"
        : "123456789:adapter-quota-telegram-token";
      const rawDescription = `adapter-quota-description-${provider}-${retryAfter}`;
      const bodyMarker = `adapter-quota-body-${provider}-${retryAfter}`;
      const requester = async () => ({
        ok: false,
        error_code: 429,
        description: `${rawDescription}:${token}`,
        marker: bodyMarker,
        parameters: { retry_after: retryAfter },
      });
      const failure = await captureAdapterFailure(() => (
        provider === "zalo"
          ? sendZaloText(token, "chat-1", "text", requester)
          : sendTelegramText(token, "chat-1", "text", requester)
      ));

      expect(failure.caught).toEqual(
        new ProviderOperationError("QUOTA", expectedRetryAfter),
      );
      expect(failure.serialized).not.toContain(token);
      expect(failure.serialized).not.toContain(rawDescription);
      expect(failure.serialized).not.toContain(bodyMarker);
    },
  );

  it("maps a Zalo webhook verification rejection to failed without leaking payload details", async () => {
    const token = "12345678:webhook-verification-token";
    const rawDescription = "zalo-verification-description";
    const bodyMarker = "zalo-verification-body-marker";
    const failure = await captureAdapterFailure(() => setZaloWebhook(
      token,
      {
        url: "https://calenote.iconiclogs.com/webhooks/zalo/a",
        secretToken: "AAAAAAAA",
      },
      async () => ({
        ok: true,
        result: {
          verification: {
            ok: false,
            description: `${rawDescription}:${token}`,
            marker: bodyMarker,
          },
        },
      }),
    ));

    expect(failure.caught).toEqual(new ProviderOperationError("FAILED"));
    expect(failure.serialized).not.toContain(token);
    expect(failure.serialized).not.toContain(rawDescription);
    expect(failure.serialized).not.toContain(bodyMarker);
  });

  it.each(["abcdefghi", "abc=defg", "tiếngviệt"]) ("rejects non-canonical Zalo webhook secrets before request: %s", async (secretToken) => {
    const requester = vi.fn();
    await expect(setZaloWebhook("12345678:abc-xyz_789", { url: "https://calenote.iconiclogs.com/a", secretToken }, requester)).rejects.toMatchObject({ code: "INVALID_PROVIDER_RESPONSE" });
    expect(requester).not.toHaveBeenCalled();
  });
  it("forms Zalo webhook and send operations inside the adapter", async () => {
    const token = "12345678:abc-xyz_789";
    const requester = vi.fn(async (request) => request.operation === "setWebhook" ? ({ ok: true, result: { verification: { ok: true } } }) : ({ ok: true, result: { message_id: "receipt-1" } }));

    await setZaloWebhook(token, { url: "https://calenote.iconiclogs.com/webhooks/zalo/a", secretToken: "AAAAAAAA" }, requester);
    await expect(sendZaloText(token, "chat-1", "Nhắc bạn họp", requester)).resolves.toEqual({ providerMessageId: "receipt-1" });
    expect(requester).toHaveBeenNthCalledWith(1, expect.objectContaining({
      provider: "zalo", operation: "setWebhook", body: { url: "https://calenote.iconiclogs.com/webhooks/zalo/a", secret_token: "AAAAAAAA" },
    }));
    expect(requester).toHaveBeenNthCalledWith(2, expect.objectContaining({
      provider: "zalo", operation: "sendMessage", body: { chat_id: "chat-1", text: "Nhắc bạn họp" },
    }));
  });

  it("accepts only private non-bot Zalo text events", () => {
    expect(parseZaloWebhook({ ok: true, result: { event_name: "message.text.received", message: { from: { id: "u1", display_name: "Minh", is_bot: false }, chat: { id: "c1", chat_type: "PRIVATE" }, text: "Xin chào", message_id: "m1", date: 1_700_000_000_000 } } })).toEqual({ provider: "zalo", providerMessageId: "m1", providerUserId: "u1", privateChatId: "c1", displayName: "Minh", text: "Xin chào", receivedAt: 1_700_000_000_000 });
    expect(parseZaloWebhook({ ok: true, result: { event_name: "message.text.received", message: { from: { id: "u1", is_bot: true }, chat: { id: "c1", chat_type: "PRIVATE" }, text: "no", message_id: "m1", date: 1 } } })).toBeNull();
  });

  it("uses Telegram's constrained webhook payload and private text parser", async () => {
    const token = "123456789:AAExample_secret-token_123456789";
    const requester = vi.fn(async (request) => request.operation === "setWebhook" ? ({ ok: true, result: true }) : ({ ok: true, result: { message_id: 7 } }));
    await setTelegramWebhook(token, { url: "https://calenote.iconiclogs.com/webhooks/telegram/a", secretToken: "base64url_secret" }, requester);
    await expect(sendTelegramText(token, "chat-1", "Nhắc bạn họp", requester)).resolves.toEqual({ providerMessageId: "7" });
    expect(requester).toHaveBeenNthCalledWith(1, expect.objectContaining({ operation: "setWebhook", body: { url: "https://calenote.iconiclogs.com/webhooks/telegram/a", secret_token: "base64url_secret", allowed_updates: ["message"] } }));
    expect(parseTelegramWebhook({ update_id: 5, message: { message_id: 7, date: 1, text: "Xin chào", chat: { id: 3, type: "private" }, from: { id: 4, first_name: "Mai", is_bot: false } } })).toEqual({ provider: "telegram", providerMessageId: "5", providerUserId: "4", privateChatId: "3", displayName: "Mai", text: "Xin chào", receivedAt: 1000 });
  });
});
