import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import axe from "axe-core";
import { CanonicalSeriesPanel } from "./CanonicalSeriesPanel";
import type { CanonicalSeriesView } from "@/contracts/api/canonical-series";

const series = (overrides: Partial<CanonicalSeriesView> = {}): CanonicalSeriesView => ({ publicId: "A".repeat(22), revision: 1, state: "ACTIVE", title: "kiểm tra QA",
  calendar: "GREGORIAN", eventDate: null, eventTime: null,
  occurrences: [{ localDate: "2026-11-09", localTime: "09:00", status: "SENT" }, { localDate: "2026-11-16", localTime: "09:00", status: "PENDING" }], ...overrides });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const list = (items: CanonicalSeriesView[]) => json({ data: { schemaVersion: "canonical-series-1", series: items } });
afterEach(() => vi.unstubAllGlobals());

describe("canonical series panel", () => {
  it("shows exact dates/statuses and requires an explicit local confirmation before one POST", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(list([series()]))
      .mockResolvedValueOnce(json({ data: { result: "CANCELLED", revision: 2, cancelledReminders: 1, cancelledDeliveries: 0, stoppedTasks: 2, preservedUnchanged: 0 } }))
      .mockResolvedValueOnce(list([series({ revision: 2, state: "CANCELLED", occurrences: [{ localDate: "2026-11-09", localTime: "09:00", status: "SENT" }, { localDate: "2026-11-16", localTime: "09:00", status: "CANCELLED" }] })]));
    vi.stubGlobal("fetch", fetch);
    const onChanged = vi.fn();
    const { container } = render(<CanonicalSeriesPanel ownerKey="owner@example.test" onUnauthorized={vi.fn()} onChanged={onChanged} />);
    expect(await screen.findByText("kiểm tra QA")).toBeVisible();
    expect(screen.getByText("09/11/2026 · 09:00")).toBeVisible(); expect(screen.getByText("Đã nhắc")).toBeVisible(); expect(screen.getByText("Sắp nhắc")).toBeVisible();
    expect((await axe.run(container, { rules: { "color-contrast": { enabled: false } } })).violations).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: "Hủy các lần còn lại" }));
    expect(fetch).toHaveBeenCalledTimes(1);
    const confirm = screen.getByRole("button", { name: "Xác nhận hủy" });
    expect(screen.getByText(/không thể thu hồi/iu)).toBeVisible();
    await userEvent.dblClick(confirm);
    await screen.findByText(/Đã hủy 1 lần nhắc chưa gửi/iu);
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(JSON.parse(String(fetch.mock.calls[1][1]!.body))).toEqual({ publicId: "A".repeat(22), expectedRevision: 1 });
    expect(await screen.findByText("Đã hủy")).toBeVisible(); // readback, not optimistic
    expect(screen.queryByRole("button", { name: "Hủy các lần còn lại" })).not.toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });

  it("an unknown mutation outcome keeps a clear error and requires reload before retry", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(list([series()])).mockRejectedValueOnce(new TypeError("network")).mockResolvedValueOnce(list([series()]));
    vi.stubGlobal("fetch", fetch);
    render(<CanonicalSeriesPanel ownerKey="owner@example.test" onUnauthorized={vi.fn()} onChanged={vi.fn()} />);
    await userEvent.click(await screen.findByRole("button", { name: "Hủy các lần còn lại" }));
    await userEvent.click(screen.getByRole("button", { name: "Xác nhận hủy" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/chưa xác định/iu);
    expect(screen.queryByRole("button", { name: "Hủy các lần còn lại" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tải lại chuỗi nhắc" }));
    expect(await screen.findByRole("button", { name: "Hủy các lần còn lại" })).toBeEnabled();
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("a stale revision conflict is reported without claiming success", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(list([series()])).mockResolvedValueOnce(json({ data: { result: "CONFLICT" } }, 409)));
    render(<CanonicalSeriesPanel ownerKey="owner@example.test" onUnauthorized={vi.fn()} onChanged={vi.fn()} />);
    await userEvent.click(await screen.findByRole("button", { name: "Hủy các lần còn lại" }));
    await userEvent.click(screen.getByRole("button", { name: "Xác nhận hủy" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/đã thay đổi/iu);
    expect(screen.queryByText(/Đã hủy \d+ lần/iu)).not.toBeInTheDocument();
  });

  it("clears owner data on 401 and on session change, ignoring a late old-owner response", async () => {
    let resolveLate!: (r: Response) => void;
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(list([series()])).mockImplementationOnce(() => new Promise(r => { resolveLate = r; }));
    vi.stubGlobal("fetch", fetch);
    const onUnauthorized = vi.fn();
    render(<CanonicalSeriesPanel ownerKey="owner@example.test" onUnauthorized={onUnauthorized} onChanged={vi.fn()} />);
    expect(await screen.findByText("kiểm tra QA")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Tải lại chuỗi nhắc" }));
    act(() => { window.dispatchEvent(new Event("calenote-session-changed")); });
    expect(screen.queryByText("kiểm tra QA")).not.toBeInTheDocument();
    await act(async () => { resolveLate(list([series({ title: "dữ liệu cũ" })])); });
    expect(screen.queryByText("dữ liệu cũ")).not.toBeInTheDocument();

    vi.stubGlobal("fetch", vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(json({ error: { code: "UNAUTHORIZED", message: "x" } }, 401)));
    render(<CanonicalSeriesPanel ownerKey="other@example.test" onUnauthorized={onUnauthorized} onChanged={vi.fn()} />);
    await waitFor(() => expect(onUnauthorized).toHaveBeenCalled());
    expect(screen.queryByText("kiểm tra QA")).not.toBeInTheDocument();
  });

  it("renders nothing when the selected runtime does not offer canonical series", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(json({ error: { code: "SERIES_UNAVAILABLE", message: "x" } }, 409)));
    const { container } = render(<CanonicalSeriesPanel ownerKey="owner@example.test" onUnauthorized={vi.fn()} onChanged={vi.fn()} />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});

it("shows current snoozed dates while offering cancellation after original dates finish",async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(list([series({occurrences:[{localDate:'2026-11-09',localTime:'09:00',status:'SENT'}],currentReminders:[{localDate:'2026-11-09',localTime:'12:00',status:'PENDING'}]})])));
 render(<CanonicalSeriesPanel ownerKey='owner@example.test' onUnauthorized={vi.fn()} onChanged={vi.fn()}/>);
 expect(await screen.findByText('09/11/2026 · 12:00')).toBeVisible();
 expect(screen.getByRole('button',{name:'Hủy các lần còn lại'})).toBeEnabled();
});
it("clears owned series if a later list request returns403",async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(list([series()])).mockResolvedValueOnce(json({error:{code:'FORBIDDEN',message:'Denied'}},403)));
 render(<CanonicalSeriesPanel ownerKey='owner@example.test' onUnauthorized={vi.fn()} onChanged={vi.fn()}/>);
 await screen.findByText('kiểm tra QA');await userEvent.click(screen.getByRole('button',{name:'Tải lại chuỗi nhắc'}));
 await waitFor(()=>expect(screen.queryByText('kiểm tra QA')).not.toBeInTheDocument());
});
it("a failed refresh after a successful cancel does not claim that data was unchanged",async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(list([series()])).mockResolvedValueOnce(json({data:{result:'CANCELLED',revision:2,cancelledReminders:1,cancelledDeliveries:0,stoppedTasks:2,preservedUnchanged:0}})).mockRejectedValueOnce(new TypeError('offline')));
 render(<CanonicalSeriesPanel ownerKey='owner@example.test' onUnauthorized={vi.fn()} onChanged={vi.fn()}/>);
 await userEvent.click(await screen.findByRole('button',{name:'Hủy các lần còn lại'}));await userEvent.click(screen.getByRole('button',{name:'Xác nhận hủy'}));
 expect(await screen.findByRole('alert')).not.toHaveTextContent('Không thay đổi dữ liệu');
 expect(screen.getByText(/Đã hủy 1 lần nhắc chưa gửi/u)).toBeVisible();
});
