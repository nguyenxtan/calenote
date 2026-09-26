import { render, screen, waitFor } from "@testing-library/react";
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
