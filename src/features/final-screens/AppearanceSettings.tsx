"use client";

import { useState } from "react";
import { saveAppearancePreferences, type AppearancePreferences } from "@/lib/appearance-preferences";
import { useAppearancePreferences } from "@/lib/use-appearance-preferences";
import styles from "./AppearanceSettings.module.css";

export function AppearanceSettings() {
  const value = useAppearancePreferences();
  const [notice, setNotice] = useState("");
  function edit(patch: Partial<AppearancePreferences>) {
    const saved = saveAppearancePreferences({ ...value, ...patch });
    setNotice(saved ? "Đã lưu lựa chọn trên thiết bị này." : "Đã áp dụng tạm cho trang này. Trình duyệt không cho phép lưu lựa chọn.");
  }
  return <section className={styles.card} id="appearance">
    <h2>Giao diện & lịch</h2><p>Áp dụng ngay và lưu riêng trên trình duyệt này. Các lựa chọn dưới đây không thay đổi giờ gửi lời nhắc.</p>
    <fieldset className={styles.density}><legend>Khoảng cách hiển thị</legend>
      {(["comfortable", "compact"] as const).map(density => <button key={density} type="button" aria-pressed={value.density === density} onClick={() => edit({ density })}>
        <span className={density === "compact" ? styles.compactPreview : styles.comfortPreview} aria-hidden="true"><i /><i /><i /></span>
        <strong>{density === "compact" ? "Gọn" : "Thoáng"}</strong><span>{density === "compact" ? "Dòng thấp, thẻ và khoảng cách nhỏ hơn" : "Nhiều khoảng nghỉ, dễ theo dõi"}</span>
      </button>)}
    </fieldset>
    <div className={styles.fields}>
      <label>Cỡ chữ<select value={value.textSize} onChange={event => edit({ textSize: event.target.value as AppearancePreferences["textSize"] })}><option value="small">Nhỏ</option><option value="standard">Vừa</option><option value="large">Lớn</option></select></label>
      <label>Trang mở sau khi đăng nhập<select value={value.startPage} onChange={event => edit({ startPage: event.target.value as AppearancePreferences["startPage"] })}><option value="today">Hôm nay</option><option value="calendar">Lịch</option><option value="inbox">Hộp thư</option><option value="reminders">Lời nhắc</option></select></label>
      <label>Ngày bắt đầu tuần<select value={value.weekStart} onChange={event => edit({ weekStart: event.target.value as AppearancePreferences["weekStart"] })}><option value="monday">Thứ Hai</option><option value="sunday">Chủ nhật</option></select></label>
      <label className={styles.lunar}><span>Hiển thị âm lịch</span><input type="checkbox" role="switch" checked={value.showLunar} onChange={event => edit({ showLunar: event.target.checked })} /></label>
    </div><p role="status" className={styles.notice}>{notice}</p>
  </section>;
}
