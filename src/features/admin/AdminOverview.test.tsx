import { releaseCatalog } from '@/modules/releases/catalog';
import { act,render,screen,waitFor } from '@testing-library/react';
import { expect,it,vi } from 'vitest';
import { AdminOverview } from './AdminOverview';
const snapshot={generatedAt:Date.parse('2026-03-01T00:00:00+07:00'),period:{day:'2026-03-01',month:'2026-03',timezone:'Asia/Ho_Chi_Minh'},accounts:{status:'KNOWN',value:0},activity:{coverage:'PARTIAL',retention:'UNKNOWN',passiveWebIncluded:false,qualifyingEvents:['LOGIN_VERIFIED','REMINDER_CREATED','REMINDER_CONFIRMED'],counts:{status:'KNOWN',value:{dau:0,mau:0}}},budget:{unit:'USD_MICROUNITS',month:'2026-02',timezone:'UTC',ledger:{status:'KNOWN',value:{reservedOutstanding:100,finalizedInMonth:200}},finalizedMayIncludeCeilings:true},providerReportedCost:{status:'UNKNOWN'},estimatedCost:{status:'UNKNOWN'},cloudflareInvoiceCost:{status:'UNKNOWN'}};
const replace=vi.fn();vi.mock('next/navigation',()=>({useRouter:()=>({replace})}));
it('shows no metrics when access is forbidden and never displays server error text',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({error:{code:'FORBIDDEN',message:'private-internal-data'}}),{status:403,headers:{'content-type':'application/json'}})));
 render(<AdminOverview/>);expect(await screen.findByRole('alert')).toHaveTextContent('không có quyền');
 expect(screen.queryByText('Tổng tài khoản')).not.toBeInTheDocument();expect(screen.queryByRole('region',{name:'Lịch sử cập nhật'})).not.toBeInTheDocument();expect(document.body.textContent).not.toContain('private-internal-data');
});
it('renders known zero separately from unknown costs and clearly labels partial coverage',async()=>{

 vi.stubGlobal('fetch',vi.fn(async(input)=>new Response(JSON.stringify({data:['/api/product-updates','/api/product-updates/runtime'].includes(String(input))?{readerId:'admin-fixture',catalog:releaseCatalog}:snapshot}),{headers:{'content-type':'application/json'}})));
 render(<AdminOverview/>);expect(await screen.findByText('Tổng tài khoản')).toBeVisible();expect(screen.getByText('Ngân sách ghi sổ · 2026-02 (UTC)')).toBeVisible();expect(screen.getAllByText('0')).toHaveLength(3);expect(screen.getAllByText('Chưa có dữ liệu')).toHaveLength(3);
 expect(screen.getByText(/chưa đại diện toàn bộ/)).toBeVisible();expect(screen.getByText(/chưa phải hóa đơn/)).toBeVisible();
 const history=screen.getByRole('region',{name:'Lịch sử cập nhật'});expect(history).toBeVisible();
 expect(await screen.findByRole('heading',{name:'Sửa phản hồi tạo lời nhắc'})).toBeVisible();
 expect(screen.getByRole('heading',{name:'Đăng ký bằng email trước, kết nối bot sau'})).toBeVisible();
 expect(screen.getByRole('heading',{name:releaseCatalog.notes[0].title})).toBeVisible();
 expect(screen.getByRole('link',{name:'Xem commit 48d7890'})).toHaveAttribute('href','https://github.com/nguyenxtan/calenote/commit/48d7890c5716623d75f9bfca477ba813fc516b37');
});

it('keeps release history hidden while admin authorization is pending',()=>{vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(()=>{})));render(<AdminOverview/>);expect(screen.getByRole('status')).toHaveTextContent('Đang kiểm tra quyền');expect(screen.queryByRole('region',{name:'Lịch sử cập nhật'})).not.toBeInTheDocument();});

it('redirects an expired session and does not render the release catalogue',async()=>{replace.mockClear();vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({error:{code:'UNAUTHENTICATED',message:'Sign in'}}),{status:401,headers:{'content-type':'application/json'}})));render(<AdminOverview/>);await waitFor(()=>expect(replace).toHaveBeenCalledWith('/login'));expect(screen.queryByRole('region',{name:'Lịch sử cập nhật'})).not.toBeInTheDocument();});


it.each([401,403])('rechecks admin permission on focus and hides cached metrics after denial (%s)',async(status)=>{
 let denied=false;
 vi.stubGlobal('fetch',vi.fn(async(input)=>new Response(JSON.stringify(denied?{error:{code:'FORBIDDEN',message:'Denied'}}:{data:String(input).startsWith('/api/product-updates')?{readerId:'owner',catalog:releaseCatalog}:snapshot}),{status:denied?status:200,headers:{'content-type':'application/json'}})));
 render(<AdminOverview/>);await screen.findAllByRole('table');
 denied=true;act(()=>window.dispatchEvent(new Event('focus')));
 await waitFor(()=>expect(screen.queryAllByRole('table')).toHaveLength(0));
 expect(screen.queryByRole('heading',{name:releaseCatalog.notes[0].title})).not.toBeInTheDocument();
 if(status===401)expect(replace).toHaveBeenCalledWith('/login');
});
it('immediately hides admin metrics on a session change',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(input)=>new Response(JSON.stringify({data:String(input).startsWith('/api/product-updates')?{readerId:'owner',catalog:releaseCatalog}:snapshot}),{headers:{'content-type':'application/json'}})));
 render(<AdminOverview/>);await screen.findAllByRole('table');
 act(()=>window.dispatchEvent(new Event('calenote-session-changed')));
 expect(screen.queryAllByRole('table')).toHaveLength(0);
});
it('never restores a previous sessions late admin response',async()=>{
 let finish!:(value:Response)=>void;
 vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(resolve=>{finish=resolve;})));
 render(<AdminOverview/>);
 act(()=>window.dispatchEvent(new Event('calenote-session-changed')));
 await act(async()=>finish(new Response(JSON.stringify({data:snapshot}),{headers:{'content-type':'application/json'}})));
 expect(screen.queryAllByRole('table')).toHaveLength(0);
 expect(screen.queryByRole('heading',{name:releaseCatalog.notes[0].title})).not.toBeInTheDocument();
});

it('keeps the new session when an aborted old admin request returns401 late',async()=>{
 replace.mockClear();let finish!:(value:Response)=>void;
 const fetcher=vi.fn(async(input:unknown)=>new Response(JSON.stringify({data:String(input).startsWith('/api/product-updates')?{readerId:'new-owner',catalog:releaseCatalog}:snapshot}),{headers:{'content-type':'application/json'}}));
 fetcher.mockImplementationOnce(()=>new Promise<Response>(resolve=>{finish=resolve;}));vi.stubGlobal('fetch',fetcher);
 render(<AdminOverview/>);act(()=>window.dispatchEvent(new Event('calenote-session-changed')));act(()=>window.dispatchEvent(new Event('focus')));
 await screen.findAllByRole('table');
 await act(async()=>finish(new Response(JSON.stringify({error:{code:'UNAUTHENTICATED',message:'Old session'}}),{status:401,headers:{'content-type':'application/json'}})));
 expect(screen.getAllByRole('table')).toHaveLength(2);expect(replace).not.toHaveBeenCalled();
});
it('refreshes admin permission on the visible sixty-second timer',async()=>{
 let denied=false;
 vi.stubGlobal('fetch',vi.fn(async(input)=>new Response(JSON.stringify(denied?{error:{code:'FORBIDDEN',message:'Denied'}}:{data:String(input).startsWith('/api/product-updates')?{readerId:'owner',catalog:releaseCatalog}:snapshot}),{status:denied?403:200,headers:{'content-type':'application/json'}})));
 vi.useFakeTimers();
 try{await act(async()=>{render(<AdminOverview/>);});expect(screen.getAllByRole('table')).toHaveLength(2);denied=true;await act(async()=>vi.advanceTimersByTimeAsync(60_000));expect(screen.queryAllByRole('table')).toHaveLength(0);}finally{vi.useRealTimers();}
});
