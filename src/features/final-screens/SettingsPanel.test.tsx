import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import axe from "axe-core";
import { SettingsPanel } from "./SettingsPanel";

const user = { displayName: "Mai", email: "mai@example.test", timezone: "Asia/Ho_Chi_Minh" } as const;
const value = { addressStyle: "ban", customDisplayName: null, tone: "friendly" } as const;
describe("Settings controls", () => {
  it("replaces an old save confirmation when the draft changes", async () => {
    const interaction = userEvent.setup();
    render(<SettingsPanel user={user} value={value} save={vi.fn()} notice="Cài đặt đã được lưu." busy={false} />);
    expect(screen.getByText("Cài đặt đã được lưu.")).toBeVisible();
    await interaction.selectOptions(screen.getByLabelText("Giọng điệu"), "concise");
    expect(screen.queryByText("Cài đặt đã được lưu.")).not.toBeInTheDocument();
    expect(screen.getByText("Có thay đổi chưa lưu.")).toBeVisible();
  });
  it("validates and saves a custom appellation together with tone only on explicit submit", async () => {
    const save = vi.fn().mockResolvedValue(true), interaction = userEvent.setup();
    render(<SettingsPanel user={user} value={value} save={save} notice={null} busy={false} />);
    await interaction.selectOptions(screen.getByLabelText("Cách xưng hô"), "custom");
    await interaction.click(screen.getByRole("button", { name: "Lưu cá nhân hoá" }));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("1 đến 80");
    await interaction.type(screen.getByLabelText("Bạn muốn được gọi là gì?"), "  Tân  ");
    await interaction.selectOptions(screen.getByLabelText("Giọng điệu"), "concise");
    expect(save).not.toHaveBeenCalled();
    await interaction.click(screen.getByRole("button", { name: "Lưu cá nhân hoá" }));
    expect(save).toHaveBeenCalledWith({ addressStyle: "custom", customDisplayName: "Tân", tone: "concise" });
  });
  it("clears the custom appellation on non-custom save and disables mutations during save", async () => {
    const save = vi.fn().mockResolvedValue(true), interaction = userEvent.setup();
    const { rerender } = render(<SettingsPanel user={user} value={{ ...value, addressStyle: "custom", customDisplayName: "Tân" }} save={save} notice={null} busy={false} />);
    await interaction.selectOptions(screen.getByLabelText("Cách xưng hô"), "sep");
    await interaction.click(screen.getByRole("button", { name: "Lưu cá nhân hoá" }));
    expect(save).toHaveBeenCalledWith({ addressStyle: "sep", customDisplayName: null, tone: "friendly" });
    rerender(<SettingsPanel user={user} value={value} save={save} notice={null} busy />);
    expect(screen.getByRole("button", { name: "Đang lưu…" })).toBeDisabled();
    expect(screen.getByLabelText("Cách xưng hô")).toBeDisabled();
  });
  it("stores browser density without a server mutation and exposes real destination links", async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
    const save = vi.fn(), interaction = userEvent.setup();
    render(<SettingsPanel user={user} value={value} save={save} notice={null} busy={false} />);
    await interaction.click(screen.getByRole("button", { name: /Gọn/ }));
    expect(document.documentElement.dataset.density).toBe("compact");
    expect(window.localStorage.getItem("calenote-ui-density")).toBe("compact");
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: /Quản lý Zalo/ })).toHaveAttribute("href", "/app/connections");
    await interaction.click(screen.getByRole("button", { name: /Thoáng/ }));
    expect(document.documentElement.dataset.density).toBe("comfortable");
  });
  it("has accessible fields, headings and links", async () => {
    const { container } = render(<SettingsPanel user={user} value={value} save={vi.fn()} notice={null} busy={false} />);
    const result = await axe.run(container, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    expect(result.violations).toEqual([]);
  });
});
