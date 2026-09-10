import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TodayExperience } from "./TodayExperience";

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const user = { displayName: "Tân", email: "tan@example.com", timezone: "Asia/Ho_Chi_Minh" };
const reminder = { publicId: "R".repeat(22), title: "Gọi khách hàng", scheduledAt: 1_800_000_000_000, timezone: "Asia/Ho_Chi_Minh", status: "PENDING" };
const action = { id: "A".repeat(22), title: "Họp vận hành ngày mai", scheduledAt: 1_800_000_100_000, timezone: "Asia/Ho_Chi_Minh", status: "PENDING" };

describe("TodayExperience", () => {
  beforeEach(() => replace.mockReset());

  it("does not reveal personal data until session confirmation, then renders the active Today shell", async () => {
    let resolveSession!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => {
      const path = typeof input === "string" ? input : input instanceof URL ? input.pathname : new URL(input.url).pathname;
      if (path === "/api/session") return new Promise<Response>((resolve) => { resolveSession = resolve; });
      if (path === "/api/reminders") return Promise.resolve(json({ data: { reminders: [reminder] } }));
      if (path === "/api/actions") return Promise.resolve(json({ data: { actions: [action] } }));
      throw new Error(`Unexpected request: ${path}`);
    }));

    render(<TodayExperience />);
    expect(screen.queryByText("Gọi khách hàng")).not.toBeInTheDocument();
    expect(screen.getByText("Đang mở Calenote")).toBeVisible();

    resolveSession(json({ data: { user } }));

    expect(await screen.findByRole("heading", { name: "Chào, Tân" })).toBeVisible();
    expect(screen.getAllByRole("link", { name: "Hôm nay" })[0]).toHaveAttribute("aria-current", "page");
    expect((await screen.findAllByText("Gọi khách hàng")).length).toBeGreaterThan(0);
    expect(await screen.findByText("Calenote đề xuất")).toBeVisible();
  });

  it("keeps reminders visible when the Actions region fails locally", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const path = typeof input === "string" ? input : input instanceof URL ? input.pathname : new URL(input.url).pathname;
      if (path === "/api/session") return json({ data: { user } });
      if (path === "/api/reminders") return json({ data: { reminders: [reminder] } });
      if (path === "/api/actions") return json({ error: { code: "INTERNAL_ERROR", message: "Không thể tải đề xuất." } }, 500);
      throw new Error(`Unexpected request: ${path}`);
    }));

    render(<TodayExperience />);

    expect((await screen.findAllByText("Gọi khách hàng")).length).toBeGreaterThan(0);
    expect(await screen.findByRole("alert")).toHaveTextContent("Không thể tải đề xuất.");
  });

  it("approves a proposal only through its existing decision endpoint", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const path = typeof input === "string" ? input : input instanceof URL ? input.pathname : new URL(input.url).pathname;
      if (path === "/api/session") return json({ data: { user } });
      if (path === "/api/reminders") return json({ data: { reminders: [reminder] } });
      if (path === "/api/actions") return json({ data: { actions: [action] } });
      if (path === `/api/actions/${action.id}/approve`) return json({ data: { decision: "APPROVED", reminderPublicId: "B".repeat(22) } });
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal("fetch", fetcher);
    const interaction = userEvent.setup();

    render(<TodayExperience />);
    await interaction.click(await screen.findByRole("button", { name: "Đồng ý Họp vận hành ngày mai" }));

    await waitFor(() => expect(fetcher).toHaveBeenCalledWith(
      `/api/actions/${action.id}/approve`,
      expect.objectContaining({ method: "POST" }),
    ));
    expect(fetcher).not.toHaveBeenCalledWith("/api/reminders", expect.objectContaining({ method: "POST" }));
  });

  it("validates Quick Capture before it can create a reminder", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const path = typeof input === "string" ? input : input instanceof URL ? input.pathname : new URL(input.url).pathname;
      if (path === "/api/session") return json({ data: { user } });
      if (path === "/api/reminders") return json({ data: { reminders: [] } });
      if (path === "/api/actions") return json({ data: { actions: [] } });
      throw new Error(`Unexpected request: ${path}`);
    }));
    const interaction = userEvent.setup();
    render(<TodayExperience />);

    expect(screen.queryByLabelText("Thời điểm nhắc")).not.toBeInTheDocument();
    await interaction.click(await screen.findByRole("button", { name: "Chọn thời gian" }));
    const manualTime = screen.getByLabelText("Thời điểm nhắc");
    expect(manualTime).toHaveAttribute("type", "datetime-local");
    fireEvent.change(manualTime, { target: { value: "2026-09-11T09:00" } });
    expect(await screen.findByText(/09:00/)).toBeVisible();
    expect(screen.queryByText("2026-09-11T09:00")).not.toBeInTheDocument();
    await interaction.click(screen.getByRole("button", { name: "Tạo lời nhắc" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Hãy nhập nội dung và thời điểm nhắc hợp lệ.");
  });

  it("rejects a proposal only through its existing decision endpoint", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const path = typeof input === "string" ? input : input instanceof URL ? input.pathname : new URL(input.url).pathname;
      if (path === "/api/session") return json({ data: { user } });
      if (path === "/api/reminders") return json({ data: { reminders: [] } });
      if (path === "/api/actions") return json({ data: { actions: [action] } });
      if (path === `/api/actions/${action.id}/reject`) return json({ data: { decision: "REJECTED" } });
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal("fetch", fetcher);
    const interaction = userEvent.setup();
    render(<TodayExperience />);

    await interaction.click(await screen.findByRole("button", { name: "Bỏ qua Họp vận hành ngày mai" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith(
      `/api/actions/${action.id}/reject`,
      expect.objectContaining({ method: "POST" }),
    ));
  });

  it("provides accessible desktop and mobile navigation", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const path = typeof input === "string" ? input : input instanceof URL ? input.pathname : new URL(input.url).pathname;
      if (path === "/api/session") return json({ data: { user } });
      if (path === "/api/reminders") return json({ data: { reminders: [] } });
      if (path === "/api/actions") return json({ data: { actions: [] } });
      throw new Error(`Unexpected request: ${path}`);
    }));
    const { container } = render(<TodayExperience />);
    await screen.findByRole("heading", { name: "Chào, Tân" });

    expect(screen.getByLabelText("Điều hướng chính trên điện thoại", { selector: "nav" })).toBeInTheDocument();
    const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(result.violations).toEqual([]);
  });
});
