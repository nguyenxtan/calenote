import { Check, Clock3, MessageCircle, MoreHorizontal, Video } from "lucide-react";
import styles from "./DashboardShell.module.css";

const timeline = [
  {
    time: "08:00",
    title: "Nhắc uống vitamin",
    meta: "Đã hoàn tất qua Telegram",
    tone: "green",
    icon: <Check size={14} />,
  },
  {
    time: "10:30",
    title: "Gọi cho mẹ",
    meta: "Nhắc trước 10 phút",
    tone: "yellow",
    icon: <MessageCircle size={14} />,
  },
  {
    time: "14:00",
    title: "Review Calenote foundation",
    meta: "45 phút · Google Meet",
    tone: "blue",
    icon: <Video size={14} />,
  },
] as const;

export function TodayTimeline() {
  return (
    <section className={styles.panel} aria-labelledby="today-title">
      <header className={styles.panelHeader}>
        <div>
          <p>Lịch trình</p>
          <h2 id="today-title">Hôm nay</h2>
        </div>
        <button type="button" className={styles.iconButton} aria-label="Tùy chọn lịch hôm nay">
          <MoreHorizontal size={18} />
        </button>
      </header>

      <div className={styles.timeline}>
        {timeline.map((item, index) => (
          <article className={styles.timelineItem} key={`${item.time}-${item.title}`}>
            <time>{item.time}</time>
            <span className={`${styles.timelineRail} ${styles[item.tone]}`} aria-hidden="true">
              <span>{item.icon}</span>
              {index < timeline.length - 1 && <i />}
            </span>
            <div className={styles.timelineCopy}>
              <strong>{item.title}</strong>
              <span>{item.meta}</span>
            </div>
            <button type="button" aria-label={`Mở ${item.title}`}>
              <Clock3 size={15} />
            </button>
          </article>
        ))}
      </div>

      <button type="button" className={styles.outlineButton} disabled title="Có ở phase scheduler">
        + Thêm từ giao diện
      </button>
    </section>
  );
}
