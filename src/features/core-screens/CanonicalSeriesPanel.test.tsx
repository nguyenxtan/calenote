import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import axe from "axe-core";
import { CanonicalSeriesPanel } from "./CanonicalSeriesPanel";
import type { CanonicalSeriesView } from "@/contracts/api/canonical-series";
import {encodeCanonicalSeriesCursor} from '@/contracts/api/canonical-series';

const series = (overrides: Partial<CanonicalSeriesView> = {}): CanonicalSeriesView => ({ publicId: "A".repeat(22), revision: 1, state: "ACTIVE", title: "kiểm tra QA",
  calendar: "GREGORIAN", eventDate: null, eventTime: null,
  occurrences: [{ localDate: "2026-11-09", localTime: "09:00", status: "SENT" }, { localDate: "2026-11-16", localTime: "09:00", status: "PENDING" }], ...overrides });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const list = (items: CanonicalSeriesView[],page={hasMore:false,nextCursor:null as string|null,skipped:0}) => json({ data: { schemaVersion: "canonical-series-1", series: items,...page } });
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
it('reaches older pages with skipped metadata, then returns to the first bounded page',async()=>{
 const cursor=encodeCanonicalSeriesCursor([0,1,'A'.repeat(22)]);
 const fetch=vi.fn().mockResolvedValueOnce(list([series({title:'Trang đầu'})],{hasMore:true,nextCursor:cursor,skipped:1})).mockResolvedValueOnce(list([series({title:'Chuỗi cũ còn hoạt động'})])).mockResolvedValueOnce(list([series({title:'Trang đầu'})],{hasMore:true,nextCursor:cursor,skipped:0}));vi.stubGlobal('fetch',fetch);
 render(<CanonicalSeriesPanel ownerKey='owner' onUnauthorized={vi.fn()} onChanged={vi.fn()}/>);
 expect(await screen.findByText(/Bỏ qua 1 chuỗi/)).toBeVisible();await userEvent.click(screen.getByRole('button',{name:'Trang tiếp theo'}));
 expect(await screen.findByText('Chuỗi cũ còn hoạt động')).toBeVisible();expect(screen.queryByText('Trang đầu')).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Hủy các lần còn lại'})).toBeEnabled();
 expect(String(fetch.mock.calls[1][0])).toContain('cursor='+cursor);await userEvent.click(screen.getByRole('button',{name:'Trang trước'}));expect(await screen.findByText('Trang đầu')).toBeVisible();expect(screen.queryByText('Chuỗi cũ còn hoạt động')).not.toBeInTheDocument();
});
it('does not hide an all-corrupt page with more results, and blocks stale mutation after a failed page request',async()=>{
 const cursor=encodeCanonicalSeriesCursor([0,1,'A'.repeat(22)]);
 vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(list([],{hasMore:true,nextCursor:cursor,skipped:10})).mockResolvedValueOnce(list([series({title:'Chuỗi đọc được'})])).mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(list([series({title:'Chuỗi đọc được'})])));
 render(<CanonicalSeriesPanel ownerKey='owner' onUnauthorized={vi.fn()} onChanged={vi.fn()}/>);expect(await screen.findByText(/Bỏ qua 10 chuỗi/)).toBeVisible();await userEvent.click(screen.getByRole('button',{name:'Trang tiếp theo'}));await screen.findByText('Chuỗi đọc được');
 await userEvent.click(screen.getByRole('button',{name:'Tải lại chuỗi nhắc'}));expect(await screen.findByRole('alert')).toBeVisible();expect(screen.queryByRole('button',{name:'Hủy các lần còn lại'})).not.toBeInTheDocument();
 await userEvent.click(screen.getByRole('button',{name:'Tải lại chuỗi nhắc'}));expect(await screen.findByRole('button',{name:'Hủy các lần còn lại'})).toBeEnabled();
});
it('clears page titles on owner change and ignores a late old-owner page response',async()=>{
 let resolve!:(r:Response)=>void;const unauthorized=vi.fn(),changed=vi.fn();
 vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(list([series({title:'Dữ liệu cũ'})])).mockImplementationOnce(()=>new Promise<Response>(r=>{resolve=r;})).mockResolvedValueOnce(list([series({title:'Dữ liệu mới'})])));
 const {rerender}=render(<CanonicalSeriesPanel ownerKey='old' onUnauthorized={unauthorized} onChanged={changed}/>);await screen.findByText('Dữ liệu cũ');await userEvent.click(screen.getByRole('button',{name:'Tải lại chuỗi nhắc'}));rerender(<CanonicalSeriesPanel ownerKey='new' onUnauthorized={unauthorized} onChanged={changed}/>);expect(screen.queryByText('Dữ liệu cũ')).not.toBeInTheDocument();await screen.findByText('Dữ liệu mới');
 await act(async()=>resolve(list([series({title:'Cũ đến muộn'})])));expect(screen.queryByText('Cũ đến muộn')).not.toBeInTheDocument();expect(screen.getByText('Dữ liệu mới')).toBeVisible();
});
it('does not invalidate the new owner when an aborted old-owner page returns401',async()=>{
 let resolve!:(r:Response)=>void;const unauthorized=vi.fn(),changed=vi.fn();vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(list([series({title:'Old'})])).mockImplementationOnce(()=>new Promise<Response>(r=>{resolve=r;})).mockResolvedValueOnce(list([series({title:'New'})])));
 const {rerender}=render(<CanonicalSeriesPanel ownerKey='old' onUnauthorized={unauthorized} onChanged={changed}/>);await screen.findByText('Old');await userEvent.click(screen.getByRole('button',{name:'Tải lại chuỗi nhắc'}));rerender(<CanonicalSeriesPanel ownerKey='new' onUnauthorized={unauthorized} onChanged={changed}/>);await screen.findByText('New');await act(async()=>resolve(json({error:{code:'UNAUTHENTICATED',message:'Expired'}},401)));
 expect(unauthorized).not.toHaveBeenCalled();expect(screen.getByText('New')).toBeVisible();
});
