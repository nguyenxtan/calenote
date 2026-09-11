import { render, screen } from "@testing-library/react";
import axe from "axe-core";
import { describe, expect, it } from "vitest";
import { PublicEntryExperience } from "./PublicEntryExperience";

describe("PublicEntryExperience", () => {
  it("guides first-time and returning visitors to the canonical routes", () => {
    render(<PublicEntryExperience />);

    expect(screen.getByRole("heading", { name: "Nhắc một câu. Calenote giữ phần còn lại." })).toBeVisible();
    expect(screen.getAllByRole("link", { name: "Bắt đầu" })).toHaveLength(2);
    for (const link of screen.getAllByRole("link", { name: "Bắt đầu" })) expect(link).toHaveAttribute("href", "/onboarding");
    expect(screen.getAllByRole("link", { name: "Đăng nhập" })).toHaveLength(2);
    for (const link of screen.getAllByRole("link", { name: "Đăng nhập" })) expect(link).toHaveAttribute("href", "/login");
  });

  it("states only supported product capabilities", () => {
    render(<PublicEntryExperience />);

    expect(screen.getByText("Kết nối Telegram hoặc Zalo")).toBeVisible();
    expect(screen.queryByText(/Google Calendar|Gmail|Slack|WhatsApp|không giới hạn AI/i)).not.toBeInTheDocument();
  });

  it("has no serious or critical accessibility violations", async () => {
    const { container } = render(<PublicEntryExperience />);
    const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });

    expect(result.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);
  });
});
