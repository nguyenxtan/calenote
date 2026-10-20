"use client";

import { useRef, useSyncExternalStore } from "react";
import { Bell, X } from "lucide-react";
import styles from "./ProductUpdates.module.css";

export const updates = [
  { id: "2026-10-20-personal", date: "20/10/2026", title: "Thêm Bàn việc cá nhân", changes: ["Lưu sinh nhật, ngày giỗ và hạn gia hạn theo lịch âm hoặc dương; chọn lặp hằng năm hoặc một lần.", "Chọn các mốc nhắc trước hạn, chẳng hạn 30, 7 và 1 ngày. Sự kiện mới mặc định tắt nhắc tự động.", "Chủ động lưu, tìm và xoá thông tin muốn ghi nhớ; trên bot dùng lệnh trí nhớ kèm từ khoá.", "Bật riêng bản tin sáng hoặc nhìn lại buổi tối trong Bàn việc cá nhân. Mặc định cả hai đều tắt."] },
  { id: "2026-10-20", date: "20/10/2026", title: "Nhắc rồi, theo dõi đến khi xong", changes: ["Đánh dấu việc đã xong, hoãn hoặc đổi giờ ngay trong danh sách việc.", "Bật nhắc tiếp khi cần: sau 30 phút, 2 giờ hoặc 24 giờ, tối đa 3 lần. Mặc định tính năng này tắt.", "Tạo lời nhắc trên web đã được sửa lỗi báo chưa kết nối dù việc đã lưu."] },
  { id: "2026-10-19", date: "19/10/2026", title: "Calenote theo cách của bạn", changes: ["Đổi tên hiển thị, cỡ chữ, khoảng cách Thoáng / Gọn và trang mở đầu trong Cài đặt.", "Chọn tạo lời nhắc ngay khi chat đã đủ thông tin, hoặc xem trước rồi xác nhận.", "Quản lý kết nối Zalo và Telegram trong mục Kết nối. Kênh đăng nhập cuối cùng được bảo vệ để bạn không mất quyền truy cập."] },
] as const;
const key = "calenote.product-updates.read";
const changed = "calenote-product-updates-read";
function snapshot() { try { return localStorage.getItem(key); } catch { return null; } }
function subscribe(callback: () => void) { window.addEventListener("storage", callback); window.addEventListener(changed, callback); return () => { window.removeEventListener("storage", callback); window.removeEventListener(changed, callback); }; }

export function ProductUpdates() {
  const read = useSyncExternalStore(subscribe, snapshot, () => updates[0].id);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  function close() { dialog.current?.close(); trigger.current?.focus(); }
  function markRead() { try { localStorage.setItem(key, updates[0].id); window.dispatchEvent(new Event(changed)); } catch { /* Reading remains available when browser storage is blocked. */ } }
  return <div className={styles.root}>
    <button ref={trigger} className={styles.trigger} type="button" aria-label={read !== updates[0].id ? "Có gì mới — có cập nhật chưa đọc" : "Có gì mới"} aria-haspopup="dialog" onClick={() => dialog.current?.showModal()}>
      <Bell size={19} aria-hidden="true" /><span>Có gì mới</span>{read !== updates[0].id && <span className={styles.dot} aria-hidden="true" />}
    </button>
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="product-updates-title" onClose={() => trigger.current?.focus()} onClick={event => { if (event.target === event.currentTarget) close(); }}>
      <header><div><p>CALENOTE NGÀY MỘT TỐT HƠN</p><h2 id="product-updates-title">Có gì mới?</h2></div><button type="button" aria-label="Đóng cập nhật" onClick={close}><X aria-hidden="true" size={20} /></button></header>
      <div className={styles.entries}>{updates.map(update => <article key={update.id}><time dateTime={update.id}>{update.date}</time><h3>{update.title}</h3><ul>{update.changes.map(change => <li key={change}>{change}</li>)}</ul></article>)}</div>
      <footer><small>Trạng thái đã đọc được lưu trên trình duyệt này.</small><button type="button" onClick={() => { markRead(); close(); }}>Đã đọc cập nhật</button></footer>
    </dialog>
  </div>;
}
