import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    expect(screen.getByRole("menuitem", { name: "Cài đặt" })).toHaveAttribute("href", "/app/settings");
    await interaction.click(screen.getByRole("menuitem", { name: "Đăng xuất" }));

    await waitFor(() => expect(fetcher).toHaveBeenCalledWith("/api/auth/logout", expect.objectContaining({ method: "POST" })));
    expect(replace).toHaveBeenCalledWith("/login");
  });

  it("keeps the account visible and announces a failed logout", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: { code: "INTERNAL_ERROR", message: "Chưa thể đăng xuất." } }, 500)));
    const interaction = userEvent.setup();
    renderShell();

    await interaction.click(screen.getByRole("button", { name: /tài khoản tuyền bích/i }));
    await interaction.click(screen.getByRole("menuitem", { name: "Đăng xuất" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Chưa thể đăng xuất.");
    expect(screen.getByRole("button", { name: /tài khoản tuyền bích/i })).toBeVisible();
    expect(replace).not.toHaveBeenCalled();
  });

  it("returns to login when the server has already ended the session", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: { code: "UNAUTHORIZED", message: "Hết phiên." } }, 401)));
    const interaction = userEvent.setup();
    renderShell();

    await interaction.click(screen.getByRole("button", { name: /tài khoản tuyền bích/i }));
    await interaction.click(screen.getByRole("menuitem", { name: "Đăng xuất" }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("closes on Escape and restores focus to the account trigger", async () => {
    const interaction = userEvent.setup();
    renderShell();
    const trigger = screen.getByRole("button", { name: /tài khoản tuyền bích/i });

    await interaction.click(trigger);
    expect(screen.getByRole("menu")).toBeVisible();
    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });
});
