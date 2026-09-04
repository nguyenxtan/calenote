import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardShell } from "./DashboardShell";

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

const CONNECTION_ID = "A".repeat(22);
const SECOND_CONNECTION_ID = "B".repeat(21) + "Q";
const THIRD_CONNECTION_ID = "C".repeat(22);
const FOURTH_CONNECTION_ID = "D".repeat(22);
const REMINDER_ID = "E".repeat(22);

type Reply = () => Response | Promise<Response>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function session(): Response {
  return json({ data: { user: {
    displayName: "Ngọc An",
    email: "an@example.com",
    timezone: "Asia/Ho_Chi_Minh",
  } } });
}

function connections(items: unknown[] = []): Response {
  return json({ data: { connections: items } });
}

function reminders(items: unknown[] = []): Response {
  return json({ data: { reminders: items } });
}

function connection(
  state: "ACTIVE_BOUND" | "ACTIVE_UNBOUND" | "WEBHOOK_FAILED" | "SUSPENDED",
  publicId = CONNECTION_ID,
  displayName = "Bot lịch riêng",
) {
  return {
    publicId,
    provider: "telegram",
    displayName,
    handle: "@lich_rieng_bot",
    state,
  };
}

function reminder(
  status: "PENDING" | "CLAIMED" | "RETRYABLE" | "SENT" | "FAILED" | "UNCERTAIN" | "CANCELLED",
  publicId = REMINDER_ID,
  title = "Chuẩn bị cuộc hẹn",
  scheduledAt = Date.UTC(2030, 0, 2, 1, 30),
) {
  return { publicId, title, scheduledAt, timezone: "Asia/Ho_Chi_Minh", status };
}

function routeFetcher(routes: Record<string, Reply[]>): ReturnType<typeof vi.fn> {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const path = typeof input === "string" ? input : input instanceof URL ? input.pathname : new URL(input.url).pathname;
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const key = `${method} ${path}`;
    const queue = routes[key];
    if (!queue?.length) throw new Error(`Unexpected request: ${key}`);
    return queue.shift()!();
  });
}

async function renderAuthenticated(fetcher: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetcher);
  render(<DashboardShell />);
  expect(screen.getByRole("status")).toHaveTextContent("Đang xác thực phiên");
  expect(screen.queryByText("Ngọc An")).not.toBeInTheDocument();
  await screen.findByRole("heading", { name: "Chào, Ngọc An" });
}

beforeEach(() => {
  replace.mockReset();
});

describe("DashboardShell", () => {
  it("renders no personal content before auth and erases state immediately on 401", async () => {
    let resolveSession!: (response: Response) => void;
    const pendingSession = new Promise<Response>((resolve) => { resolveSession = resolve; });
    const fetcher = vi.fn(() => pendingSession);
    vi.stubGlobal("fetch", fetcher);

    render(<DashboardShell />);

    expect(screen.getByRole("status")).toHaveTextContent("Đang xác thực phiên");
    expect(screen.queryByText("Ngọc An")).not.toBeInTheDocument();
    resolveSession(json({ error: {
      code: "UNAUTHENTICATED",
      message: "Bạn cần đăng nhập để tiếp tục.",
    } }, 401));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
    expect(screen.queryByText("Ngọc An")).not.toBeInTheDocument();
  });

  it("loads connections and reminders independently after authentication", async () => {
    let resolveConnections!: (response: Response) => void;
    const pendingConnections = new Promise<Response>((resolve) => { resolveConnections = resolve; });
    const fetcher = routeFetcher({
      "GET /api/session": [async () => session()],
      "GET /api/connections": [async () => pendingConnections],
      "GET /api/reminders": [async () => reminders([reminder("PENDING")])],
    });
    await renderAuthenticated(fetcher);

    expect(screen.getByText("an@example.com")).toBeVisible();
    expect(await screen.findByText("Chuẩn bị cuộc hẹn")).toBeVisible();
    expect(screen.getByText("Đang tải kết nối…")).toBeVisible();

    resolveConnections(connections([connection("ACTIVE_BOUND")]));
    expect(await screen.findByText("Bot lịch riêng")).toBeVisible();
    expect(screen.getByText("Đã kết nối chat riêng")).toBeVisible();
  });

  it("keeps a successful empty reminder panel usable when connections fail, then retries only that resource", async () => {
    const fetcher = routeFetcher({
      "GET /api/session": [async () => session()],
      "GET /api/connections": [
        async () => json({ error: { code: "INTERNAL_ERROR", message: "Không thể hoàn tất yêu cầu." } }, 500),
        async () => connections([connection("ACTIVE_BOUND")]),
      ],
      "GET /api/reminders": [async () => reminders()],
    });
    await renderAuthenticated(fetcher);

    expect(await screen.findByText("Bạn chưa có nhắc hẹn nào.")).toBeVisible();
    expect(await screen.findByRole("alert")).toHaveTextContent("Chưa thể tải kết nối bot");
    await userEvent.setup().click(screen.getByRole("button", { name: "Tải lại kết nối" }));
    expect(await screen.findByText("Bot lịch riêng")).toBeVisible();
    expect(fetcher.mock.calls.filter(([path]) => path === "/api/reminders")).toHaveLength(1);
  });

  it("maps every real connection state and exposes only supported state actions", async () => {
    const fetcher = routeFetcher({
      "GET /api/session": [async () => session()],
      "GET /api/connections": [async () => connections([
        connection("ACTIVE_BOUND"),
        connection("ACTIVE_UNBOUND", SECOND_CONNECTION_ID, "Bot chờ liên kết"),
        connection("WEBHOOK_FAILED", THIRD_CONNECTION_ID, "Bot lỗi webhook"),
        connection("SUSPENDED", FOURTH_CONNECTION_ID, "Bot tạm dừng"),
      ])],
      "GET /api/reminders": [async () => reminders()],
    });
    await renderAuthenticated(fetcher);

    expect(await screen.findByText("Đã kết nối chat riêng")).toBeVisible();
    expect(screen.getByText("Chờ lệnh kết nối riêng")).toBeVisible();
    expect(screen.getByText("Đường nhận tin cần mở lại")).toBeVisible();
    expect(screen.getByText("Token không còn hiệu lực")).toBeVisible();
    expect(screen.getByRole("button", { name: /Tạo mã kết nối cho Bot chờ liên kết/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Mở lại đường nhận tin cho Bot lỗi webhook/ })).toBeEnabled();
    expect(screen.queryByText(/credential/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Bot tạm dừng/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/chưa kết nối thật|API v0.1|production gate/i)).not.toBeInTheDocument();
  });

  it("does not silently re-enable a confirmed connection action when canonical refresh fails", async () => {
    const user = userEvent.setup();
    const unbound = connection("ACTIVE_UNBOUND", SECOND_CONNECTION_ID, "Bot chờ liên kết");
    const fetcher = routeFetcher({
      "GET /api/session": [async () => session()],
      "GET /api/connections": [
        async () => connections([unbound]),
        async () => json({ error: { code: "INTERNAL_ERROR", message: "Không thể hoàn tất yêu cầu." } }, 500),
      ],
      "GET /api/reminders": [async () => reminders()],
      [`POST /api/connections/${SECOND_CONNECTION_ID}/connect-code`]: [async () => json({
        data: { connectCommand: "/connect FRESH-CODE", expiresAt: 1_900_000_000_000 },
      })],
    });
    await renderAuthenticated(fetcher);
    await screen.findByText("Bot chờ liên kết");

    await user.click(screen.getByRole("button", { name: "Tạo mã kết nối cho Bot chờ liên kết" }));

    const reconciliationWarning = await screen.findByText(/máy chủ đã ghi nhận thao tác kết nối/i);
    expect(reconciliationWarning).toHaveTextContent(/không gửi lại/i);
    expect(fetcher.mock.calls.filter(([path, init]) => path === `/api/connections/${SECOND_CONNECTION_ID}/connect-code` && init?.method === "POST")).toHaveLength(1);
  });

  it("shows every reminder lifecycle and warns against recreating an uncertain delivery", async () => {
    const statuses = ["PENDING", "CLAIMED", "RETRYABLE", "SENT", "FAILED", "UNCERTAIN", "CANCELLED"] as const;
    const fetcher = routeFetcher({
      "GET /api/session": [async () => session()],
      "GET /api/connections": [async () => connections([connection("ACTIVE_BOUND")])],
      "GET /api/reminders": [async () => reminders(statuses.map((status, index) =>
        reminder(status, String.fromCharCode(70 + index).repeat(22), `Lời nhắc ${status}`, Date.UTC(2030, 0, 2 + index, 1, 30)),
      ))],
    });
    await renderAuthenticated(fetcher);

    for (const label of ["Đang chờ", "Đang chuẩn bị gửi", "Sẽ thử gửi lại", "Đã gửi", "Gửi thất bại", "Chưa rõ đã gửi", "Đã hủy"]) {
      expect(await screen.findByText(label)).toBeVisible();
    }
    expect(screen.getByText(/không tạo lại ngay/i)).toBeVisible();
    expect(screen.getAllByRole("button", { name: /^Hủy / })).toHaveLength(3);
  });

  it("converts a Vietnam wall clock deterministically and renders only the canonical refresh after create", async () => {
    const user = userEvent.setup();
    const canonical = reminder("PENDING", REMINDER_ID, "Bản ghi đã lưu");
    const fetcher = routeFetcher({
      "GET /api/session": [async () => session()],
      "GET /api/connections": [async () => connections([connection("ACTIVE_BOUND")])],
      "GET /api/reminders": [
        async () => reminders(),
        async () => reminders([canonical]),
      ],
      "POST /api/reminders": [async () => json({ data: { reminder: reminder("PENDING", REMINDER_ID, "Không dùng phản hồi tạm") } }, 201)],
    });
    await renderAuthenticated(fetcher);
    await screen.findByText("Bạn chưa có nhắc hẹn nào.");

    await user.type(screen.getByLabelText("Nội dung nhắc"), "Bản ghi đã lưu");
    await user.type(screen.getByLabelText("Ngày giờ tại Việt Nam"), "2030-01-02T08:30");
    await user.click(screen.getByRole("button", { name: "Tạo nhắc hẹn" }));

    expect(await screen.findByText("Bản ghi đã lưu")).toBeVisible();
    expect(screen.queryByText("Không dùng phản hồi tạm")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Nhắc hẹn đã được lưu");
    expect(fetcher).toHaveBeenCalledWith("/api/reminders", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        title: "Bản ghi đã lưu",
        scheduledAt: Date.UTC(2030, 0, 2, 1, 30),
        timezone: "Asia/Ho_Chi_Minh",
      }),
    }));
  });

  it("does not invite a duplicate create after the server confirms it but canonical refresh fails", async () => {
    const user = userEvent.setup();
    const fetcher = routeFetcher({
      "GET /api/session": [async () => session()],
      "GET /api/connections": [async () => connections([connection("ACTIVE_BOUND")])],
      "GET /api/reminders": [
        async () => reminders(),
        async () => json({ error: { code: "INTERNAL_ERROR", message: "Không thể hoàn tất yêu cầu." } }, 500),
      ],
      "POST /api/reminders": [async () => json({ data: { reminder: reminder("PENDING") } }, 201)],
    });
    await renderAuthenticated(fetcher);
    await screen.findByText("Bạn chưa có nhắc hẹn nào.");

    await user.type(screen.getByLabelText("Nội dung nhắc"), "Đã được ghi nhận");
    await user.type(screen.getByLabelText("Ngày giờ tại Việt Nam"), "2030-01-02T08:30");
    await user.click(screen.getByRole("button", { name: "Tạo nhắc hẹn" }));

    const reconciliationWarning = await screen.findByText(/máy chủ đã ghi nhận nhắc hẹn/i);
    expect(reconciliationWarning).toHaveTextContent(/không tạo lại/i);
    expect(screen.getByLabelText("Nội dung nhắc")).toHaveValue("");
    expect(screen.getByLabelText("Ngày giờ tại Việt Nam")).toHaveValue("");
    expect(fetcher.mock.calls.filter(([path, init]) => path === "/api/reminders" && init?.method === "POST")).toHaveLength(1);
  });

  it("locks duplicate create submissions while the first request is unsettled", async () => {
    const user = userEvent.setup();
    let resolveCreate!: (response: Response) => void;
    const pendingCreate = new Promise<Response>((resolve) => { resolveCreate = resolve; });
    const fetcher = routeFetcher({
      "GET /api/session": [async () => session()],
      "GET /api/connections": [async () => connections([connection("ACTIVE_BOUND")])],
      "GET /api/reminders": [async () => reminders(), async () => reminders([reminder("PENDING")])],
      "POST /api/reminders": [async () => pendingCreate],
    });
    await renderAuthenticated(fetcher);
    await screen.findByText("Bạn chưa có nhắc hẹn nào.");
    await user.type(screen.getByLabelText("Nội dung nhắc"), "Chuẩn bị cuộc hẹn");
    await user.type(screen.getByLabelText("Ngày giờ tại Việt Nam"), "2030-01-02T08:30");
    const submit = screen.getByRole("button", { name: "Tạo nhắc hẹn" });

    await user.click(submit);
    await user.click(submit);

    expect(screen.getByRole("button", { name: "Đang lưu…" })).toBeDisabled();
    expect(fetcher.mock.calls.filter(([path, init]) => path === "/api/reminders" && init?.method === "POST")).toHaveLength(1);
    resolveCreate(json({ data: { reminder: reminder("PENDING") } }, 201));
    expect(await screen.findByText("Chuẩn bị cuộc hẹn")).toBeVisible();
  });

  it("does not retry an ambiguous create and performs a safe canonical refresh", async () => {
    const user = userEvent.setup();
    const fetcher = routeFetcher({
      "GET /api/session": [async () => session()],
      "GET /api/connections": [async () => connections([connection("ACTIVE_BOUND")])],
      "GET /api/reminders": [
        async () => reminders(),
        async () => reminders([reminder("PENDING", REMINDER_ID, "Có thể đã lưu")]),
      ],
      "POST /api/reminders": [async () => { throw new TypeError("connection reset"); }],
    });
    await renderAuthenticated(fetcher);
    await screen.findByText("Bạn chưa có nhắc hẹn nào.");
    await user.type(screen.getByLabelText("Nội dung nhắc"), "Có thể đã lưu");
    await user.type(screen.getByLabelText("Ngày giờ tại Việt Nam"), "2030-01-02T08:30");
    await user.click(screen.getByRole("button", { name: "Tạo nhắc hẹn" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/kết quả tạo nhắc chưa xác định/i);
    expect(await screen.findByText("Có thể đã lưu")).toBeVisible();
    expect(fetcher.mock.calls.filter(([path, init]) => path === "/api/reminders" && init?.method === "POST")).toHaveLength(1);
  });

  it("keeps a reminder visible until cancellation is canonically refreshed", async () => {
    const user = userEvent.setup();
    let resolveRefresh!: (response: Response) => void;
    const refresh = new Promise<Response>((resolve) => { resolveRefresh = resolve; });
    const fetcher = routeFetcher({
      "GET /api/session": [async () => session()],
      "GET /api/connections": [async () => connections([connection("ACTIVE_BOUND")])],
      "GET /api/reminders": [
        async () => reminders([reminder("PENDING")]),
        async () => refresh,
      ],
      [`DELETE /api/reminders/${REMINDER_ID}`]: [async () => json({ data: { cancelled: true } })],
    });
    await renderAuthenticated(fetcher);
    const title = await screen.findByText("Chuẩn bị cuộc hẹn");

    await user.click(screen.getByRole("button", { name: "Hủy Chuẩn bị cuộc hẹn" }));
    expect(title).toBeVisible();
    expect(screen.getByRole("button", { name: "Đang hủy Chuẩn bị cuộc hẹn" })).toBeDisabled();

    resolveRefresh(reminders([reminder("CANCELLED")]));
    expect(await screen.findByText("Đã hủy")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Hủy Chuẩn bị cuộc hẹn" })).not.toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledWith(`/api/reminders/${REMINDER_ID}`, expect.objectContaining({
      method: "DELETE",
      body: "{}",
    }));
  });

  it("does not imply a second cancellation is needed after the server confirms it but refresh fails", async () => {
    const user = userEvent.setup();
    const fetcher = routeFetcher({
      "GET /api/session": [async () => session()],
      "GET /api/connections": [async () => connections([connection("ACTIVE_BOUND")])],
      "GET /api/reminders": [
        async () => reminders([reminder("PENDING")]),
        async () => json({ error: { code: "INTERNAL_ERROR", message: "Không thể hoàn tất yêu cầu." } }, 500),
      ],
      [`DELETE /api/reminders/${REMINDER_ID}`]: [async () => json({ data: { cancelled: true } })],
    });
    await renderAuthenticated(fetcher);
    await user.click(await screen.findByRole("button", { name: "Hủy Chuẩn bị cuộc hẹn" }));

    const reconciliationWarning = await screen.findByText(/máy chủ đã ghi nhận việc hủy/i);
    expect(reconciliationWarning).toHaveTextContent(/không hủy lại/i);
    expect(fetcher.mock.calls.filter(([path, init]) => path === `/api/reminders/${REMINDER_ID}` && init?.method === "DELETE")).toHaveLength(1);
  });

  it("refreshes and reports the server state after a cancellation race", async () => {
    const user = userEvent.setup();
    const fetcher = routeFetcher({
      "GET /api/session": [async () => session()],
      "GET /api/connections": [async () => connections([connection("ACTIVE_BOUND")])],
      "GET /api/reminders": [
        async () => reminders([reminder("PENDING")]),
        async () => reminders([reminder("SENT")]),
      ],
      [`DELETE /api/reminders/${REMINDER_ID}`]: [async () => json({ error: {
        code: "REMINDER_NOT_CANCELLABLE",
        message: "Nhắc hẹn này không còn có thể hủy.",
      } }, 409)],
    });
    await renderAuthenticated(fetcher);
    await user.click(await screen.findByRole("button", { name: "Hủy Chuẩn bị cuộc hẹn" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Nhắc hẹn này không còn có thể hủy.");
    expect(alert).toHaveTextContent("Danh sách đã được làm mới");
    expect(await screen.findByText("Đã gửi")).toBeVisible();
  });

  it("retains account state and does not redirect when logout fails", async () => {
    const user = userEvent.setup();
    const fetcher = routeFetcher({
      "GET /api/session": [async () => session()],
      "GET /api/connections": [async () => connections()],
      "GET /api/reminders": [async () => reminders()],
      "POST /api/auth/logout": [async () => json({ error: {
        code: "INTERNAL_ERROR",
        message: "Không thể hoàn tất yêu cầu.",
      } }, 500)],
    });
    await renderAuthenticated(fetcher);
    await screen.findByText("Bạn chưa có nhắc hẹn nào.");

    await user.click(screen.getByRole("button", { name: "Đăng xuất" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/chưa thể đăng xuất/i);
    expect(screen.getByText("Ngọc An")).toBeVisible();
    expect(replace).not.toHaveBeenCalledWith("/login");
    expect(fetcher).toHaveBeenCalledWith("/api/auth/logout", expect.objectContaining({
      method: "POST",
      body: "{}",
    }));
  });

  it("clears personal UI and redirects only after logout is confirmed", async () => {
    const user = userEvent.setup();
    const fetcher = routeFetcher({
      "GET /api/session": [async () => session()],
      "GET /api/connections": [async () => connections()],
      "GET /api/reminders": [async () => reminders()],
      "POST /api/auth/logout": [async () => json({ data: { loggedOut: true } })],
    });
    await renderAuthenticated(fetcher);
    await screen.findByText("Bạn chưa có nhắc hẹn nào.");
    const account = screen.getByTestId("mobile-account-state");
    expect(within(account).getByText("Ngọc An")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Đăng xuất" }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
    expect(screen.queryByText("Ngọc An")).not.toBeInTheDocument();
  });

  it("removes already-rendered personal content when a child resource returns 401", async () => {
    let resolveConnections!: (response: Response) => void;
    const pendingConnections = new Promise<Response>((resolve) => { resolveConnections = resolve; });
    const fetcher = routeFetcher({
      "GET /api/session": [async () => session()],
      "GET /api/connections": [async () => pendingConnections],
      "GET /api/reminders": [async () => reminders([reminder("PENDING")])],
    });
    await renderAuthenticated(fetcher);
    expect(await screen.findByText("Ngọc An")).toBeVisible();
    expect(await screen.findByText("Chuẩn bị cuộc hẹn")).toBeVisible();

    resolveConnections(json({ error: {
      code: "UNAUTHENTICATED",
      message: "Bạn cần đăng nhập để tiếp tục.",
    } }, 401));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
    expect(screen.queryByText("Ngọc An")).not.toBeInTheDocument();
    expect(screen.queryByText("Chuẩn bị cuộc hẹn")).not.toBeInTheDocument();
  });

  it("contains no fake controls, fabricated counts, or live links to roadmap features", async () => {
    const fetcher = routeFetcher({
      "GET /api/session": [async () => session()],
      "GET /api/connections": [async () => connections()],
      "GET /api/reminders": [async () => reminders()],
    });
    await renderAuthenticated(fetcher);
    await screen.findByText("Bạn chưa có nhắc hẹn nào.");

    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Thông báo|Gửi tin nhắn mẫu|Tạo nhắc bằng chat/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/67%|4 \/ 6|Dữ liệu minh họa|Hộp thư chat/i)).not.toBeInTheDocument();
    for (const label of ["Cặp đôi", "Nhóm", "Thu chi", "Lặp lại", "Ứng dụng di động"]) {
      const item = screen.getByText(label);
      expect(item.closest("a,button")).toBeNull();
    }
    expect(document.querySelector('a[href="#"]')).toBeNull();
  });
});
