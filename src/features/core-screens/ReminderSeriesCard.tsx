"use client";
import { useState } from "react";
import type { PublicSeriesView, SeriesDecisionRequest } from "@/contracts/api/reminder-series";
import styles from "./ReminderSeriesCard.module.css";
const labels = { PROPOSED: "Chờ xác nhận", PENDING: "Sắp nhắc", CLAIMED: "Đang gửi", RETRYABLE: "Chờ thử lại", SENT: "Đã nhắc", FAILED: "Gửi thất bại", UNCERTAIN: "Chưa rõ kết quả", CANCELLED: "Đã hủy" };
export function ReminderSeriesCard({ series, onDecision }: { series: PublicSeriesView; onDecision: (decision: SeriesDecisionRequest) => Promise<void> }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const decide = async () => {
    if (busy) return; setBusy(true); setError(null);
    try { await onDecision({ publicId: series.publicId, revision: series.revision, action: series.state === "PROPOSED" ? "CONFIRM" : "PROPOSE_CANCEL" }); }
    catch { setError("Kết quả chưa xác định hoặc đề xuất đã thay đổi. Hãy làm mới danh sách trước khi thử lại."); }
    finally { setBusy(false); }
  };
  return <article className={styles.card} aria-label={`Chuỗi nhắc: ${series.title}`} aria-busy={busy}>
    <header><span>{series.state === "PROPOSED" ? series.action === "CANCEL" ? "Đề xuất hủy các lần còn lại" : "Đề xuất — chưa tạo lời nhắc" : { ACTIVE: "Chuỗi đang hoạt động", CANCELLED: "Đã hủy các lần đủ điều kiện", COMPLETED: "Chuỗi đã kết thúc" }[series.state]}</span><h3>{series.title}</h3></header>
    <p>{series.calendarLabel}</p>{series.eventLabel && <p>{series.eventLabel}</p>}
    <p>{series.occurrences.length} lần · Giờ Việt Nam (UTC+7)</p>
    <ol>{series.occurrences.map((item, index) => <li key={index}><time dateTime={`${item.localDate}T${item.localTime}:00+07:00`}>{item.localDate.split("-").reverse().join("/")} · {item.localTime}</time><span>{labels[item.status]}</span></li>)}</ol>
    <p className={styles.hint}>Hủy chỉ dừng các lần tương lai chưa gửi xử lý. Lần đang gửi hoặc chưa rõ kết quả không thể thu hồi.</p>
    {error && <p role="alert">{error}</p>}
    {(series.state === "PROPOSED" || series.state === "ACTIVE") && <button type="button" disabled={busy} onClick={() => void decide()}>{busy ? "Đang xử lý…" : series.state === "ACTIVE" ? "Đề xuất hủy các lần còn lại" : series.action === "CANCEL" ? "Xác nhận hủy các lần còn lại" : "Xác nhận tạo chuỗi nhắc"}</button>}
  </article>;
}
