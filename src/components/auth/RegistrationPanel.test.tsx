import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { RegistrationPanel } from "./RegistrationPanel";

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(status === 200 ? { data } : { error: { code: "INVALID_CODE", message: "private account detail" } }), { status, headers: { "content-type": "application/json" } });
}
beforeEach(() => { replace.mockReset(); sessionStorage.clear(); });

async function request(fetcher: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  render(<RegistrationPanel />);
  await user.type(screen.getByLabelText("Tên bạn"), "Ngọc An");
  await user.type(screen.getByLabelText("Email"), "An@Example.com");
  await user.click(screen.getByRole("button", { name: "Gửi mã xác minh" }));
  await screen.findByLabelText("Mã 6 số");
  return user;
}

it("verifies email before creating a session, supports pasted OTP, and directs to optional bot setup", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(json({ accepted: true, challengeId: "challenge", expiresAt: Date.now() + 600000 }))
    .mockResolvedValueOnce(json({ registered: true, next: "/app/connections" }));
  const user = await request(fetcher);
  expect(fetcher.mock.calls[0][0]).toBe("/api/auth/register/request");
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ email: "an@example.com", displayName: "Ngọc An" });
  expect(replace).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Gửi lại sau 60 giây" })).toBeDisabled();
  await user.click(screen.getByLabelText("Mã 6 số"));
  await user.paste("123 456");
  expect(screen.getByLabelText("Mã 6 số")).toHaveValue("123456");
  await user.click(screen.getByRole("button", { name: "Xác minh và tạo tài khoản" }));
  await waitFor(() => expect(replace).toHaveBeenCalledWith("/app/connections"));
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ challengeId: "challenge", email: "an@example.com", code: "123456" });
});

it("shows a safe verification failure without disclosing server account details or granting access", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(json({ accepted: true, challengeId: "challenge", expiresAt: Date.now() + 600000 }))
    .mockResolvedValueOnce(json(null, 401));
  const user = await request(fetcher);
  await user.type(screen.getByLabelText("Mã 6 số"), "123456");
  await user.click(screen.getByRole("button", { name: "Xác minh và tạo tài khoản" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Không thể xác minh mã này");
  expect(screen.queryByText("private account detail")).not.toBeInTheDocument();
  expect(replace).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Mã 6 số")).toHaveValue("");
});

it("blocks expired challenges", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(json({ accepted: true, challengeId: "expired", expiresAt: Date.now() - 1 }));
  await request(fetcher);
  expect(screen.getByLabelText("Mã 6 số")).toBeDisabled();
  expect(screen.getByText("Mã đã hết hạn. Hãy yêu cầu mã mới.")).toBeVisible();
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("only enables resend after the cooldown and replaces the old challenge", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(json({ accepted: true, challengeId: "first", expiresAt: Date.now() + 600000 }))
    .mockResolvedValueOnce(json({ accepted: true, challengeId: "second", expiresAt: Date.now() + 600000 }))
    .mockResolvedValueOnce(json({ registered: true, next: "/app/connections" }));
  let tick = () => {};
  const nativeInterval = window.setInterval.bind(window);
  const interval = vi.spyOn(window, "setInterval").mockImplementation((handler, delay) => {
    if (delay === 1000) { tick = handler as () => void; return nativeInterval(() => {}, 1000000) as unknown as ReturnType<typeof setInterval>; }
    return nativeInterval(handler, delay) as unknown as ReturnType<typeof setInterval>;
  });
  const user = await request(fetcher);
  act(() => { for (let second = 0; second < 60; second++) tick(); });
  expect(screen.getByRole("button", { name: "Gửi lại mã" })).toBeEnabled();
  interval.mockRestore();
  await user.click(screen.getByRole("button", { name: "Gửi lại mã" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  await user.type(screen.getByLabelText("Mã 6 số"), "654321");
  await user.click(screen.getByRole("button", { name: "Xác minh và tạo tài khoản" }));
  await waitFor(() => expect(replace).toHaveBeenCalledWith("/app/connections"));
  expect(JSON.parse(fetcher.mock.calls[2][1].body).challengeId).toBe("second");
});

it("consumes the email handoff without writing a URL or OTP storage", async () => {
  sessionStorage.setItem("calenote:registration-email", "new@example.com");
  render(<RegistrationPanel />);
  await waitFor(() => expect(screen.getByLabelText("Email")).toHaveValue("new@example.com"));
  expect(sessionStorage.getItem("calenote:registration-email")).toBeNull();
  expect(replace).not.toHaveBeenCalled();
});
