import { describe, expect, it, vi } from "vitest";
import { handleZaloPollDiagnostic } from "./connections";

const origin = "https://calenote.iconiclogs.com";
const publicId = "AAAAAAAAAAAAAAAAAAAAAA";
const cookie = `__Host-calenote_session=${"A".repeat(43)}`;

function request(headers: HeadersInit = {}) {
  return new Request(`${origin}/api/connections/${publicId}/zalo-poll-diagnostic`, {
    method: "POST",
    headers: { origin, "content-type": "application/json", cookie, ...headers },
    body: "{}",
  });
}

describe("Zalo polling diagnostic route", () => {
  it("requires same-origin authentication and returns only safe diagnostic fields", async () => {
    const operations = {
      requireUser: vi.fn(async () => ({ userId: "owner-internal" })),
      runZaloPollDiagnostic: vi.fn(async () => ({
        pollProbeStarted: true,
        webhookRemoved: true,
        pollUpdateReceived: false,
        pollEventName: "NONE" as const,
        pollPrivateChat: false,
        webhookRestored: true,
        restoredHostMatch: true,
        restoredPathPrefixMatch: true,
        restoreTestOk: true,
      })),
    };

    const response = await handleZaloPollDiagnostic(
      request(), origin, publicId, async () => operations,
    );

    expect(operations.requireUser).toHaveBeenCalledWith({ bearer: "A".repeat(43) });
    expect(operations.runZaloPollDiagnostic).toHaveBeenCalledWith({ userId: "owner-internal", publicId });
    expect(await response.json()).toEqual({ data: {
      pollProbeStarted: true,
      webhookRemoved: true,
      pollUpdateReceived: false,
      pollEventName: "NONE",
      pollPrivateChat: false,
      webhookRestored: true,
      restoredHostMatch: true,
      restoredPathPrefixMatch: true,
      restoreTestOk: true,
    } });

    await expect(handleZaloPollDiagnostic(
      request({ origin: "https://evil.example" }), origin, publicId, async () => operations,
    )).rejects.toMatchObject({ status: 403 });
    expect(operations.runZaloPollDiagnostic).toHaveBeenCalledOnce();
  });
});
