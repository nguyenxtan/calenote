import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AddBotPanel } from "./AddBotPanel";
const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
const bot = { publicId: "A".repeat(22), provider: "telegram", displayName: "Bot mẫu", handle: "@fixture", state: "ACTIVE_UNBOUND" };
function json(value: unknown, status = 201) { return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } }); }

describe("AddBotPanel", () => {
  it("posts the exact add contract once, clears token and never claims chat is bound", async () => {
    const fetcher = vi.fn(async () => json({ data: { bot, connectCommand: `/connect ${"A".repeat(26)}`, connectCodeExpiresAt: 1900000000000, activationCode: null } }));
    vi.stubGlobal("fetch", fetcher); const onAdded = vi.fn(); const interaction = userEvent.setup();
    render(<AddBotPanel onAdded={onAdded} />);
    await interaction.click(screen.getByRole("button", { name: "Thêm bot" }));
    const token = screen.getByLabelText("Bot token");
    expect(token).toHaveAttribute("type", "password"); expect(token).toHaveAttribute("autocomplete", "off");
    await interaction.type(token, "LOCAL-SYNTHETIC-TOKEN");
    await interaction.click(screen.getByRole("button", { name: "Kiểm tra và thêm bot" }));
    await waitFor(() => expect(onAdded).toHaveBeenCalledOnce());
    expect(fetcher).toHaveBeenCalledWith("/api/connections", expect.objectContaining({ method: "POST", body: JSON.stringify({ provider: "telegram", token: "LOCAL-SYNTHETIC-TOKEN" }) }));
    expect(token).toHaveValue(""); expect(document.body.textContent).not.toContain("LOCAL-SYNTHETIC-TOKEN");
    expect(screen.getByRole("status")).toHaveTextContent("chưa liên kết chat riêng");
    expect(screen.getByText(`/connect ${"A".repeat(26)}`)).toBeVisible();
  });
  it("suppresses server error content and clears tokens on failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: { code: "INVALID_TOKEN", message: "LEAKED-SYNTHETIC-TOKEN" } }, 400)));
    const interaction = userEvent.setup(); render(<AddBotPanel onAdded={vi.fn()} />);
    await interaction.click(screen.getByRole("button", { name: "Thêm bot" }));
    await interaction.type(screen.getByLabelText("Bot token"), "LEAKED-SYNTHETIC-TOKEN");
    await interaction.click(screen.getByRole("button", { name: "Kiểm tra và thêm bot" }));
    expect(await screen.findByRole("alert")).not.toHaveTextContent("LEAKED-SYNTHETIC-TOKEN");
    expect(screen.getByLabelText("Bot token")).toHaveValue("");
  });
  it("blocks duplicate submits and warns before retrying ambiguous outcomes", async () => {
    let finish!: (value: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })); vi.stubGlobal("fetch", fetcher);
    const interaction = userEvent.setup(); render(<AddBotPanel onAdded={vi.fn()} />);
    await interaction.click(screen.getByRole("button", { name: "Thêm bot" }));
    await interaction.type(screen.getByLabelText("Bot token"), "LOCAL-SYNTHETIC-TOKEN");
    const form = screen.getByRole("form", { name: "Thêm bot riêng" }); fireEvent.submit(form); fireEvent.submit(form);
    expect(fetcher).toHaveBeenCalledOnce(); finish(json({}, 502));
    expect(await screen.findByRole("alert")).toHaveTextContent(/kiểm tra danh sách.+gửi lại/i);
  });
  it("shows webhook attention without a successful connect command", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ data: { bot: { ...bot, state: "WEBHOOK_FAILED" }, connectCommand: null, connectCodeExpiresAt: null, activationCode: "WEBHOOK_ACTIVATION_FAILED" } })));
    const interaction = userEvent.setup(); render(<AddBotPanel onAdded={vi.fn()} />);
    await interaction.click(screen.getByRole("button", { name: "Thêm bot" })); await interaction.type(screen.getByLabelText("Bot token"), "LOCAL-SYNTHETIC-TOKEN"); await interaction.click(screen.getByRole("button", { name: "Kiểm tra và thêm bot" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/cần kiểm tra/i); expect(screen.queryByText(/^\/connect/)).not.toBeInTheDocument();
  });
  it.each(["provider", "echo", "malformed"])("rejects unsafe %s response without claiming success", async kind => {
    const result = { bot: { ...bot, ...(kind === "provider" ? { provider: "zalo" } : kind === "echo" ? { displayName: "LOCAL-SYNTHETIC-TOKEN" } : {}) }, connectCommand: kind === "malformed" ? null : `/connect ${"A".repeat(26)}`, connectCodeExpiresAt: 1900000000000, activationCode: null };
    vi.stubGlobal("fetch", vi.fn(async () => json({ data: result })));
    const interaction = userEvent.setup(); const onAdded = vi.fn(); render(<AddBotPanel onAdded={onAdded} />);
    await interaction.click(screen.getByRole("button", { name: "Thêm bot" })); await interaction.type(screen.getByLabelText("Bot token"), "LOCAL-SYNTHETIC-TOKEN"); await interaction.click(screen.getByRole("button", { name: "Kiểm tra và thêm bot" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/kiểm tra danh sách/i); expect(onAdded).not.toHaveBeenCalled(); expect(document.body.textContent).not.toContain("LOCAL-SYNTHETIC-TOKEN");
  });

});
