"use client";

import { useState, type FormEvent } from "react";
import { ArrowUpRight, Bell, LockKeyhole, SlidersHorizontal, UserRound } from "lucide-react";
import type { SessionUser } from "@/contracts/api/session";
import type { PublicPreferences } from "@/contracts/api/preferences";
import styles from "./FinalScreenExperience.module.css";

type Props = { user: SessionUser; value: PublicPreferences; save(value: PublicPreferences): Promise<boolean>; notice: string | null; busy: boolean };
export function SettingsPanel({ user, value, save, notice, busy }: Props) {
  const [draft, setDraft] = useState(value);
  const [editedSinceSubmit, setEditedSinceSubmit] = useState(false);
  function edit(next: PublicPreferences) { setDraft(next); setEditedSinceSubmit(true); }
  const [validation, setValidation] = useState("");
  const [density, setDensity] = useState<"comfortable" | "compact">(() => {
    if (typeof window === "undefined") return "comfortable";
    try { return window.localStorage.getItem("calenote-ui-density") === "compact" ? "compact" : "comfortable"; } catch { return "comfortable"; }
  });
  const [appearanceNotice, setAppearanceNotice] = useState("");
  const address = ({ ban: "bạn", anh_chi: "anh/chị", ong_tui: "ông", minh: "mình", sep: "sếp", custom: draft.customDisplayName || "bạn" })[draft.addressStyle];
  const preview = ({ concise: `${address}, lời nhắc đã sẵn sàng. Xác nhận nhé?`, friendly: `Mình ghi nhận rồi nha. ${address} xác nhận thời gian giúp mình nhé!`, professional: `Lời nhắc đã được chuẩn bị. Mời ${address} kiểm tra và xác nhận.`, playful: `Sẵn sàng rồi đây! ${address} chốt giờ để mình nhớ giúp nhé.` })[draft.tone];
  async function submit(event: FormEvent) {
    event.preventDefault();
    const name = draft.customDisplayName?.trim() || null;
    if (draft.addressStyle === "custom" && (!name || name.length > 80)) { setValidation("Nhập cách gọi từ 1 đến 80 ký tự."); return; }
    setValidation("");
    setEditedSinceSubmit(false);
    await save({ ...draft, customDisplayName: draft.addressStyle === "custom" ? name : null });
  }
  function changeDensity(next: "comfortable" | "compact") {
    setDensity(next);
    document.documentElement.dataset.density = next;
    try { window.localStorage.setItem("calenote-ui-density", next); setAppearanceNotice("Đã lưu giao diện trên trình duyệt này."); }
    catch { setAppearanceNotice("Đã áp dụng cho trang này. Trình duyệt không cho phép lưu lựa chọn."); }
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
          <div className={styles.preview}><span>Ví dụ giọng điệu</span><p>{preview}</p><small>Minh hoạ cách diễn đạt; nội dung phản hồi thực tế tuỳ tình huống.</small></div>
          <div className={styles.saveRow}><button className={styles.primary} type="submit" disabled={busy}>{busy ? "Đang lưu…" : "Lưu cá nhân hoá"}</button><span role="status">{editedSinceSubmit ? "Có thay đổi chưa lưu." : notice}</span></div>
          {validation && <p role="alert" className={styles.mutationError}>{validation}</p>}
        </form>
      </section>
      <section className={styles.settingsCard} id="appearance">
        <h2>Giao diện</h2><p>Chọn khoảng cách phù hợp với cách bạn làm việc. Lưu riêng trên trình duyệt này.</p>
        <div className={styles.densityChoices} role="group" aria-label="Mật độ giao diện">
          <button type="button" aria-pressed={density === "comfortable"} onClick={() => changeDensity("comfortable")}><strong>Thoáng</strong><span>Nhiều khoảng nghỉ, dễ theo dõi</span></button>
          <button type="button" aria-pressed={density === "compact"} onClick={() => changeDensity("compact")}><strong>Gọn</strong><span>Nhiều nội dung hơn trên màn hình</span></button>
        </div><p role="status">{appearanceNotice}</p>
      </section>
      <section className={styles.settingsCard} id="account">
        <h2>Tài khoản</h2><p>Thông tin không gian Calenote của bạn.</p>
        <dl className={styles.details}><div><dt>Tên tài khoản</dt><dd>{user.displayName}</dd></div><div><dt>Email đăng nhập</dt><dd>{user.email}</dd></div><div><dt>Múi giờ lời nhắc</dt><dd>Việt Nam · UTC+7</dd></div><div><dt>Đăng nhập</dt><dd>Mã một lần qua bot riêng</dd></div></dl>
        <p className={styles.help}>Tên tài khoản và email hiện chỉ xem. Bạn có thể đặt tên gọi riêng ở Cá nhân hoá. Lịch nhắc hiện hỗ trợ giờ Việt Nam.</p>
        <p className={styles.help}>Đăng xuất ở menu tài khoản; trên điện thoại, mở mục Thêm → Đăng xuất.</p>
      </section>
      <section className={styles.settingsCard} id="delivery">
        <h2>Kênh nhận lời nhắc</h2><p>Lời nhắc được gửi qua bot đã kết nối với cuộc trò chuyện riêng của bạn.</p>
        <a className={styles.destination} href="/app/connections"><span><strong>Quản lý Zalo & Telegram</strong><small>Xem trạng thái và hoàn tất kết nối bot</small></span><ArrowUpRight size={19} /></a>
        <a className={styles.destination} href="/app/activity"><span><strong>Lịch sử hoạt động</strong><small>Xem những thay đổi quan trọng của tài khoản</small></span><ArrowUpRight size={19} /></a>
      </section>
      <section className={styles.settingsCard} id="privacy">
        <h2>Quyền riêng tư & trợ lý</h2><p>Trợ lý hoạt động ở chế độ riêng tư. Calenote xử lý ngày giờ và chỉ tạo lời nhắc sau bước xác nhận của bạn.</p>
        <ul className={styles.privacyList}><li>Nội dung nhạy cảm được mã hoá khi lưu trữ.</li><li>Trợ lý giúp hiểu ý định và nội dung lời nhắc.</li><li>Bạn luôn kiểm tra thời gian trước khi xác nhận.</li></ul>
        <a className={styles.textLink} href="/docs">Tìm hiểu cách Calenote hoạt động →</a>
      </section>
    </div>
  </div>;
}
