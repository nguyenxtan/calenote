import Link from "next/link";
import {
  Bell,
  Bot,
  CalendarDays,
  CheckSquare2,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  HeartHandshake,
  Inbox,
  LayoutDashboard,
  MessageCircle,
  Plus,
  Search,
  Settings,
  Sparkles,
} from "lucide-react";
import { CalenoteMark } from "@/components/brand/CalenoteMark";
import { ConnectionCard } from "./ConnectionCard";
import { TodayTimeline } from "./TodayTimeline";
import styles from "./DashboardShell.module.css";

const primaryNav = [
  { label: "Tổng quan", icon: LayoutDashboard, active: true },
  { label: "Nhắc hẹn", icon: Clock3, active: false },
  { label: "Công việc", icon: CheckSquare2, active: false },
  { label: "Lịch", icon: CalendarDays, active: false },
  { label: "Hộp thư chat", icon: Inbox, active: false },
] as const;

export function DashboardShell() {
  return (
    <main className={styles.dashboard}>
      <aside className={styles.sidebar}>
        <CalenoteMark compact />

        <nav className={styles.nav} aria-label="Điều hướng chính">
          <p>Không gian của bạn</p>
          {primaryNav.map(({ label, icon: Icon, active }) => (
            <Link
              href="#"
              className={active ? styles.navActive : ""}
              aria-current={active ? "page" : undefined}
              key={label}
            >
              <Icon size={17} />
              {label}
              {label === "Hộp thư chat" && <small>2</small>}
            </Link>
          ))}

          <p className={styles.navSection}>Mở rộng</p>
          <Link href="#" className={styles.futureNav}>
            <HeartHandshake size={17} />
            Cặp đôi
            <small>Sắp tới</small>
          </Link>
          <Link href="#" className={styles.futureNav}>
            <CircleDollarSign size={17} />
            Thu chi
            <small>Sắp tới</small>
          </Link>
        </nav>

        <div className={styles.sidebarBottom}>
          <Link href="#"><Settings size={17} /> Cài đặt</Link>
          <div className={styles.accountChip}>
            <span>BT</span>
            <div><strong>Bích Tuyền</strong><small>Cá nhân</small></div>
            <ChevronDown size={14} />
          </div>
        </div>
      </aside>

      <section className={styles.mainArea}>
        <header className={styles.topbar}>
          <div className={styles.mobileLogo}><CalenoteMark compact /></div>
          <label className={styles.search}>
            <Search size={16} />
            <span className={styles.srOnly}>Tìm kiếm</span>
            <input placeholder="Tìm lịch, việc hoặc tin nhắn…" />
            <kbd>⌘ K</kbd>
          </label>
          <div className={styles.topActions}>
            <button type="button" aria-label="Thông báo"><Bell size={18} /><i /></button>
            <button type="button" className={styles.avatarButton} aria-label="Mở tài khoản">BT</button>
          </div>
        </header>

        <div className={styles.content}>
          <header className={styles.pageHeader}>
            <div>
              <div className={styles.dateLine}>
                <span>Thứ tư, 2 tháng 9</span>
                <span className={styles.demoBadge}>Dữ liệu minh họa</span>
              </div>
              <h1>Chào buổi sáng, Tuyền</h1>
              <p>Hôm nay nhẹ nhàng thôi — bạn có 3 việc trong lịch.</p>
            </div>
            <button type="button" className={styles.chatButton} disabled title="Có ở phase chat ingestion">
              <MessageCircle size={17} />
              Tạo nhắc bằng chat
            </button>
          </header>

          <section className={styles.stats} aria-label="Tóm tắt hôm nay">
            <StatCard icon={<CalendarDays size={18} />} value="03" label="Lịch hôm nay" tone="green" />
            <StatCard icon={<Clock3 size={18} />} value="01" label="Đang chờ phản hồi" tone="yellow" />
            <StatCard icon={<CheckSquare2 size={18} />} value="04" label="Việc đã xong tuần này" tone="blue" />
          </section>

          <div className={styles.dashboardGrid}>
            <div className={styles.primaryColumn}>
              <TodayTimeline />
              <section className={`${styles.panel} ${styles.chatPanel}`} aria-labelledby="chat-title">
                <div className={styles.chatOrb} aria-hidden="true"><Sparkles size={20} /></div>
                <div className={styles.chatCopy}>
                  <p>Thư ký chat-first</p>
                  <h2 id="chat-title">Bạn chỉ cần nói như bình thường</h2>
                  <span>“Chiều thứ sáu 4h nhắc tui gửi báo cáo”</span>
                </div>
                <div className={styles.fakeComposer}>
                  <Bot size={16} />
                  <span>Chat qua bot sau khi webhook + /connect hoàn tất</span>
                  <button type="button" disabled aria-label="Gửi tin nhắn mẫu"><Plus size={16} /></button>
                </div>
              </section>
            </div>

            <aside className={styles.rightColumn}>
              <ConnectionCard />
              <section className={`${styles.panel} ${styles.weekPanel}`} aria-label="Tiến độ tuần này">
                <header><div><p>Nhịp tuần</p><h2>4 / 6 hoàn tất</h2></div><span>67%</span></header>
                <div className={styles.weekBar}><span /></div>
                <div className={styles.weekDays}>
                  {[
                    ["T2", true], ["T3", true], ["T4", true], ["T5", false], ["T6", false], ["T7", true], ["CN", false],
                  ].map(([day, done]) => (
                    <span className={done ? styles.dayDone : ""} key={String(day)}>{day}</span>
                  ))}
                </div>
              </section>
            </aside>
          </div>
        </div>
      </section>
    </main>
  );
}

function StatCard({
  icon,
  value,
  label,
  tone,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
  tone: "green" | "yellow" | "blue";
}) {
  return (
    <article className={styles.statCard}>
      <span className={`${styles.statIcon} ${styles[tone]}`} aria-hidden="true">{icon}</span>
      <div><strong>{value}</strong><span>{label}</span></div>
    </article>
  );
}
