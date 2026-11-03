// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiResponseError } from "@/lib/client-api";
import { PersonalAssistantPanel } from "./PersonalAssistantWorkspace";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/client-api", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/client-api")>(), apiRequest: mocks.request }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
const initial = { revision: 4, document: { events: [], memories: [], daily: { morningEnabled: false, morningTime: "07:00", eveningEnabled: false, eveningTime: "20:00" } } };
const brief = { date: "2026-10-20", openCount: 12, overdueCount: 3, doneTodayCount: 2, next: [] };
beforeEach(() => { mocks.request.mockReset(); mocks.request.mockImplementation(path => Promise.resolve(structuredClone(path.endsWith("/brief") ? brief : initial))); });
describe("personal workspace", () => {
 it("edits explicit memory and preserves the draft on a stale save", async () => {
  mocks.request.mockImplementation((path, options) => options?.method === "PUT" ? Promise.reject(new ApiResponseError(409, "CONFLICT", "Conflict")) : Promise.resolve(structuredClone(path.endsWith("/brief") ? brief : initial)));
  render(<PersonalAssistantPanel onUnauthorized={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Thêm thông tin" }));
  fireEvent.change(screen.getByLabelText("Nhãn"), { target: { value: "Sở thích" } });
  fireEvent.change(screen.getByLabelText("Nội dung"), { target: { value: "Trà sen" } });
  fireEvent.click(screen.getByRole("button", { name: "Lưu thay đổi" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Bản nháp vẫn được giữ");
  expect(screen.getByLabelText("Nội dung")).toHaveValue("Trà sen");
  expect(mocks.request).toHaveBeenLastCalledWith("/api/v1/personal-assistant", expect.objectContaining({ method: "PUT", body: expect.objectContaining({ expectedRevision: 4 }) }));
  fireEvent.click(screen.getByRole("button", { name: "Xóa thông tin 1" }));
  expect(screen.queryByLabelText("Nội dung")).not.toBeInTheDocument();
 });
 it("keeps automation off by default and edits lunar policy and reminder offsets", async () => {
  render(<PersonalAssistantPanel onUnauthorized={vi.fn()} />);
  const morning = await screen.findByLabelText("Bản tin buổi sáng");
  expect(morning).not.toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Thêm ngày" }));
  expect(screen.getByRole("switch", { name: "Bật sự kiện" })).not.toBeChecked();
  fireEvent.change(screen.getByLabelText("Tên sự kiện"), { target: { value: "Giỗ ông" } });
  fireEvent.change(screen.getByLabelText("Lịch"), { target: { value: "LUNAR" } });
  fireEvent.change(screen.getByLabelText("Tháng nhuận"), { target: { value: "LEAP_OR_REGULAR" } });
  fireEvent.change(screen.getByLabelText("Lặp lại"), { target: { value: "ONCE" } });
  fireEvent.change(screen.getByLabelText("Năm âm lịch"), { target: { value: "2028" } });
  fireEvent.click(screen.getByLabelText("7 ngày"));
  fireEvent.click(screen.getByRole("button", { name: "Lưu thay đổi" }));
  await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("/api/v1/personal-assistant", expect.objectContaining({ body: expect.objectContaining({ document: expect.objectContaining({ events: [expect.objectContaining({ title: "Giỗ ông", calendar: "LUNAR", year: 2028, enabled: false, leapPolicy: "LEAP_OR_REGULAR", leadDays: [0,1] })] }) }) })));
  expect(screen.getByText("12")).toBeInTheDocument();
  expect(screen.getByText("3")).toBeInTheDocument();
 });
 it("does not invent progress counts when loading fails", async () => {
  mocks.request.mockImplementation(path => path.endsWith("/brief") ? Promise.reject(new Error("unavailable")) : Promise.resolve(structuredClone(initial)));
  render(<PersonalAssistantPanel onUnauthorized={vi.fn()} />);
  await screen.findByText(/Chưa thể tải tiến độ/);
  expect(screen.getByRole("link", { name: "Mở Hôm nay →" })).toHaveAttribute("href", "/app/today");
  expect(mocks.request).toHaveBeenCalledTimes(2);
 });
 it("searches only explicit memory labels and content locally", async () => {
  mocks.request.mockImplementation(path => Promise.resolve(path.endsWith("/brief") ? brief : { ...initial, document: { ...initial.document, memories: [{ id: "tea", label: "Sở thích", value: "Trà sen" }, { id: "book", label: "Sách", value: "Lịch sử" }] } }));
  render(<PersonalAssistantPanel onUnauthorized={vi.fn()} />);
  const query = await screen.findByLabelText("Tìm thông tin đã ghi nhớ");
  fireEvent.change(query, { target: { value: "TRÀ" } });
  expect(screen.getByDisplayValue("Trà sen").closest("fieldset")).not.toHaveAttribute("hidden");
  expect(screen.getByDisplayValue("Lịch sử").closest("fieldset")).toHaveAttribute("hidden");
  expect(mocks.request).toHaveBeenCalledTimes(2);
 });
 it("keeps an oversized UTF-8 draft local and never sends PUT", async () => {
  const document = { ...initial.document, memories: Array.from({ length: 16 }, (_, index) => ({ id: `memory-${index}`, label: `Ghi nhớ ${index}`, value: "ạ".repeat(2000) })) };
  mocks.request.mockImplementation(path => Promise.resolve(path.endsWith("/brief") ? brief : { ...initial, document }));
  render(<PersonalAssistantPanel onUnauthorized={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Thêm thông tin" }));
  fireEvent.change(screen.getAllByLabelText("Nhãn").at(-1)!, { target: { value: "Thông tin mới" } });
  fireEvent.change(screen.getAllByLabelText("Nội dung").at(-1)!, { target: { value: "ạ".repeat(2000) } });
  fireEvent.click(screen.getByRole("button", { name: "Lưu thay đổi" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("100 KiB");
  expect(screen.getAllByLabelText("Nội dung").at(-1)).toHaveValue("ạ".repeat(2000));
  expect(mocks.request.mock.calls.every(([, options]) => options?.method !== "PUT")).toBe(true);
 });

 it("creates a category from a hint, renames it and removes the category without losing the event", async () => {
  render(<PersonalAssistantPanel onUnauthorized={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Thêm ngày" }));
  fireEvent.change(screen.getByLabelText("Tên sự kiện"), {target:{value:"Thay nhớt xe"}});
  fireEvent.click(screen.getByRole("button", {name:"Gợi ý: Chăm xe"}));
  expect(screen.getByLabelText("Loại")).toHaveDisplayValue("Chăm xe");
  fireEvent.click(screen.getByText("Quản lý loại riêng (1/30)"));
  fireEvent.change(screen.getByLabelText("Tên loại Chăm xe"), {target:{value:"Xe gia đình"}});
  expect(screen.getByLabelText("Loại")).toHaveDisplayValue("Xe gia đình");
  fireEvent.click(screen.getByRole("button", {name:"Xóa loại Xe gia đình"}));
  expect(screen.getByLabelText("Loại")).toHaveDisplayValue("Ngày khác");
  expect(screen.getByLabelText("Tên sự kiện")).toHaveValue("Thay nhớt xe");
 });

});
