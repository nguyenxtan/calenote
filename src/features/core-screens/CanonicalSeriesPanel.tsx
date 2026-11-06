"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { CanonicalSeriesCancelResponseSchema, CanonicalSeriesListResponseSchema, type CanonicalSeriesPage,type CanonicalSeriesCancelResult, type CanonicalSeriesView } from "@/contracts/api/canonical-series";
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
type PanelProps={ownerKey:string;onUnauthorized:()=>void;onChanged:()=>void};
export function CanonicalSeriesPanel(props:PanelProps){return <CanonicalSeriesContent key={props.ownerKey} {...props}/>;}
function CanonicalSeriesContent({ ownerKey, onUnauthorized, onChanged }:PanelProps) {
  const [page, setPage] = useState<CanonicalSeriesPage | null>(null);
  const [cursor,setCursor]=useState<string|null>(null),[history,setHistory]=useState<Array<string|null>>([]),[loading,setLoading]=useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState<string | null>(null);
  const generation = useRef(0);
  const readRequest=useRef<AbortController|null>(null),writeRequests=useRef(new Set<AbortController>());
  const fetchSeries = useCallback(async (after:string|null=null) => {
    readRequest.current?.abort();const controller=new AbortController();readRequest.current=controller;
    try{const data = await apiRequest<unknown>(PATH, {signal:controller.signal,canonicalSeriesCursor:after??undefined, authenticated: true, onUnauthorized });return CanonicalSeriesListResponseSchema.parse({ data }).data;}
    finally{if(readRequest.current===controller)readRequest.current=null;}
  }, [onUnauthorized]);
  // Applies a list result only if no newer load or session change happened.
  const settle = useCallback((current: number, next: CanonicalSeriesPage | null, failure?: unknown): boolean => {
    if (generation.current !== current) return false;
    setLoading(false);
    if (next) { setPage(next); setLoadError(false); return true; }
    if (failure instanceof ApiResponseError && [401,403].includes(failure.status)) { setPage(null);setNotice(null);setError(null);setLoadError(true); }
    else if (failure instanceof ApiResponseError && failure.code === "SERIES_UNAVAILABLE") { setUnavailable(true); setPage(null); }
    else setLoadError(true);
    return false;
  }, []);
  const load = useCallback(async (after:string|null=cursor,direction:'reload'|'next'|'previous'='reload'): Promise<boolean> => {
    const current = ++generation.current;setLoading(true);
    try { const ok=settle(current, await fetchSeries(after));if(ok){setCursor(after);if(direction==='next')setHistory(old=>[...old,cursor]);if(direction==='previous')setHistory(old=>old.slice(0,-1));}return ok; } catch (failure) { return settle(current, null, failure); }
  }, [fetchSeries, settle,cursor]);
  useLayoutEffect(()=>{const writes=writeRequests.current;return()=>{generation.current+=1;readRequest.current?.abort();for(const request of writes)request.abort();};},[]);
  useEffect(() => {
    const clear = () => { generation.current += 1;readRequest.current?.abort();for(const request of writeRequests.current)request.abort(); setPage(null);setCursor(null);setHistory([]); setNotice(null); setError(null); setLocked(null); setLoadError(false);setLoading(false); };
    const current = ++generation.current;
    void fetchSeries().then(next => settle(current, next), failure => settle(current, null, failure));
    window.addEventListener("calenote-session-changed", clear);
    return () => { generation.current += 1; window.removeEventListener("calenote-session-changed", clear); };
  }, [fetchSeries, settle, ownerKey]);
  const reload = async () => { if (await load()) { setLocked(null); setError(null); } };
  const cancel = async (item: CanonicalSeriesView) => {
    const current = generation.current;
    const request=new AbortController();writeRequests.current.add(request);
    setNotice(null); setError(null);
    try {
      const data = await apiRequest<unknown>(PATH, {signal:request.signal, method: "POST", body: { publicId: item.publicId, expectedRevision: item.revision }, authenticated: true, onUnauthorized });
      const result = CanonicalSeriesCancelResponseSchema.parse({ data }).data;
      if (generation.current !== current) return;
      setNotice(outcome(result));
      await load(); onChanged();
    } catch (failure) {
      if (generation.current !== current) return;
      if (failure instanceof ApiResponseError && failure.status === 401) return;
      setLocked(item.publicId);
      setError(failure instanceof ApiResponseError && (failure.status === 409 || failure.status === 404) ? STALE : UNKNOWN);
    }finally{writeRequests.current.delete(request);}
  };
  if (unavailable || (!loadError && page?.series.length === 0&&!page.hasMore&&!page.skipped&&!history.length)) return null;
  return <section className={styles.panel} aria-label="Chuỗi nhắc định kỳ">
    <h2>Chuỗi nhắc định kỳ</h2>
    <p>Mỗi trang tối đa 10 chuỗi, ưu tiên chuỗi chưa hủy. Mỗi chuỗi hiển thị ngày giờ và trạng thái thực tế.</p>
    {loadError ? <p role="alert">Chưa thể tải chuỗi nhắc. Vui lòng tải lại để xem trạng thái hiện tại.</p> : loading ? <p role="status">Đang tải chuỗi nhắc…</p> : null}
    {!!page?.skipped&&<p role="status">Bỏ qua {page.skipped} chuỗi không đọc được trên trang này.</p>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error}</p>}
    <button type="button" disabled={loading} onClick={() => void reload()}>Tải lại chuỗi nhắc</button>
    {(history.length>0||page?.hasMore)&&<nav aria-label="Phân trang chuỗi nhắc"><button type="button" disabled={loading||!history.length} onClick={()=>void load(history.at(-1)??null,'previous')}>Trang trước</button><span>Trang {history.length+1}</span><button type="button" disabled={loading||!page?.hasMore||loadError} onClick={()=>page?.nextCursor&&void load(page.nextCursor,'next')}>Trang tiếp theo</button></nav>}
    {page?.series.map(item => <SeriesCard key={`${item.publicId}:${item.revision}`} series={item} locked={loading||loadError||locked === item.publicId} onCancel={() => cancel(item)} />)}
  </section>;
}
