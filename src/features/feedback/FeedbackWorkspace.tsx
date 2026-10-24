"use client";
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {useRouter} from 'next/navigation';
import {SessionUserSchema,type SessionUser} from '@/contracts/api/session';
import {FeedbackListSchema} from '@/contracts/api/feedback';
import {apiRequest,ApiResponseError} from '@/lib/client-api';
import {AppShell} from '@/ui/shell/AppShell';
import {feedbackRequest} from './feedback-client';
import {FeedbackPanel} from './FeedbackPanel';
import type {z} from 'zod';
import styles from './Feedback.module.css';
export function FeedbackWorkspace({admin=false}:{admin?:boolean}){
 const {replace}=useRouter(),[attempt,setAttempt]=useState(0),[checking,setChecking]=useState(true),[ready,setReady]=useState<{user:SessionUser;list:z.infer<typeof FeedbackListSchema>}|null>(null),[error,setError]=useState<string|null>(null);
 useEffect(()=>{
  let alive=true,generation=0;const controllers=new Set<AbortController>();
  async function load(){
   const epoch=++generation,controller=new AbortController();controllers.add(controller);setChecking(true);setError(null);
   try{
    const [raw,listing]=await Promise.all([apiRequest<{user:unknown}>('/api/session',{signal:controller.signal}),feedbackRequest(admin,{signal:controller.signal})]);
    const user=SessionUserSchema.parse(raw.user),list=FeedbackListSchema.parse(listing);
    if(alive&&epoch===generation){setReady({user,list});setChecking(false);}
   }catch(reason){if(alive&&epoch===generation){setReady(null);setChecking(false);setError(reason instanceof ApiResponseError&&reason.status===403?'Bạn không có quyền xem mục này.':'Chưa thể xác nhận phiên hoặc tải yêu cầu.');if(reason instanceof ApiResponseError&&reason.status===401)replace('/login');}}
   finally{controllers.delete(controller);}
  }
  const invalidate=()=>{generation++;for(const c of controllers)c.abort();controllers.clear();setReady(null);setChecking(false);setError('Phiên đăng nhập đã thay đổi. Kiểm tra lại phiên để tiếp tục.');};
  const obscure=()=>{if(alive)setChecking(true);};
  const resume=()=>{if(document.visibilityState!=='hidden')void load();};
  const visibility=()=>{if(document.visibilityState==='hidden')obscure();else resume();};
  window.addEventListener('blur',obscure);window.addEventListener('focus',resume);document.addEventListener('visibilitychange',visibility);
  window.addEventListener('calenote-session-changed',invalidate);void load();
  return()=>{alive=false;generation++;for(const c of controllers)c.abort();window.removeEventListener('calenote-session-changed',invalidate);window.removeEventListener('blur',obscure);window.removeEventListener('focus',resume);document.removeEventListener('visibilitychange',visibility);};
 },[admin,replace,attempt]);
 if(!ready)return <main className={styles.page}><h1>{admin?'Quản trị góp ý':'Góp ý & báo lỗi'}</h1>{error?<><p role="alert">{error}</p><button onClick={()=>setAttempt(n=>n+1)}>Kiểm tra lại phiên</button><p><Link href="/login">Đăng nhập</Link></p></>:<p role="status">Đang kiểm tra phiên và tải yêu cầu…</p>}</main>;
 return <AppShell user={ready.user} activePath={admin?'/app/admin':'/app/feedback'}><div>{checking&&<p role="status" className={styles.page}>Đang kiểm tra lại phiên…</p>}<div hidden={checking}>{admin&&<p className={styles.page}><Link href="/app/admin">← Dashboard quản trị</Link></p>}<FeedbackPanel initial={ready.list} admin={admin} onAuthLost={()=>{setReady(null);setError('Phiên hoặc quyền truy cập đã thay đổi. Kiểm tra lại phiên để tiếp tục.');}}/></div></div></AppShell>;
}
