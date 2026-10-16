import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoreScreenExperience } from "./CoreScreenExperience";

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const user = { displayName: "Mai", email: "mai@example.test", timezone: "Asia/Ho_Chi_Minh" };
const reminder = { publicId: "R".repeat(22), title: "Gửi báo giá", scheduledAt: Date.UTC(2026, 8, 10, 7), timezone: "Asia/Ho_Chi_Minh", status: "PENDING" };
const action = { id: "A".repeat(22), title: "Họp với team vận hành", scheduledAt: Date.UTC(2026, 8, 11, 2), timezone: "Asia/Ho_Chi_Minh", status: "PENDING" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => { vi.spyOn(Date, "now").mockReturnValue(new Date("2026-09-10T05:00:00.000Z").getTime()); });
afterEach(() => { vi.restoreAllMocks(); });

function installFetch(extra: (path: string) => Response | undefined = () => undefined) {
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    void init;
    const path = typeof input === "string" ? input : input instanceof URL ? input.pathname : new URL(input.url).pathname;
    if (path === "/api/session") return json({ data: { user } });
    if (path === "/api/reminders") return json({ data: { reminders: [reminder] } });
    if (path === "/api/actions") return json({ data: { actions: [action] } });
    if (path === "/api/reminder-series") return extra(path) ?? json({ data: { series: [] } });
    return extra(path) ?? json({ error: { code: "NOT_FOUND", message: "Không tìm thấy." } }, 404);
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

describe("CoreScreenExperience", () => {
  it("serializes cancellation clicks while a response is pending", async () => {
    let resolveCancel!: (response: Response) => void;
    let posts = 0;
    const second = { ...reminder, publicId: "S".repeat(22), title: "Gọi mẹ" };
    vi.stubGlobal("fetch", vi.fn(async (path: string | URL | Request) => {
      if (path === "/api/session") return json({ data: { user } });
      if (path === "/api/reminder-series") return json({ data: { series: [] } });
      if (String(path).endsWith("/cancel")) {
        posts += 1;
        return new Promise<Response>((resolve) => { resolveCancel = resolve; });
      }
      return json({ data: { reminders: [reminder, second] } });
    }));
    render(<CoreScreenExperience screen="reminders" />);
    const first = await screen.findByRole("button", { name: "Huỷ Gửi báo giá" });
    fireEvent.click(first);
    fireEvent.click(screen.getByRole("button", { name: "Huỷ Gọi mẹ" }));
    expect(posts).toBe(1);
    await act(async () => { resolveCancel(json({ data: { cancelled: true } })); });
  });

  it("does not let a series refresh during cancellation overwrite its committed state", async () => {
    let resolveCancel!: (response: Response) => void;
    let resolveStale!: (response: Response) => void;
    let reads = 0;
    let confirmed = false;
    const series = { publicId: "A".repeat(22), title: "Ôn thi", revision: 1, state: "PROPOSED", action: "CREATE",
      calendarLabel: "Dương lịch", eventLabel: null, occurrences: ["2026-10-08", "2026-10-09", "2026-10-10"].map(localDate => ({ localDate, localTime: "12:00", status: "PROPOSED" })) };
    vi.stubGlobal("fetch", vi.fn(async (path: string | URL | Request, init?: RequestInit) => {
      if (path === "/api/session") return json({ data: { user } });
      if (path === "/api/reminder-series") {
        if (init?.method === "POST") { confirmed = true; return json({ data: { result: "CONFIRMED" } }); }
        return json({ data: { series: confirmed ? [] : [series] } });
      }
      if (String(path).endsWith("/cancel")) return new Promise<Response>((resolve) => { resolveCancel = resolve; });
      reads += 1;
      if (reads === 2) return new Promise<Response>((resolve) => { resolveStale = resolve; });
      return json({ data: { reminders: [{ ...reminder, status: reads >= 3 ? "CANCELLED" : "PENDING" }] } });
    }));
    render(<CoreScreenExperience screen="reminders" />);
    fireEvent.click(await screen.findByRole("button", { name: "Huỷ Gửi báo giá" }));
    await userEvent.click(await screen.findByRole("button", { name: "Xác nhận tạo chuỗi nhắc" }));
    await waitFor(() => expect(reads).toBe(2));
    await act(async () => { resolveCancel(json({ data: { cancelled: true } })); });
    await waitFor(() => expect(reads).toBe(3));
    await act(async () => { resolveStale(json({ data: { reminders: [reminder] } })); });
    expect(screen.queryByRole("button", { name: "Huỷ Gửi báo giá" })).not.toBeInTheDocument();
  });

  it.each(["lost-response", "conflict"])("reads cancellation state back after %s without claiming success", async (failure) => {
    let attempted = false;
    let reads = 0;
    vi.stubGlobal("fetch", vi.fn(async (path: string | URL | Request) => {
      if (path === "/api/session") return json({ data: { user } });
      if (path === "/api/reminder-series") return json({ data: { series: [] } });
      if (path === `/api/reminders/${reminder.publicId}/cancel`) {
        attempted = true;
        if (failure === "lost-response") throw new TypeError("response lost");
        return json({ error: { code: "CONFLICT", message: "Lời nhắc đang được gửi, không thể huỷ." } }, 409);
      }
      reads += 1;
      return json({ data: { reminders: [{ ...reminder, status: attempted ? (failure === "lost-response" ? "CANCELLED" : "SENT") : "PENDING" }] } });
    }));
    render(<CoreScreenExperience screen="reminders" />);
    await userEvent.click(await screen.findByRole("button", { name: "Huỷ Gửi báo giá" }));
    await waitFor(() => expect(reads).toBe(2));
    expect(screen.queryByRole("button", { name: "Huỷ Gửi báo giá" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(failure === "lost-response" ? "Kết quả huỷ chưa xác định" : "Lời nhắc đang được gửi");
    expect(screen.getByRole("status")).not.toHaveTextContent("Lời nhắc đã được huỷ.");
  });

  it("loads grouped series from the authenticated API and refreshes after an explicit decision", async () => {
    let confirmed = false;
    const series = { publicId: "A".repeat(22), title: "Ôn thi theo chuỗi", revision: 1, state: "PROPOSED", action: "CREATE",
      calendarLabel: "Dương lịch", eventLabel: null, occurrences: ["2026-10-08", "2026-10-09", "2026-10-10"].map(localDate => ({ localDate, localTime: "12:00", status: "PROPOSED" })) };
    const fetcher = installFetch(path => path === "/api/reminder-series" ? json({ data: { series: confirmed ? [] : [series] } }) : undefined);
    const initial = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (input, ...rest) => {
      const init = rest[0] as RequestInit | undefined;
      if (input === "/api/reminder-series" && init?.method === "POST") { confirmed = true; return json({ data: { result: "CONFIRMED" } }); }
      return initial(input);
    });
    render(<CoreScreenExperience screen="reminders" />);
    expect(await screen.findByText(series.title)).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Xác nhận tạo chuỗi nhắc" }));
    await waitFor(() => expect(screen.queryByText(series.title)).not.toBeInTheDocument());
    expect(fetcher).toHaveBeenCalledWith("/api/reminder-series", expect.objectContaining({ method: "POST", body: JSON.stringify({ publicId: series.publicId, revision: 1, action: "CONFIRM" }) }));
  });
  it("renders a calendar from authenticated reminder data and exposes period controls", async () => {
    installFetch();
    const interaction = userEvent.setup();
    render(<CoreScreenExperience screen="calendar" />);
    expect(screen.queryByText("Gửi báo giá")).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Lịch" })).toBeVisible();
    expect(screen.getByText("14:00")).toBeVisible();
    await interaction.click(screen.getByRole("button", { name: "Tháng sau" }));
    expect(screen.getByRole("button", { name: "Hôm nay" })).toBeVisible();
  });

  it("shows both calendars near Tet and preserves selection through month navigation", async () => {
    vi.mocked(Date.now).mockReturnValue(Date.parse("2026-02-16T17:30:00Z"));
    installFetch(); const interaction = userEvent.setup();
    render(<CoreScreenExperience screen="calendar" />);
    await screen.findByRole("heading", { name: "Lịch" });
    expect(screen.getByRole("button", { name: /Dương lịch 2026-02-17, Âm lịch 1\/1\/2026.*đã chọn/ })).toBeVisible();
    expect(screen.getByText(/Âm lịch 1\/1\/2026/)).toBeVisible();
    await interaction.click(screen.getByRole("button", { name: "Tháng sau" }));
    expect(screen.getByText(/Âm lịch 1\/1\/2026/)).toBeVisible();
    expect(screen.getAllByRole("button", { name: /Dương lịch 2026-03-\d+, Âm lịch/ })).toHaveLength(31);
  });

  it("approves an Inbox ActionCandidate through its decision endpoint only", async () => {
    const fetcher = installFetch((path) => path === `/api/actions/${action.id}/approve` ? json({ data: { decision: "APPROVED", reminderPublicId: "B".repeat(22) } }) : undefined);
    const interaction = userEvent.setup();
    render(<CoreScreenExperience screen="inbox" />);
    await interaction.click(await screen.findByRole("button", { name: `Đồng ý ${action.title}` }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith(`/api/actions/${action.id}/approve`, expect.objectContaining({ method: "POST" })));
    expect(fetcher).not.toHaveBeenCalledWith("/api/reminders", expect.objectContaining({ method: "POST" }));
  });

  it("renders Vietnamese reminder status and only exposes the existing cancellation API", async () => {
    const fetcher = installFetch((path) => path === `/api/reminders/${reminder.publicId}/cancel` ? json({ data: { cancelled: true } }) : undefined);
    const interaction = userEvent.setup();
    render(<CoreScreenExperience screen="reminders" />);
    expect(await screen.findByText("Sắp tới")).toBeVisible();
    expect(screen.getByRole("tab", { name: "Đang chờ" })).toHaveAttribute("aria-selected", "true");
    await interaction.click(screen.getByRole("button", { name: `Huỷ ${reminder.title}` }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith(`/api/reminders/${reminder.publicId}/cancel`, expect.objectContaining({ method: "POST" })));
  });

  it("opens an accessible mobile More menu for secondary routes", async () => {
    installFetch();
    const interaction = userEvent.setup();
    render(<CoreScreenExperience screen="calendar" />);
    await screen.findByRole("heading", { name: "Lịch" });
    await interaction.click(screen.getByRole("button", { name: "Mở thêm điều hướng", hidden: true }));
    expect(screen.getByRole("group", { name: "Tất cả điều hướng", hidden: true })).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Tất cả điều hướng", hidden: true })).getByRole("link", { name: "Kết nối", hidden: true })).toHaveAttribute("href", "/app/connections");
    await interaction.keyboard("{Escape}");
    expect(screen.queryByRole("group", { name: "Tất cả điều hướng", hidden: true })).not.toBeInTheDocument();
  });

  it.each(["calendar", "inbox", "reminders"] as const)("has no serious axe violations for %s", async (screenName) => {
    installFetch();
    const { container } = render(<CoreScreenExperience screen={screenName} />);
    await screen.findByRole("heading", { level: 1 });
    const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(result.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);
  });
});
