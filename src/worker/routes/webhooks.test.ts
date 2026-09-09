import { describe, expect, it, vi } from "vitest";
import { constantTimeEqual } from "@/modules/security/encoding";
import {
  handleWebhook,
  matchWebhookRoute,
  type WebhookRouteDependencies,
} from "./webhooks";

const publicId = "AAAAAAAAAAAAAAAAAAAAAA";
const pathSecret = `${"B".repeat(42)}A`;
const headerSecret = `${"C".repeat(42)}A`;
const connection = { id: "connection-1", provider: "telegram" as const, publicId };

function request(provider: "zalo" | "telegram" = "telegram", headers: HeadersInit = {}, body: unknown = {}) {
  const headerName = provider === "zalo"
    ? "X-Bot-Api-Secret-Token"
    : "X-Telegram-Bot-Api-Secret-Token";
  return new Request(`https://calenote.iconiclogs.com/webhooks/${provider}/${publicId}/${pathSecret}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [headerName]: headerSecret,
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function dependencies(overrides: Partial<WebhookRouteDependencies> = {}): WebhookRouteDependencies {
  return {
    findConnection: vi.fn(async () => connection),
    webhookSecrets: vi.fn(async () => ({ pathSecret, headerSecret })),
    constantTimeEqual,
    accept: vi.fn(async () => ({ status: 200 as const })),
    ...overrides,
  };
}

describe("webhook route authentication", () => {
  it("matches only the strict provider, 22-character public ID, and 43-character path secret", () => {
    expect(matchWebhookRoute(`/webhooks/telegram/${publicId}/${pathSecret}`)).toEqual({
      provider: "telegram",
      publicId,
      pathSecret,
    });
    expect(matchWebhookRoute(`/webhooks/zalo/${publicId}/${pathSecret}`)).toEqual({
      provider: "zalo",
      publicId,
      pathSecret,
    });
    expect(matchWebhookRoute(`/webhooks/signal/${publicId}/${pathSecret}`)).toBeNull();
    expect(matchWebhookRoute(`/webhooks/telegram/${publicId.slice(1)}/${pathSecret}`)).toBeNull();
    expect(matchWebhookRoute(`/webhooks/telegram/${publicId}/${pathSecret.slice(1)}`)).toBeNull();
    expect(matchWebhookRoute(`/webhooks/telegram/${"A".repeat(21)}B/${pathSecret}`)).toBeNull();
    expect(matchWebhookRoute(`/webhooks/telegram/${publicId}/${"B".repeat(43)}`)).toBeNull();
    expect(matchWebhookRoute(`/webhooks/telegram/${publicId}/${pathSecret}/extra`)).toBeNull();
  });

  it("returns 404 for unknown connections or wrong path secrets before body acceptance", async () => {
    const unknown = dependencies({ findConnection: vi.fn(async () => null) });
    const unknownResponse = await handleWebhook(request(), {
      provider: "telegram", publicId, pathSecret,
    }, unknown);
    expect(unknownResponse.status).toBe(404);
    expect(unknown.webhookSecrets).not.toHaveBeenCalled();
    expect(unknown.accept).not.toHaveBeenCalled();

    const wrong = dependencies();
    const wrongResponse = await handleWebhook(request(), {
      provider: "telegram", publicId, pathSecret: `${"D".repeat(42)}A`,
    }, wrong);
    expect(wrongResponse.status).toBe(404);
    expect(wrong.accept).not.toHaveBeenCalled();
  });

  it.each([
    { provider: "telegram" as const, expectedHeader: "X-Telegram-Bot-Api-Secret-Token", otherHeader: "X-Bot-Api-Secret-Token" },
    { provider: "zalo" as const, expectedHeader: "X-Bot-Api-Secret-Token", otherHeader: "X-Telegram-Bot-Api-Secret-Token" },
  ])("requires the $provider provider-specific header after the path secret", async ({ provider, expectedHeader, otherHeader }) => {
    const deps = dependencies({
      findConnection: vi.fn(async () => ({ ...connection, provider })),
      constantTimeEqual(left, right) {
        if (left.length === 0) throw new Error("secret comparisons must use a non-empty fixed-work candidate");
        return constantTimeEqual(left, right);
      },
    });
    const missing = request(provider);
    missing.headers.delete(expectedHeader);
    missing.headers.set(otherHeader, headerSecret);

    const missingResponse = await handleWebhook(missing, {
      provider, publicId, pathSecret,
    }, deps);
    expect(missingResponse.status).toBe(403);
    expect(deps.accept).not.toHaveBeenCalled();

    const wrong = request(provider, { [expectedHeader]: `${"D".repeat(42)}A` });
    const wrongResponse = await handleWebhook(wrong, {
      provider, publicId, pathSecret,
    }, deps);
    expect(wrongResponse.status).toBe(403);
    expect(deps.accept).not.toHaveBeenCalled();
  });

  it.each([
    { label: "non-JSON", request: () => request("telegram", { "content-type": "text/plain" }, "ignored"), status: 415 },
    { label: "malformed JSON", request: () => request("telegram", {}, "{"), status: 400 },
  ])("keeps $label ingress rejection in the webhook controller", async ({ request: webhookRequest, status }) => {
    const deps = dependencies();
    const response = await handleWebhook(webhookRequest(), {
      provider: "telegram", publicId, pathSecret,
    }, deps);

    expect(response.status).toBe(status);
    expect(deps.accept).not.toHaveBeenCalled();
  });

  it("passes a normalized provider message only after both independent secrets compare equal", async () => {
    const comparisons: Array<[string, string]> = [];
    const deps = dependencies({
      constantTimeEqual(left, right) {
        comparisons.push([left, right]);
        return constantTimeEqual(left, right);
      },
    });
    const webhookRequest = request("telegram", {}, {
      update_id: 41,
      message: {
        message_id: 7,
        date: 1_700_000_000,
        text: "Nhac toi",
        chat: { id: 23, type: "private" },
        from: { id: 12, first_name: "Tuyen", is_bot: false },
      },
    });

    const response = await handleWebhook(webhookRequest, {
      provider: "telegram", publicId, pathSecret,
    }, deps);

    expect(response.status).toBe(200);
    expect(comparisons).toEqual([
      [pathSecret, pathSecret],
      [headerSecret, headerSecret],
    ]);
    expect(deps.accept).toHaveBeenCalledWith({
      connection,
      message: {
        provider: "telegram",
        providerMessageId: "41",
        providerUserId: "12",
        privateChatId: "23",
        displayName: "Tuyen",
        text: "Nhac toi",
        receivedAt: 1_700_000_000_000,
      },
    });
  });
});
