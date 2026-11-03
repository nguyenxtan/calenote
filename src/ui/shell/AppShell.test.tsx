// Notification polling has its own API/lifecycle tests; isolate it from these request-order fixtures.
vi.mock("@/features/updates/ProductUpdates", () => ({ ProductUpdates: () => null }));
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/contracts/api/session";
import { AppShell } from "./AppShell";

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const account: SessionUser = { displayName: "Tuyền Bích", email: "bich@example.com", timezone: "Asia/Ho_Chi_Minh" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function renderShell() {
  return render(<AppShell user={account}><main><h1>Hôm nay</h1></main></AppShell>);
}

describe("AppShell account menu", () => {
  beforeEach(() => { replace.mockReset(); });

  it("opens an accessible account menu and logs out through the canonical endpoint", async () => {
    const fetcher = vi.fn(async () => json({ data: { loggedOut: true } }));
    vi.stubGlobal("fetch", fetcher);
    const interaction = userEvent.setup();
    renderShell();

    await interaction.click(screen.getByRole("button", { name: /tài khoản tuyền bích/i }));
    const accountActions = screen.getByRole("group", { name: "Tài khoản" });
    expect(accountActions).toBeVisible();
    expect(screen.queryByRole("menu", { name: "Tài khoản" })).not.toBeInTheDocument();
    expect(within(accountActions).getByRole("link", { name: "Cài đặt" })).toHaveAttribute("href", "/app/settings");
    await interaction.click(within(accountActions).getByRole("button", { name: "Đăng xuất" }));

    await waitFor(() => expect(fetcher).toHaveBeenCalledWith("/api/auth/logout", expect.objectContaining({ method: "POST" })));
    expect(replace).toHaveBeenCalledWith("/login");
  });

  it("keeps the account visible and announces a failed logout", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: { code: "INTERNAL_ERROR", message: "Chưa thể đăng xuất." } }, 500)));
    const interaction = userEvent.setup();
    renderShell();

    await interaction.click(screen.getByRole("button", { name: /tài khoản tuyền bích/i }));
    await interaction.click(screen.getByRole("button", { name: "Đăng xuất" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Chưa thể đăng xuất.");
    expect(screen.getByRole("button", { name: /tài khoản tuyền bích/i })).toBeVisible();
    expect(replace).not.toHaveBeenCalled();
  });

  it("returns to login when the server has already ended the session", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: { code: "UNAUTHORIZED", message: "Hết phiên." } }, 401)));
    const interaction = userEvent.setup();
    renderShell();

    await interaction.click(screen.getByRole("button", { name: /tài khoản tuyền bích/i }));
    await interaction.click(screen.getByRole("button", { name: "Đăng xuất" }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("closes on Escape and restores focus to the account trigger", async () => {
    const interaction = userEvent.setup();
    renderShell();
    const trigger = screen.getByRole("button", { name: /tài khoản tuyền bích/i });

    await interaction.click(trigger);
    expect(screen.getByRole("group", { name: "Tài khoản" })).toBeVisible();
    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("group", { name: "Tài khoản" })).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });
});

describe("unified navigation", () => {
  it("offers the same grouped destinations and current page in the mobile panel", async () => {
    const interaction = userEvent.setup();
    const { container } = render(<AppShell user={account} activePath="/app/settings"><main><h1>Cài đặt</h1></main></AppShell>);
    const desktop = screen.getByRole("navigation", { name: "Điều hướng chính" });
    expect(within(desktop).getByRole("link", { name: "Hướng dẫn" })).toHaveAttribute("href", "/docs");
    const trigger = screen.getByRole("button", { name: "Mở thêm điều hướng", hidden: true });
    await interaction.click(trigger);
    const panel = screen.getByRole("group", { name: "Tất cả điều hướng", hidden: true });
    for (const link of within(desktop).getAllByRole("link")) {
      expect(within(panel).getByRole("link", { name: link.textContent!.trim(), hidden: true })).toHaveAttribute("href", link.getAttribute("href"));
    }
    expect(within(panel).getByRole("link", { name: "Cài đặt", hidden: true })).toHaveAttribute("aria-current", "page");
    expect(within(panel).getByText(account.displayName)).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: "Hôm nay", hidden: true })).toHaveFocus();
    const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(result.violations.filter((item) => ["serious", "critical"].includes(item.impact ?? ""))).toEqual([]);
    await interaction.keyboard("{Escape}");
    expect(screen.queryByRole("group", { name: "Tất cả điều hướng", hidden: true })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});


describe("admin discovery", () => {
 it("shows admin navigation only after the server grants access", async () => {
  vi.stubGlobal("fetch",vi.fn(async()=>json({data:{allowed:true}})));
  renderShell();
  expect(await screen.findByRole("link",{name:"Quản trị"})).toHaveAttribute("href","/app/admin");
 });
 it("does not infer admin from the user profile or unavailable access endpoint",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>json({error:{code:"FORBIDDEN"}},403)));
  renderShell();
  await waitFor(()=>expect(fetch).toHaveBeenCalled());
  expect(screen.queryByRole("link",{name:"Quản trị"})).not.toBeInTheDocument();
 });
});

it("removes a previous admin navigation grant when the account changes or the response is malformed",async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(json({data:{allowed:true}})).mockResolvedValueOnce(json({data:{allowed:true,unexpected:"field"}}));
 vi.stubGlobal("fetch",fetcher);
 const view=renderShell();
 expect(await screen.findByRole("link",{name:"Quản trị"})).toBeVisible();
 view.rerender(<AppShell user={{...account,email:"another@example.invalid"}}><main>Other account</main></AppShell>);
 expect(screen.queryByRole("link",{name:"Quản trị"})).not.toBeInTheDocument();
 await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(2));
 expect(screen.queryByRole("link",{name:"Quản trị"})).not.toBeInTheDocument();
});
