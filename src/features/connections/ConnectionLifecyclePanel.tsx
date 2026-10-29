"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {useRouter} from "next/navigation";
import type {PublicConnection} from "@/contracts/api/connections";
import {ApiResponseError,apiRequest} from "@/lib/client-api";
import {LifecycleSchema,type Lifecycle} from "./DeliveryTarget";
import styles from "./ConnectionControls.module.css";

export function ConnectionLifecyclePanel({connection,onChanged}:{connection:PublicConnection;onChanged?:()=>void}){
 const {replace}=useRouter();const epoch=useRef(0),locked=useRef(false),confirmButton=useRef<HTMLButtonElement>(null);
 const [value,setValue]=useState<Lifecycle|null>(null),[busy,setBusy]=useState(false),[confirming,setConfirming]=useState(false),[needsReload,setNeedsReload]=useState(false),[notice,setNotice]=useState<string|null>(null),[error,setError]=useState<string|null>(null);
 const load=useCallback(async()=>{
  if(locked.current)return;
  const current=++epoch.current;setValue(null);setConfirming(false);setNotice(null);setError(null);setNeedsReload(true);
  try{
   const result=LifecycleSchema.parse(await apiRequest<unknown>("/api/connections/"+connection.publicId+"/lifecycle",{authenticated:true,onUnauthorized:()=>{if(epoch.current===current){epoch.current++;setValue(null);replace("/login");}}})).lifecycle;
   if(result.publicId!==connection.publicId)throw new Error("Mismatched connection");
   if(epoch.current===current){setValue(result);setNeedsReload(false);}
  }catch{if(epoch.current===current)setError("Chưa xác minh được trạng thái. Hãy tải lại trước khi thao tác.");}
 },[connection.publicId,replace]);
 useEffect(()=>{const guard=epoch;let active=true;queueMicrotask(()=>{if(active)void load();});return()=>{active=false;guard.current++;};},[load]);
 useEffect(()=>{if(confirming)confirmButton.current?.focus();},[confirming]);
 async function mutate(){
  if(!value||needsReload||locked.current)return;
  locked.current=true;setBusy(true);setError(null);const current=++epoch.current;const paused=!value.paused;
  const unauthorized=()=>{if(epoch.current===current){epoch.current++;setValue(null);replace("/login");}};
  try{
   const result=LifecycleSchema.parse(await apiRequest<unknown>("/api/connections/"+connection.publicId+(paused?"/pause":"/resume"),{method:"POST",body:value.cas,authenticated:true,onUnauthorized:unauthorized})).lifecycle;
   if(result.publicId!==connection.publicId||result.paused!==paused)throw new Error("Unverified lifecycle mutation");
   const read=LifecycleSchema.parse(await apiRequest<unknown>("/api/connections/"+connection.publicId+"/lifecycle",{authenticated:true,onUnauthorized:unauthorized})).lifecycle;
   if(read.publicId!==connection.publicId||read.paused!==paused)throw new Error("Unverified lifecycle read-back");
   if(epoch.current===current){setValue(read);setConfirming(false);setNotice(paused?"Đã xác minh: bot đang tạm dừng.":read.state==="SUSPENDED"?"Đã bỏ tạm dừng; bot vẫn cần kiểm tra, lời nhắc vẫn được giữ.":"Đã xác minh: bot đã bỏ tạm dừng. Tin cũ và lời nhắc quá hạn không phát lại.");onChanged?.();}
  }catch(reason){if(epoch.current===current){setConfirming(false);setNeedsReload(true);setError(reason instanceof ApiResponseError&&reason.status===409?"Trạng thái đã thay đổi hoặc đây là bot đăng nhập. Chọn bot đăng nhập khác nếu cần, rồi tải lại trạng thái.":"Kết quả chưa được xác minh. Tải lại và kiểm tra trước khi thao tác tiếp.");}}
  finally{locked.current=false;if(epoch.current===current)setBusy(false);}
 }
 const canChange=!!value&&(value.paused||value.state==="ACTIVE_BOUND");
 return <section className={styles.control} aria-label={"Vận hành "+connection.displayName}>
  <h3>Vận hành bot</h3>
  {value&&<><p>{value.paused?"Đang tạm dừng xử lý":"Chưa tạm dừng"} · {value.state==="SUSPENDED"?"Cần kiểm tra thông tin xác thực":"Trạng thái trong Calenote"}</p><p>{value.heldReminders} lời nhắc đang giữ · {value.heldInbound} tin cũ không phát lại.</p><p>{value.inFlight.reminders+value.inFlight.login+value.inFlight.inbound} yêu cầu đã bắt đầu, có thể hoàn tất.</p></>}
  {notice&&<p role="status">{notice}</p>}{error&&<p className={styles.error} role="alert">{error}</p>}
  <div className={styles.actions}><button type="button" disabled={busy||needsReload||!canChange||confirming} onClick={()=>setConfirming(true)}>{value?.paused?"Tiếp tục ":"Tạm dừng "}{connection.displayName}</button><button type="button" disabled={busy||confirming} onClick={()=>void load()}>Tải lại trạng thái bot</button><a href="/app/settings">Chọn bot đăng nhập</a></div>
  {confirming&&value&&<section className={styles.confirm} role="dialog" aria-label={value.paused?"Xác nhận tiếp tục bot":"Xác nhận tạm dừng bot"}>
   <p>{value.paused?"Chỉ lời nhắc tương lai đủ điều kiện được tiếp tục. Tin cũ, lời nhắc quá hạn hoặc chưa rõ kết quả không phát lại. Bot bị đình chỉ vẫn cần kiểm tra.":"Calenote giữ token mã hoá, lịch và lịch sử. Dừng xử lý mới và giữ lời nhắc chưa gửi; yêu cầu đã bắt đầu gửi có thể hoàn tất."}</p>
   <div className={styles.actions}><button ref={confirmButton} type="button" disabled={busy} onClick={()=>void mutate()}>{value.paused?"Xác nhận tiếp tục":"Xác nhận tạm dừng"}</button><button type="button" disabled={busy} onClick={()=>setConfirming(false)}>Hủy thao tác</button></div>
  </section>}
 </section>;
}
