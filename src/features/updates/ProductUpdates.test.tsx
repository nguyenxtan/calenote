import { fireEvent, render, screen, act, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ProductUpdates } from "./ProductUpdates";
import { releaseCatalog } from '@/modules/releases/catalog';
const key='calenote.product-updates.read.member-a';
let readerId='member-a',catalog=structuredClone(releaseCatalog);
beforeEach(() => {
 localStorage.clear();readerId='member-a';catalog=structuredClone(releaseCatalog);
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({data:{readerId,catalog}}),{headers:{'content-type':'application/json'}})));
 HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
 HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
it("keeps updates unread until acknowledged and remembers acknowledgement after remount", async () => {
 const view = render(<ProductUpdates />);
 const trigger = await screen.findByRole("button", { name: /có cập nhật chưa đọc/ });
 fireEvent.click(trigger);expect(screen.getByRole("dialog")).toBeVisible();
 fireEvent.click(screen.getByRole("button", { name: "Đóng cập nhật" }));expect(trigger).toHaveAccessibleName(/chưa đọc/);
 fireEvent.click(trigger);fireEvent.click(screen.getByRole("button", { name: "Đã đọc cập nhật" }));
 expect(trigger).toHaveAccessibleName("Có gì mới");expect(trigger).toHaveFocus();
 view.unmount(); render(<ProductUpdates />);
 await waitFor(()=>expect(screen.getByRole("button", { name: "Có gì mới" })).toBeEnabled());
});
it("stays usable if browser storage is unavailable", async () => {
 vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw Error("blocked"); });
 render(<ProductUpdates />);fireEvent.click(await screen.findByRole("button", { name: /có cập nhật chưa đọc/ }));
 expect(() => fireEvent.click(screen.getByRole("button", { name: "Đã đọc cập nhật" }))).not.toThrow();
});
it("updates the unread indicator when another tab acknowledges the current release", async () => {
 render(<ProductUpdates />);await screen.findByRole('button',{name:/chưa đọc/});
 act(() => { localStorage.setItem(key,catalog.latestId); window.dispatchEvent(new Event("storage")); });
 expect(screen.getByRole("button", { name: "Có gì mới" })).toBeVisible();
});
it('notifies an already-open tab on server release changes, without auto-opening a modal',async()=>{
 localStorage.setItem(key,catalog.latestId);render(<ProductUpdates />);
 await waitFor(()=>expect(screen.getByRole('button',{name:'Có gì mới'})).toBeEnabled());
 catalog={...catalog,latestId:'next-release',notes:[{...catalog.notes[0],id:'next-release',title:'Bản mới trên máy chủ'},...catalog.notes]};
 act(()=>window.dispatchEvent(new Event('focus')));
 const trigger=await screen.findByRole('button',{name:/chưa đọc/});expect(trigger).toBeVisible();
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument();fireEvent.click(trigger);
 expect(screen.getByRole('heading',{name:'Bản mới trên máy chủ'})).toBeVisible();
});
it('does not let another account inherit read acknowledgement',async()=>{
 localStorage.setItem(key,catalog.latestId);render(<ProductUpdates />);
 await waitFor(()=>expect(screen.getByRole('button',{name:'Có gì mới'})).toBeEnabled());
 readerId='member-b';act(()=>window.dispatchEvent(new Event('focus')));
 expect(await screen.findByRole('button',{name:/chưa đọc/})).toBeVisible();
});
it('does not invent release details if the server is unavailable',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>{throw Error('offline');}));render(<ProductUpdates />);
 await screen.findByText('Chưa làm mới được thông báo cập nhật.');
 expect(screen.getByRole('button',{name:'Có gì mới'})).toBeDisabled();
 expect(screen.queryByRole('heading',{name:catalog.notes[0].title})).not.toBeInTheDocument();
});

it.each([401,403])('discards cached notes when refresh loses authorization (%s)',async(status)=>{
 const view=render(<ProductUpdates/>);fireEvent.click(await screen.findByRole('button',{name:/chưa đọc/}));
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({error:{code:'UNAUTHENTICATED',message:'Denied'}}),{status,headers:{'content-type':'application/json'}})));
 act(()=>window.dispatchEvent(new Event('focus')));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Có gì mới'})).toBeDisabled());
 expect(screen.queryByRole('heading',{name:catalog.notes[0].title})).not.toBeInTheDocument();
 expect(view.container.querySelector('dialog')).not.toHaveAttribute('open');
});
it('clears old-account notes immediately and ignores their late response after a session change',async()=>{
 let finish!:(value:Response)=>void;
 vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(resolve=>{finish=resolve;})));
 render(<ProductUpdates/>);
 act(()=>window.dispatchEvent(new Event('calenote-session-changed')));
 await act(async()=>finish(new Response(JSON.stringify({data:{readerId:'old-owner',catalog}}),{headers:{'content-type':'application/json'}})));
 expect(screen.getByRole('button',{name:'Có gì mới'})).toBeDisabled();
 expect(screen.queryByRole('heading',{name:catalog.notes[0].title})).not.toBeInTheDocument();
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({data:{readerId:'new-owner',catalog}}),{headers:{'content-type':'application/json'}})));
 act(()=>window.dispatchEvent(new Event('focus')));
 expect(await screen.findByRole('button',{name:/chưa đọc/})).toBeEnabled();
});
