import { act,render,screen,waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect,it,vi } from "vitest";
import { PrimaryLoginPanel } from "./PrimaryLoginPanel";
vi.mock("next/navigation",()=>({useRouter:()=>({replace:vi.fn()})}));
it('loads the current login destination and saves only an explicit eligible choice',async()=>{
 const fetcher=vi.fn(async(_input:unknown,init?:RequestInit)=>new Response(JSON.stringify({data:{publicId:init?.method==='PATCH'?'Z'.repeat(22):'T'.repeat(22)}}),{headers:{'content-type':'application/json'}}));vi.stubGlobal('fetch',fetcher);
 const user=userEvent.setup();render(<PrimaryLoginPanel connections={[
 {publicId:'T'.repeat(22),provider:'telegram',displayName:'Telegram riêng',handle:null,state:'ACTIVE_BOUND'},
 {publicId:'Z'.repeat(22),provider:'zalo',displayName:'Zalo riêng',handle:null,state:'ACTIVE_BOUND'},
 {publicId:'U'.repeat(22),provider:'telegram',displayName:'Chưa liên kết',handle:null,state:'ACTIVE_UNBOUND'}]}/>);
 await waitFor(()=>expect(screen.getByLabelText('Bot nhận mã đăng nhập')).toHaveValue('T'.repeat(22)));
 expect(screen.queryByRole('option',{name:/Chưa liên kết/})).not.toBeInTheDocument();
 await user.selectOptions(screen.getByLabelText('Bot nhận mã đăng nhập'),'Z'.repeat(22));
 await user.click(screen.getByRole('button',{name:'Lưu kênh đăng nhập'}));
 await waitFor(()=>expect(fetcher).toHaveBeenCalledWith('/api/connections/primary-login',expect.objectContaining({method:'PATCH',body:JSON.stringify({publicId:'Z'.repeat(22)})})));
});

const connections = [
 {publicId:'T'.repeat(22),provider:'telegram',displayName:'Telegram riêng',handle:null,state:'ACTIVE_BOUND'},
 {publicId:'Z'.repeat(22),provider:'zalo',displayName:'Zalo riêng',handle:null,state:'ACTIVE_BOUND'},
] as const;
const response=(publicId:string|null)=>new Response(JSON.stringify({data:{publicId}}),{headers:{'content-type':'application/json'}});
it.each(['short','!'.repeat(22),'T'.repeat(23)])('rejects noncanonical login readback %s',async publicId=>{
 vi.stubGlobal('fetch',vi.fn(async()=>response(publicId)));
 render(<PrimaryLoginPanel connections={[...connections]}/>);
 expect(await screen.findByText(/Chưa tải được kênh đăng nhập/)).toBeVisible();
 expect(screen.getByRole('button',{name:'Lưu kênh đăng nhập'})).toBeDisabled();
});
it.each(['T'.repeat(22),null,'bad'])('does not claim a different or invalid PATCH readback was saved: %s',async publicId=>{
 const fetcher=vi.fn(async(_input:unknown,init?:RequestInit)=>response(init?.method==='PATCH'?publicId:'T'.repeat(22)));vi.stubGlobal('fetch',fetcher);
 const user=userEvent.setup();render(<PrimaryLoginPanel connections={[...connections]}/>);
 await waitFor(()=>expect(screen.getByLabelText('Bot nhận mã đăng nhập')).toHaveValue('T'.repeat(22)));
 await user.selectOptions(screen.getByLabelText('Bot nhận mã đăng nhập'),'Z'.repeat(22));
 await user.click(screen.getByRole('button',{name:'Lưu kênh đăng nhập'}));
 expect(await screen.findByText(/Chưa xác nhận được kênh đăng nhập/)).toBeVisible();
 expect(screen.queryByText('Đã lưu bot nhận mã đăng nhập.')).not.toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Lưu kênh đăng nhập'})).toBeDisabled();
 expect(fetcher).toHaveBeenCalledTimes(2);
});
it('ignores a refresh GET that resolves after a newer explicit save',async()=>{
 let resolveRefresh!:(value:Response)=>void;
 let reads=0;
 const fetcher=vi.fn(async(_input:unknown,init?:RequestInit)=>{
  if(init?.method==='PATCH')return response('Z'.repeat(22));
  if(reads++===0)return response('T'.repeat(22));
  return new Promise<Response>(resolve=>{resolveRefresh=resolve;});
 });vi.stubGlobal('fetch',fetcher);
 const user=userEvent.setup();const view=render(<PrimaryLoginPanel connections={[...connections]}/>);
 await waitFor(()=>expect(screen.getByLabelText('Bot nhận mã đăng nhập')).toHaveValue('T'.repeat(22)));
 view.rerender(<PrimaryLoginPanel connections={[...connections]}/>);
 await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(2));
 await user.selectOptions(screen.getByLabelText('Bot nhận mã đăng nhập'),'Z'.repeat(22));
 await user.click(screen.getByRole('button',{name:'Lưu kênh đăng nhập'}));
 expect(await screen.findByText('Đã lưu bot nhận mã đăng nhập.')).toBeVisible();
 await act(async()=>{resolveRefresh(response('T'.repeat(22)));});
 expect(screen.getByLabelText('Bot nhận mã đăng nhập')).toHaveValue('Z'.repeat(22));
 expect(screen.getByText('Đã lưu bot nhận mã đăng nhập.')).toBeVisible();
 expect(fetcher).toHaveBeenCalledTimes(3);
});
