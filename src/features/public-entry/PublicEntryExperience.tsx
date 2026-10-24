import Link from "next/link";
import Image from "next/image";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { CalenoteMark } from "@/components/brand/CalenoteMark";
import styles from "./PublicEntryExperience.module.css";

const steps = [
  ["1", "Kết nối Telegram hoặc Zalo", "Dùng bot của riêng bạn để Calenote có thể trò chuyện cùng bạn."],
  ["2", "Tạo lời nhắc, kiểm tra thời gian", "Dùng Hôm nay trên web hoặc nhắn trong chat riêng đã liên kết. Kiểm tra đề xuất trước khi xác nhận."],
  ["3", "Theo dõi những việc đang chờ", "Xem Lịch và Lời nhắc. Tin nhắc qua bot đến quanh phút đã hẹn, tuỳ mạng và nền tảng."],
] as const;

export function PublicEntryExperience() {
  return <main className={styles.page}>
    <header className={styles.header}>
      <Link href="/" aria-label="Calenote"><CalenoteMark /></Link>
      <nav aria-label="Điều hướng trang chủ"><a href="#capabilities">Tính năng</a><Link href="/docs">Hướng dẫn</Link><Link className={styles.loginLink} href="/login">Đăng nhập</Link></nav>
    </header>
    <section className={styles.hero} aria-labelledby="landing-title">
      <div className={styles.heroCopy}>
        <p className={styles.eyebrow}>Nhắc việc theo cách tự nhiên</p>
        <h1 id="landing-title">Nhắc một câu. Calenote giữ phần còn lại.</h1>
        <p>Ghi lại việc cần nhớ, kiểm tra thời gian và theo dõi lời nhắc trong một không gian riêng. Kết nối bot của bạn khi muốn nhận tin qua Zalo hoặc Telegram.</p>
        <div className={styles.actions}>
          <Link className={styles.primary} href="/onboarding">Bắt đầu <ArrowRight size={18} /></Link>
          <Link className={styles.secondary} href="/login">Đăng nhập</Link>
        </div>
      </div>
      <figure className={styles.productPreview}>
        <Image src="/guide/today-desktop.jpg" alt="Giao diện Hôm nay của Calenote với dữ liệu mẫu" width={1425} height={1198} unoptimized />
        <figcaption>Ảnh chụp Calenote trên local · dữ liệu mẫu.</figcaption>
      </figure>
    </section>
    <section id="capabilities" className={styles.section} aria-labelledby="capabilities-title">
      <p className={styles.eyebrow}>Trong Calenote hiện có</p><h2 id="capabilities-title">Một nơi cho những việc đang chờ bạn</h2>
      <div className={styles.capabilities}>
        <article><span>01</span><h3>Ngày của bạn</h3><p>Tạo lời nhắc với nội dung, ngày và giờ cụ thể. Hôm nay giúp xem việc sắp tới và những lời nhắc cần kiểm tra.</p><Link href="/app/today">Mở Hôm nay <ArrowRight size={16} aria-hidden="true" /></Link></article>
        <article><span>02</span><h3>Kiểm tra rồi quyết định</h3><p>Hộp thư tập hợp đề xuất đang chờ. Đọc lại thời gian và nội dung, rồi chọn Đồng ý hoặc Bỏ qua.</p><Link href="/app/inbox">Mở Hộp thư <ArrowRight size={16} aria-hidden="true" /></Link></article>
        <article><span>03</span><h3>Xem lại, bớt bỏ sót</h3><p>Xem lời nhắc theo ngày trên Lịch; tìm trạng thái, lịch sử và huỷ lời nhắc không còn cần trong Lời nhắc.</p><Link href="/app/calendar">Mở Lịch <ArrowRight size={16} aria-hidden="true" /></Link></article>
      </div>
      <p className={styles.signInNote}>Các màn hình cá nhân yêu cầu đăng nhập. Telegram và Zalo dùng bot do bạn sở hữu; hướng dẫn tập trung vào chat riêng.</p>
    </section>
    <section className={styles.section} aria-labelledby="how-it-works"><p className={styles.eyebrow}>Cách hoạt động</p><h2 id="how-it-works">Ít bước hơn. Nhẹ đầu hơn.</h2><ol className={styles.steps}>{steps.map(([number, title, copy]) => <li key={number}><span>{number}</span><div><h3>{title}</h3><p>{copy}</p></div></li>)}</ol></section>
    <section className={styles.trust} aria-labelledby="trust-title"><LockKeyhole size={22} aria-hidden="true" /><div><p className={styles.eyebrow}>Riêng tư theo thiết kế</p><h2 id="trust-title">Bạn vẫn là người quyết định.</h2><p>Thông tin kết nối được mã hoá khi lưu. Các đề xuất đang chờ cần bạn xác nhận; bạn có thể xem trạng thái và lịch sử lời nhắc trước khi quyết định.</p></div></section>
    <section className={styles.helpLinks} aria-label="Tìm đúng nơi"><div><h2>Cần hướng dẫn từng bước?</h2><p>Từ kết nối bot đến tạo lời nhắc đầu tiên, chọn tác vụ và làm theo đúng màn hình.</p><Link href="/docs">Xem hướng dẫn sử dụng <ArrowRight size={16} aria-hidden="true" /></Link></div><div><h2>Đã có tài khoản?</h2><p>Xem kết nối bot, hồ sơ và các lựa chọn cá nhân hoá trong không gian của bạn.</p><Link href="/app/connections">Kết nối</Link><Link href="/app/settings">Cài đặt</Link><Link href="/app/feedback">Góp ý & báo lỗi (cần đăng nhập)</Link></div></section>
    <section className={styles.final} aria-labelledby="start-title"><h2 id="start-title">Bắt đầu với Calenote</h2><p>Thiết lập một bot riêng, rồi để những điều quan trọng đến đúng lúc.</p><Link className={styles.primary} href="/onboarding">Bắt đầu <ArrowRight size={18} /></Link></section>
  </main>;
}
