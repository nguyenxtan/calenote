'use client';

import { useEffect, useState } from 'react';
import type { CalendarSyncStatus } from '@/modules/calendar-sync/contracts';
import styles from './CalendarSyncPanel.module.css';

const scope='https://www.googleapis.com/auth/calendar.app.created';
type CodeResponse={code?:string;error?:string};
export interface GoogleCodeApi {
 initCodeClient(config:{client_id:string;scope:string;include_granted_scopes:false;ux_mode:'popup';select_account:true;callback:(response:CodeResponse)=>void;error_callback:()=>void}):{requestCode():void};
}
function googleApi():GoogleCodeApi|undefined{return (window as Window&{google?:{accounts?:{oauth2?:GoogleCodeApi}}}).google?.accounts?.oauth2;}
/** Called only after explicit connect and an available server capability. */
export async function loadGoogleCalendarIdentity():Promise<GoogleCodeApi>{
 const existing=googleApi();if(existing)return existing;
 return new Promise((resolve,reject)=>{
  const script=document.createElement('script');script.src='https://accounts.google.com/gsi/client';script.async=true;script.referrerPolicy='no-referrer';
  const timer=setTimeout(()=>{script.remove();reject(new Error('Google identity unavailable'));},10_000);
  script.onload=()=>{clearTimeout(timer);const api=googleApi();if(api)resolve(api);else{script.remove();reject(new Error('Google identity unavailable'));}};
  script.onerror=()=>{clearTimeout(timer);script.remove();reject(new Error('Google identity unavailable'));};document.head.appendChild(script);
 });
}
interface Props {request?:typeof fetch;loadGoogle?:()=>Promise<GoogleCodeApi>}
type Prepared={nonce:string;clientId:string;expiresAt:number;api:GoogleCodeApi};
async function readData<T>(response:Response):Promise<T>{if(!response.ok)throw new Error('Calendar request failed');const value:unknown=await response.json();if(!value||typeof value!=='object'||!('data' in value))throw new Error('Calendar response invalid');return value.data as T;}
export function CalendarSyncPanel({request=fetch,loadGoogle=loadGoogleCalendarIdentity}:Props){
 const [status,setStatus]=useState<CalendarSyncStatus|null>(null);const [busy,setBusy]=useState(false);const [prepared,setPrepared]=useState<Prepared|null>(null);const [message,setMessage]=useState('');const [revokeFailed,setRevokeFailed]=useState(false);
 useEffect(()=>{const controller=new AbortController();request('/api/calendar/sync',{credentials:'same-origin',cache:'no-store',signal:controller.signal}).then(readData<CalendarSyncStatus>).then(setStatus).catch(()=>{if(!controller.signal.aborted)setMessage('Chưa đọc được trạng thái đồng bộ. Vui lòng tải lại trang.');});return ()=>controller.abort();},[request]);
 async function refresh(){setStatus(await readData<CalendarSyncStatus>(await request('/api/calendar/sync',{credentials:'same-origin',cache:'no-store'})));}
 function post(path:string,body:unknown){return request('/api/calendar/sync/'+path,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'content-type':'application/json','x-requested-with':'XmlHttpRequest'},body:JSON.stringify(body)});}
 async function prepare(){
  if(!status?.available)return;setBusy(true);setMessage('');setRevokeFailed(false);
  try{const result=await readData<{nonce:string;clientId:string;expiresAt:number}>(await post('begin',{}));const api=await loadGoogle();setPrepared({...result,api});}
  catch{setMessage('Chưa thể mở kết nối Google. Vui lòng thử lại sau.');}finally{setBusy(false);}
 }
 function startPopup(){
  if(!prepared||prepared.expiresAt<=Date.now()){setPrepared(null);setMessage('Yêu cầu kết nối đã hết hạn. Vui lòng thử lại.');return;}
  const ready=prepared;setBusy(true);setMessage('');
  try{ready.api.initCodeClient({client_id:ready.clientId,scope,include_granted_scopes:false,ux_mode:'popup',select_account:true,
   callback:(result)=>{setPrepared(null);if(!result.code||result.error){setBusy(false);setMessage('Kết nối Google chưa hoàn tất. Vui lòng thử lại.');return;}
    void post('code',{nonce:ready.nonce,code:result.code}).then(readData<{state:'PENDING'}>).then(()=>refresh()).catch(()=>setMessage('Chưa lưu được kết nối Google. Vui lòng thử lại sau.')).finally(()=>setBusy(false));},
   error_callback:()=>{setPrepared(null);setBusy(false);setMessage('Cửa sổ Google chưa mở hoặc đã đóng. Vui lòng thử lại.');}
  }).requestCode();}catch{setPrepared(null);setBusy(false);setMessage('Chưa thể mở Google. Vui lòng thử lại sau.');}
 }
 async function disconnect(){
  setBusy(true);setMessage('');setPrepared(null);
  try{const result=await readData<{revocation:string}>(await post('disconnect',{}));setRevokeFailed(result.revocation==='FAILED');setStatus({available:true,state:'DISCONNECTED',lastSyncedAt:null,error:null});setMessage('Đã ngắt đồng bộ. Lịch và sự kiện đã gửi vẫn ở Google.');}
  catch{setMessage('Đồng bộ đang xử lý hoặc chưa ngắt được. Vui lòng thử lại sau.');}finally{setBusy(false);}
 }
 const connectable=status?.available&&['NOT_CONNECTED','DISCONNECTED','REAUTH_REQUIRED'].includes(status.state);
 const connected=status?.available&&!['NOT_CONNECTED','DISCONNECTED'].includes(status.state);
 return <section className={styles.panel} aria-labelledby="calendar-sync-heading">
  <h3 id="calendar-sync-heading">Google Calendar</h3>
  <p>Đồng bộ một chiều từ Calenote vào một lịch riêng. Chỉ gửi tiêu đề, thời gian và lịch riêng sang Google. Không gửi ghi chú.</p>
  <p className={styles.hint}>Lời nhắc có giờ chiếm 1 phút trên lịch. Thay đổi ở Google không cập nhật Calenote. Ngắt kết nối giữ nguyên lịch và sự kiện đã gửi. Mỗi lần kết nối lại tạo một lịch riêng mới; lịch cũ được giữ.</p>
  {!status&&!message&&<p role="status">Đang đọc trạng thái đồng bộ…</p>}
  {status&&!status.available&&<p role="status">Đồng bộ tự động chưa khả dụng. Quản trị viên cần thiết lập Google Calendar trước khi bật kết nối.</p>}
  {status?.available&&status.state==='ACTIVE'&&<p role="status">Đã kết nối Google Calendar.{status.lastSyncedAt?' Đồng bộ gần nhất: '+new Date(status.lastSyncedAt).toLocaleString('vi-VN'):''}</p>}
  {status?.state==='PENDING'&&<p role="status">Đang chuẩn bị lịch riêng. Việc đồng bộ có thể mất vài phút.</p>}
  {status?.state==='CREATING_CALENDAR'&&<p role="status">Đang tạo lịch riêng trong Google.</p>}
  {status?.state==='AUTHORIZING'&&<p role="status">Đang hoàn tất quyền truy cập Google.</p>}
  {status?.state==='DISCONNECTING'&&<p role="status">Đang thu hồi quyền Google. Chưa thể kết nối lại trong lúc xử lý.</p>}
  {status?.state==='SETUP_UNCERTAIN'&&<p role="status">Chưa xác định được lịch đã tạo trong Google. Hãy kiểm tra Google Calendar rồi ngắt kết nối trước khi thử lại.</p>}
  {status?.state==='REAUTH_REQUIRED'&&<p role="status">Google cần bạn cấp quyền lại để tiếp tục đồng bộ.</p>}
  {status?.error&&status.state!=='SETUP_UNCERTAIN'&&status.state!=='REAUTH_REQUIRED'&&<p role="status">Đồng bộ đang tạm dừng hoặc chờ thử lại. Các sự kiện đã gửi vẫn được giữ.</p>}
  <div className={styles.actions}>
   {connectable&&!prepared&&<button type="button" disabled={busy} onClick={()=>void prepare()}>Kết nối Google Calendar</button>}
   {prepared&&<button type="button" disabled={busy} onClick={startPopup}>Tiếp tục với Google</button>}
   {connected&&<button type="button" disabled={busy||status?.state==='DISCONNECTING'} onClick={()=>void disconnect()}>Ngắt kết nối Google Calendar</button>}
   {connected&&<button type="button" disabled={busy} onClick={()=>{setBusy(true);void refresh().catch(()=>setMessage('Chưa đọc được trạng thái đồng bộ.')).finally(()=>setBusy(false));}}>Cập nhật trạng thái</button>}
  </div>
  {message&&<p role="status">{message}</p>}
  {revokeFailed&&<p>Quyền Google chưa thu hồi được; thông tin đăng nhập đã xóa khỏi Calenote. <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer">Thu hồi quyền trong Google</a>.</p>}
 </section>;
}
