import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DashboardShell } from "./DashboardShell";

describe("DashboardShell", () => {
  it("renders the working foundation separately from sample and future modules", () => {
    render(<DashboardShell />);

    expect(screen.getByRole("heading", { name: "Chào buổi sáng, Tuyền" })).toBeInTheDocument();
    expect(screen.getByText("Dữ liệu minh họa")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Tổng quan/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Nhắc uống vitamin")).toBeInTheDocument();

    expect(screen.getByText("Chưa kết nối thật")).toBeInTheDocument();
    expect(screen.getByText("Webhook chưa được đăng ký")).toBeInTheDocument();

    expect(screen.getByText("Cặp đôi")).toBeInTheDocument();
    expect(screen.getByText("Thu chi")).toBeInTheDocument();
    expect(screen.getAllByText("Sắp tới")).toHaveLength(2);
  });
});
