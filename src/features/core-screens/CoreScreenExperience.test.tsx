import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoreScreenExperience } from "./CoreScreenExperience";
import { createRouter } from "@/worker/router";

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const user = { displayName: "Mai", email: "mai@example.test", timezone: "Asia/Ho_Chi_Minh" };
const reminder = { publicId: "R".repeat(21) + "A", title: "Gửi báo giá", scheduledAt: Date.UTC(2026, 8, 10, 7), timezone: "Asia/Ho_Chi_Minh", status: "PENDING" };
const action = { id: "A".repeat(22), title: "Họp với team vận hành", scheduledAt: Date.UTC(2026, 8, 11, 2), timezone: "Asia/Ho_Chi_Minh", status: "PENDING" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => { vi.spyOn(Date, "now").mockReturnValue(new Date("2026-09-10T05:00:00.000Z").getTime()); });
afterEach(() => { vi.restoreAllMocks(); });

function installFetch(extra: (path: string) => Response | undefined = () => undefined) {
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    void init;
    const path = typeof input === "string" ? input : input instanceof URL ? input.pathname : new URL(input.url).pathname;
    if (path === "/api/session") return json({ data: { user } });
    const override = extra(path);
    if (override) return override;
    if (path === "/api/v2/reminders") return json({ data: { schemaVersion: "reminders-2", reminders: [{ ...reminder, details: null }], hasMore: false, scope: "OWNER" } });
    if (path === "/api/v2/conversation-previews") return json({ data: { schemaVersion: "conversation-previews-1", previews: [], hasMore: false } });
    if (path === "/api/actions") return json({ data: { actions: [action] } });
    if (path === "/api/reminder-series") return json({ data: { series: [] } });
    return json({ error: { code: "NOT_FOUND", message: "Không tìm thấy." } }, 404);
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

describe("CoreScreenExperience", () => {
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
    const selectedDay = screen.getByRole("button", { name: /Dương lịch 2026-09-10, Âm lịch.*1 lời nhắc, đã chọn/ });
    expect(selectedDay).toBeVisible();
    const nextDay = screen.getByRole("button", { name: /Dương lịch 2026-09-11, Âm lịch.*0 lời nhắc/ });
    nextDay.focus();
    await interaction.keyboard("{Enter}");
    expect(nextDay).toHaveAttribute("aria-pressed", "true");
    await interaction.click(screen.getByRole("button", { name: "Tháng sau" }));
    expect(screen.getByRole("button", { name: "Hôm nay" })).toBeVisible();
  });

  it("shows OWNER partial scope and complete companion fields from strict V2 response", async () => {
    const details = { schemaVersion: "calenote-reminder-details-1", location: "Quang Trung", notes: "Mang giấy tờ", eventDate: "2026-09-11", eventTime: "13:30", calendarProvenance: { calendar: "GREGORIAN", sourceDate: null, provenance: { kind: "EXPLICIT_USER" } }, resolutionVersion: "context-resolution-1" };
    installFetch(path => path === "/api/v2/reminders" ? json({ data: { schemaVersion: "reminders-2", reminders: [{ ...reminder, details }], hasMore: true, scope: "OWNER" } }) : undefined);
    render(<CoreScreenExperience screen="calendar" />);
    expect(await screen.findByText("Gửi báo giá")).toBeVisible();
    await userEvent.click(screen.getByText("Gửi báo giá"));
    expect(screen.getByText(/Quang Trung/)).toBeVisible();
    expect(screen.getByText(/Mang giấy tờ/)).toBeVisible();
    expect(screen.getByText(/2026-09-11 13:30/)).toBeVisible();
    expect(screen.getByText(/chủ tài khoản/)).toBeVisible();
    expect(screen.getByText(/chỉ hiển thị một phần/)).toBeVisible();
  });

  it("shows full solar and lunar years near lunar new year even after month navigation", async () => {
    vi.mocked(Date.now).mockReturnValue(Date.parse("2026-02-16T05:00:00Z"));
    installFetch();
    render(<CoreScreenExperience screen="calendar" />);
    await screen.findByRole("heading", { name: "Lịch" });
    expect(screen.getByRole("heading", { name: /16 tháng 2.*2026/ })).toBeVisible();
    expect(screen.getByText(/Âm lịch 29\/12\/2025/)).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Tháng sau" }));
    expect(screen.getByRole("heading", { name: /16 tháng 2.*2026/ })).toBeVisible();
  });

  it("keeps dual-date grid and reminder detail controls operable at a 375px viewport", async () => {
    const originalWidth = window.innerWidth;
    try {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: 375 });
      window.dispatchEvent(new Event("resize"));
      installFetch();
      render(<CoreScreenExperience screen="calendar" />);
      await screen.findByRole("heading", { name: "Lịch" });
      expect(screen.getAllByRole("button", { name: /Dương lịch 2026-09-\d+, Âm lịch/ })).toHaveLength(30);
      expect(screen.getByRole("heading", { name: /10 tháng 9.*2026/ })).toBeVisible();
      await userEvent.click(screen.getByText("Gửi báo giá"));
      expect(screen.getByRole("region", { name: "Chi tiết lời nhắc" })).toBeVisible();
      await userEvent.click(screen.getByRole("button", { name: "Đóng chi tiết" }));
      expect(screen.queryByRole("region", { name: "Chi tiết lời nhắc" })).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Tháng sau" }));
      expect(screen.getByRole("button", { name: "Hôm nay" })).toBeVisible();
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
      window.dispatchEvent(new Event("resize"));
    }
  });

  it("approves an Inbox ActionCandidate through its decision endpoint only", async () => {
    const fetcher = installFetch((path) => path === `/api/actions/${action.id}/approve` ? json({ data: { decision: "APPROVED", reminderPublicId: "B".repeat(22) } }) : undefined);
    const interaction = userEvent.setup();
    render(<CoreScreenExperience screen="inbox" />);
    await interaction.click(await screen.findByRole("button", { name: `Đồng ý ${action.title}` }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith(`/api/actions/${action.id}/approve`, expect.objectContaining({ method: "POST" })));
    expect(fetcher).not.toHaveBeenCalledWith("/api/reminders", expect.objectContaining({ method: "POST" }));
  });

  it("cancels from the web button through the real authenticated Worker route", async () => {
    let cancelled = false;
    let routeResult: unknown;
    const router = createRouter({ remindersOperations: async () => ({
      requireUser: async () => ({ userId: "owner" }),
      listReminders: async () => [], createReminder: async () => { throw new Error("unexpected create"); },
      cancelReminder: async ({ userId, publicId }) => {
        expect(userId).toBe("owner"); expect(publicId).toBe(reminder.publicId);
        cancelled = true; return { cancelled: true as const };
      },
    }) });
    const initial = installFetch().getMockImplementation()!;
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      if (typeof input === "string" && input.startsWith("/api/reminders/")) {
        const headers = new Headers(init?.headers);
        headers.set("origin", "https://localhost:8787");
        headers.set("cookie", `__Host-calenote_session=${"A".repeat(43)}`);
        const response = await router(new Request(`https://localhost:8787${input}`, { ...init, headers }),
          { APP_ORIGIN: "https://localhost:8787", CALENOTE_RUNTIME_ENVIRONMENT: "local" } as unknown as Env,
          {} as ExecutionContext);
        routeResult = await response.clone().json();
        return response;
      }
      return initial(input, init);
    });
    render(<CoreScreenExperience screen="reminders" />);
    expect(await screen.findByText("Sắp tới")).toBeVisible();
    expect(screen.getByRole("tab", { name: "Đang chờ" })).toHaveAttribute("aria-selected", "true");
    await userEvent.click(screen.getByRole("button", { name: `Huỷ ${reminder.title}` }));
    await waitFor(() => expect(routeResult).toEqual({ data: { cancelled: true } }));
    expect(await screen.findByText("Lời nhắc đã được huỷ.")).toBeVisible();
    expect(cancelled).toBe(true);
    expect(screen.queryByRole("button", { name: `Huỷ ${reminder.title}` })).not.toBeInTheDocument();
  });

  it("opens an accessible mobile More menu for secondary routes", async () => {
    installFetch();
    const interaction = userEvent.setup();
    render(<CoreScreenExperience screen="calendar" />);
    await screen.findByRole("heading", { name: "Lịch" });
    await interaction.click(screen.getByRole("button", { name: "Mở thêm điều hướng", hidden: true }));
    expect(screen.getByRole("menu", { name: "Điều hướng thêm", hidden: true })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Kết nối", hidden: true })).toHaveAttribute("href", "/app/connections");
    await interaction.keyboard("{Escape}");
    expect(screen.queryByRole("menu", { name: "Điều hướng thêm", hidden: true })).not.toBeInTheDocument();
  });

  it.each(["calendar", "inbox", "reminders"] as const)("has no serious axe violations for %s", async (screenName) => {
    installFetch();
    const { container } = render(<CoreScreenExperience screen={screenName} />);
    await screen.findByRole("heading", { level: 1 });
    const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(result.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);
  });
});
