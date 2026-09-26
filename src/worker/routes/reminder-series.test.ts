import { describe, expect, it, vi } from "vitest";
import { createRouter } from "../router";
const origin = "https://calenote.iconiclogs.com";
const cookie = `__Host-calenote_session=${"A".repeat(43)}`;
const principal = { userId: "owner", sessionId: "session", expiresAt: 9999999999999 };
const env = { APP_ORIGIN: origin, CALENOTE_RUNTIME_ENVIRONMENT: "production" } as Env;
describe("authenticated series routes", () => {
  function fixture() {
    const ops = { requireUser: vi.fn(async () => principal), listSeries: vi.fn(async () => []), decideSeries: vi.fn(async () => "STALE" as const) };
    const route = createRouter({ seriesOperations: async () => ops });
    return { ops, request: (method: string, body?: unknown, headers: HeadersInit = { cookie, origin }) => route(new Request(`${origin}/api/reminder-series`, {
      method, headers: { "Content-Type": "application/json", ...headers }, ...(body ? { body: JSON.stringify(body) } : {}),
    }), env, {} as ExecutionContext) };
  }
  it("requires auth and same-origin before any series operation", async () => {
    const h = fixture();
    expect((await h.request("GET", undefined, {})).status).toBe(401);
    expect((await h.request("POST", {}, { cookie, origin: "https://evil.test" })).status).toBe(403);
    expect(h.ops.listSeries).not.toHaveBeenCalled(); expect(h.ops.decideSeries).not.toHaveBeenCalled();
  });
  it("passes the session principal only, returns stale revisions as 409 and private no-store responses", async () => {
    const h = fixture(); const list = await h.request("GET");
    expect(list.status).toBe(200); expect(list.headers.get("cache-control")).toContain("no-store");
    expect(h.ops.listSeries).toHaveBeenCalledWith(principal);
    const decision = { publicId: "A".repeat(22), revision: 1, action: "CONFIRM" };
    expect((await h.request("POST", { ...decision, ownerId: "other" })).status).toBe(400);
    expect((await h.request("POST", decision)).status).toBe(409);
    expect(h.ops.decideSeries).toHaveBeenCalledWith(principal, decision);
  });
});
