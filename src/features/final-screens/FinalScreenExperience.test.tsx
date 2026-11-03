import { render, screen, waitFor, within } from "@testing-library/react";
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

function installSettingsFetch() { const fetcher=vi.fn(async (input:string|URL|Request, init?:RequestInit)=>{const path=typeof input==="string"?input:input instanceof URL?input.pathname:new URL(input.url).pathname;if(path==="/api/session")return json({data:{user}});if(path==="/api/connections")return json({data:{connections:[]}});if(path==="/api/account/sessions")return json({data:{sessions:[]}});if(path==="/api/connections/primary-login")return json({data:{publicId:null}});if(path==="/api/preferences"&&init?.method==="PATCH")return json({data:{preferences:{addressStyle:"ong_tui",customDisplayName:null,tone:"friendly"}}});if(path==="/api/preferences")return json({data:{preferences:{addressStyle:"ban",customDisplayName:null,tone:"concise"}}});return json({error:{code:"NOT_FOUND",message:"no"}},404);});vi.stubGlobal("fetch",fetcher);return fetcher; }

describe("FinalScreenExperience connections", () => {
  afterEach(() => vi.restoreAllMocks());

  it("announces session loading without exposing a personal shell or a large page heading", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    render(<FinalScreenExperience screen="activity" />);
    expect(screen.getByRole("status", { name: "Đang mở Calenote" })).toBeVisible();
    expect(screen.getByRole("img", { name: "Calenote" })).toBeVisible();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

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
    expect(screen.getByRole("group", { name: "Tất cả điều hướng", hidden: true })).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Tất cả điều hướng", hidden: true })).getByRole("link", { name: "Kết nối", hidden: true })).toHaveAttribute("href", "/app/connections");
    await interaction.keyboard("{Escape}");
    expect(screen.queryByRole("group", { name: "Tất cả điều hướng", hidden: true })).not.toBeInTheDocument();
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
    expect(screen.getByText(/Calenote kiểm tra ngày giờ/i)).toBeVisible();
    expect(screen.getByText(/tạo lời nhắc theo lựa chọn xác nhận/i)).toBeVisible();
    expect(screen.queryByText(/miễn phí|chi phí rất thấp/i)).not.toBeInTheDocument();
  });
});

it('loads account settings with real channels/sessions and updates shell after profile readback',async()=>{
 const interaction=userEvent.setup();let displayName='Mai';let sessions=[{id:'current',createdAt:1,expiresAt:200,current:true},{id:'other',createdAt:1,expiresAt:200,current:false}];
 const fetcher=vi.fn(async(path:string,init?:RequestInit)=>{
 if(path==='/api/session')return json({data:{user:{...user,displayName}}});
 if(path==='/api/preferences')return json({data:{preferences:{addressStyle:'ban',customDisplayName:null,tone:'friendly'}}});
 if(path==='/api/connections')return json({data:{connections:[{publicId:'T'.repeat(22),provider:'telegram',displayName:'My bot',handle:null,state:'ACTIVE_BOUND'}]}});
 if(path==='/api/connections/primary-login')return json({data:{publicId:'T'.repeat(22)}});
 if(path==='/api/account/sessions')return json({data:{sessions}});
 if(path==='/api/account/profile'&&init?.method==='PATCH'){displayName='An';return json({data:{user:{...user,displayName}}});}
 if(path==='/api/account/sessions/revoke-others'){sessions=sessions.filter(s=>s.current);return json({data:{revoked:1}});}
 return json({error:{code:'NOT_FOUND',message:'missing'}},404);
 });vi.stubGlobal('fetch',fetcher);
 render(<FinalScreenExperience screen="settings"/>);
 const name=await screen.findByRole('textbox',{name:'Tên tài khoản'});await interaction.clear(name);await interaction.type(name,'An');await interaction.click(screen.getByRole('button',{name:'Lưu tên tài khoản'}));
 await screen.findByText('Đã lưu tên tài khoản.');expect(screen.getAllByRole('button',{name:/An/}).length).toBeGreaterThan(0);
 expect(screen.getByText('My bot')).toBeVisible();expect(screen.getByText('Phiên hiện tại')).toBeVisible();
 await interaction.click(screen.getByRole('button',{name:'Đăng xuất các phiên khác'}));await interaction.click(screen.getByRole('button',{name:'Xác nhận đăng xuất phiên khác'}));
 await screen.findByText('Đã đăng xuất các phiên khác. Phiên hiện tại vẫn hoạt động.');expect(screen.queryByText('Phiên khác 2')).toBeNull();
 expect(fetcher).toHaveBeenCalledWith('/api/account/sessions/revoke-others',expect.objectContaining({method:'POST',body:'{}'}));
});
it('reports ambiguous profile or session save without inventing a successful readback',async()=>{
 const interaction=userEvent.setup();let revokeCommitted=false;
 vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
 if(path==='/api/session')return json({data:{user}});
 if(path==='/api/preferences')return json({data:{preferences:{addressStyle:'ban',customDisplayName:null,tone:'friendly'}}});
 if(path==='/api/connections')return json({data:{connections:[]}});
 if(path==='/api/connections/primary-login')return json({data:{publicId:null}});
 if(path==='/api/account/profile'&&init?.method==='PATCH')return json({data:{user:{...user,displayName:'An',unexpected:'unsafe'}}});
 if(path==='/api/account/sessions/revoke-others'){revokeCommitted=true;return json({data:{revoked:1}});}
 if(path==='/api/account/sessions'){if(revokeCommitted)return json({error:{code:'UNAVAILABLE',message:'retry'}},503);return json({data:{sessions:[{id:'current',createdAt:1,expiresAt:200,current:true},{id:'other',createdAt:1,expiresAt:200,current:false}]}});}
 return json({error:{code:'NOT_FOUND',message:'missing'}},404);
 }));
 render(<FinalScreenExperience screen="settings"/>);
 const name=await screen.findByRole('textbox',{name:'Tên tài khoản'});await interaction.clear(name);await interaction.type(name,'An');await interaction.click(screen.getByRole('button',{name:'Lưu tên tài khoản'}));
 expect(await screen.findByText('Chưa xác nhận được việc lưu tên. Hãy tải lại để kiểm tra.')).toBeVisible();expect(screen.queryByText('Đã lưu tên tài khoản.')).toBeNull();expect(screen.getAllByRole('button',{name:/Mai/}).length).toBeGreaterThan(0);
 await interaction.click(screen.getByRole('button',{name:'Đăng xuất các phiên khác'}));await interaction.click(screen.getByRole('button',{name:'Xác nhận đăng xuất phiên khác'}));
 expect(await screen.findByText('Chưa xác nhận được việc đăng xuất. Hãy tải lại danh sách trước khi thử lại.')).toBeVisible();expect(screen.queryByText('Đã đăng xuất các phiên khác. Phiên hiện tại vẫn hoạt động.')).toBeNull();
});
