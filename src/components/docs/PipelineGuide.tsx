import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowRight,
  Bot,
  CalendarCheck,
  Check,
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Link2,
  LockKeyhole,
  MessageCircle,
  Send,
  ShieldCheck,
  Timer,
  Webhook,
} from "lucide-react";
import { CalenoteMark } from "@/components/brand/CalenoteMark";
import styles from "./PipelineGuide.module.css";

const SETUP_STEPS = [
  {
    icon: <Bot size={20} />,
    title: "Tạo bot của riêng bạn",
    body: "Tạo bot trực tiếp trên Zalo Bot Platform hoặc qua @BotFather của Telegram. Bạn vẫn là chủ của bot và token.",
  },
  {
    icon: <LockKeyhole size={20} />,
    title: "Kết nối an toàn",
    body: "Nhập token một lần trong trang kết nối Calenote. Token được kiểm tra ở máy chủ, mã hóa khi lưu và không xuất hiện trong đường dẫn.",
  },
  {
    icon: <Webhook size={20} />,
    title: "Mở đường nhận tin",
    body: "Calenote đăng ký webhook HTTPS cho bot và xác thực bí mật trên từng tin đến trước khi xử lý.",
  },
  {
    icon: <Link2 size={20} />,
    title: "Liên kết chat riêng",
    body: "Gửi lệnh có mã dùng một lần trong cuộc chat riêng với đúng bot. Mã hết hạn sau 10 phút và chỉ dùng được một lần.",
  },
] as const;

const REMINDER_STEPS = [
  {
    icon: <MessageCircle size={19} />,
    title: "Bạn nhắn",
    body: "Viết lời nhắc bằng tiếng Việt tự nhiên trong cuộc chat riêng đã liên kết.",
  },
  {
    icon: <CalendarCheck size={19} />,
    title: "Calenote đọc lại",
    body: "Bot gửi bản xem trước gồm nội dung và giờ Việt Nam để bạn kiểm tra.",
  },
  {
    icon: <CheckCircle2 size={19} />,
    title: "Bạn xác nhận",
    body: "Bạn xác nhận trong chat bằng cách trả lời “có”, “ok”, “1” hoặc “xác nhận”. Chỉ sau khi xác nhận, lời nhắc mới được kích hoạt.",
  },
  {
    icon: <Timer size={19} />,
    title: "Bot nhắc bạn",
    body: "Đến giờ, Calenote gửi quanh phút đã hẹn qua chính bot đã kết nối.",
  },
] as const;

export function PipelineGuide() {
  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <Link href="/" aria-label="Calenote — Trang kết nối"><CalenoteMark compact /></Link>
        <nav aria-label="Điều hướng tài liệu">
          <Link href="/dashboard">Tổng quan</Link>
          <Link href="/" className={styles.topCta}>Kết nối bot <ArrowRight size={15} aria-hidden="true" /></Link>
        </nav>
      </header>

      <section className={styles.hero}>
        <div className={styles.heroGrid}>
          <div>
            <p className={styles.eyebrow}>Hướng dẫn bắt đầu</p>
            <h1>Kết nối bot của bạn với Calenote</h1>
            <p className={styles.heroLead}>
              Dùng bot Zalo hoặc Telegram do chính bạn sở hữu để tạo, xác nhận và nhận
              nhắc hẹn trong một cuộc chat riêng.
            </p>
            <div className={styles.heroActions}>
              <Link href="/">Bắt đầu kết nối <ArrowRight size={16} aria-hidden="true" /></Link>
              <a href="#providers">Chọn nền tảng bot</a>
            </div>
          </div>
          <aside className={styles.promiseCard} aria-label="Điều Calenote hỗ trợ">
            <ShieldCheck size={24} aria-hidden="true" />
            <div>
              <strong>Riêng tư từ lúc kết nối</strong>
              <span>Chat riêng duy nhất · giờ Việt Nam · xác nhận trước khi lưu</span>
            </div>
          </aside>
        </div>
      </section>

      <div className={styles.body}>
        <section className={styles.setupSection} aria-label="Các bước kết nối an toàn">
          <header className={styles.sectionHeader}>
            <p className={styles.eyebrow}>Bốn bước kết nối</p>
            <h2>Từ token đến cuộc chat riêng</h2>
            <p>Bạn chỉ cung cấp token ở bước kết nối; các lần trao đổi với nền tảng bot sau đó đều do máy chủ Calenote thực hiện.</p>
          </header>
          <div className={styles.stepGrid}>
            {SETUP_STEPS.map((step, index) => (
              <article className={styles.stepCard} key={step.title}>
                <header><span aria-hidden="true">{step.icon}</span><small>0{index + 1}</small></header>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
                {index === SETUP_STEPS.length - 1 && (
                  <code className={styles.connectCommand}>/connect &lt;mã-một-lần&gt;</code>
                )}
              </article>
            ))}
          </div>
        </section>

        <section className={styles.providers} id="providers" aria-labelledby="providers-title">
          <header className={styles.sectionHeader}>
            <p className={styles.eyebrow}>Chọn nền tảng</p>
            <h2 id="providers-title">Hai cách tạo bot của riêng bạn</h2>
          </header>
          <div className={styles.providerGrid}>
            <ProviderPanel
              logo="Z"
              logoClass="zaloLogo"
              title="Zalo Bot Platform"
              summary="Phù hợp khi bạn muốn dùng Zalo. Đây là Zalo Bot Platform, không phải Zalo OA OpenAPI."
              steps={[
                "Đăng nhập Zalo Bot Manager và mở Bot Creator.",
                "Tạo bot, sau đó sao chép Bot Token mà Zalo cấp.",
                "Chọn Zalo trên Calenote, dán token và hoàn tất kết nối.",
              ]}
              href="https://docs.zaloplatforms.com/docs/BOT/create_bot"
              linkLabel="Cách tạo bot trên Zalo"
            />
            <ProviderPanel
              logo={<Send size={20} fill="currentColor" />}
              logoClass="telegramLogo"
              title="Telegram Bot API"
              summary="Phù hợp khi bạn đang dùng Telegram và muốn tạo bot nhanh qua tài khoản chính thức @BotFather."
              steps={[
                "Mở cuộc chat với @BotFather trong Telegram.",
                "Gửi /newbot, đặt tên và sao chép HTTP API token được cấp.",
                "Chọn Telegram trên Calenote, dán token và hoàn tất kết nối.",
              ]}
              href="https://core.telegram.org/bots/features#creating-a-new-bot"
              linkLabel="Cách tạo bot trên Telegram"
            />
          </div>
          <p className={styles.tokenNote}>
            <KeyRound size={17} aria-hidden="true" />
            Không gửi token qua tin nhắn, email hoặc ảnh chụp. Nếu nghi ngờ token đã lộ, hãy tạo lại token trên nền tảng bot trước khi kết nối lại.
          </p>
        </section>

        <section className={styles.pipelineSection} aria-label="Từ tin nhắn đến lời nhắc">
          <header className={styles.sectionHeader}>
            <p className={styles.eyebrow}>Một vòng nhắc hẹn</p>
            <h2>Bạn luôn duyệt trước khi Calenote lưu</h2>
            <p>Giờ và nội dung được đọc lại trong chat, giúp tránh kích hoạt một lời nhắc bị hiểu sai.</p>
          </header>
          <ol className={styles.pipelineList}>
            {REMINDER_STEPS.map((step, index) => (
              <li key={step.title}>
                <span className={styles.pipelineIcon} aria-hidden="true">{step.icon}</span>
                <div><small>Bước {index + 1}</small><h3>{step.title}</h3><p>{step.body}</p></div>
                {index < REMINDER_STEPS.length - 1 && <ArrowRight className={styles.pipelineArrow} size={18} aria-hidden="true" />}
              </li>
            ))}
          </ol>
          <aside className={styles.deliveryNote}>
            <Check size={18} aria-hidden="true" />
            <p><strong>“Quanh phút đã hẹn” nghĩa là gì?</strong> Bộ lập lịch kiểm tra theo phút và chuyển tin qua hàng đợi gửi an toàn. Mạng hoặc nền tảng bot có thể làm tin đến chậm hơn một chút.</p>
          </aside>
        </section>

        <section className={styles.roadmapSection} aria-label="Lộ trình sau MVP">
          <div>
            <p className={styles.eyebrow}>Lộ trình sau MVP</p>
            <h2>Những ý tưởng chưa phải tính năng hiện tại</h2>
            <p>Calenote hiện tập trung vào một người, một chat riêng và nhắc hẹn một lần.</p>
          </div>
          <ul>
            <li>Cặp đôi</li>
            <li>Nhóm</li>
            <li>Thu chi</li>
            <li>Nhắc lặp lại</li>
            <li>Ứng dụng di động</li>
          </ul>
        </section>
      </div>

      <footer className={styles.footer}>
        <div><CalenoteMark compact /><span>Nhắc đúng điều quan trọng, qua bot của bạn.</span></div>
        <Link href="/">Bắt đầu kết nối <ArrowRight size={15} aria-hidden="true" /></Link>
      </footer>
    </main>
  );
}

function ProviderPanel({
  logo,
  logoClass,
  title,
  summary,
  steps,
  href,
  linkLabel,
}: {
  logo: ReactNode;
  logoClass: "zaloLogo" | "telegramLogo";
  title: string;
  summary: string;
  steps: readonly string[];
  href: string;
  linkLabel: string;
}) {
  return (
    <article className={styles.providerPanel}>
      <header>
        <span className={`${styles.providerLogo} ${styles[logoClass]}`} aria-hidden="true">{logo}</span>
        <div><h3>{title}</h3><p>{summary}</p></div>
      </header>
      <ol>
        {steps.map((step) => <li key={step}>{step}</li>)}
      </ol>
      <a href={href} target="_blank" rel="noreferrer">
        {linkLabel}<ExternalLink size={15} aria-hidden="true" />
      </a>
    </article>
  );
}
