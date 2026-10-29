"use client";
import {useEffect,useRef} from "react";
import styles from "./ConnectionControls.module.css";
export type PendingApproval={id:string;title:string;connectionPublicId:string;botLabel:string};
export function ApprovalConfirmation({pending,busy,confirm,cancel}:{pending:PendingApproval;busy:boolean;confirm:()=>void;cancel:()=>void}){
 const button=useRef<HTMLButtonElement>(null);
 useEffect(()=>{const previous=document.activeElement;button.current?.focus();return()=>{if(previous instanceof HTMLElement&&previous.isConnected&&!previous.hasAttribute("disabled"))previous.focus();};},[]);
 return <section className={styles.confirm} role="dialog" aria-label="Xác nhận duyệt đề xuất" onKeyDown={event=>{if(event.key==="Escape"&&!busy)cancel();}}>
  <p>Duyệt <strong>{pending.title}</strong> và gửi lời nhắc qua <strong>{pending.botLabel}</strong>?</p>
  <div className={styles.actions}><button ref={button} type="button" disabled={busy} onClick={confirm}>Xác nhận bot nhận</button><button type="button" disabled={busy} onClick={cancel}>Hủy duyệt</button></div>
 </section>;
}
