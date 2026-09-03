import { CalendarDays, RefreshCw, X } from "lucide-react";
import type { PublicReminder, ReminderStatus } from "./DashboardShell";
import styles from "./DashboardShell.module.css";

interface TodayTimelineProps {
  reminders: PublicReminder[] | null;
  loading: boolean;
  error: string | null;
  cancellingId: string | null;
  onCancel: (reminder: PublicReminder) => void;
  onRetry: () => void;
}

const STATUS_COPY: Record<ReminderStatus, string> = {
  PENDING: "Đang chờ",
  CLAIMED: "Đang chuẩn bị gửi",
  RETRYABLE: "Sẽ thử gửi lại",
  SENT: "Đã gửi",
  FAILED: "Gửi thất bại",
  UNCERTAIN: "Chưa rõ đã gửi",
  CANCELLED: "Đã hủy",
};

const CANCELLABLE = new Set<ReminderStatus>(["PENDING", "CLAIMED", "RETRYABLE"]);

function formatVietnamDate(epoch: number): { date: string; time: string; iso: string } {
  const date = new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(epoch);
  const time = new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(epoch);
  return { date, time, iso: new Date(epoch).toISOString() };
}

export function TodayTimeline({
  reminders,
  loading,
  error,
  cancellingId,
  onCancel,
  onRetry,
}: TodayTimelineProps) {
  return (
    <section className={styles.panel} aria-labelledby="reminders-title">
      <header className={styles.panelHeader}>
        <span className={styles.panelIcon} aria-hidden="true"><CalendarDays size={18} /></span>
        <div><p>Lịch cá nhân</p><h2 id="reminders-title">Nhắc hẹn</h2></div>
      </header>

      {loading && reminders === null && <p className={styles.loadingText}>Đang tải nhắc hẹn…</p>}
      {error && (
        <div className={styles.resourceError} role="alert">
          <p>{error}</p>
          <button type="button" onClick={onRetry}><RefreshCw size={16} aria-hidden="true" /> Tải lại nhắc hẹn</button>
        </div>
      )}
      {!loading && !error && reminders?.length === 0 && (
        <div className={styles.emptyState}>
          <p>Bạn chưa có nhắc hẹn nào.</p>
          <span>Dùng biểu mẫu phía trên để thêm nhắc đầu tiên.</span>
        </div>
      )}
      {reminders && reminders.length > 0 && (
        <div className={styles.reminderList}>
          {reminders.map((reminder) => {
            const formatted = formatVietnamDate(reminder.scheduledAt);
            const cancelling = cancellingId === reminder.publicId;
            return (
              <article className={`${styles.reminderCard} ${styles[`status${reminder.status}`]}`} key={reminder.publicId}>
                <div className={styles.reminderTime}>
                  <time dateTime={formatted.iso}><strong>{formatted.time}</strong><span>{formatted.date}</span></time>
                </div>
                <div className={styles.reminderCopy}>
                  <h3>{reminder.title}</h3>
                  <span className={styles.statusBadge}>{STATUS_COPY[reminder.status]}</span>
                  {reminder.status === "UNCERTAIN" && (
                    <p className={styles.uncertainWarning}>Có thể bot đã gửi nhắc này. Không tạo lại ngay; hãy kiểm tra cuộc chat trước.</p>
                  )}
                </div>
                {CANCELLABLE.has(reminder.status) && (
                  <button
                    type="button"
                    className={styles.cancelButton}
                    onClick={() => onCancel(reminder)}
                    disabled={cancelling}
                    aria-label={`${cancelling ? "Đang hủy" : "Hủy"} ${reminder.title}`}
                  >
                    <X size={15} aria-hidden="true" />
                    {cancelling ? "Đang hủy…" : "Hủy"}
                  </button>
                )}
              </article>
            );
          })}
        </div>
      )}
      {loading && reminders !== null && <p className={styles.refreshText}>Đang làm mới nhắc hẹn…</p>}
    </section>
  );
}
