import { releaseCatalog } from '@/modules/releases/catalog';
import { render,screen,waitFor } from '@testing-library/react';
import { expect,it,vi } from 'vitest';
import { AdminOverview } from './AdminOverview';
const replace=vi.fn();vi.mock('next/navigation',()=>({useRouter:()=>({replace})}));
it('shows no metrics when access is forbidden and never displays server error text',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({error:{code:'FORBIDDEN',message:'private-internal-data'}}),{status:403,headers:{'content-type':'application/json'}})));
 render(<AdminOverview/>);expect(await screen.findByRole('alert')).toHaveTextContent('không có quyền');
 expect(screen.queryByText('Tổng tài khoản')).not.toBeInTheDocument();expect(screen.queryByRole('region',{name:'Lịch sử cập nhật'})).not.toBeInTheDocument();expect(document.body.textContent).not.toContain('private-internal-data');
});
it('renders known zero separately from unknown costs and clearly labels partial coverage',async()=>{
 const snapshot={generatedAt:Date.parse('2026-03-01T00:00:00+07:00'),period:{day:'2026-03-01',month:'2026-03',timezone:'Asia/Ho_Chi_Minh'},accounts:{status:'KNOWN',value:0},activity:{coverage:'PARTIAL',retention:'UNKNOWN',passiveWebIncluded:false,qualifyingEvents:['LOGIN_VERIFIED','REMINDER_CREATED','REMINDER_CONFIRMED'],counts:{status:'KNOWN',value:{dau:0,mau:0}}},budget:{unit:'USD_MICROUNITS',month:'2026-02',timezone:'UTC',ledger:{status:'KNOWN',value:{reservedOutstanding:100,finalizedInMonth:200}},finalizedMayIncludeCeilings:true},providerReportedCost:{status:'UNKNOWN'},estimatedCost:{status:'UNKNOWN'},cloudflareInvoiceCost:{status:'UNKNOWN'}};
 vi.stubGlobal('fetch',vi.fn(async(input)=>new Response(JSON.stringify({data:String(input).endsWith('/api/product-updates')?{readerId:'admin-fixture',catalog:releaseCatalog}:snapshot}),{headers:{'content-type':'application/json'}})));
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
