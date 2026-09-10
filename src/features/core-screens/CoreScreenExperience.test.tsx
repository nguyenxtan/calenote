import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CoreScreenExperience } from "./CoreScreenExperience";

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const user = { displayName: "Mai", email: "mai@example.test", timezone: "Asia/Ho_Chi_Minh" };
const reminder = { publicId: "R".repeat(22), title: "Gửi báo giá", scheduledAt: Date.UTC(2026, 8, 10, 7), timezone: "Asia/Ho_Chi_Minh", status: "PENDING" };
const action = { id: "A".repeat(22), title: "Họp với team vận hành", scheduledAt: Date.UTC(2026, 8, 11, 2), timezone: "Asia/Ho_Chi_Minh", status: "PENDING" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function installFetch(extra: (path: string) => Response | undefined = () => undefined) {
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    const path = typeof input === "string" ? input : input instanceof URL ? input.pathname : new URL(input.url).pathname;
    if (path === "/api/session") return json({ data: { user } });
    if (path === "/api/reminders") return json({ data: { reminders: [reminder] } });
    if (path === "/api/actions") return json({ data: { actions: [action] } });
    return extra(path) ?? json({ error: { code: "NOT_FOUND", message: "Không tìm thấy." } }, 404);
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

describe("CoreScreenExperience", () => {
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
    expect((await screen.findAllByText("Sắp tới")).length).toBeGreaterThan(1);
    await interaction.click(screen.getByRole("button", { name: `Huỷ ${reminder.title}` }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith(`/api/reminders/${reminder.publicId}/cancel`, expect.objectContaining({ method: "POST" })));
  });
});
