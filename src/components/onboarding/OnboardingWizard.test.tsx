import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { OnboardingWizard } from "./OnboardingWizard";

async function reachTokenStep(user: ReturnType<typeof userEvent.setup>, provider = "Zalo") {
  await user.type(screen.getByLabelText("Tên hiển thị"), "Bích Tuyền");
  await user.type(screen.getByLabelText("Email"), "tuyen@example.com");
  await user.click(screen.getByRole("button", { name: "Tiếp tục chọn kênh" }));

  if (provider === "Telegram") {
    await user.click(screen.getByRole("radio", { name: /Telegram/ }));
  }
  await user.click(screen.getByRole("button", { name: "Tiếp tục nhập token" }));
}

describe("OnboardingWizard", () => {
  it("collects the Calenote profile before revealing provider setup", async () => {
    const user = userEvent.setup();
    render(<OnboardingWizard />);

    expect(screen.getByRole("heading", { name: "Thiết lập Calenote của bạn" })).toBeInTheDocument();
    expect(
      screen.getByText("Minh họa · Chat và nhắc lịch chưa hoạt động trong v0.1"),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Tiếp tục chọn kênh" })).toBeDisabled();

    await user.type(screen.getByLabelText("Tên hiển thị"), "Bích Tuyền");
    await user.type(screen.getByLabelText("Email"), "tuyen@example.com");
    await user.click(screen.getByRole("button", { name: "Tiếp tục chọn kênh" }));

    expect(screen.getByRole("heading", { name: "Bạn muốn chat ở đâu?" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Zalo Bot Platform/ })).toBeChecked();
    expect(screen.getByText("Zalo-first")).toBeInTheDocument();
  });

  it("supports native arrow-key selection between bot providers", async () => {
    const user = userEvent.setup();
    render(<OnboardingWizard />);

    await user.type(screen.getByLabelText("Tên hiển thị"), "Bích Tuyền");
    await user.type(screen.getByLabelText("Email"), "tuyen@example.com");
    await user.click(screen.getByRole("button", { name: "Tiếp tục chọn kênh" }));

    const zalo = screen.getByRole("radio", { name: /Zalo Bot Platform/ });
    zalo.focus();
    await user.keyboard("{ArrowRight}");

    expect(screen.getByRole("radio", { name: /Telegram/ })).toBeChecked();
  });

  it("verifies a Telegram token, clears the secret and keeps webhook state honest", async () => {
    const user = userEvent.setup();
    const token = "123456789:AAExample_secret-token_123456789";
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: {
            bot: {
              provider: "telegram",
              providerBotId: "123456789",
              displayName: "Thư ký Mây",
              handle: "@may_calendar_bot",
              accountType: null,
              canJoinGroups: true,
            },
          },
          meta: { tokenStored: false },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetcher);

    render(<OnboardingWizard />);
    await reachTokenStep(user, "Telegram");

    expect(screen.getByRole("heading", { name: "Kết nối bot Telegram" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Bot token"), token);
    await user.click(screen.getByRole("button", { name: "Xác minh token" }));

    expect(await screen.findByText("Thư ký Mây")).toBeInTheDocument();
    expect(screen.getByText("@may_calendar_bot")).toBeInTheDocument();
    expect(screen.queryByDisplayValue(token)).not.toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/bot-connections/verify",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ provider: "telegram", token }),
      }),
    );

    expect(screen.getByRole("radio", { name: "Dùng cho lịch cá nhân" })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Hoàn tất thiết lập" }));

    expect(screen.getByRole("heading", { name: "Bot đã được xác minh" })).toBeInTheDocument();
    expect(screen.getByText("Webhook chưa bật")).toBeInTheDocument();
    expect(screen.getByText("/connect <mã-một-lần>")).toBeInTheDocument();
  });

  it("shows a safe recovery message when verification fails", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            error: {
              code: "BOT_TOKEN_REJECTED",
              message: "Provider không chấp nhận token này. Hãy tạo hoặc sao chép lại token rồi thử lại.",
            },
          }),
          { status: 422, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    render(<OnboardingWizard />);
    await reachTokenStep(user);
    await user.type(screen.getByLabelText("Bot token"), "12345678:abc-xyz_789");
    await user.click(screen.getByRole("button", { name: "Xác minh token" }));

    expect(
      await screen.findByText(
        "Provider không chấp nhận token này. Hãy tạo hoặc sao chép lại token rồi thử lại.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Xác minh token" })).toBeEnabled();
  });

  it("rejects a mismatched provider identity instead of attaching a stale result", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: {
              bot: {
                provider: "zalo",
                providerBotId: "wrong-provider",
                displayName: "Stale bot",
                handle: null,
                accountType: "BASIC",
                canJoinGroups: true,
              },
            },
            meta: { tokenStored: false },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    render(<OnboardingWizard />);
    await reachTokenStep(user, "Telegram");
    await user.type(screen.getByLabelText("Bot token"), "123456789:AAExample_secret-token");
    await user.click(screen.getByRole("button", { name: "Xác minh token" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Kết quả xác minh không khớp kênh đã chọn. Hãy thử lại.",
    );
    expect(screen.queryByText("Stale bot")).not.toBeInTheDocument();
  });

  it("does not lose the chosen provider when navigating back from token setup", async () => {
    const user = userEvent.setup();
    render(<OnboardingWizard />);
    await reachTokenStep(user, "Telegram");

    await user.click(screen.getByRole("button", { name: "Quay lại" }));

    await waitFor(() => {
      expect(screen.getByRole("radio", { name: /Telegram/ })).toBeChecked();
    });
  });

  it("locks navigation while verifying and disables group scope when the bot cannot join", async () => {
    const user = userEvent.setup();
    const token = "123456789:AAExample_secret-token_123456789";
    let resolveProvider!: (response: Response) => void;
    const providerResponse = new Promise<Response>((resolve) => {
      resolveProvider = resolve;
    });
    vi.stubGlobal("fetch", vi.fn(() => providerResponse));

    render(<OnboardingWizard />);
    await reachTokenStep(user, "Telegram");
    await user.type(screen.getByLabelText("Bot token"), token);
    await user.click(screen.getByRole("button", { name: "Xác minh token" }));

    expect(screen.getByRole("button", { name: "Quay lại" })).toBeDisabled();

    resolveProvider(
      new Response(
        JSON.stringify({
          data: {
            bot: {
              provider: "telegram",
              providerBotId: "123456789",
              displayName: "Bot riêng tư",
              handle: "@private_bot",
              accountType: null,
              canJoinGroups: false,
            },
          },
          meta: { tokenStored: false },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    expect(await screen.findByText("Đã xác minh qua Telegram")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Dùng cho lịch cá nhân" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Dùng trong nhóm" })).toBeDisabled();
    expect(screen.getByText("Bot này không được provider cho phép vào nhóm.")).toBeInTheDocument();
  });

  it("resets scope to personal when another bot is verified", async () => {
    const user = userEvent.setup();
    const botResponse = (name: string, canJoinGroups: boolean) =>
      new Response(
        JSON.stringify({
          data: {
            bot: {
              provider: "telegram",
              providerBotId: name,
              displayName: name,
              handle: null,
              accountType: null,
              canJoinGroups,
            },
          },
          meta: { tokenStored: false },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(botResponse("Group bot", true))
        .mockResolvedValueOnce(botResponse("Private bot", false)),
    );

    render(<OnboardingWizard />);
    await reachTokenStep(user, "Telegram");
    await user.type(screen.getByLabelText("Bot token"), "first-safe-token");
    await user.click(screen.getByRole("button", { name: "Xác minh token" }));
    await user.click(await screen.findByRole("radio", { name: "Dùng trong nhóm" }));
    expect(screen.getByRole("radio", { name: "Dùng trong nhóm" })).toBeChecked();

    await user.click(screen.getByRole("button", { name: "Quay lại" }));
    await user.type(screen.getByLabelText("Bot token"), "second-safe-token");
    await user.click(screen.getByRole("button", { name: "Xác minh token" }));

    expect(await screen.findByText("Private bot")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Dùng cho lịch cá nhân" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Dùng trong nhóm" })).toBeDisabled();
  });
});
