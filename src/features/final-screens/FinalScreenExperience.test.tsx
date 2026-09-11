import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FinalScreenExperience } from "./FinalScreenExperience";

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const user = { displayName: "Mai", email: "mai@example.test", timezone: "Asia/Ho_Chi_Minh" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});

function installFetch(connections: Response) {
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    const path = typeof input === "string" ? input : input instanceof URL ? input.pathname : new URL(input.url).pathname;
    if (path === "/api/session") return json({ data: { user } });
    if (path === "/api/connections") return connections;
    return json({ error: { code: "NOT_FOUND", message: "Không tìm thấy." } }, 404);
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

function installSettingsFetch() { const fetcher=vi.fn(async (input:string|URL|Request, init?:RequestInit)=>{const path=typeof input==="string"?input:input instanceof URL?input.pathname:new URL(input.url).pathname;if(path==="/api/session")return json({data:{user}});if(path==="/api/preferences"&&init?.method==="PATCH")return json({data:{preferences:{addressStyle:"ong_tui",customDisplayName:null,tone:"friendly"}}});if(path==="/api/preferences")return json({data:{preferences:{addressStyle:"ban",customDisplayName:null,tone:"concise"}}});return json({error:{code:"NOT_FOUND",message:"no"}},404);});vi.stubGlobal("fetch",fetcher);return fetcher; }

describe("FinalScreenExperience connections", () => {
  afterEach(() => vi.restoreAllMocks());

  it("renders only the supported providers with bound, unbound, and attention states", async () => {
    installFetch(json({ data: { connections: [
      { publicId: "T".repeat(22), provider: "telegram", displayName: "Mai Telegram", handle: "@mai", state: "ACTIVE_BOUND" },
      { publicId: "Z".repeat(22), provider: "zalo", displayName: "Mai Zalo", handle: null, state: "ACTIVE_UNBOUND" },
      { publicId: "F".repeat(22), provider: "telegram", displayName: "Telegram dự phòng", handle: null, state: "WEBHOOK_FAILED" },
    ] } }));

    render(<FinalScreenExperience screen="connections" />);

    expect(await screen.findByRole("heading", { name: "Kết nối" })).toBeVisible();
    expect(screen.getAllByRole("heading", { name: "Telegram" })).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "Zalo" })).toBeVisible();
    expect(screen.getByText("Đã kết nối")).toBeVisible();
    expect(screen.getByText("Chưa kết nối")).toBeVisible();
    expect(screen.getByText("Cần kiểm tra")).toBeVisible();
    expect(screen.getByText("Kết nối cần được xác minh lại.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Kết nối" })).toHaveAttribute("aria-current", "page");
  });

  it("renders a truthful supported-provider empty state", async () => {
    installFetch(json({ data: { connections: [] } }));

    render(<FinalScreenExperience screen="connections" />);

    expect(await screen.findByRole("heading", { name: "Chưa có kết nối nào." })).toBeVisible();
    expect(screen.getByText("Telegram và Zalo sẽ xuất hiện ở đây sau khi được thiết lập.")).toBeVisible();
  });

  it("keeps Connections reachable through the accessible mobile More menu", async () => {
    installFetch(json({ data: { connections: [] } }));
    const interaction = userEvent.setup();
    render(<FinalScreenExperience screen="connections" />);

    await screen.findByRole("heading", { name: "Kết nối" });
    await interaction.click(screen.getByRole("button", { name: "Mở thêm điều hướng", hidden: true }));
    expect(screen.getByRole("menu", { name: "Điều hướng thêm", hidden: true })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Kết nối", hidden: true })).toHaveAttribute("href", "/app/connections");
    await interaction.keyboard("{Escape}");
    expect(screen.queryByRole("menu", { name: "Điều hướng thêm", hidden: true })).not.toBeInTheDocument();
  });

  it("shows a generic recovery state without exposing a failed response secret", async () => {
    const secret = "telegram-token-should-never-render";
    const fetcher = installFetch(json({ error: { code: "INTERNAL_ERROR", message: secret } }, 500));

    render(<FinalScreenExperience screen="connections" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Chưa tải được dữ liệu.");
    expect(screen.queryByText(secret)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Thử lại" })).toBeVisible();
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith("/api/connections", expect.objectContaining({ credentials: "same-origin" })));
  });

  it("has no serious or critical accessibility violations with populated connections", async () => {
    installFetch(json({ data: { connections: [
      { publicId: "T".repeat(22), provider: "telegram", displayName: "Mai Telegram", handle: null, state: "ACTIVE_BOUND" },
      { publicId: "Z".repeat(22), provider: "zalo", displayName: "Mai Zalo", handle: null, state: "WEBHOOK_FAILED" },
    ] } }));
    const { container } = render(<FinalScreenExperience screen="connections" />);

    await screen.findByRole("heading", { name: "Kết nối" });
    const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(result.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);
  });
});

describe("FinalScreenExperience settings", () => {
  afterEach(() => vi.restoreAllMocks());
  it("uses the preferences API while keeping account and AI controls honest", async () => { const fetcher=installSettingsFetch(); const interaction=userEvent.setup(); render(<FinalScreenExperience screen="settings" />); await screen.findByRole("heading",{name:"Cài đặt"}); expect(screen.getByDisplayValue("Mai")).toHaveAttribute("readonly"); expect(screen.queryByRole("button",{name:/lưu/i})).not.toBeInTheDocument(); expect(screen.queryByText(/OpenRouter|API key|max price/i)).not.toBeInTheDocument(); await interaction.selectOptions(screen.getByLabelText("Cách xưng hô"),"ong_tui"); await waitFor(()=>expect(fetcher).toHaveBeenCalledWith("/api/preferences",expect.objectContaining({method:"PATCH"}))); expect(screen.getByRole("status")).toHaveTextContent("Cài đặt đã được lưu."); });
});
