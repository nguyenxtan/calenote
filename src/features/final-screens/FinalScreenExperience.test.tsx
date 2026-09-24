import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FinalScreenExperience } from "./FinalScreenExperience";

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }), useSearchParams: () => new URLSearchParams(window.location.search) }));

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

function installRecoveryFetch(initial: unknown, refresh: unknown, mutations: Record<string, Response>) {
  let connectionReads = 0;
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const path = typeof input === "string" ? input : input instanceof URL ? input.pathname : new URL(input.url).pathname;
    if (path === "/api/session") return json({ data: { user } });
    if (path === "/api/connections" && (init?.method === undefined || init.method === "GET")) return json({ data: { connections: connectionReads++ === 0 ? initial : refresh } });
    if (init?.method === "POST" && mutations[path]) return mutations[path];
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
    expect(screen.getByText("Cần kiểm tra")).toHaveAttribute("data-state", "WEBHOOK_FAILED");
    expect(screen.getByText("Kết nối cần được xác minh lại.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Kết nối" })).toHaveAttribute("aria-current", "page");
  });

  it("retries a failed webhook once and reloads the canonical connection state", async () => {
    const publicId = "F".repeat(22);
    const fetcher = installRecoveryFetch(
      [{ publicId, provider: "zalo", displayName: "Zalo", handle: null, state: "WEBHOOK_FAILED" }],
      [{ publicId, provider: "zalo", displayName: "Zalo", handle: null, state: "ACTIVE_UNBOUND" }],
      { [`/api/connections/${publicId}/webhook-retry`]: json({ data: {} }) },
    );
    const interaction = userEvent.setup();
    render(<FinalScreenExperience screen="connections" />);

    await interaction.click(await screen.findByRole("button", { name: "Mở lại đường nhận tin" }));
    await screen.findByText("Đường nhận tin đã được mở lại. Hãy tạo mã kết nối mới.");
    expect(screen.getByRole("button", { name: "Tạo mã kết nối" })).toBeVisible();
    expect(fetcher).toHaveBeenCalledWith(
      `/api/connections/${publicId}/webhook-retry`,
      expect.objectContaining({ method: "POST", credentials: "same-origin", body: "{}" }),
    );
  });

  it("shows and copies a rotated private-chat connect command for an unbound connection", async () => {
    const publicId = "U".repeat(22);
    const command = "/connect ABCDEFGHJKLMNPQRSTUVWXYZ23";
    const fetcher = installRecoveryFetch(
      [{ publicId, provider: "telegram", displayName: "Telegram", handle: null, state: "ACTIVE_UNBOUND" }],
      [{ publicId, provider: "telegram", displayName: "Telegram", handle: null, state: "ACTIVE_UNBOUND" }],
      { [`/api/connections/${publicId}/connect-code`]: json({ data: { connectCommand: command, expiresAt: Date.now() + 600_000 } }) },
    );
    const interaction = userEvent.setup();
    render(<FinalScreenExperience screen="connections" />);

    await interaction.click(await screen.findByRole("button", { name: "Tạo mã kết nối" }));
    expect(await screen.findByText(command)).toBeVisible();
    expect(screen.getByText("Chỉ gửi mã này trong cuộc trò chuyện riêng với đúng bot.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Sao chép mã kết nối" })).toBeVisible();
    expect(fetcher).toHaveBeenCalledWith(
      `/api/connections/${publicId}/connect-code`,
      expect.objectContaining({ method: "POST", credentials: "same-origin", body: "{}" }),
    );
  });

  it("keeps bound connections healthy and suspended connections out of webhook retry", async () => {
    installFetch(json({ data: { connections: [
      { publicId: "B".repeat(22), provider: "telegram", displayName: "Bot đang hoạt động", handle: null, state: "ACTIVE_BOUND" },
      { publicId: "S".repeat(22), provider: "zalo", displayName: "Cần xem lại", handle: null, state: "SUSPENDED" },
    ] } }));
    render(<FinalScreenExperience screen="connections" />);

    expect(await screen.findByText("Đã kết nối")).toBeVisible();
    expect(screen.getByText("Thông tin xác thực của bot cần được xem lại.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Mở lại đường nhận tin" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tạo mã kết nối" })).not.toBeInTheDocument();
  });

  it("keeps a failed webhook visible and reports the safe backend error when retry fails", async () => {
    const publicId = "E".repeat(22);
    installRecoveryFetch(
      [{ publicId, provider: "zalo", displayName: "Zalo", handle: null, state: "WEBHOOK_FAILED" }],
      [],
      { [`/api/connections/${publicId}/webhook-retry`]: json({ error: { code: "WEBHOOK_RETRY_FAILED", message: "Chưa thể mở lại đường nhận tin." } }, 502) },
    );
    const interaction = userEvent.setup();
    render(<FinalScreenExperience screen="connections" />);

    await interaction.click(await screen.findByRole("button", { name: "Mở lại đường nhận tin" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Chưa thể mở lại đường nhận tin.");
    expect(screen.getByRole("button", { name: "Mở lại đường nhận tin" })).toBeVisible();
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

  it("does not expose a polling control when a retired diagnostic URL is opened", async () => {
    window.history.pushState({}, "", "/app/connections?diagnostic=zalo-poll");
    installFetch(json({ data: { connections: [
      { publicId: "Z".repeat(22), provider: "zalo", displayName: "Zalo", handle: null, state: "ACTIVE_UNBOUND" },
    ] } }));

    render(<FinalScreenExperience screen="connections" />);

    await screen.findByRole("heading", { name: "Kết nối" });
    expect(screen.queryByRole("button", { name: "Chạy kiểm tra một lần" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Kiểm tra nhận tin Zalo tạm thời" })).not.toBeInTheDocument();
    window.history.pushState({}, "", "/");
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
  it("uses the preferences API while keeping account and AI controls honest", async () => { const fetcher=installSettingsFetch(); const interaction=userEvent.setup(); render(<FinalScreenExperience screen="settings" />); await screen.findByRole("heading",{name:"Cài đặt"}); expect(screen.getByText("Tên tài khoản")).toBeVisible(); expect(screen.getByRole("button",{name:"Lưu cá nhân hoá"})).toBeVisible(); expect(screen.queryByText(/OpenRouter|API key|max price/i)).not.toBeInTheDocument(); await interaction.selectOptions(screen.getByLabelText("Cách xưng hô"),"ong_tui"); expect(fetcher).not.toHaveBeenCalledWith("/api/preferences",expect.objectContaining({method:"PATCH"})); await interaction.click(screen.getByRole("button",{name:"Lưu cá nhân hoá"})); await waitFor(()=>expect(fetcher).toHaveBeenCalledWith("/api/preferences",expect.objectContaining({method:"PATCH"}))); expect(await screen.findByText("Cài đặt đã được lưu.")).toBeVisible(); });

  it("describes the production assistant as privacy-preserving and non-authoritative", async () => {
    installSettingsFetch();
    render(<FinalScreenExperience screen="settings" />);

    await screen.findByRole("heading", { name: "Cài đặt" });
    expect(screen.getByRole("heading", { name: "Quyền riêng tư & trợ lý" })).toBeVisible();
    expect(screen.getByText(/chế độ riêng tư/i)).toBeVisible();
    expect(screen.getByText(/Calenote xử lý ngày giờ/i)).toBeVisible();
    expect(screen.getByText(/chỉ tạo lời nhắc sau bước xác nhận/i)).toBeVisible();
    expect(screen.queryByText(/miễn phí|chi phí rất thấp/i)).not.toBeInTheDocument();
  });
});
