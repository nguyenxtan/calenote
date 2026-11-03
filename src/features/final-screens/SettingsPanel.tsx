"use client";

import { useState, type FormEvent } from "react";
import { ArrowUpRight, Bell, LockKeyhole, SlidersHorizontal, UserRound } from "lucide-react";
import type { SessionUser } from "@/contracts/api/session";
import type { PublicPreferences } from "@/contracts/api/preferences";
import { AppearanceSettings } from "@/features/final-screens/AppearanceSettings";
import { AccountSettings, type AccountSettingsProps } from "./AccountSettings";
import type { PublicConnection } from "@/contracts/api/connections";
import { PrimaryLoginPanel } from "./PrimaryLoginPanel";
import styles from "./FinalScreenExperience.module.css";

type Props = AccountSettingsProps & { connections?: PublicConnection[]; user: SessionUser; value: PublicPreferences; save(value: PublicPreferences): Promise<boolean>; notice: string | null; busy: boolean };
export function SettingsPanel({ user, value, save, notice, busy, saveProfile, sessions, revokeOthers, connections }: Props) {
  const [draft, setDraft] = useState(value);
  const [editedSinceSubmit, setEditedSinceSubmit] = useState(false);
  function edit(next: PublicPreferences) { setDraft(next); setEditedSinceSubmit(true); }
  const [validation, setValidation] = useState("");
  const address = ({ ban: "bạn", anh_chi: "anh/chị", ong_tui: "ông", minh: "mình", sep: "sếp", custom: draft.customDisplayName || "bạn" })[draft.addressStyle];
  const preview = draft.reminderConfirmation !== "preview"
    ? ({ concise: `${address}, đã tạo lời nhắc.`, friendly: `Mình đã tạo lời nhắc cho ${address} rồi nha!`, professional: `Lời nhắc của ${address} đã được tạo.`, playful: `Đã chốt lịch cho ${address}! Đến giờ mình sẽ nhắc nhé.` })[draft.tone]
    : ({ concise: `${address}, lời nhắc đã sẵn sàng. Xác nhận nhé?`, friendly: `Mình ghi nhận rồi nha. ${address} xác nhận thời gian giúp mình nhé!`, professional: `Lời nhắc đã được chuẩn bị. Mời ${address} kiểm tra và xác nhận.`, playful: `Sẵn sàng rồi đây! ${address} chốt giờ để mình nhớ giúp nhé.` })[draft.tone];
  async function submit(event: FormEvent) {
    event.preventDefault();
    const name = draft.customDisplayName?.trim() || null;
    if (draft.addressStyle === "custom" && (!name || name.length > 80)) { setValidation("Nhập cách gọi từ 1 đến 80 ký tự."); return; }
    setValidation("");
    setEditedSinceSubmit(false);
    await save({ ...draft, customDisplayName: draft.addressStyle === "custom" ? name : null });
  }
  return <div className={styles.settingsLayout}>
    <nav className={styles.settingsNav} aria-label="Nhóm cài đặt">
      <a href="#personalisation"><SlidersHorizontal size={17} />Cá nhân hoá</a>
      <a href="#appearance"><SlidersHorizontal size={17} />Giao diện</a>
      <a href="#account"><UserRound size={17} />Tài khoản</a>
      <a href="#delivery"><Bell size={17} />Kênh nhận lời nhắc</a>
      <a href="#privacy"><LockKeyhole size={17} />Quyền riêng tư</a>
    </nav>
    <div className={styles.settingsContent}>
      <section className={styles.settingsCard} id="personalisation">
        <div className={styles.cardHeading}><span className={styles.iconTile}><SlidersHorizontal size={20} /></span><div><h2>Cá nhân hoá</h2><p>Chọn cách Calenote trò chuyện với bạn.</p></div></div>
        <form onSubmit={event => void submit(event)}>
          <div className={styles.fieldGrid}>
            <label>Cách xưng hô<select disabled={busy} value={draft.addressStyle} onChange={event => edit({ ...draft, addressStyle: event.target.value as PublicPreferences["addressStyle"] })}>
              <option value="ban">Bạn / mình</option><option value="anh_chi">Anh / chị</option><option value="ong_tui">Ông / tui</option><option value="minh">Mình</option><option value="sep">Sếp</option><option value="custom">Tên gọi riêng</option>
            </select></label>
            <label>Giọng điệu<select disabled={busy} value={draft.tone} onChange={event => edit({ ...draft, tone: event.target.value as PublicPreferences["tone"] })}>
              <option value="concise">Ngắn gọn</option><option value="friendly">Thân thiện</option><option value="professional">Chuyên nghiệp</option><option value="playful">Vui vẻ</option>
            </select></label>
          </div>
          {draft.addressStyle === "custom" && <label className={styles.customName}>Bạn muốn được gọi là gì?<input disabled={busy} maxLength={80} value={draft.customDisplayName ?? ""} onChange={event => edit({ ...draft, customDisplayName: event.target.value })} placeholder="Ví dụ: Tân" /></label>}
          <div className={styles.confirmationSetting}>
            <label className={styles.switchRow}>
              <span id="confirmation-label">Xem trước và xác nhận trước khi tạo lời nhắc</span>
              <input className={styles.confirmationSwitch} type="checkbox" role="switch" aria-labelledby="confirmation-label" aria-describedby="confirmation-help" disabled={busy} checked={draft.reminderConfirmation === "preview"} onChange={event => edit({ ...draft, reminderConfirmation: event.target.checked ? "preview" : "auto" })} />
            </label>
            <p id="confirmation-help" className={styles.help}>Mặc định, yêu cầu nhắc rõ nội dung và ngày giờ trong Zalo hoặc Telegram được tạo ngay. Bật lựa chọn này để xem trước rồi xác nhận. Áp dụng chung cho tài khoản.</p>
          </div>
          <div className={styles.preview}><span>Ví dụ giọng điệu</span><p>{preview}</p><small>Minh hoạ cách diễn đạt; nội dung phản hồi thực tế tuỳ tình huống.</small></div>
          <div className={styles.saveRow}><button className={styles.primary} type="submit" disabled={busy}>{busy ? "Đang lưu…" : "Lưu cá nhân hoá"}</button><span role="status">{editedSinceSubmit ? "Có thay đổi chưa lưu." : notice}</span></div>
          {validation && <p role="alert" className={styles.mutationError}>{validation}</p>}
        </form>
      </section>
      <AppearanceSettings />
      <AccountSettings user={user} saveProfile={saveProfile} sessions={sessions} revokeOthers={revokeOthers} />
      <section className={styles.settingsCard} id="delivery">
        <h2>Kênh nhận lời nhắc</h2><p>Lời nhắc được gửi qua bot đã kết nối với cuộc trò chuyện riêng của bạn.</p>
        {connections && <><ul>{connections.map(connection => <li key={connection.publicId}><strong>{connection.displayName}</strong> · {connection.provider === "telegram" ? "Telegram" : "Zalo"} · {connection.disconnected ? "Đã ngắt trong Calenote" : connection.state === "ACTIVE_BOUND" ? "Đã kết nối cuộc trò chuyện riêng" : connection.state === "ACTIVE_UNBOUND" ? "Chưa liên kết cuộc trò chuyện" : "Cần kiểm tra kết nối"}</li>)}</ul>{connections.length === 0 && <p>Chưa có bot Zalo hoặc Telegram trong tài khoản.</p>}<PrimaryLoginPanel connections={connections} /></>}
        <a className={styles.destination} href="/app/connections"><span><strong>Quản lý Zalo & Telegram</strong><small>Xem trạng thái và hoàn tất kết nối bot</small></span><ArrowUpRight size={19} /></a>
        <a className={styles.destination} href="/app/activity"><span><strong>Lịch sử hoạt động</strong><small>Xem những thay đổi quan trọng của tài khoản</small></span><ArrowUpRight size={19} /></a>
      </section>
      <section className={styles.settingsCard} id="privacy">
        <h2>Quyền riêng tư & trợ lý</h2><p>Trợ lý hoạt động ở chế độ riêng tư. Calenote kiểm tra ngày giờ và tạo lời nhắc theo lựa chọn xác nhận của bạn.</p>
        <ul className={styles.privacyList}><li>Nội dung nhạy cảm được mã hoá khi lưu trữ.</li><li>Trợ lý giúp hiểu ý định và nội dung lời nhắc.</li><li>Yêu cầu còn thiếu hoặc chưa rõ thông tin sẽ được hỏi lại.</li></ul>
        <a className={styles.textLink} href="/docs">Tìm hiểu cách Calenote hoạt động →</a>
      </section>
    </div>
  </div>;
}
