"use client";
import Link from 'next/link';
import { useEffect,useState } from 'react';
import { useRouter } from 'next/navigation';
import { AdminOverviewSchema,type AdminOverview as Snapshot } from '@/contracts/api/admin-overview';
import { ApiResponseError,apiRequest } from '@/lib/client-api';
import styles from './AdminOverview.module.css';
const unknown='Chưa có dữ liệu';
const money=(value:number)=>new Intl.NumberFormat('vi-VN',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:6}).format(value/1_000_000);
export function AdminOverview(){
 const {replace}=useRouter();const [data,setData]=useState<Snapshot|null>(null);const [error,setError]=useState<string|null>(null);const [attempt,setAttempt]=useState(0);
 useEffect(()=>{
  let active=true;const controller=new AbortController();
  void apiRequest<unknown>('/api/admin/overview',{authenticated:true,signal:controller.signal,onUnauthorized:()=>{if(active){setData(null);replace('/login');}}}).then(value=>{const next=AdminOverviewSchema.parse(value);if(active)setData(next);}).catch(reason=>{if(active){setData(null);setError(reason instanceof ApiResponseError&&reason.status===403?'Bạn không có quyền xem dashboard này.':'Chưa thể tải dashboard.');}});
  return()=>{active=false;controller.abort();};
 },[replace,attempt]);
 return <main className={styles.page}><header><Link href="/app/today">← Về Calenote</Link><h1>Dashboard quản trị</h1><p>Tổng quan chỉ đọc</p></header>
  {error?<div role="alert"><p>{error}</p><button type="button" onClick={()=>{setError(null);setData(null);setAttempt(value=>value+1);}}>Thử lại</button></div>:!data?<p role="status">Đang kiểm tra quyền truy cập…</p>:<>
   <p>Ngày {data.period.day} · Tháng {data.period.month} · Giờ Việt Nam</p>
   <section aria-labelledby="activity-title"><h2 id="activity-title">Tài khoản & hoạt động ghi nhận</h2><table><tbody>
    <tr><th scope="row">Tổng tài khoản</th><td>{data.accounts.status==='KNOWN'?data.accounts.value:unknown}</td></tr>
    <tr><th scope="row">Người hoạt động trong ngày</th><td>{data.activity.counts.status==='KNOWN'?data.activity.counts.value.dau:unknown}</td></tr>
    <tr><th scope="row">Người hoạt động trong tháng</th><td>{data.activity.counts.status==='KNOWN'?data.activity.counts.value.mau:unknown}</td></tr>
   </tbody></table><p>Chỉ ghi nhận đăng nhập thành công, tạo lời nhắc và xác nhận nhắc. Mỗi tài khoản tính một lần trong từng kỳ. Chưa bao gồm người chỉ xem web; thời gian lưu giữ dữ liệu chưa được xác minh. Đây là thống kê hoạt động có ghi nhận, chưa đại diện toàn bộ người dùng hoạt động.</p></section>
   <section aria-labelledby="cost-title"><h2 id="cost-title">Ngân sách & chi phí</h2><table><tbody>
    <tr><th scope="row">Ngân sách đang giữ chỗ · mọi kỳ</th><td>{data.budget.ledger.status==='KNOWN'?money(data.budget.ledger.value.reservedOutstanding):unknown}</td></tr>
    <tr><th scope="row">Ngân sách ghi sổ · {data.budget.month} (UTC)</th><td>{data.budget.ledger.status==='KNOWN'?money(data.budget.ledger.value.finalizedInMonth):unknown}</td></tr>
    <tr><th scope="row">Chi phí AI do nhà cung cấp báo</th><td>{unknown}</td></tr>
    <tr><th scope="row">Chi phí AI ước tính có căn cứ</th><td>{unknown}</td></tr>
    <tr><th scope="row">Hóa đơn Cloudflare</th><td>{unknown}</td></tr>
   </tbody></table><p>Kỳ ngân sách theo tháng UTC, khác kỳ hoạt động giờ Việt Nam. Số ghi sổ có thể dùng mức trần khi thiếu thông tin sử dụng. Đây là số quản lý ngân sách, chưa phải hóa đơn hoặc chi phí thực tế đã đối soát. Không có nguồn hóa đơn thì hiển thị chưa có dữ liệu.</p></section>
   <p className={styles.updated}>Cập nhật {new Intl.DateTimeFormat('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',dateStyle:'short',timeStyle:'short'}).format(data.generatedAt)}</p>
  </>}
 </main>;
}
