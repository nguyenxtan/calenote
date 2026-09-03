import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PipelineGuide } from "./PipelineGuide";

describe("PipelineGuide", () => {
  it("describes both user-owned bot setup paths with authoritative links", () => {
    render(<PipelineGuide />);

    expect(screen.getByRole("heading", { name: "Kết nối bot của bạn với Calenote" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Zalo Bot Platform" })).toBeInTheDocument();
    expect(screen.getByText(/không phải Zalo OA OpenAPI/i)).toBeVisible();
    expect(screen.getByRole("link", { name: "Cách tạo bot trên Zalo" })).toHaveAttribute(
      "href",
      "https://docs.zaloplatforms.com/docs/BOT/create_bot",
    );

    expect(screen.getByRole("heading", { name: "Telegram Bot API" })).toBeInTheDocument();
    expect(screen.getAllByText(/@BotFather/).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Cách tạo bot trên Telegram" })).toHaveAttribute(
      "href",
      "https://core.telegram.org/bots/features#creating-a-new-bot",
    );
  });

  it("explains the deployed private-chat activation without exposing credentials", () => {
    render(<PipelineGuide />);

    const setup = screen.getByRole("region", { name: "Các bước kết nối an toàn" });
    expect(within(setup).getByText(/nhập token một lần/i)).toBeVisible();
    expect(within(setup).getByText(/mã hóa khi lưu/i)).toBeVisible();
    expect(within(setup).getByText(/đăng ký webhook/i)).toBeVisible();
    expect(screen.queryByText(/credential/i)).not.toBeInTheDocument();
    expect(within(setup).getByText("/connect <mã-một-lần>")).toBeVisible();
    expect(within(setup).getByText(/Gửi lệnh.+cuộc chat riêng/i)).toBeVisible();
    expect(within(setup).getByText(/mã hết hạn/i)).toBeVisible();
  });

  it("shows confirmation before activation and promises delivery only around the scheduled minute", () => {
    render(<PipelineGuide />);

    const pipeline = screen.getByRole("region", { name: "Từ tin nhắn đến lời nhắc" });
    expect(within(pipeline).getByText(/viết lời nhắc bằng tiếng Việt/i)).toBeVisible();
    expect(within(pipeline).getByText(/bot gửi bản xem trước/i)).toBeVisible();
    expect(within(pipeline).getByText(/xác nhận trong chat/i)).toBeVisible();
    expect(within(pipeline).getByText(/chỉ sau khi xác nhận/i)).toBeVisible();
    expect(within(pipeline).getByText(/gửi quanh phút đã hẹn/i)).toBeVisible();
  });

  it("keeps future product ideas separate from live navigation and removes prototype claims", () => {
    render(<PipelineGuide />);

    const roadmap = screen.getByRole("region", { name: "Lộ trình sau MVP" });
    for (const label of ["Cặp đôi", "Nhóm", "Thu chi", "Nhắc lặp lại", "Ứng dụng di động"]) {
      const item = within(roadmap).getByText(label);
      expect(item.closest("a,button")).toBeNull();
    }
    expect(screen.queryByText(/v0\.1|foundation|demo|beta|production gate|có trong repo/i)).not.toBeInTheDocument();
    expect(document.querySelector('a[href="#"]')).toBeNull();
  });
});
