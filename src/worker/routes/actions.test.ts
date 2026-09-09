import { describe, expect, it, vi } from "vitest";
import { createRouter, type RouterOptions } from "../router";

const origin = "https://calenote.iconiclogs.com";
const cookie = `__Host-calenote_session=${"A".repeat(43)}`;
const candidateId = "B".repeat(21) + "Q";

function context(): ExecutionContext {
  return { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;
}

function environment(): Env {
  return {
    APP_ORIGIN: origin,
    ASSETS: { fetch: vi.fn(async () => new Response("asset", { status: 404 })) },
  } as unknown as Env;
}

function actionsOperations() {
  return {
    requireUser: vi.fn(async () => ({ userId: "owner-1" })),
    listPendingActions: vi.fn(async () => [{
      id: candidateId,
      title: "Họp khách hàng",
      scheduledAt: 1_800_000_000_000,
      timezone: "Asia/Ho_Chi_Minh" as const,
      status: "PENDING" as const,
      title_ciphertext: "must-never-leak",
      workspaceId: "workspace-internal",
    }]),
    approveAction: vi.fn(async () => ({ status: "APPROVED" as const, reminderPublicId: "C".repeat(22) })),
    rejectAction: vi.fn(async () => ({ status: "REJECTED" as const })),
  };
}

describe("action routes", () => {
  it("requires a session before constructing the actions capability", async () => {
    const actions = actionsOperations();
    const factory = vi.fn(async () => actions);
    const response = await createRouter({ actionsOperations: factory } as unknown as RouterOptions)(
      new Request(`${origin}/api/actions`), environment(), context(),
    );

    expect(response.status).toBe(401);
    expect(factory).not.toHaveBeenCalled();
  });

  it("lists owned pending actions without secret or workspace fields", async () => {
    const actions = actionsOperations();
    const response = await createRouter({ actionsOperations: async () => actions } as unknown as RouterOptions)(
      new Request(`${origin}/api/actions`, { headers: { cookie } }), environment(), context(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { actions: [{
      id: candidateId,
      title: "Họp khách hàng",
      scheduledAt: 1_800_000_000_000,
      timezone: "Asia/Ho_Chi_Minh",
      status: "PENDING",
    }] } });
    expect(actions.listPendingActions).toHaveBeenCalledWith("owner-1");
  });

  it("requires same origin then approves one owned action through the operation", async () => {
    const actions = actionsOperations();
    const router = createRouter({ actionsOperations: async () => actions } as unknown as RouterOptions);
    const rejected = await router(new Request(`${origin}/api/actions/${candidateId}/approve`, {
      method: "POST", headers: { "content-type": "application/json", cookie }, body: "{}",
    }), environment(), context());
    expect(rejected.status).toBe(403);
    expect(actions.approveAction).not.toHaveBeenCalled();

    const approved = await router(new Request(`${origin}/api/actions/${candidateId}/approve`, {
      method: "POST", headers: { origin, "content-type": "application/json", cookie }, body: "{}",
    }), environment(), context());
    expect(approved.status).toBe(200);
    await expect(approved.json()).resolves.toEqual({ data: { decision: "APPROVED", reminderPublicId: "C".repeat(22) } });
    expect(actions.approveAction).toHaveBeenCalledWith({ userId: "owner-1", candidateId });
  });

  it("rejects one owned action with an exact empty JSON body", async () => {
    const actions = actionsOperations();
    const router = createRouter({ actionsOperations: async () => actions } as unknown as RouterOptions);
    const malformed = await router(new Request(`${origin}/api/actions/${candidateId}/reject`, {
      method: "POST", headers: { origin, "content-type": "application/json", cookie }, body: '{"reason":"no"}',
    }), environment(), context());
    expect(malformed.status).toBe(400);
    expect(actions.rejectAction).not.toHaveBeenCalled();

    const rejected = await router(new Request(`${origin}/api/actions/${candidateId}/reject`, {
      method: "POST", headers: { origin, "content-type": "application/json", cookie }, body: "{}",
    }), environment(), context());
    expect(rejected.status).toBe(200);
    await expect(rejected.json()).resolves.toEqual({ data: { decision: "REJECTED" } });
    expect(actions.rejectAction).toHaveBeenCalledWith({ userId: "owner-1", candidateId });
  });

  it("rejects malformed action operation output without serializing it", async () => {
    const actions = actionsOperations();
    actions.listPendingActions.mockResolvedValueOnce([{ id: candidateId, title: "title", scheduledAt: 1.5, timezone: "UTC", status: "APPROVED" }] as never);
    const response = await createRouter({ actionsOperations: async () => actions } as unknown as RouterOptions)(
      new Request(`${origin}/api/actions`, { headers: { cookie } }), environment(), context(),
    );
    expect(response.status).toBe(500);
    const raw = await response.text();
    expect(raw).not.toContain("APPROVED");
    expect(raw).not.toContain("UTC");
  });
});
