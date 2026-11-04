"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { CanonicalSeriesCancelResponseSchema, CanonicalSeriesListResponseSchema, type CanonicalSeriesCancelResult, type CanonicalSeriesView } from "@/contracts/api/canonical-series";
import { ApiResponseError, apiRequest } from "@/lib/client-api";
import styles from "./CanonicalSeriesPanel.module.css";

const PATH = "/api/v2/reminder-series";
const labels = { PENDING: "Sắp nhắc", CLAIMED: "Đang xử lý", RETRYABLE: "Chờ thử lại", SENT: "Đã nhắc", FAILED: "Gửi thất bại", UNCERTAIN: "Chưa rõ kết quả", CANCELLED: "Đã hủy" } as const;
const states = { ACTIVE: "Chuỗi đang hoạt động", CANCELLED: "Đã hủy các lần còn lại", COMPLETED: "Chuỗi đã kết thúc" } as const;
const UNKNOWN = "Kết quả hủy chưa xác định. Hãy tải lại chuỗi nhắc để xem trạng thái thực tế trước khi thử lại.";
const STALE = "Chuỗi nhắc đã thay đổi hoặc không còn khả dụng. Hãy tải lại trước khi thử lại.";

function outcome(result: CanonicalSeriesCancelResult): string {
  if (result.result === "ALREADY_CANCELLED") return "Chuỗi nhắc này đã được hủy trước đó.";
  if (result.result !== "CANCELLED") return STALE;
  return `Đã hủy ${result.cancelledReminders} lần nhắc chưa gửi.${result.preservedUnchanged ? ` ${result.preservedUnchanged} lần chưa được hủy; hãy kiểm tra trạng thái. Tin đã gửi, đang gửi hoặc chưa rõ kết quả không thể thu hồi.` : ""}`;
}

function SeriesCard({ series, locked, onCancel }: { series: CanonicalSeriesView; locked: boolean; onCancel: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false); const [busy, setBusy] = useState(false); const inFlight = useRef(false);
  const confirm = async () => {
    if (inFlight.current) return; inFlight.current = true; setBusy(true);
    try { await onCancel(); } finally { inFlight.current = false; setBusy(false); setConfirming(false); }
  };
  return <article className={styles.card} aria-label={`Chuỗi nhắc: ${series.title}`} aria-busy={busy}>
    <header><span>{states[series.state]}</span><h3>{series.title}</h3></header>
    <p>{series.calendar === "LUNAR_VN" ? "Âm lịch Việt Nam" : "Dương lịch"}{series.eventDate ? ` · Ngày sự kiện: ${series.eventDate.split("-").reverse().join("/")}${series.eventTime ? ` ${series.eventTime}` : ""}` : ""}</p>
    <p>{series.occurrences.length} lần · Giờ Việt Nam (UTC+7)</p>
    <ol>{series.occurrences.map((item, index) => <li key={index}><time dateTime={`${item.localDate}T${item.localTime}:00+07:00`}>{item.localDate.split("-").reverse().join("/")} · {item.localTime}</time><span>{labels[item.status]}</span></li>)}</ol>
    {!!series.currentReminders?.length && <><h4>Lịch hoãn hoặc dời hiện tại</h4><ol>{series.currentReminders.map((item,index)=><li key={index}><time dateTime={`${item.localDate}T${item.localTime}:00+07:00`}>{item.localDate.split("-").reverse().join("/")} · {item.localTime}</time><span>{labels[item.status]}</span></li>)}</ol></>}
    {!!series.pendingFollowUps && <p>{series.pendingFollowUps} việc đang có lịch nhắc tiếp tự động.</p>}
    {series.state === "ACTIVE" && !locked && (confirming
      ? <div role="group" aria-label="Xác nhận hủy chuỗi nhắc">
          <p className={styles.hint}>Chỉ các lần chưa gửi sẽ bị hủy. Lần đang gửi, đã gửi hoặc chưa rõ kết quả không thể thu hồi.</p>
          <div className={styles.actions}>
            <button type="button" className={styles.primary} disabled={busy} onClick={() => void confirm()}>{busy ? "Đang hủy…" : "Xác nhận hủy"}</button>
            <button type="button" className={styles.secondary} disabled={busy} onClick={() => setConfirming(false)}>Quay lại</button>
          </div>
        </div>
      : <button type="button" className={styles.secondary} onClick={() => setConfirming(true)}>Hủy các lần còn lại</button>)}
  </article>;
}

/** Canonical (context-contract) series. Separate from ReminderSeriesPanel's legacy authority. */
export function CanonicalSeriesPanel({ ownerKey, onUnauthorized, onChanged }: { ownerKey: string; onUnauthorized: () => void; onChanged: () => void }) {
  const [series, setSeries] = useState<CanonicalSeriesView[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState<string | null>(null);
  const generation = useRef(0);
  const fetchSeries = useCallback(async () => {
    const data = await apiRequest<unknown>(PATH, { authenticated: true, onUnauthorized });
    return CanonicalSeriesListResponseSchema.parse({ data }).data.series;
  }, [onUnauthorized]);
  // Applies a list result only if no newer load or session change happened.
  const settle = useCallback((current: number, next: CanonicalSeriesView[] | null, failure?: unknown): boolean => {
    if (generation.current !== current) return false;
    if (next) { setSeries(next); setLoadError(false); return true; }
    if (failure instanceof ApiResponseError && [401,403].includes(failure.status)) { setSeries(null);setNotice(null);setError(null);setLoadError(true); }
    else if (failure instanceof ApiResponseError && failure.code === "SERIES_UNAVAILABLE") { setUnavailable(true); setSeries(null); }
    else setLoadError(true);
    return false;
  }, []);
  const load = useCallback(async (): Promise<boolean> => {
    const current = ++generation.current;
    try { return settle(current, await fetchSeries()); } catch (failure) { return settle(current, null, failure); }
  }, [fetchSeries, settle]);
  useEffect(() => {
    const clear = () => { generation.current += 1; setSeries(null); setNotice(null); setError(null); setLocked(null); setLoadError(false); };
    const current = ++generation.current;
    void fetchSeries().then(next => settle(current, next), failure => settle(current, null, failure));
    window.addEventListener("calenote-session-changed", clear);
    return () => { generation.current += 1; window.removeEventListener("calenote-session-changed", clear); };
  }, [fetchSeries, settle, ownerKey]);
  const reload = async () => { if (await load()) { setLocked(null); setError(null); } };
  const cancel = async (item: CanonicalSeriesView) => {
    const current = generation.current;
    setNotice(null); setError(null);
    try {
      const data = await apiRequest<unknown>(PATH, { method: "POST", body: { publicId: item.publicId, expectedRevision: item.revision }, authenticated: true, onUnauthorized });
      const result = CanonicalSeriesCancelResponseSchema.parse({ data }).data;
      if (generation.current !== current) return;
      setNotice(outcome(result));
      await load(); onChanged();
    } catch (failure) {
      if (generation.current !== current) return;
      if (failure instanceof ApiResponseError && failure.status === 401) return;
      setLocked(item.publicId);
      setError(failure instanceof ApiResponseError && (failure.status === 409 || failure.status === 404) ? STALE : UNKNOWN);
    }
  };
  if (unavailable || (!loadError && series?.length === 0)) return null;
  return <section className={styles.panel} aria-label="Chuỗi nhắc định kỳ">
    <h2>Chuỗi nhắc định kỳ</h2>
    <p>Tối đa 10 chuỗi gần nhất, mỗi chuỗi hiển thị đúng ngày giờ và trạng thái thực tế.</p>
    {loadError ? <p role="alert">Chưa thể tải chuỗi nhắc. Vui lòng tải lại để xem trạng thái hiện tại.</p> : series === null ? <p role="status">Đang tải chuỗi nhắc…</p> : null}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error}</p>}
    <button type="button" onClick={() => void reload()}>Tải lại chuỗi nhắc</button>
    {series?.map(item => <SeriesCard key={`${item.publicId}:${item.revision}`} series={item} locked={locked === item.publicId} onCancel={() => cancel(item)} />)}
  </section>;
}
