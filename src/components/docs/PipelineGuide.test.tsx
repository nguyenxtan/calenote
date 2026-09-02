import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PipelineGuide } from "./PipelineGuide";

describe("PipelineGuide", () => {
  it("shows the verified v0.1 boundary and both provider pipelines", () => {
    render(<PipelineGuide />);

    expect(screen.getByRole("heading", { name: "Từ một bot token đến một lời nhắc" })).toBeInTheDocument();
    expect(screen.getByText("Đang chạy trong v0.1")).toBeInTheDocument();
    expect(screen.getByText("Chỉ getMe + chuẩn hóa BotProfile")).toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "Zalo Bot Platform mới" })).toBeInTheDocument();
    expect(screen.getByText("Không dùng Zalo OA OpenAPI.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Tài liệu Zalo chính thức" })).toHaveAttribute(
      "href",
      "https://docs.zaloplatforms.com/docs/BOT",
    );

    expect(screen.getByRole("heading", { name: "Telegram Bot API" })).toBeInTheDocument();
    expect(screen.getByText("/connect <mã-một-lần>")).toBeInTheDocument();
  });
});
