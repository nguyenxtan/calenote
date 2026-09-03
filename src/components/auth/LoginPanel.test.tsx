import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginPanel } from "./LoginPanel";

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function unauthenticated(): Response {
  return json({
    error: { code: "UNAUTHENTICATED", message: "Bạn cần đăng nhập để tiếp tục." },
  }, 401);
}

async function revealLogin(fetcher: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetcher);
  render(<LoginPanel />);
  expect(screen.getByRole("status")).toHaveTextContent("Đang kiểm tra phiên đăng nhập");
  expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  await screen.findByRole("heading", { name: "Đăng nhập vào Calenote" });
}

beforeEach(() => {
  replace.mockReset();
});

describe("LoginPanel", () => {
  it("keeps the login form hidden until session bootstrap returns 401", async () => {
    let resolveSession!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { resolveSession = resolve; });
    vi.stubGlobal("fetch", vi.fn(() => pending));

    render(<LoginPanel />);

    expect(screen.getByRole("status")).toHaveTextContent("Đang kiểm tra phiên đăng nhập");
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
    resolveSession(unauthenticated());
    expect(await screen.findByLabelText("Email")).toBeVisible();
  });

  it("redirects an authenticated visitor without rendering personal session data", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ data: { user: {
      displayName: "Ngọc An",
      email: "an@example.com",
      timezone: "Asia/Ho_Chi_Minh",
    } } })));

    render(<LoginPanel />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
    expect(screen.queryByText("Ngọc An")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  });

  it("lets a session bootstrap error be retried without revealing the form", async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(unauthenticated());
    vi.stubGlobal("fetch", fetcher);
    render(<LoginPanel />);

    const heading = await screen.findByRole("heading", { name: "Chưa thể kiểm tra phiên" });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Thử kiểm tra lại" }));
    expect(await screen.findByLabelText("Email")).toBeVisible();
  });

  it("shows the same generic accepted message and a correctly configured six-digit input", async () => {
    const user = userEvent.setup();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(unauthenticated())
      .mockResolvedValueOnce(json({ data: { accepted: true } }, 202));
    await revealLogin(fetcher);

    await user.type(screen.getByLabelText("Email"), "Owner@Example.com");
    await user.click(screen.getByRole("button", { name: "Gửi mã qua bot" }));

    const generic = "Nếu email có kết nối hợp lệ, mã 6 số đã được gửi đến cuộc chat riêng với bot.";
    expect(await screen.findByText(generic)).toBeVisible();
    const heading = screen.getByRole("heading", { name: "Nhập mã đăng nhập" });
    await waitFor(() => expect(heading).toHaveFocus());
    const code = screen.getByLabelText("Mã 6 số");
    expect(code).toHaveAttribute("inputmode", "numeric");
    expect(code).toHaveAttribute("autocomplete", "one-time-code");
    expect(code).toHaveAttribute("maxlength", "6");
    expect(fetcher).toHaveBeenNthCalledWith(2, "/api/auth/request-code", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ email: "owner@example.com" }),
      credentials: "same-origin",
      cache: "no-store",
    }));
  });

  it("exchanges the exact email and six digits then redirects only after confirmed success", async () => {
    const user = userEvent.setup();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(unauthenticated())
      .mockResolvedValueOnce(json({ data: { accepted: true } }, 202))
      .mockResolvedValueOnce(json({ data: { authenticated: true } }));
    await revealLogin(fetcher);
    await user.type(screen.getByLabelText("Email"), "owner@example.com");
    await user.click(screen.getByRole("button", { name: "Gửi mã qua bot" }));
    await user.type(await screen.findByLabelText("Mã 6 số"), "012345");
    await user.click(screen.getByRole("button", { name: "Xác nhận đăng nhập" }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
    expect(fetcher).toHaveBeenNthCalledWith(3, "/api/auth/verify-code", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ email: "owner@example.com", code: "012345" }),
    }));
    expect(screen.getByLabelText("Mã 6 số")).toHaveValue("");
  });

  it("uses one safe error for invalid, expired, reused, or exhausted codes and stays on login", async () => {
    const user = userEvent.setup();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(unauthenticated())
      .mockResolvedValueOnce(json({ data: { accepted: true } }, 202))
      .mockResolvedValueOnce(json({ error: {
        code: "INVALID_LOGIN_CODE",
        message: "Mã đăng nhập không hợp lệ hoặc đã hết hạn.",
      } }, 401));
    await revealLogin(fetcher);
    await user.type(screen.getByLabelText("Email"), "owner@example.com");
    await user.click(screen.getByRole("button", { name: "Gửi mã qua bot" }));
    const code = await screen.findByLabelText("Mã 6 số");
    await user.type(code, "654321");
    await user.click(screen.getByRole("button", { name: "Xác nhận đăng nhập" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Mã đăng nhập không hợp lệ hoặc đã hết hạn.");
    await waitFor(() => expect(screen.getByRole("alert")).toHaveFocus());
    expect(code).toHaveValue("");
    expect(replace).not.toHaveBeenCalledWith("/dashboard");
  });

  it("does not auto-retry an ambiguous code request", async () => {
    const user = userEvent.setup();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(unauthenticated())
      .mockRejectedValueOnce(new TypeError("connection reset"));
    await revealLogin(fetcher);
    await user.type(screen.getByLabelText("Email"), "owner@example.com");
    await user.click(screen.getByRole("button", { name: "Gửi mã qua bot" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/không rõ yêu cầu gửi mã đã hoàn tất/i);
    expect(screen.getByRole("alert")).toHaveTextContent(/không tự gửi lại/i);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("locks duplicate code requests while the first explicit mutation is pending", async () => {
    const user = userEvent.setup();
    let resolveRequest!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { resolveRequest = resolve; });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(unauthenticated())
      .mockReturnValueOnce(pending);
    await revealLogin(fetcher);
    await user.type(screen.getByLabelText("Email"), "owner@example.com");
    const submit = screen.getByRole("button", { name: "Gửi mã qua bot" });

    await user.click(submit);
    await user.click(submit);
    expect(submit).toBeDisabled();
    expect(fetcher).toHaveBeenCalledTimes(2);

    resolveRequest(json({ data: { accepted: true } }, 202));
    expect(await screen.findByLabelText("Mã 6 số")).toBeVisible();
  });

  it("never puts the email or login code in navigation URLs", async () => {
    const user = userEvent.setup();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(unauthenticated())
      .mockResolvedValueOnce(json({ data: { accepted: true } }, 202))
      .mockResolvedValueOnce(json({ data: { authenticated: true } }));
    await revealLogin(fetcher);
    await user.type(screen.getByLabelText("Email"), "owner@example.com");
    await user.click(screen.getByRole("button", { name: "Gửi mã qua bot" }));
    await user.type(await screen.findByLabelText("Mã 6 số"), "123456");
    await user.click(screen.getByRole("button", { name: "Xác nhận đăng nhập" }));

    await waitFor(() => expect(replace).toHaveBeenCalled());
    for (const [url] of replace.mock.calls) {
      expect(url).not.toContain("owner@example.com");
      expect(url).not.toContain("123456");
    }
  });
});
