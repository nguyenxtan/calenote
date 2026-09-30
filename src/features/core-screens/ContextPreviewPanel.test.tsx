import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PublicPreviewV1 } from "@/contracts/api/conversation-previews";
import { ContextPreviewPanel } from "./ContextPreviewPanel";

const preview: PublicPreviewV1 = {
  publicId: "A".repeat(22), draftRevision: 2, previewHash: "a".repeat(64),
  expiresAt: Date.parse("2026-10-01T00:00:00Z"), decisionToken: "token",
  title: "Đi thi <b>", details: { schemaVersion: "calenote-reminder-details-1",
    location: "Quang Trung", notes: "Mang giấy tờ", eventDate: "2026-10-11", eventTime: "13:30",
    calendarProvenance: { calendar: "LUNAR_VN", sourceDate: { kind: "CIVIL_DATE", calendar: "LUNAR_VN", day: 1, month: 9, year: 2026, leapMonth: false }, provenance: { kind: "EXPLICIT_USER" } },
    resolutionVersion: "context-resolution-1" },
  occurrences: ["2026-10-09", "2026-10-10"].map((localDate, index) => ({ index, localDate, scheduledAt: Date.parse(`${localDate}T01:00:00Z`) })),
};

describe("ContextPreviewPanel", () => {
  it("shows every canonical field and occurrence as escaped text", () => {
    render(<ContextPreviewPanel previews={[preview]} loading={false} error={null} hasMore={false} onDecision={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getByText("Đi thi <b>")).toBeVisible();
    expect(screen.getByText(/Quang Trung/)).toBeVisible();
    expect(screen.getByText(/Mang giấy tờ/)).toBeVisible();
    expect(screen.getByText(/2026-10-11 13:30/)).toBeVisible();
    expect(screen.getByText(/1\/9\/2026/)).toBeVisible();
    expect(screen.getByText(/2026-10-09 08:00/)).toBeVisible();
    expect(screen.getByText(/2026-10-10 08:00/)).toBeVisible();
    expect(document.querySelector("b")).toBeNull();
  });

  it("protects rapid double clicks and gives an explicit stale result", async () => {
    let release: (value: { status: "STALE" }) => void = () => {};
    const onDecision = vi.fn(() => new Promise<{ status: "STALE" }>(resolve => { release = resolve; }));
    render(<ContextPreviewPanel previews={[preview]} loading={false} error={null} hasMore={false} onDecision={onDecision} onRetry={vi.fn()} />);
    const button = screen.getByRole("button", { name: /Lưu bản xem trước/ });
    await userEvent.click(button);
    await userEvent.click(button);
    expect(onDecision).toHaveBeenCalledTimes(1);
    release({ status: "STALE" });
    expect(await screen.findByRole("alert")).toHaveTextContent(/đã thay đổi|hết hạn/);
    expect(button).toBeDisabled();
  });

  it("retains A uncertainty after B fails and the same A and B versions refresh", async () => {
    const other = { ...preview, publicId: "B".repeat(22), title: "Việc B", previewHash: "b".repeat(64), decisionToken: "token-b" };
    const onDecision = vi.fn().mockRejectedValueOnce(new Error("unknown send result")).mockResolvedValueOnce({ status: "STALE" });
    const props = { previews: [preview, other], loading: false, error: null, hasMore: false, onDecision, onRetry: vi.fn() };
    const view = render(<ContextPreviewPanel {...props} />);
    const a = screen.getByRole("button", { name: /Lưu bản xem trước Đi thi/ });
    const b = screen.getByRole("button", { name: /Lưu bản xem trước Việc B/ });
    await userEvent.click(a);
    await waitFor(() => expect(a).toBeDisabled());
    await userEvent.click(b);
    await waitFor(() => expect(b).toBeDisabled());
    view.rerender(<ContextPreviewPanel {...props} previews={[{ ...preview }, { ...other }]} />);
    expect(a).toBeDisabled();
    expect(b).toBeDisabled();
    await userEvent.click(a);
    expect(onDecision).toHaveBeenCalledTimes(2);
  });

  it("distinguishes loading, failure, and partial preview results", () => {
    const { rerender } = render(<ContextPreviewPanel previews={[]} loading error={null} hasMore={false} onDecision={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getByText(/Đang tải bản xem trước/)).toBeVisible();
    rerender(<ContextPreviewPanel previews={[]} loading={false} error="Không tải được" hasMore={false} onDecision={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Không tải được");
    rerender(<ContextPreviewPanel previews={[preview]} loading={false} error={null} hasMore onDecision={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getByText(/Còn bản xem trước khác/)).toBeVisible();
  });

  it("keeps complete preview and both decisions operable at a 375px viewport", async () => {
    const originalWidth = window.innerWidth;
    try {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: 375 });
      window.dispatchEvent(new Event("resize"));
      const onDecision = vi.fn(async () => ({ result: "DECLINED" as const }));
      render(<ContextPreviewPanel previews={[preview]} loading={false} error={null} hasMore={false} onDecision={onDecision} onRetry={vi.fn()} />);
      expect(screen.getByText(/Lịch nguồn: Âm lịch Việt Nam/)).toBeVisible();
      expect(screen.getAllByRole("listitem")).toHaveLength(2);
      const save = screen.getByRole("button", { name: /Lưu bản xem trước/ });
      const decline = screen.getByRole("button", { name: /Bỏ qua Đi thi/ });
      expect(save).toBeEnabled();
      await userEvent.click(decline);
      expect(onDecision).toHaveBeenCalledWith(preview, "DECLINE");
      expect(await screen.findByRole("status")).toHaveTextContent(/Đã bỏ qua/);
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
      window.dispatchEvent(new Event("resize"));
    }
  });
});
