"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {z} from "zod";
import {ConnectionsResponseSchema,type PublicConnection} from "@/contracts/api/connections";
import {apiRequest} from "@/lib/client-api";
import styles from "./ConnectionControls.module.css";

const count=z.number().int().nonnegative();
export const LifecycleSchema=z.object({lifecycle:z.object({publicId:z.string().length(22),state:z.enum(["VALIDATING","ACTIVE_UNBOUND","ACTIVE_BOUND","WEBHOOK_FAILED","SUSPENDED"]),paused:z.boolean(),
 cas:z.object({authRevision:count,primary:z.object({revision:z.number().int().positive(),generation:z.string().regex(/^[a-f0-9]{32}$/u)}).strict().nullable()}).strict(),heldReminders:count,heldInbound:count,
 inFlight:z.object({reminders:count,login:count,inbound:count}).strict()}).strict()}).strict();
export type Lifecycle=z.infer<typeof LifecycleSchema>["lifecycle"];
export type DeliveryTargets={options:PublicConnection[]|null;selectedId:string;loading:boolean;error:string|null;ready:boolean;select:(id:string)=>void;reload:()=>Promise<void>};

export function useDeliveryTargets(owner:string|null,onUnauthorized:()=>void):DeliveryTargets {
 const generation=useRef(0);
 const [loadedOwner,setLoadedOwner]=useState<string|null>(null);
 const [options,setOptions]=useState<PublicConnection[]|null>(null),[selectedId,setSelectedId]=useState(""),[loading,setLoading]=useState(false),[error,setError]=useState<string|null>(null);
 const reload=useCallback(async()=>{
  const current=++generation.current;setLoadedOwner(null);setOptions(null);setSelectedId("");setError(null);setLoading(!!owner);
  if(!owner) return;
  const unauthorized=()=>{if(generation.current===current){generation.current++;setOptions(null);setSelectedId("");setLoading(false);onUnauthorized();}};
  try {
   const list=ConnectionsResponseSchema.parse({data:await apiRequest<unknown>("/api/connections",{authenticated:true,onUnauthorized:unauthorized})}).data.connections;
   const bound=list.filter(bot=>bot.state==="ACTIVE_BOUND");
   const verified=await Promise.all(bound.map(async bot=>{
    const value=LifecycleSchema.parse(await apiRequest<unknown>("/api/connections/"+bot.publicId+"/lifecycle",{authenticated:true,onUnauthorized:unauthorized})).lifecycle;
    if(value.publicId!==bot.publicId) throw new Error("Mismatched connection");
    return value.state==="ACTIVE_BOUND"&&!value.paused?bot:null;
   }));
   if(generation.current===current){setLoadedOwner(owner);setOptions(verified.filter((value):value is PublicConnection=>value!==null));setLoading(false);}
  } catch {if(generation.current===current){setOptions(null);setSelectedId("");setLoading(false);setError("Chưa xác minh được bot nhận. Hãy tải lại trước khi gửi.");}}
 },[owner,onUnauthorized]);
 useEffect(()=>{const guard=generation;let active=true;queueMicrotask(()=>{if(active)void reload();});return()=>{active=false;guard.current++;};},[reload]);
 return {options:loadedOwner===owner?options:null,selectedId:loadedOwner===owner?selectedId:"",loading:!!owner&&(loading||loadedOwner!==owner&&!error),error,ready:loadedOwner===owner&&!loading&&!error&&!!options?.some(bot=>bot.publicId===selectedId),select:id=>setSelectedId(options?.some(bot=>bot.publicId===id)?id:""),reload};
}
export function DeliveryTarget({id,targets,disabled=false,label="Bot nhận lời nhắc"}:{id:string;targets:DeliveryTargets;disabled?:boolean;label?:string}) {
 const selected=targets.options?.find(bot=>bot.publicId===targets.selectedId);
 return <section className={styles.control} aria-label="Chọn kênh gửi">
  <label htmlFor={id}>{label}</label>
  {targets.loading?<p>Đang tải bot nhận…</p>:targets.error?<p role="alert">{targets.error}</p>:targets.options?.length===0?<p>Chưa có bot đã liên kết đang bật. <a href="/app/connections">Mở Kết nối</a></p>:null}
  <select id={id} value={targets.selectedId} disabled={disabled||targets.loading||!targets.options?.length} onChange={event=>targets.select(event.target.value)}>
   <option value="">Chọn bot nhận…</option>{targets.options?.map(bot=><option key={bot.publicId} value={bot.publicId}>{bot.displayName} · {bot.provider==="telegram"?"Telegram":"Zalo"}</option>)}
  </select>
  {selected&&<p>Sẽ gửi qua <strong>{selected.displayName} · {selected.provider==="telegram"?"Telegram":"Zalo"}</strong>.</p>}
  <button type="button" disabled={disabled||targets.loading} onClick={()=>void targets.reload()}>Tải lại danh sách bot</button>
 </section>;
}
