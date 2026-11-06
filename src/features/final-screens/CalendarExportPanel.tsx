'use client';
import {useLayoutEffect,useRef,useState} from 'react';
import {CALENDAR_EXPORT_MAX_BYTES} from '@/modules/calendar/ics';
import styles from './CalendarExportPanel.module.css';
type DownloadResult={eventCount:number;truncated:boolean;skipped:number};
const countHeader=(value:string|null)=>{if(value===null||!/^\d{1,6}$/u.test(value))throw new Error('Invalid export response');return Number(value);};
// Changing owner remounts the request scope and clears both result and pending
// download authority. An old response cannot create a blob URL after cleanup.
export function CalendarExportPanel({ownerKey}:{ownerKey:string}){return <CalendarExportDownload key={ownerKey}/>;}
function CalendarExportDownload(){
 const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[result,setResult]=useState<DownloadResult|null>(null);
 const mounted=useRef(false),controller=useRef<AbortController|null>(null);
 useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;controller.current?.abort();};},[]);
 async function download(){
  if(controller.current)return;
  const request=new AbortController();controller.current=request;setBusy(true);setError(null);setResult(null);
  try{
   const response=await fetch('/api/calendar/export.ics',{credentials:'same-origin',cache:'no-store',signal:request.signal});
   if(!response.ok)throw new Error(response.status===401||response.status===403?'Đăng nhập lại để tải lịch.':response.status===429?'Bạn tải lịch quá nhanh. Vui lòng thử lại sau.':'Chưa tải được lịch. Vui lòng thử lại.');
   if(!/^text\/calendar\b/iu.test(response.headers.get('content-type')??''))throw new Error('Invalid export response');
   const truncated=response.headers.get('x-calenote-export-truncated');
   if(truncated!=='true'&&truncated!=='false')throw new Error('Invalid export response');
   const data={truncated:truncated==='true',skipped:countHeader(response.headers.get('x-calenote-export-skipped')),eventCount:countHeader(response.headers.get('x-calenote-export-events'))};
   const blob=await response.blob();if(blob.size>CALENDAR_EXPORT_MAX_BYTES)throw new Error('Invalid export response');
   if(!mounted.current||request.signal.aborted)return;
   const url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download='calenote.ics';
   try{document.body.appendChild(anchor);anchor.click();}finally{anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),0);}
   setResult(data);
  }catch(cause){
   if(mounted.current&&!request.signal.aborted)setError(cause instanceof Error&&/^(Đăng nhập lại|Bạn tải lịch quá nhanh)/u.test(cause.message)?cause.message:'Chưa tải được lịch. Vui lòng thử lại.');
  }finally{
   if(controller.current===request)controller.current=null;if(mounted.current)setBusy(false);
  }
 }
 return <section className={styles.panel} aria-labelledby="calendar-export-heading">
  <header><h2 id="calendar-export-heading">Tải lịch nhắc nhở</h2><button type="button" disabled={busy} onClick={()=>void download()}>{busy?'Đang tải…':'Tải lịch (.ics)'}</button></header>
  <p>Tải một lần. Lịch của bạn sẽ không tự cập nhật; hãy tải lại nếu có thay đổi.</p>
  <p>Tệp gồm tiêu đề, địa điểm và thời gian; không gồm ghi chú. Khoảng xuất từ 30 ngày trước đến 400 ngày tới, tối đa 300 mục và 1 MiB.</p>
  <p>Ứng dụng lịch có thể xử lý việc nhập lại và mục đã hủy khác nhau; nhập lại có thể không xóa mục cũ.</p>
  {busy&&<p role="status">Đang chuẩn bị tệp lịch…</p>}
  {error&&<p role="alert">{error}</p>}
  {result&&<p role="status">Đã chuẩn bị tệp {result.eventCount} mục. {result.truncated?'Tệp chỉ gồm một phần do giới hạn xuất. ':''}{result.skipped?`Bỏ qua ${result.skipped} mục không đọc được. `:''}Hãy kiểm tra tệp trước khi nhập vào ứng dụng lịch.</p>}
 </section>;
}
