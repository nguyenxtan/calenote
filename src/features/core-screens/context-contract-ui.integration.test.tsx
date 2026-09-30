import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { fixture, now } from "@/modules/conversation/context-contract/infrastructure/d1/test-support";
import { addConfirmationToken } from "@/modules/conversation/context-contract/confirmation-test-support";
import { D1ReminderApiStore } from "@/modules/reminders/infrastructure/d1/api-store";
import { listDetailedReminders } from "@/modules/reminders/details-api-service";
import { createRouter } from "@/worker/router";
import { PreviewUnavailableError } from "@/worker/routes/conversation-previews";
import { CoreScreenExperience } from "./CoreScreenExperience";

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
const origin = "https://calenote.iconiclogs.com";
const cookie = `__Host-calenote_session=${"A".repeat(43)}`;
const env = { APP_ORIGIN: origin, CALENOTE_RUNTIME_ENVIRONMENT: "production", ASSETS: { fetch: async () => new Response("missing") } } as unknown as Env;
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("strict Worker preview, exact web decision and detailed reminder reach the real UI", async () => {
  const f = await fixture();
  try {
    await addConfirmationToken(f);
    expect((await f.save()).result.status).toBe("APPLIED");
    const principal = { sessionId: "session", userId: "owner", expiresAt: now + 1_000_000 };
    const router = createRouter({ contextApiOperations: async () => ({
      requireUser: async () => principal,
      listDetailedReminders: p => listDetailedReminders(p, { store: new D1ReminderApiStore(f.db), contextStore: f.store, keyring: f.keyring }),
      listPreviews: p => f.store.listWebPreviews(p), decidePreview: (p, decision) => f.store.decideWebPreview(p, decision),
    }) });
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = typeof input === "string" ? input : input instanceof URL ? input.pathname : new URL(input.url).pathname;
      if (path === "/api/session") return json({ data: { user: { displayName: "Mai", email: "mai@example.test", timezone: "Asia/Ho_Chi_Minh" } } });
      if (path === "/api/actions") return json({ data: { actions: [] } });
      if (path === "/api/reminder-series") return json({ data: { series: [] } });
      const headers = new Headers(init?.headers);
      headers.set("cookie", cookie);
      if (init?.method === "POST") headers.set("origin", origin);
      return router(new Request(origin + path, { ...init, headers }), env, ctx);
    });
    vi.stubGlobal("fetch", fetcher);
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-08T05:00:00Z"));
    const view = render(<CoreScreenExperience screen="inbox" />);
    expect(await screen.findByRole("heading", { name: f.preview.title })).toBeVisible();
    expect(screen.getByText(/Thời điểm thông báo.*Việt Nam/)).toBeVisible();
    const save = screen.getByRole("button", { name: `Lưu bản xem trước ${f.preview.title}` });
    await userEvent.click(save);
    await waitFor(async () => expect((await f.db.prepare("SELECT count(*) n FROM reminders").first<{ n: number }>())?.n).toBe(2));
    const mutation = fetcher.mock.calls.find(([path, init]) => path === "/api/v2/conversation-previews/decision" && init?.method === "POST");
    expect(mutation).toBeDefined();
    const body = JSON.parse(String(mutation?.[1]?.body));
    expect(body).toMatchObject({ schemaVersion: "conversation-previews-1", action: "SAVE_PREVIEW", draftRevision: 1,
      previewHash: f.proof.draftHash, decisionToken: "CN-test-token" });
    expect(typeof body.idempotencyKey).toBe("string");
    view.rerender(<CoreScreenExperience screen="calendar" />);
    expect(await screen.findByText(f.preview.title)).toBeVisible();
    await userEvent.click(screen.getByText(f.preview.title));
    expect(screen.getByRole("region", { name: "Chi tiết lời nhắc" })).toHaveTextContent(f.preview.details.notes ?? "");
    expect(fetcher.mock.calls.some(([path]) => path === "/api/v2/reminders")).toBe(true);
  } finally { f.close(); }
});

it.each(["UNCERTAIN", "UNAVAILABLE"] as const)("preserves Worker PREVIEW_%s through the strict client and UI without resubmission", async outcome => {
  const f = await fixture();
  try {
    await addConfirmationToken(f);
    expect((await f.save()).result.status).toBe("APPLIED");
    const principal = { sessionId: "session", userId: "owner", expiresAt: now + 1_000_000 };
    const decide = vi.fn(async () => {
      if (outcome === "UNAVAILABLE") throw new PreviewUnavailableError();
      return { status: "UNCERTAIN" as const };
    });
    const router = createRouter({ contextApiOperations: async () => ({
      requireUser: async () => principal,
      listDetailedReminders: p => listDetailedReminders(p, { store: new D1ReminderApiStore(f.db), contextStore: f.store, keyring: f.keyring }),
      listPreviews: p => f.store.listWebPreviews(p), decidePreview: decide,
    }) });
    const codes: string[] = [];
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = typeof input === "string" ? input : input instanceof URL ? input.pathname : new URL(input.url).pathname;
      if (path === "/api/session") return json({ data: { user: { displayName: "Mai", email: "mai@example.test", timezone: "Asia/Ho_Chi_Minh" } } });
      if (path === "/api/actions") return json({ data: { actions: [] } });
      if (path === "/api/reminder-series") return json({ data: { series: [] } });
      const headers = new Headers(init?.headers);
      headers.set("cookie", cookie);
      if (init?.method === "POST") headers.set("origin", origin);
      const response = await router(new Request(origin + path, { ...init, headers }), env, ctx);
      if (path === "/api/v2/conversation-previews/decision") {
        expect(response.status).toBe(409);
        const body = await response.clone().json() as { error: { code: string } };
        codes.push(body.error.code);
      }
      return response;
    });
    vi.stubGlobal("fetch", fetcher);
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-08T05:00:00Z"));
    const view = render(<CoreScreenExperience screen="inbox" />);
    const save = await screen.findByRole("button", { name: `Lưu bản xem trước ${f.preview.title}` });
    await userEvent.click(save);
    const expected = outcome === "UNCERTAIN" ? /Kết quả xác nhận chưa xác định/ : /hiện chưa khả dụng/;
    expect(await screen.findByRole("alert")).toHaveTextContent(expected);
    expect(save).toBeDisabled();
    expect(codes).toEqual([`PREVIEW_${outcome}`]);
    await userEvent.click(screen.getByRole("button", { name: "Tải lại" }));
    await waitFor(() => expect(screen.getByRole("button", { name: `Lưu bản xem trước ${f.preview.title}` })).toBeDisabled());
    await userEvent.click(save);
    expect(decide).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls.filter(([path, init]) => path === "/api/v2/conversation-previews/decision" && init?.method === "POST")).toHaveLength(1);
    view.unmount();
  } finally { f.close(); }
});
