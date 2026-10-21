"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { Bell, X } from "lucide-react";
import { useProductUpdates } from './useProductUpdates';
import styles from "./ProductUpdates.module.css";

const key = "calenote.product-updates.read";
const changed = "calenote-product-updates-read";
function subscribe(callback: () => void) { window.addEventListener("storage", callback); window.addEventListener(changed, callback); return () => { window.removeEventListener("storage", callback); window.removeEventListener(changed, callback); }; }
export function ProductUpdates() {
  const {data,error}=useProductUpdates();
  const scopedKey=data?`${key}.${data.readerId}`:null;
  const read = useSyncExternalStore(subscribe, () => {try{return scopedKey?localStorage.getItem(scopedKey):null;}catch{return null;}}, () => null);
  const unread=Boolean(data&&read!==data.catalog.latestId);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(()=>{if(!data&&dialog.current?.open)dialog.current.close();},[data]);
  function close() { dialog.current?.close(); trigger.current?.focus(); }
  function markRead() { if(!data||!scopedKey)return;try { localStorage.setItem(scopedKey,data.catalog.latestId); window.dispatchEvent(new Event(changed)); } catch { /* Browser storage may be blocked; keep the update available. */ } }
  return <div className={styles.root}>
    <button ref={trigger} className={styles.trigger} type="button" disabled={!data} aria-label={unread ? "Có gì mới — có cập nhật chưa đọc" : "Có gì mới"} aria-haspopup="dialog" onClick={() => dialog.current?.showModal()}>
      <Bell size={19} aria-hidden="true" /><span>Có gì mới</span>{unread && <span className={styles.dot} aria-hidden="true" />}
    </button>
    {error&&<small>Chưa làm mới được thông báo cập nhật.</small>}
    <span className={styles.srOnly} aria-live="polite">{unread?'Calenote có cập nhật chưa đọc. Mở Có gì mới để xem.':''}</span>
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="product-updates-title" onClose={() => trigger.current?.focus()} onClick={event => { if (event.target === event.currentTarget) close(); }}>
      <header><div><p>CALENOTE NGÀY MỘT TỐT HƠN</p><h2 id="product-updates-title">Có gì mới?</h2></div><button type="button" aria-label="Đóng cập nhật" onClick={close}><X aria-hidden="true" size={20} /></button></header>
      <div className={styles.entries}>{data?.catalog.notes.map(update => <article key={update.id}>{update.releasedAt?<time dateTime={update.releasedAt}>{new Intl.DateTimeFormat('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',dateStyle:'short'}).format(new Date(update.releasedAt))}</time>:<p>Trong bản ứng dụng này</p>}<h3>{update.title}</h3><ul>{update.memberChanges.map(change => <li key={change}>{change}</li>)}</ul></article>)}</div>
      <footer><small>Trạng thái đã đọc được lưu riêng cho tài khoản trên trình duyệt này.</small><button type="button" disabled={!data} onClick={() => { markRead(); close(); }}>Đã đọc cập nhật</button></footer>
    </dialog>
  </div>;
}
