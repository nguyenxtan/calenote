import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { OnboardingWizard } from "./OnboardingWizard";

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

const CONNECTION_ID = "A".repeat(22);
const FUTURE_EXPIRY = 1_900_000_000_000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function unauthenticated(): Response {
  return json(
    { error: { code: "UNAUTHENTICATED", message: "Bạn cần đăng nhập để tiếp tục." } },
    401,
  );
}

function onboarded(
  state: "ACTIVE_UNBOUND" | "ACTIVE_BOUND" | "WEBHOOK_FAILED" | "SUSPENDED",
  overrides: { command?: string | null; expiresAt?: number | null } = {},
): Response {
  const command = overrides.command === undefined
    ? state === "ACTIVE_UNBOUND" ? "/connect SAFE-CODE" : null
    : overrides.command;
  const expiresAt = overrides.expiresAt === undefined
    ? command ? FUTURE_EXPIRY : null
    : overrides.expiresAt;
  return json({
    data: {
      bot: {
        publicId: CONNECTION_ID,
        provider: "telegram",
        displayName: "Lịch riêng",
        handle: "@lich_rieng_bot",
        state,
      },
      connectCommand: command,
      connectCodeExpiresAt: expiresAt,
      activationCode: state === "WEBHOOK_FAILED" || state === "SUSPENDED"
        ? "WEBHOOK_ACTIVATION_FAILED"
        : null,
    },
  }, 201);
}

async function revealWizard(fetcher: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetcher);
  render(<OnboardingWizard />);
  expect(screen.getByRole("status")).toHaveTextContent("Đang kiểm tra phiên đăng nhập");
  expect(screen.queryByLabelText("Tên bạn")).not.toBeInTheDocument();
  await screen.findByRole("heading", { name: "Tạo không gian Calenote của bạn" });
}

async function reachTokenStep(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Tên bạn"), "Ngọc An");
  await user.type(screen.getByLabelText("Email"), "An@Example.com");
  await user.click(screen.getByRole("button", { name: "Chọn kênh chat" }));
  await user.click(screen.getByRole("radio", { name: /Telegram Bot API/ }));
  await user.click(screen.getByRole("button", { name: "Nhập bot token" }));
}

async function submitToken(user: ReturnType<typeof userEvent.setup>, token = "123456789:AA-private") {
  await reachTokenStep(user);
  await user.type(screen.getByLabelText("Bot token"), token);
  await user.click(screen.getByRole("button", { name: "Kích hoạt bot" }));
}

describe("OnboardingWizard", () => {
  it("keeps onboarding and personal fields hidden until the session check returns 401", async () => {
    let resolveSession!: (response: Response) => void;
    const session = new Promise<Response>((resolve) => { resolveSession = resolve; });
    const fetcher = vi.fn(() => session);
    vi.stubGlobal("fetch", fetcher);

    render(<OnboardingWizard />);

    expect(screen.getByRole("status")).toHaveTextContent("Đang kiểm tra phiên đăng nhập");
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();

    resolveSession(unauthenticated());
    expect(await screen.findByLabelText("Tên bạn")).toBeVisible();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("redirects an authenticated visitor without flashing onboarding", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({
      data: {
        user: {
          displayName: "Ngọc An",
          email: "an@example.com",
          timezone: "Asia/Ho_Chi_Minh",
        },
      },
    })));

    render(<OnboardingWizard />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
    expect(screen.queryByLabelText("Tên bạn")).not.toBeInTheDocument();
    expect(screen.queryByText("Ngọc An")).not.toBeInTheDocument();
  });

  it("offers an accessible retry when the session check cannot be completed", async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(unauthenticated());
    vi.stubGlobal("fetch", fetcher);

    render(<OnboardingWizard />);

    const heading = await screen.findByRole("heading", { name: "Chưa thể kiểm tra phiên" });
    await waitFor(() => expect(heading).toHaveFocus());
    await userEvent.setup().click(screen.getByRole("button", { name: "Thử kiểm tra lại" }));
    expect(await screen.findByLabelText("Tên bạn")).toBeVisible();
  });

  it("submits one durable onboarding request, clears the token, and shows the real bot and connect command", async () => {
    const user = userEvent.setup();
    const token = "123456789:AA-private";
    const fetcher = vi.fn()
      .mockResolvedValueOnce(unauthenticated())
      .mockResolvedValueOnce(onboarded("ACTIVE_UNBOUND"));
    await revealWizard(fetcher);

    expect(screen.getByText(/gửi quanh phút đã hẹn/i)).toBeVisible();
    expect(screen.getByText(/mã hóa khi lưu/i)).toBeVisible();
    expect(screen.getByRole("link", { name: /Đăng nhập/i })).toHaveAttribute("href", "/login");

    await submitToken(user, token);

    expect(await screen.findByRole("heading", { name: "Kết nối cuộc chat riêng" })).toBeVisible();
    expect(screen.getByText("Lịch riêng")).toBeVisible();
    expect(screen.getByText("@lich_rieng_bot")).toBeVisible();
    expect(screen.getByText("/connect SAFE-CODE")).toBeVisible();
    expect(screen.queryByDisplayValue(token)).not.toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenNthCalledWith(2, "/api/onboarding", expect.objectContaining({
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify({
        displayName: "Ngọc An",
        email: "an@example.com",
        timezone: "Asia/Ho_Chi_Minh",
        provider: "telegram",
        token,
      }),
    }));
  });

  it("copies the returned command only from an explicit action", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    await revealWizard(
      vi.fn()
        .mockResolvedValueOnce(unauthenticated())
        .mockResolvedValueOnce(onboarded("ACTIVE_UNBOUND")),
    );
    await submitToken(user);

    await user.click(await screen.findByRole("button", { name: "Sao chép lệnh kết nối" }));
    expect(writeText).toHaveBeenCalledWith("/connect SAFE-CODE");
    expect(screen.getByRole("status")).toHaveTextContent("Đã sao chép lệnh kết nối");
  });

  it("clears and re-hides the token after an HTTP failure", async () => {
    const user = userEvent.setup();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(unauthenticated())
      .mockResolvedValueOnce(json({
        error: {
          code: "BOT_TOKEN_REJECTED",
          message: "Provider không chấp nhận thông tin xác thực này.",
        },
      }, 422));
    await revealWizard(fetcher);
    await reachTokenStep(user);
    const tokenInput = screen.getByLabelText("Bot token");
    await user.click(screen.getByRole("button", { name: "Hiện token" }));
    await user.type(tokenInput, "rejected-secret");
    await user.click(screen.getByRole("button", { name: "Kích hoạt bot" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Provider không chấp nhận thông tin xác thực này.",
    );
    expect(tokenInput).toHaveValue("");
    expect(tokenInput).toHaveAttribute("type", "password");
    await waitFor(() => expect(screen.getByRole("alert")).toHaveFocus());
  });

  it("reports an ambiguous onboarding result, clears the token, and never retries the mutation", async () => {
    const user = userEvent.setup();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(unauthenticated())
      .mockRejectedValueOnce(new TypeError("connection reset"));
    await revealWizard(fetcher);
    await submitToken(user, "uncertain-secret");

    expect(await screen.findByRole("alert")).toHaveTextContent(/kết quả chưa xác định/i);
    expect(screen.getByRole("alert")).toHaveTextContent(/cùng email và token/i);
    expect(screen.getByLabelText("Bot token")).toHaveValue("");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("locks double-submit while the durable onboarding request is pending", async () => {
    const user = userEvent.setup();
    let resolveOnboarding!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { resolveOnboarding = resolve; });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(unauthenticated())
      .mockReturnValueOnce(pending);
    await revealWizard(fetcher);
    await reachTokenStep(user);
    await user.type(screen.getByLabelText("Bot token"), "one-request-only");

    const submit = screen.getByRole("button", { name: "Kích hoạt bot" });
    await user.click(submit);
    await user.click(submit);
    expect(submit).toBeDisabled();
    expect(fetcher).toHaveBeenCalledTimes(2);

    resolveOnboarding(onboarded("ACTIVE_UNBOUND"));
    expect(await screen.findByText("/connect SAFE-CODE")).toBeVisible();
  });

  it("shows webhook failure without a command and recovers only after an explicit retry", async () => {
    const user = userEvent.setup();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(unauthenticated())
      .mockResolvedValueOnce(onboarded("WEBHOOK_FAILED"))
      .mockResolvedValueOnce(json({
        data: {
          connection: {
            publicId: CONNECTION_ID,
            provider: "telegram",
            displayName: "Lịch riêng",
            handle: "@lich_rieng_bot",
            state: "ACTIVE_UNBOUND",
          },
          connectCommand: "/connect RECOVERED-CODE",
          expiresAt: FUTURE_EXPIRY,
        },
      }));
    await revealWizard(fetcher);
    await submitToken(user);

    expect(await screen.findByRole("heading", { name: "Đường nhận tin chưa được kích hoạt" })).toBeVisible();
    expect(screen.queryByText(/\/connect /)).not.toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole("button", { name: "Thử mở lại đường nhận tin" }));
    expect(await screen.findByText("/connect RECOVERED-CODE")).toBeVisible();
    expect(fetcher).toHaveBeenNthCalledWith(
      3,
      `/api/connections/${CONNECTION_ID}/webhook-retry`,
      expect.objectContaining({ method: "POST", body: "{}" }),
    );
  });

  it("explains a suspended connection without offering an unsupported recovery control", async () => {
    const user = userEvent.setup();
    await revealWizard(
      vi.fn()
        .mockResolvedValueOnce(unauthenticated())
        .mockResolvedValueOnce(onboarded("SUSPENDED")),
    );
    await submitToken(user);

    expect(await screen.findByRole("heading", { name: "Kết nối đã tạm dừng" })).toBeVisible();
    expect(screen.getByText(/kiểm tra lại token tại nền tảng bot/i)).toBeVisible();
    expect(screen.queryByRole("button", { name: /thử|khôi phục|kích hoạt/i })).not.toBeInTheDocument();
  });

  it("shows ACTIVE_BOUND only after the canonical connections refresh confirms it", async () => {
    const user = userEvent.setup();
    let resolveConnections!: (response: Response) => void;
    const connections = new Promise<Response>((resolve) => { resolveConnections = resolve; });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(unauthenticated())
      .mockResolvedValueOnce(onboarded("ACTIVE_BOUND"))
      .mockReturnValueOnce(connections);
    await revealWizard(fetcher);
    await submitToken(user);

    expect(await screen.findByRole("status")).toHaveTextContent("Đang xác nhận trạng thái kết nối");
    expect(screen.queryByRole("heading", { name: "Cuộc chat riêng đã kết nối" })).not.toBeInTheDocument();

    resolveConnections(json({ data: { connections: [{
      publicId: CONNECTION_ID,
      provider: "telegram",
      displayName: "Lịch riêng",
      handle: "@lich_rieng_bot",
      state: "ACTIVE_BOUND",
    }] } }));
    expect(await screen.findByRole("heading", { name: "Cuộc chat riêng đã kết nối" })).toBeVisible();
    expect(fetcher).toHaveBeenNthCalledWith(
      3,
      "/api/connections",
      expect.objectContaining({ method: "GET", cache: "no-store" }),
    );
  });

  it("does not invent a suspended or bound state when the canonical refresh fails", async () => {
    const user = userEvent.setup();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(unauthenticated())
      .mockResolvedValueOnce(onboarded("ACTIVE_BOUND"))
      .mockResolvedValueOnce(json({ error: {
        code: "INTERNAL_ERROR",
        message: "Không thể hoàn tất yêu cầu.",
      } }, 500));
    await revealWizard(fetcher);
    await submitToken(user);

    expect(await screen.findByRole("alert")).toHaveTextContent("Chưa thể xác nhận trạng thái kết nối");
    expect(screen.queryByRole("heading", { name: "Cuộc chat riêng đã kết nối" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Kết nối đã tạm dừng" })).not.toBeInTheDocument();
  });

  it("hides an expired connect command and rotates it with an authenticated empty-object mutation", async () => {
    const user = userEvent.setup();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(unauthenticated())
      .mockResolvedValueOnce(onboarded("ACTIVE_UNBOUND", {
        command: "/connect EXPIRED-CODE",
        expiresAt: 1,
      }))
      .mockResolvedValueOnce(json({
        data: { connectCommand: "/connect FRESH-CODE", expiresAt: FUTURE_EXPIRY },
      }));
    await revealWizard(fetcher);
    await submitToken(user);

    expect(await screen.findByText(/Mã kết nối đã hết hạn/i)).toBeVisible();
    expect(screen.queryByText("/connect EXPIRED-CODE")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Tạo mã kết nối mới" }));

    expect(await screen.findByText("/connect FRESH-CODE")).toBeVisible();
    expect(fetcher).toHaveBeenNthCalledWith(
      3,
      `/api/connections/${CONNECTION_ID}/connect-code`,
      expect.objectContaining({ method: "POST", body: "{}" }),
    );
  });

  it("does not expose unsupported group scope or alternative timezones", async () => {
    await revealWizard(vi.fn().mockResolvedValueOnce(unauthenticated()));

    expect(screen.getByText("Việt Nam · GMT+7")).toBeVisible();
    expect(screen.queryByText(/Bangkok|Singapore|Tokyo|nhóm/i)).not.toBeInTheDocument();
  });
});
