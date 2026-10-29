import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Bot, CalendarDays, CheckCircle2, BookOpen } from "lucide-react";
import { CalenoteMark } from "@/components/brand/CalenoteMark";
import { BotCreationGuide } from "./BotCreationGuide";
import styles from "./PipelineGuide.module.css";

const tasks = [
  ["start", "Kết nối bot"], ["create", "Tạo lời nhắc"], ["confirm", "Duyệt đề xuất"],
  ["organize", "Xem lịch & quản lý"], ["account", "Tài khoản"], ["trouble", "Khi cần kiểm tra"],
] as const;

export function PipelineGuide() {
  return <main className={styles.page}>
    <header className={styles.topbar}>
      <Link href="/" aria-label="Calenote — Trang chủ"><CalenoteMark compact /></Link>
      <nav aria-label="Điều hướng tài liệu"><Link href="/app/today">Hôm nay</Link><Link href="/app/settings">Cài đặt</Link><Link href="/docs" aria-current="page">Hướng dẫn</Link></nav>
    </header>
    <section className={styles.hero}>
      <p className={styles.eyebrow}>Hướng dẫn sử dụng</p><h1>Bắt đầu nhẹ nhàng với Calenote</h1>
      <p className={styles.heroLead}>Chọn việc bạn muốn làm. Mỗi hướng dẫn đưa bạn đến đúng màn hình, từng bước một.</p>
      <nav className={styles.taskNav} aria-label="Chọn tác vụ">{tasks.map(([id, label]) => <a key={id} href={`#${id}`}>{label}<ArrowRight size={15} aria-hidden="true" /></a>)}</nav>
    </section>
    <div className={styles.body}>
      <section id="start" className={styles.task} aria-labelledby="start-title">
        <header><Bot aria-hidden="true" /><p className={styles.eyebrow}>01 · Lần đầu sử dụng</p><h2 id="start-title">Kết nối bot của riêng bạn</h2><p>Calenote dùng bot bạn sở hữu trên Zalo Bot Platform hoặc Telegram. Hướng dẫn này dành cho cuộc chat riêng với bot.</p></header>
        <BotCreationGuide />
        <h3>Tiếp tục trên Calenote</h3>
        <ol><li><strong>Mở Bắt đầu kết nối.</strong> Điền thông tin tài khoản. Bạn sẽ đến bước chọn nền tảng.<div className={styles.taskActions}><Link href="/onboarding">Bắt đầu kết nối <ArrowRight size={16} aria-hidden="true" /></Link></div></li><li><strong>Nhập Bot token.</strong> Chọn đúng nền tảng và tự dán token vào ô Bot token. Sau khi bấm Kích hoạt bot, Calenote hiển thị bước liên kết.</li><li><strong>Gửi lệnh kết nối.</strong> Mở cuộc chat riêng với bot vừa tạo; trên Telegram bấm Start trước. Gửi nguyên lệnh /connect do Calenote cung cấp trước khi mã hết hạn. Bạn sẽ nhận được kết quả liên kết.</li><li><strong>Kiểm tra Kết nối.</strong> Xem trạng thái đã liên kết chat riêng. Việc lưu token chưa chứng minh đã liên kết thành công.<div className={styles.taskActions}><Link href="/app/connections">Mở Kết nối</Link></div></li></ol>
      </section>
      <section id="create" className={styles.task} aria-labelledby="create-title">
        <header><CalendarDays aria-hidden="true" /><p className={styles.eyebrow}>02 · Thêm một việc cần nhớ</p><h2 id="create-title">Tạo lời nhắc trên web</h2><p>Dùng biểu mẫu trên Hôm nay khi bạn đã biết nội dung và thời điểm chính xác.</p></header>
        <div className={styles.taskGrid}><ol><li>Mở <strong>Hôm nay</strong> và nhập vào ô <strong>Nội dung nhắc hẹn</strong>.</li><li>Bấm <strong>Chọn thời gian</strong>, rồi chọn ngày và giờ Việt Nam. Kiểm tra thời điểm hiển thị trước khi lưu.</li><li>Bấm <strong>Tạo lời nhắc</strong>. Đợi thông báo đã lưu; kiểm tra lại ở Hôm nay hoặc Lời nhắc.</li><li>Nếu kết quả chưa xác định, tải lại danh sách để kiểm tra trước khi gửi lại.</li></ol><figure><Image src="/guide/create-reminder.jpg" alt="Biểu mẫu tạo lời nhắc trên Hôm nay với dữ liệu mẫu" width={1425} height={1216} unoptimized /><figcaption>Ảnh chụp giao diện local · dữ liệu mẫu, không phải lịch của người dùng.</figcaption><a className={styles.enlarge} href="/guide/create-reminder.jpg" target="_blank" rel="noreferrer">Mở ảnh kích thước đầy đủ</a></figure></div>
        <div className={styles.taskActions}><Link href="/app/today">Mở Hôm nay <ArrowRight size={16} aria-hidden="true" /></Link></div>
      </section>
      <section id="confirm" className={styles.task} aria-labelledby="confirm-title">
        <header><CheckCircle2 aria-hidden="true" /><p className={styles.eyebrow}>03 · Bạn là người quyết định</p><h2 id="confirm-title">Kiểm tra trước khi đồng ý</h2></header>
        <ol><li>Nhắn yêu cầu bằng tiếng Việt trong cuộc chat riêng đã liên kết. Nếu bot hỏi thêm, cung cấp thông tin còn thiếu.</li><li>Đọc lại nội dung, ngày và giờ bot đưa ra. Làm theo yêu cầu xác nhận trong cuộc chat.</li><li>Trên web, mở <strong>Hộp thư</strong> để xem những đề xuất đang chờ. Chọn <strong>Đồng ý</strong> nếu đúng, hoặc <strong>Bỏ qua</strong> nếu không cần.</li><li>Kiểm tra lời nhắc sau khi duyệt. Một đề xuất đang chờ chưa phải lời nhắc đã được tạo.</li></ol>
        <p className={styles.note}>Tin nhắc được gửi quanh phút đã hẹn; mạng và nền tảng bot có thể làm tin đến chậm hơn.</p><div className={styles.taskActions}><Link href="/app/inbox">Mở Hộp thư</Link></div>
      </section>
      <section id="organize" className={styles.task} aria-labelledby="organize-title">
        <header><BookOpen aria-hidden="true" /><p className={styles.eyebrow}>04 · Tìm lại và quản lý</p><h2 id="organize-title">Biết điều gì đang chờ mình</h2></header>
        <div className={styles.destinations}><article><h3>Lịch</h3><p>Xem lời nhắc theo ngày. Chuyển tháng hoặc quay về Hôm nay để tìm thời điểm cần xem.</p><Link href="/app/calendar">Mở Lịch</Link></article><article><h3>Lời nhắc</h3><p>Xem những lời nhắc đang chờ hoặc lịch sử. Kiểm tra đúng nội dung rồi dùng Huỷ khi không còn cần.</p><Link href="/app/reminders">Mở Lời nhắc</Link></article><article><h3>Hoạt động</h3><p>Xem các thay đổi được ghi nhận gần đây, như tạo hoặc huỷ lời nhắc và liên kết chat.</p><Link href="/app/activity">Mở Hoạt động</Link></article></div>
        <p className={styles.note}>Trên điện thoại, bấm <strong>Menu</strong> ở thanh dưới để mở đầy đủ các nhóm điều hướng. Mục đang xem được tô màu cam.</p>
      </section>
      <section id="account" className={styles.task} aria-labelledby="account-title">
        <header><p className={styles.eyebrow}>05 · Không gian của bạn</p><h2 id="account-title">Tài khoản và cài đặt</h2></header>
        <ol><li>Mở <strong>Cài đặt</strong> để xem hồ sơ và các lựa chọn cá nhân hoá hiện có.</li><li>Trên máy tính, bấm tên tài khoản ở cuối menu để mở <strong>Đăng xuất</strong>. Trên điện thoại, Đăng xuất nằm trong <strong>Menu</strong>.</li><li>Khi quay lại, mở <strong>Đăng nhập</strong> và làm theo hướng dẫn nhận mã qua bot đã liên kết.</li></ol><div className={styles.taskActions}><Link href="/app/settings">Mở Cài đặt</Link><Link href="/login">Đăng nhập</Link></div>
      </section>
      <section id="trouble" className={styles.task} aria-labelledby="trouble-title">
        <header><p className={styles.eyebrow}>06 · Khi cần kiểm tra</p><h2 id="trouble-title">Chưa thấy lời nhắc hoặc tin nhắn?</h2></header>
        <details><summary>Bot chưa liên kết chat riêng</summary><p>Mở Kết nối. Nếu có nút Tạo mã kết nối, lấy mã mới và gửi lệnh cho đúng bot. Không gửi mã cho người khác.</p></details><details><summary>Đường nhận tin cần mở lại</summary><p>Mở Kết nối và làm theo thao tác hiển thị. Kiểm tra lại trạng thái sau khi hoàn tất; đừng coi việc lưu webhook là bằng chứng đã nhận tin thành công.</p></details><details><summary>Đến giờ nhưng chưa nhận được tin</summary><p>Kiểm tra trạng thái ở Lời nhắc và nhóm Cần kiểm tra trên Hôm nay. Kiểm tra Kết nối; chưa tạo thêm lời nhắc trùng chỉ vì tin chưa đến.</p></details><details><summary>Trang chưa tải được dữ liệu</summary><p>Dùng Thử lại ở phần bị lỗi. Nếu phiên hết hạn, đăng nhập lại. Nếu vừa lưu mà kết quả chưa rõ, xem lại danh sách trước khi thử lần nữa.</p></details>
      </section>
    </div>
    <footer className={styles.footer}><CalenoteMark compact /><Link href="/app/today">Về Hôm nay <ArrowRight size={16} aria-hidden="true" /></Link></footer>
  </main>;
}
