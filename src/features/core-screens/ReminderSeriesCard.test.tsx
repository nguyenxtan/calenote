import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import axe from "axe-core";
import { ReminderSeriesCard } from "./ReminderSeriesCard";
import type { PublicSeriesView } from "@/contracts/api/reminder-series";
const series: PublicSeriesView = { publicId: "A".repeat(22), title: "Ôn thi", revision: 1, state: "PROPOSED", action: "CREATE",
  calendarLabel: "Âm lịch Việt Nam → 2026-10-10 dương lịch", eventLabel: "Ngày sự kiện: 2026-10-11",
  occurrences: Array.from({ length: 30 }, (_, i) => ({ localDate: `2026-10-${String(i + 1).padStart(2, "0")}`, localTime: "12:00", status: "PROPOSED" })) };
describe("full finite-series preview", () => {
  it("shows every date, calendar labels and keyboard-confirmable draft without claiming creation", async () => {
    const onDecision = vi.fn(async () => {}); const user = userEvent.setup();
    const { container } = render(<ReminderSeriesCard series={series} onDecision={onDecision} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(30);
    expect(screen.getByText(series.calendarLabel)).toBeVisible();
    expect(screen.queryByText(/đã tạo/iu)).not.toBeInTheDocument();
    await user.tab(); expect(screen.getByRole("button", { name: /xác nhận/iu })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onDecision).toHaveBeenCalledWith({ publicId: series.publicId, revision: 1, action: "CONFIRM" });
    expect((await axe.run(container, { rules: { "color-contrast": { enabled: false } } })).violations).toEqual([]);
  });
  it("prevents double click and keeps a failed or stale decision visible without false success", async () => {
    let fail!: (error: Error) => void;
    render(<ReminderSeriesCard series={series} onDecision={() => new Promise((_resolve, reject) => { fail = reject; })} />);
    await userEvent.click(screen.getByRole("button", { name: /xác nhận/iu }));
    expect(screen.getByRole("button")).toBeDisabled();
    fail(new Error("stale"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/làm mới/iu);
    await waitFor(() => expect(screen.getByRole("button")).toBeEnabled());
  });
  it("offers cancellation proposal first and warns about in-flight delivery", async () => {
    const onDecision = vi.fn(async () => {});
    render(<ReminderSeriesCard series={{ ...series, state: "ACTIVE", action: null, occurrences: series.occurrences.map(item => ({ ...item, status: "UNCERTAIN" })) }} onDecision={onDecision} />);
    await userEvent.click(screen.getByRole("button", { name: /đề xuất hủy/iu }));
    expect(onDecision).toHaveBeenCalledWith({ publicId: series.publicId, revision: 1, action: "PROPOSE_CANCEL" });
    expect(screen.getByText(/không thể thu hồi/iu)).toBeVisible();
  });
});
