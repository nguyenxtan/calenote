import { fireEvent, render, screen, act } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ProductUpdates } from "./ProductUpdates";
beforeEach(() => {
 localStorage.clear();
 HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
 HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
it("keeps updates unread until acknowledged and remembers acknowledgement after remount", () => {
 const view = render(<ProductUpdates />);
 const trigger = screen.getByRole("button", { name: /có cập nhật chưa đọc/ });
 fireEvent.click(trigger);
 expect(screen.getByRole("dialog")).toBeVisible();
 fireEvent.click(screen.getByRole("button", { name: "Đóng cập nhật" }));
 expect(trigger).toHaveAccessibleName(/chưa đọc/);
 fireEvent.click(trigger);
 fireEvent.click(screen.getByRole("button", { name: "Đã đọc cập nhật" }));
 expect(trigger).toHaveAccessibleName("Có gì mới");
 expect(trigger).toHaveFocus();
 view.unmount(); render(<ProductUpdates />);
 expect(screen.getByRole("button", { name: "Có gì mới" })).toBeVisible();
});
it("stays usable if browser storage is unavailable", () => {
 const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw Error("blocked"); });
 render(<ProductUpdates />);
 fireEvent.click(screen.getByRole("button", { name: /Có gì mới/ }));
 expect(() => fireEvent.click(screen.getByRole("button", { name: "Đã đọc cập nhật" }))).not.toThrow();
 spy.mockRestore();
});
it("updates the unread indicator when another tab acknowledges the current release", () => {
 render(<ProductUpdates />);
 act(() => { localStorage.setItem("calenote.product-updates.read", "2026-10-20"); window.dispatchEvent(new Event("storage")); });
 expect(screen.getByRole("button", { name: "Có gì mới" })).toBeVisible();
});
