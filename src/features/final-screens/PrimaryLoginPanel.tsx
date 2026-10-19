"use client";
import { useEffect,useRef,useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import type { PublicConnection } from "@/contracts/api/connections";
import { apiRequest } from "@/lib/client-api";
import styles from "./FinalScreenExperience.module.css";
const Result=z.object({publicId:z.string().nullable()}).strict();
export function PrimaryLoginPanel({connections}:{connections:PublicConnection[]}){
 const {replace}=useRouter();const replaceRef=useRef(replace);const [selected,setSelected]=useState('');const [loaded,setLoaded]=useState(false);const [busy,setBusy]=useState(false);const [notice,setNotice]=useState<string|null>(null);const lock=useRef(false);
 useEffect(()=>{let active=true;void apiRequest('/api/connections/primary-login',{authenticated:true,onUnauthorized:()=>replaceRef.current('/login')}).then(value=>{if(active){setSelected(Result.parse(value).publicId??'');setLoaded(true);setNotice(null);}}).catch(()=>{if(active)setNotice('Chưa tải được kênh đăng nhập. Hãy tải lại trang trước khi đổi kênh.');});return()=>{active=false;};},[connections]);
 async function save(){if(lock.current||!selected)return;lock.current=true;setBusy(true);setNotice(null);try{const value=Result.parse(await apiRequest('/api/connections/primary-login',{method:'PATCH',body:{publicId:selected},authenticated:true,onUnauthorized:()=>replaceRef.current('/login')}));setSelected(value.publicId??'');setNotice('Đã lưu bot nhận mã đăng nhập.');}catch{setLoaded(false);setNotice('Chưa xác nhận được kênh đăng nhập. Hãy tải lại trang để kiểm tra trước khi thử lại.');}finally{lock.current=false;setBusy(false);}}
 const eligible=connections.filter(c=>c.state==='ACTIVE_BOUND'&&!c.disconnected);
 return <section className={styles.addBot} aria-label="Kênh đăng nhập"><h2>Mã đăng nhập gửi tới đâu?</h2><p>Bot mới không thay thế kênh hiện tại. Chọn bot nhận mã đăng nhập trước khi ngắt bot đang dùng.</p>
 <label>Bot nhận mã đăng nhập<select disabled={!loaded||busy} value={selected} onChange={event=>setSelected(event.target.value)}><option value="">Chọn một bot đã liên kết</option>{eligible.map(c=><option key={c.publicId} value={c.publicId}>{c.displayName} · {c.provider==='telegram'?'Telegram':'Zalo'}</option>)}</select></label>
 <button className={styles.action} type="button" disabled={!loaded||busy||!selected} onClick={()=>void save()}>Lưu kênh đăng nhập</button>{notice&&<p>{notice}</p>}</section>;
}
