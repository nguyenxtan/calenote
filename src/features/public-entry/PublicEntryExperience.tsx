import Link from "next/link";
import { ArrowRight, BellRing, LockKeyhole, MessageCircleMore, ShieldCheck } from "lucide-react";
import { CalenoteMark } from "@/components/brand/CalenoteMark";
import styles from "./PublicEntryExperience.module.css";

const steps = [
  ["1", "Kết nối Telegram hoặc Zalo", "Dùng bot của riêng bạn để Calenote có thể trò chuyện cùng bạn."],
  ["2", "Nhắn lời nhắc tự nhiên", "Gửi một câu như cách bạn vẫn nhắn cho chính mình."],
  ["3", "Nhận nhắc đúng lúc", "Calenote giữ nhịp cho những việc bạn đã chọn xác nhận."],
] as const;

export function PublicEntryExperience() {
  return <main className={styles.page}>
    <header className={styles.header}>
      <Link href="/" aria-label="Calenote"><CalenoteMark /></Link>
      <Link className={styles.loginLink} href="/login">Đăng nhập</Link>
    </header>
    <section className={styles.hero} aria-labelledby="landing-title">
      <div className={styles.heroCopy}>
        <p className={styles.eyebrow}>Nhắc việc theo cách tự nhiên</p>
        <h1 id="landing-title">Nhắc một câu. Calenote giữ phần còn lại.</h1>
        <p>Biến những lời nhắc ngắn thành một nhịp ngày bình tĩnh, qua Telegram hoặc Zalo mà bạn đã chọn.</p>
        <div className={styles.actions}>
          <Link className={styles.primary} href="/onboarding">Bắt đầu <ArrowRight size={18} /></Link>
          <Link className={styles.secondary} href="/login">Đăng nhập</Link>
        </div>
      </div>
      <aside className={styles.preview} aria-label="Ví dụ lời nhắc Calenote">
        <div className={styles.previewTop}><BellRing size={19} aria-hidden="true" /><span>Hôm nay</span></div>
        <p className={styles.chatUser}>14:00 nhắc mình gửi báo giá</p>
        <div className={styles.chatBot}><MessageCircleMore size={18} aria-hidden="true" /><p><strong>Đã hiểu.</strong><br />Mình sẽ nhắc bạn lúc 14:00.</p></div>
        <div className={styles.confirmed}><ShieldCheck size={17} aria-hidden="true" />Lời nhắc đang chờ bạn.</div>
      </aside>
    </section>
    <section className={styles.section} aria-labelledby="how-it-works"><p className={styles.eyebrow}>Cách hoạt động</p><h2 id="how-it-works">Ít bước hơn. Nhẹ đầu hơn.</h2><ol className={styles.steps}>{steps.map(([number, title, copy]) => <li key={number}><span>{number}</span><div><h3>{title}</h3><p>{copy}</p></div></li>)}</ol></section>
    <section className={styles.trust} aria-labelledby="trust-title"><LockKeyhole size={22} aria-hidden="true" /><div><p className={styles.eyebrow}>Riêng tư theo thiết kế</p><h2 id="trust-title">Bạn vẫn là người quyết định.</h2><p>Thông tin kết nối được bảo vệ khi lưu. Hỗ trợ thông minh là tuỳ chọn; các đề xuất quan trọng vẫn cần sự xác nhận của bạn.</p></div></section>
    <section className={styles.final} aria-labelledby="start-title"><h2 id="start-title">Bắt đầu với Calenote</h2><p>Thiết lập một bot riêng, rồi để những điều quan trọng đến đúng lúc.</p><Link className={styles.primary} href="/onboarding">Bắt đầu <ArrowRight size={18} /></Link></section>
  </main>;
}
