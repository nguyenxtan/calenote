"use client";
import { useRef, useState } from "react";
import type { PublicPreviewV1 } from "@/contracts/api/conversation-previews";
import styles from "./CoreScreenExperience.module.css";

interface Props {
  previews: PublicPreviewV1[]; loading: boolean; error: string | null; hasMore: boolean;
  onDecision: (preview: PublicPreviewV1, action: "SAVE_PREVIEW" | "DECLINE") => Promise<{ result: "COMMITTED" | "IDEMPOTENT" | "DECLINED" | "ALREADY_DECLINED" } | { status: "STALE" | "UNCERTAIN" | "UNAVAILABLE" }>;
  onRetry: () => void;
}

const notification = (value: number) => new Date(value + 7 * 3600000).toISOString().slice(0, 16).replace("T", " ");

export function ContextPreviewPanel({ previews, loading, error, hasMore, onDecision, onRetry }: Props) {
  const pending = useRef(false);
  const blockedKeysRef = useRef(new Set<string>());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [blockedKeys, setBlockedKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [outcome, setOutcome] = useState<string | null>(null);
  const [outcomeError, setOutcomeError] = useState<string | null>(null);
  const block = (key: string) => {
    blockedKeysRef.current.add(key);
    setBlockedKeys(new Set(blockedKeysRef.current));
  };
  const decide = async (preview: PublicPreviewV1, action: "SAVE_PREVIEW" | "DECLINE") => {
    const key = `${preview.publicId}:${preview.draftRevision}:${preview.previewHash}:${preview.decisionToken}`;
    if (pending.current || blockedKeysRef.current.has(key)) return;
    pending.current = true;
    setBusyId(preview.publicId);
    setOutcome(null); setOutcomeError(null);
    try {
      const result = await onDecision(preview, action);
      if ("result" in result && ["COMMITTED", "IDEMPOTENT", "DECLINED", "ALREADY_DECLINED"].includes(result.result)) {
        setOutcome(action === "SAVE_PREVIEW" ? "Lời nhắc đã được lưu." : "Đã bỏ qua bản xem trước.");
      } else {
        block(key);
        setOutcomeError("status" in result && result.status === "UNCERTAIN"
          ? "Kết quả xác nhận chưa xác định. Hãy kiểm tra trước khi quyết định tiếp."
          : "status" in result && result.status === "UNAVAILABLE"
            ? "Xác nhận bản xem trước hiện chưa khả dụng. Hãy tải lại trước khi quyết định."
            : "Bản xem trước đã thay đổi hoặc hết hạn. Hãy tải lại trước khi quyết định.");
      }
    } catch {
      block(key);
      setOutcomeError("Không xác định được kết quả. Hãy tải lại trước khi quyết định tiếp.");
    } finally {
      pending.current = false;
      setBusyId(null);
    }
  };
  return <section className={styles.previewSection} aria-labelledby="preview-title">
    <h2 id="preview-title">Bản xem trước cần xác nhận</h2>
    {loading && <p>Đang tải bản xem trước…</p>}
    {error && <p role="alert">{error} <button type="button" onClick={onRetry}>Thử lại</button></p>}
    {outcomeError && <p role="alert">{outcomeError} <button type="button" onClick={onRetry}>Tải lại</button></p>}
    {outcome && <p role="status">{outcome}</p>}
    {!loading && !error && previews.length === 0 && <p>Chưa có bản xem trước nào.</p>}
    {!loading && !error && previews.map(preview => {
      const details = preview.details;
      const source = details.calendarProvenance.sourceDate;
      return <article className={styles.previewCard} key={preview.publicId}>
        <h3>{preview.title}</h3>
        {details.location !== null && <p>Địa điểm: {details.location}</p>}
        {details.notes !== null && <p>Ghi chú: {details.notes}</p>}
        {details.eventDate !== null && <p>Sự kiện: {details.eventDate}{details.eventTime ? ` ${details.eventTime}` : " (chưa có giờ sự kiện)"}</p>}
        <p>Lịch nguồn: {details.calendarProvenance.calendar === "LUNAR_VN" ? "Âm lịch Việt Nam" : "Dương lịch"}
          {source?.kind === "CIVIL_DATE" && source.calendar === "LUNAR_VN" ? ` · ${source.day}/${source.month}/${source.year}${source.leapMonth ? " nhuận" : ""}` : ""}</p>
        <p>Thời điểm thông báo (Việt Nam):</p>
        <ol>{preview.occurrences.map(item => <li key={item.index}><time dateTime={new Date(item.scheduledAt).toISOString()}>{notification(item.scheduledAt)}</time></li>)}</ol>
        <p>Xác nhận đúng bản xem trước này; nếu thông tin chưa đúng, hãy sửa trong cuộc trò chuyện.</p>
        <div className={styles.previewActions}>
          <button type="button" disabled={busyId !== null || blockedKeys.has(`${preview.publicId}:${preview.draftRevision}:${preview.previewHash}:${preview.decisionToken}`)} onClick={() => void decide(preview, "SAVE_PREVIEW")}>Lưu bản xem trước {preview.title}</button>
          <button type="button" disabled={busyId !== null || blockedKeys.has(`${preview.publicId}:${preview.draftRevision}:${preview.previewHash}:${preview.decisionToken}`)} onClick={() => void decide(preview, "DECLINE")}>Bỏ qua {preview.title}</button>
        </div>
      </article>;
    })}
    {hasMore && <p>Còn bản xem trước khác; danh sách hiện tại chỉ là một phần.</p>}
  </section>;
}
