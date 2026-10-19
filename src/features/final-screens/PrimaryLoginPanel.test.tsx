import { render,screen,waitFor } from "@testing-library/react";
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
