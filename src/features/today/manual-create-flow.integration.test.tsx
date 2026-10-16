import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { createSession } from "@/modules/auth/session";
import { D1SessionStore } from "@/modules/db/session-store";
import { createKeyring } from "@/modules/security/keyring";
import { SqliteD1Database } from "@/testing/sqlite-d1.test-support";
import { createRouter } from "@/worker/router";
import { CoreScreenExperience } from "@/features/core-screens/CoreScreenExperience";
import { TodayExperience } from "./TodayExperience";

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

it("recovers a committed response lost across remount, then cancels through authenticated Worker/D1 without duplicating", async () => {
  const db = new SqliteD1Database({ contextContract: true });
  const origin = "https://calenote.iconiclogs.com";
  const masterKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  const now = Date.parse("2026-10-16T06:00:00Z");
  vi.spyOn(Date, "now").mockReturnValue(now);
  localStorage.clear();
  try {
    db.sqlite.exec(`INSERT INTO users(id,email,display_name,timezone,created_at,updated_at) VALUES('owner','fixture@example.test','Fixture','Asia/Ho_Chi_Minh',1,1);
      INSERT INTO workspaces(id,owner_user_id,kind,created_at,updated_at) VALUES('space','owner','PERSONAL',1,1);
      INSERT INTO memberships(workspace_id,user_id,role,created_at) VALUES('space','owner','OWNER',1);
      INSERT INTO bot_connections(id,user_id,provider,public_id,provider_bot_id,display_name,encrypted_token,encrypted_token_iv,token_fingerprint,credential_version,state,created_at,updated_at)
      VALUES('connection','owner','telegram','fixture-public','fixture-bot','Fixture',x'01',zeroblob(12),'fixture-fingerprint',1,'ACTIVE_BOUND',1,1);
      INSERT INTO chat_identities(id,connection_id,provider_user_id,private_chat_id,linked_at) VALUES('chat','connection','provider-owner','private-owner',1);`);
    const keyring = await createKeyring(masterKey);
    const session = await createSession("owner", { store: new D1SessionStore(db as unknown as D1Database), keyring, now: () => now });
    const env = { APP_ORIGIN: origin, CALENOTE_RUNTIME_ENVIRONMENT: "production", CALENOTE_MASTER_KEY: masterKey,
      AI_MODE: "off", DB: db, JOBS: { send: vi.fn(async () => { throw new Error("Queue dispatch forbidden in manual fixture"); }) }, ASSETS: { fetch: async () => new Response("missing", { status: 404 }) } } as unknown as Env;
    const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
    const router = createRouter();
    let creates = 0;
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = String(input);
      if (!path.startsWith("/api/")) throw new Error("External transport forbidden");
      const headers = new Headers(init?.headers);
      headers.set("cookie", session.cookie.split(";")[0]);
      if (init?.method && init.method !== "GET") headers.set("origin", origin);
      const response = await router(new Request(origin + path, { ...init, headers }), env, ctx);
      if (path === "/api/reminders" && init?.method === "POST") {
        creates += 1;
        expect(response.status).toBe(201);
        throw new TypeError("Synthetic response loss after committed transaction");
      }
      return response;
    });
    vi.stubGlobal("fetch", fetcher);
    let view = render(<TodayExperience />);
    await userEvent.type(await screen.findByLabelText("Nội dung nhắc hẹn"), "Gọi khách fixture");
    await userEvent.click(screen.getByRole("button", { name: "Chọn thời gian" }));
    fireEvent.change(screen.getByLabelText("Thời điểm nhắc"), { target: { value: "2026-10-17T09:00" } });
    await userEvent.click(screen.getByRole("button", { name: "Tạo lời nhắc" }));
    await screen.findByText(/Kết quả chưa xác định/);
    expect(db.sqlite.prepare("SELECT COUNT(*) n FROM reminders").get()).toMatchObject({ n: 1 });
    expect(JSON.stringify(localStorage)).not.toContain("Gọi khách fixture");
    view.unmount();
    view = render(<TodayExperience />);
    await userEvent.click(await screen.findByRole("button", { name: "Kiểm tra lần tạo trước" }));
    await screen.findByText(/Nhắc hẹn trước đã được lưu/);
    expect(creates).toBe(1);
    expect(localStorage.length).toBe(0);
    expect(db.sqlite.prepare("SELECT COUNT(*) n FROM reminders").get()).toMatchObject({ n: 1 });
    expect(db.sqlite.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='REMINDER_CREATED'").get()).toMatchObject({ n: 1 });
    view.unmount();
    view = render(<CoreScreenExperience screen="reminders" />);
    await userEvent.click(await screen.findByRole("button", { name: "Huỷ Gọi khách fixture" }));
    await waitFor(() => expect(db.sqlite.prepare("SELECT status FROM reminders").get()).toMatchObject({ status: "CANCELLED" }));
    expect(fetcher.mock.calls.some(([path, init]) => String(path).startsWith("/api/reminders/") && init?.method === "DELETE")).toBe(true);
    expect(creates).toBe(1);
    view.unmount();
  } finally { db.close(); }
}, 15_000);
