import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  Database,
  ExternalLink,
  KeyRound,
  LockKeyhole,
  MessageCircle,
  Radio,
  Send,
  ServerCog,
  ShieldCheck,
  Webhook,
} from "lucide-react";
import { CalenoteMark } from "@/components/brand/CalenoteMark";
import styles from "./PipelineGuide.module.css";

const productionSteps = [
  {
    number: "01",
    icon: <KeyRound size={19} />,
    title: "Xác minh token",
    body: "Server gọi getMe đến host provider cố định, chuẩn hóa danh tính bot và chặn token không an toàn.",
    current: true,
  },
  {
    number: "02",
    icon: <LockKeyhole size={19} />,
    title: "Lưu credential",
    body: "Production mã hóa envelope qua KMS, giữ HMAC fingerprint để chống một bot thuộc hai workspace.",
    current: false,
  },
  {
    number: "03",
    icon: <Webhook size={19} />,
    title: "Bật đường nhận tin",
    body: "Local dùng getUpdates. Production đăng ký HTTPS webhook và kiểm tra secret header trước khi xử lý.",
    current: false,
  },
  {
    number: "04",
    icon: <MessageCircle size={19} />,
    title: "Liên kết cuộc chat",
    body: "Phát hành mã một lần, chỉ nhận từ direct chat rồi bind user/chat identity vào đúng workspace.",
    current: false,
  },
] as const;

export function PipelineGuide() {
  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <CalenoteMark compact />
        <nav aria-label="Điều hướng tài liệu">
          <Link href="/dashboard">Dashboard mẫu</Link>
          <Link href="/" className={styles.topCta}>Xác minh bot <ArrowRight size={14} /></Link>
        </nav>
      </header>

      <section className={styles.hero}>
        <Link href="/" className={styles.backLink}><ArrowLeft size={14} /> Onboarding</Link>
        <div className={styles.heroGrid}>
          <div>
            <p className={styles.eyebrow}>Connection blueprint · BYOB</p>
            <h1>Từ một bot token đến một lời nhắc</h1>
            <p className={styles.heroLead}>
              Một đường đi rõ ràng cho Zalo và Telegram: người dùng sở hữu bot,
              Calenote sở hữu quy trình bảo mật và lịch.
            </p>
          </div>
          <div className={styles.statusCard}>
            <span className={styles.liveDot} />
            <div>
              <strong>Đang chạy trong v0.1</strong>
              <span>Chỉ getMe + chuẩn hóa BotProfile</span>
            </div>
            <CheckCircle2 size={21} />
          </div>
        </div>
      </section>

      <section className={styles.body}>
        <header className={styles.sectionHeader}>
          <p className={styles.eyebrow}>Pipeline chung</p>
          <h2>Bốn chốt kiểm soát trước khi bot nghe lịch</h2>
          <p>Mỗi trạng thái nói đúng một việc; VERIFIED không bao giờ được đồng nghĩa với CHAT_BOUND.</p>
        </header>

        <div className={styles.flow}>
          {productionSteps.map((item) => (
            <article className={item.current ? styles.flowCurrent : ""} key={item.number}>
              <div className={styles.flowTop}>
                <span>{item.icon}</span>
                <small>{item.number}</small>
              </div>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
              <div className={styles.flowState}>
                {item.current ? <Check size={12} /> : <ServerCog size={12} />}
                {item.current ? "Có trong repo" : "Production gate"}
              </div>
            </article>
          ))}
        </div>

        <section className={styles.providers} aria-labelledby="provider-heading">
          <header className={styles.sectionHeader}>
            <p className={styles.eyebrow}>Hai provider, một domain contract</p>
            <h2 id="provider-heading">Đường nối cụ thể</h2>
          </header>

          <div className={styles.providerGrid}>
            <ProviderPanel
              logo="Z"
              logoClass="zaloLogo"
              title="Zalo Bot Platform mới"
              subtitle="Ưu tiên cho người dùng Việt Nam"
              warning="Không dùng Zalo OA OpenAPI."
              create="Zalo app → Zalo Bot Manager → Bot Creator → copy token"
              verify="POST bot<TOKEN>/getMe"
              local="deleteWebhook → getUpdates"
              production="setWebhook + X-Bot-Api-Secret-Token"
              send="sendMessage · tối đa 2.000 ký tự"
              href="https://docs.zaloplatforms.com/docs/BOT"
              linkLabel="Tài liệu Zalo chính thức"
            />
            <ProviderPanel
              logo={<Send size={20} fill="currentColor" />}
              logoClass="telegramLogo"
              title="Telegram Bot API"
              subtitle="Dễ tạo bot và thử nghiệm local"
              warning="BotFather cấp token; Calenote không tạo bot thay người dùng."
              create="Telegram → @BotFather → /newbot → copy HTTP API token"
              verify="POST bot<TOKEN>/getMe"
              local="deleteWebhook → getUpdates + offset"
              production="setWebhook + X-Telegram-Bot-Api-Secret-Token"
              send="sendMessage · tối đa 4.096 ký tự"
              href="https://core.telegram.org/bots/api"
              linkLabel="Tài liệu Telegram chính thức"
            />
          </div>
        </section>

        <section className={styles.connectSection}>
          <div className={styles.connectCopy}>
            <p className={styles.eyebrow}>Identity binding</p>
            <h2>Một câu lệnh để biết ai đang nói</h2>
            <p>
              Sau khi webhook hoạt động, Calenote phát hành mã 128-bit có hạn 10 phút.
              Người dùng gửi mã trong direct chat; server consume nguyên tử và chỉ lưu hash.
            </p>
          </div>
          <div className={styles.commandCard}>
            <span><Bot size={18} /></span>
            <code>/connect &lt;mã-một-lần&gt;</code>
            <small>Direct chat only</small>
          </div>
        </section>

        <section className={styles.dataFlow} aria-label="Luồng tin nhắn production">
          <FlowNode icon={<MessageCircle size={17} />} title="Tin nhắn" detail="Zalo / Telegram" />
          <ArrowRight size={17} />
          <FlowNode icon={<ShieldCheck size={17} />} title="Webhook ingress" detail="Verify + dedupe" />
          <ArrowRight size={17} />
          <FlowNode icon={<Database size={17} />} title="Command draft" detail="Parse + confirm" />
          <ArrowRight size={17} />
          <FlowNode icon={<Radio size={17} />} title="Scheduler" detail="Outbox + delivery" />
        </section>
      </section>

      <footer className={styles.footer}>
        <div><CalenoteMark compact /><span>Architecture foundation · September 2026</span></div>
        <Link href="/">Bắt đầu onboarding <ArrowRight size={14} /></Link>
      </footer>
    </main>
  );
}

function ProviderPanel({
  logo,
  logoClass,
  title,
  subtitle,
  warning,
  create,
  verify,
  local,
  production,
  send,
  href,
  linkLabel,
}: {
  logo: ReactNode;
  logoClass: "zaloLogo" | "telegramLogo";
  title: string;
  subtitle: string;
  warning: string;
  create: string;
  verify: string;
  local: string;
  production: string;
  send: string;
  href: string;
  linkLabel: string;
}) {
  return (
    <article className={styles.providerPanel}>
      <header>
        <span className={`${styles.providerLogo} ${styles[logoClass]}`}>{logo}</span>
        <div><h3>{title}</h3><p>{subtitle}</p></div>
      </header>
      <div className={styles.providerWarning}>{warning}</div>
      <dl>
        <div><dt>01 · Tạo bot</dt><dd>{create}</dd></div>
        <div><dt>02 · Xác minh</dt><dd><code>{verify}</code></dd></div>
        <div><dt>03 · Local</dt><dd><code>{local}</code></dd></div>
        <div><dt>04 · Production</dt><dd>{production}</dd></div>
        <div><dt>05 · Phản hồi</dt><dd>{send}</dd></div>
      </dl>
      <a href={href} target="_blank" rel="noreferrer">
        {linkLabel}<ExternalLink size={14} />
      </a>
    </article>
  );
}

function FlowNode({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return (
    <div className={styles.flowNode}>
      <span>{icon}</span>
      <div><strong>{title}</strong><small>{detail}</small></div>
    </div>
  );
}
