import { render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import axe from "axe-core";
import { PrimaryLoginPanel } from "./PrimaryLoginPanel";
const { replace, router } = vi.hoisted(() => { const replace = vi.fn(); return { replace, router: { replace } }; });
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const first = { publicId: "A".repeat(22), provider: "telegram", displayName: "Bot Mai", handle: null, state: "ACTIVE_BOUND" };
const second = { ...first, publicId: "B".repeat(22), provider: "zalo", displayName: "Bot Zalo mẫu" };
const unbound = { ...second, publicId: "C".repeat(22), displayName: "Bot chưa liên kết", state: "ACTIVE_UNBOUND" };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
function setup(post: () => Promise<Response> = async () => json({ data: { connection: second } })) {
  let chosen = first;
  const fetcher = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === "/api/connections") return json({ data: { connections: [first, second, unbound] } });
    if (path === "/api/connections/login-channel") return json({ data: { connection: chosen } });
    if (path === `/api/connections/${second.publicId}/login-channel` && init?.method === "POST") { const response = await post(); if (response.ok) chosen = second; return response; }
    throw new Error("Unexpected fixture request");
  });
  vi.stubGlobal("fetch", fetcher); return fetcher;
}
describe("PrimaryLoginPanel", () => {
  beforeEach(() => { router.replace = replace; });
  it("confirms selection and reads back before showing the new primary", async () => {
    const fetcher = setup(); const interaction = userEvent.setup(); render(<PrimaryLoginPanel />);
    expect(await screen.findByText("Bot Mai · Telegram")).toBeVisible();
    expect(screen.getByRole("button", { name: "Chọn Bot chưa liên kết" })).toBeDisabled();
    await interaction.click(screen.getByRole("button", { name: "Chọn Bot Zalo mẫu" }));
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
    await interaction.click(screen.getByRole("button", { name: "Xác nhận đổi bot" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Đã xác nhận bot nhận mã đăng nhập"));
    expect(fetcher).toHaveBeenCalledWith(`/api/connections/${second.publicId}/login-channel`, expect.objectContaining({ method: "POST", body: "{}" }));
    expect(screen.getByText("Bot Zalo mẫu · Zalo")).toBeVisible();
    expect(fetcher.mock.calls.filter(([path]) => path === "/api/connections/login-channel")).toHaveLength(2);
  });
  it("keeps known state on CAS conflict, suppresses server messages and requires reload", async () => {
    setup(async () => json({ error: { code: "CONFLICT", message: "UNSAFE-SERVER-TEXT" } }, 409));
    const interaction = userEvent.setup(); render(<PrimaryLoginPanel />);
    await interaction.click(await screen.findByRole("button", { name: "Chọn Bot Zalo mẫu" })); await interaction.click(screen.getByRole("button", { name: "Xác nhận đổi bot" }));
    expect(await screen.findByRole("alert")).not.toHaveTextContent("UNSAFE-SERVER-TEXT");
    expect(screen.getByText("Bot Mai · Telegram")).toBeVisible(); expect(screen.getByRole("button", { name: "Chọn Bot Zalo mẫu" })).toBeDisabled();
    await interaction.click(screen.getByRole("button", { name: "Tải lại trạng thái" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Chọn Bot Zalo mẫu" })).toBeEnabled());
  });
  it("does not submit when confirmation is cancelled and is accessible", async () => {
    const fetcher=setup(); const interaction=userEvent.setup(); const {container}=render(<PrimaryLoginPanel />);
    await interaction.click(await screen.findByRole("button", {name:"Chọn Bot Zalo mẫu"})); await interaction.click(screen.getByRole("button", {name:"Giữ bot hiện tại"}));
    expect(fetcher.mock.calls.filter(([, init])=>init?.method==='POST')).toHaveLength(0);
    const result=await axe.run(container,{rules:{"color-contrast":{enabled:false}}});expect(result.violations.filter(item=>['serious','critical'].includes(item.impact??''))).toEqual([]);
  });
  it("redirects an expired session and cannot show choices after a 401", async () => {
    replace.mockReset(); vi.stubGlobal('fetch',vi.fn(async()=>json({error:{code:'UNAUTHENTICATED',message:'Fixture expired'}},401)));
    render(<PrimaryLoginPanel />);await waitFor(()=>expect(replace).toHaveBeenCalledWith('/login'));expect(screen.queryByRole('button',{name:'Xác nhận đổi bot'})).not.toBeInTheDocument();
  });
  it("ignores delayed older GET responses after a newer load and selection", async () => {
    let releaseOld!: (value: Response) => void;
    let gets = 0;
    const fetcher = setup();
    const initialFetch = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (path, init) => {
      if (path === "/api/connections/login-channel" && ++gets === 1) return new Promise<Response>(resolve => { releaseOld = resolve; });
      return initialFetch(path, init);
    });
    const interaction = userEvent.setup();
    const { rerender } = render(<PrimaryLoginPanel />);
    await waitFor(() => expect(gets).toBe(1));
    // Simulate a replaced request context while the first GET is pending.
    router.replace = vi.fn();
    rerender(<PrimaryLoginPanel />);
    await interaction.click(await screen.findByRole("button", { name: "Chọn Bot Zalo mẫu" })); await interaction.click(screen.getByRole("button", { name: "Xác nhận đổi bot" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Đã xác nhận"));
    await act(async () => { releaseOld(json({ data: { connection: first } })); });
    expect(screen.getByText("Bot Zalo mẫu · Zalo")).toBeVisible();
    router.replace = replace;
  });

});
