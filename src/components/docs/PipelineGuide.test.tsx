import { render, screen, within } from "@testing-library/react";
import axe from "axe-core";
import { describe, expect, it } from "vitest";
import { PipelineGuide } from "./PipelineGuide";

describe("task guide", () => {
  it("links each task to a real screen and explains manual creation accurately", () => {
    render(<PipelineGuide />);
    expect(screen.getByRole("heading", { name: "Bắt đầu nhẹ nhàng với Calenote" })).toBeInTheDocument();
    const manual = screen.getByRole("region", { name: "Tạo lời nhắc trên web" });
    expect(within(manual).getByText(/chọn thời gian/i)).toBeVisible();
    expect(within(manual).getByText(/giờ Việt Nam/i)).toBeVisible();
    expect(within(manual).getByRole("link", { name: "Mở Hôm nay" })).toHaveAttribute("href", "/app/today");
    expect(screen.getByRole("link", { name: "Mở Cài đặt" })).toHaveAttribute("href", "/app/settings");
    expect(screen.getByRole("link", { name: /Cách tạo bot trên Zalo/ })).toHaveAttribute("href", "https://docs.zaloplatforms.com/docs/BOT/create_bot");
    expect(screen.getByRole("link", { name: "Bắt đầu kết nối" })).toHaveAttribute("href", "/onboarding");
    expect(screen.getAllByText(/ảnh chụp.+dữ liệu mẫu/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/giá|miễn phí không giới hạn|thu chi|bot dùng chung/i)).not.toBeInTheDocument();
  });
  it("has no serious or critical accessibility violations", async () => {
    const { container } = render(<PipelineGuide />);
    const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(result.violations.filter((item) => ["serious", "critical"].includes(item.impact ?? ""))).toEqual([]);
  });
});
