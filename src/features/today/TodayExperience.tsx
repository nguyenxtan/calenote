"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Check, CircleAlert, CircleCheck, RefreshCw, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/ui/shell/AppShell";
import { ActionDecisionResponseSchema, ActionsResponseSchema, type PublicPendingAction } from "@/contracts/api/actions";
import { RemindersResponseSchema, type PublicReminder } from "@/contracts/api/reminders";
import { SessionResponseSchema, type SessionUser } from "@/contracts/api/session";
import { AmbiguousMutationError, ApiResponseError, apiRequest } from "@/lib/client-api";
import { projectReminders } from "./projection";
import styles from "./TodayExperience.module.css";

type SessionState = "checking" | "ready" | "error" | "redirecting";
type Resource<T> = { value: T | null; loading: boolean; error: string | null };
const EMPTY_REMINDERS: Resource<PublicReminder[]> = { value: null, loading: false, error: null };
const EMPTY_ACTIONS: Resource<PublicPendingAction[]> = { value: null, loading: false, error: null };

function vietnamWallClockToEpoch(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/u.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return null;
  return date.getTime() - 7 * 60 * 60_000;
}

function time(epoch: number): string { return new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(epoch); }
function humanTime(epoch: number): string {
  const now = new Date(); const target = new Date(epoch);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short" }).format(target);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short" }).format(now);
  const tomorrow = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short" }).format(new Date(now.getTime() + 86_400_000));
  return `${day === today ? "Hôm nay" : day === tomorrow ? "Ngày mai" : new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "numeric", month: "long" }).format(target)} · ${time(epoch)}`;
}
function status(status: PublicReminder["status"]): string { return ({ PENDING: "Sắp tới", CLAIMED: "Đang chuẩn bị", RETRYABLE: "Sắp thử lại", SENT: "Đã nhắc", FAILED: "Cần kiểm tra", UNCERTAIN: "Cần kiểm tra", CANCELLED: "Đã huỷ" })[status]; }
function isAbort(error: unknown): boolean { return error instanceof Error && error.name === "AbortError"; }

export function TodayExperience() {
  const { replace } = useRouter();
  const [sessionState, setSessionState] = useState<SessionState>("checking");
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [reminders, setReminders] = useState<Resource<PublicReminder[]>>(EMPTY_REMINDERS);
  const [actions, setActions] = useState<Resource<PublicPendingAction[]>>(EMPTY_ACTIONS);
  const [title, setTitle] = useState("");
  const [scheduledFor, setScheduledFor] = useState("");
  const [showManualTime, setShowManualTime] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const tick = () => setNow(Date.now()); const timer = setInterval(tick, 30_000); window.addEventListener("focus", tick); return () => { clearInterval(timer); window.removeEventListener("focus", tick); }; }, []);
  const epoch = useRef(0);
  const mutationLocked = useRef(false);
  const reminderRequest = useRef(0);
  const actionRequest = useRef(0);

  const clearAndRedirect = useCallback(() => {
    epoch.current += 1; setUser(null); setReminders(EMPTY_REMINDERS); setActions(EMPTY_ACTIONS); setSessionState("redirecting"); replace("/login");
  }, [replace]);

  const loadReminders = useCallback(async (current: number) => {
    const request = ++reminderRequest.current;
    setReminders((state) => ({ ...state, loading: true, error: null }));
    try { const data = await apiRequest<unknown>("/api/reminders", { authenticated: true, onUnauthorized: clearAndRedirect }); const next = RemindersResponseSchema.parse({ data }).data.reminders; if (epoch.current === current && request === reminderRequest.current) setReminders({ value: next, loading: false, error: null }); }
    catch (error) { if (!isAbort(error) && epoch.current === current && request === reminderRequest.current) setReminders((state) => ({ ...state, loading: false, error: error instanceof ApiResponseError ? error.message : "Chưa thể tải nhắc hẹn." })); }
  }, [clearAndRedirect]);
  const loadActions = useCallback(async (current: number) => {
    const request = ++actionRequest.current;
    setActions((state) => ({ ...state, loading: true, error: null }));
    try { const data = await apiRequest<unknown>("/api/actions", { authenticated: true, onUnauthorized: clearAndRedirect }); const next = ActionsResponseSchema.parse({ data }).data.actions; if (epoch.current === current && request === actionRequest.current) setActions({ value: next, loading: false, error: null }); }
    catch (error) { if (!isAbort(error) && epoch.current === current && request === actionRequest.current) setActions((state) => ({ ...state, loading: false, error: error instanceof ApiResponseError ? error.message : "Chưa thể tải đề xuất." })); }
  }, [clearAndRedirect]);

  const start = useCallback(async () => {
    const current = epoch.current + 1; epoch.current = current; setSessionState("checking"); setUser(null); setReminders(EMPTY_REMINDERS); setActions(EMPTY_ACTIONS);
    try { const data = await apiRequest<unknown>("/api/session", { authenticated: true, onUnauthorized: clearAndRedirect }); const next = SessionResponseSchema.parse({ data }).data.user; if (epoch.current !== current) return; setUser(next); setSessionState("ready"); void loadReminders(current); void loadActions(current); }
    catch (error) { if (!isAbort(error) && epoch.current === current) { setSessionState("error"); setSessionError("Chưa thể xác thực phiên. Vui lòng thử lại."); } }
  }, [clearAndRedirect, loadActions, loadReminders]);
  useEffect(() => { void start(); return () => { epoch.current += 1; }; }, [start]);
  useEffect(() => {
    if (sessionState !== "ready") return;
    let refreshing = false;
    const refresh = async () => {
      if (document.visibilityState === "hidden" || refreshing || mutationLocked.current) return;
      refreshing = true;
      const current = epoch.current;
      try { await Promise.all([loadReminders(current), loadActions(current)]); }
      finally { refreshing = false; }
    };
    const timer = setInterval(() => void refresh(), 60_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [sessionState, loadReminders, loadActions]);

  async function createReminder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!user || mutationLocked.current) return;
    const scheduledAt = vietnamWallClockToEpoch(scheduledFor); const trimmed = title.trim();
    if (!trimmed || scheduledAt === null) { setCaptureError("Hãy nhập nội dung và thời điểm nhắc hợp lệ."); return; }
    mutationLocked.current = true; setCreating(true); setCaptureError(null); setNotice(null); const current = epoch.current;
    try { await apiRequest<unknown>("/api/reminders", { method: "POST", body: { title: trimmed, scheduledAt, timezone: "Asia/Ho_Chi_Minh" }, authenticated: true, onUnauthorized: clearAndRedirect }); if (epoch.current === current) { setTitle(""); setScheduledFor(""); setNotice("Nhắc hẹn đã được lưu."); await loadReminders(current); } }
    catch (error) { if (epoch.current === current) setCaptureError(error instanceof AmbiguousMutationError ? "Kết quả chưa xác định. Danh sách đã được làm mới; đừng gửi lại trước khi kiểm tra." : error instanceof ApiResponseError ? error.message : "Chưa thể tạo nhắc hẹn." ); }
    finally { if (epoch.current === current) { setCreating(false); mutationLocked.current = false; } }
  }

  async function decide(candidate: PublicPendingAction, decision: "approve" | "reject") {
    if (!user || mutationLocked.current) return; mutationLocked.current = true; actionRequest.current += 1; setDecidingId(candidate.id); setNotice(null); const current = epoch.current;
    try { const data = await apiRequest<unknown>(`/api/actions/${candidate.id}/${decision}`, { method: "POST", body: {}, authenticated: true, onUnauthorized: clearAndRedirect }); ActionDecisionResponseSchema.parse({ data }); if (epoch.current === current) { setActions((state) => ({ ...state, value: state.value?.filter((item) => item.id !== candidate.id) ?? null })); setNotice(decision === "approve" ? "Đề xuất đã được duyệt và chuyển qua luồng nhắc hẹn." : "Đề xuất đã được bỏ qua."); if (decision === "approve") await loadReminders(current); } }
    catch (error) { if (epoch.current === current) setActions((state) => ({ ...state, error: error instanceof ApiResponseError ? error.message : "Chưa thể cập nhật đề xuất." })); }
    finally { if (epoch.current === current) { setDecidingId(null); mutationLocked.current = false; } }
  }

  if (sessionState !== "ready" || !user) return <main className={styles.entry}><section className={styles.entryCard}>{sessionState === "error" ? <><h1>Chưa mở được Calenote</h1><p>{sessionError}</p><button type="button" onClick={() => void start()}>Thử lại</button></> : <><h1>Đang mở Calenote</h1><p>Calenote chưa hiển thị dữ liệu cá nhân.</p></>}</section></main>;

  const projection = projectReminders(reminders.value ?? [], now);
  const upcoming = projection.today;
  const fullDate = (at: number) => new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric" }).format(at);
  return <AppShell user={user}><main className={styles.page}><header className={styles.header}><p className={styles.eyebrow}><Sparkles aria-hidden="true" size={14} />Ngày của bạn</p><h1>Chào, {user.displayName}</h1><p>{new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(now)} · Giờ Việt Nam</p></header>
    <section className={styles.captureSection} aria-labelledby="quick-capture-title"><h2 className={styles.visuallyHidden} id="quick-capture-title">Tạo lời nhắc nhanh</h2><form className={styles.quickCapture} onSubmit={createReminder}><label className={styles.visuallyHidden} htmlFor="capture-title">Nội dung nhắc hẹn</label><textarea id="capture-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Bạn muốn Calenote nhắc điều gì?" aria-describedby="capture-help" /><p id="capture-help" className={styles.captureHelp}>Bắt đầu bằng nội dung, rồi chọn thời gian chính xác trước khi lưu.</p><div className={styles.captureFoot}><div>{showManualTime ? <><label htmlFor="capture-time">Thời điểm nhắc</label><input id="capture-time" type="datetime-local" value={scheduledFor} onChange={(event) => setScheduledFor(event.target.value)} /></> : <button className={styles.timeTrigger} type="button" onClick={() => setShowManualTime(true)}>Chọn thời gian</button>}{scheduledFor && <p className={styles.selectedTime}>{humanTime(vietnamWallClockToEpoch(scheduledFor) ?? 0)}</p>}</div><button type="submit" disabled={creating}>{creating ? "Đang lưu…" : "Tạo lời nhắc"}</button></div><div className={styles.quickIdeas} aria-label="Gợi ý bắt đầu"><span>Bắt đầu nhanh</span><button type="button" onClick={() => setTitle("Gọi mẹ")}>Nhắc gọi mẹ</button><button type="button" onClick={() => setTitle("Lên kế hoạch tuần")}>Lên kế hoạch tuần</button><button type="button" onClick={() => setTitle("Chuẩn bị cho ngày mai")}>Chuẩn bị cho ngày mai</button></div>{captureError && <p className={styles.inlineError} role="alert">{captureError}</p>}</form></section>
    {notice && <p className={styles.notice} role="status"><CircleCheck aria-hidden="true" size={18} />{notice}</p>}
    <div className={styles.grid}><section aria-labelledby="today-title"><div className={styles.sectionHead}><div><p>Lịch trong ngày</p><h2 id="today-title">Còn lại hôm nay</h2></div></div>{reminders.error ? <LocalError message={reminders.error} onRetry={() => void loadReminders(epoch.current)} /> : reminders.value === null ? <Skeleton /> : upcoming.length === 0 ? <Empty title="Hôm nay không còn lời nhắc sắp tới." text="Bạn có thể thêm lời nhắc mới hoặc xem những ngày tiếp theo bên dưới." /> : <div className={styles.timeline}>{upcoming.map((item) => <article className={styles.reminder} key={item.publicId}><time>{time(item.scheduledAt)}</time><span className={styles.dot} aria-hidden="true" /><div><h3>{item.title}</h3><p>{status(item.status)}</p></div></article>)}</div>}</section>
      <aside className={styles.context}>{upcoming[0] && <section className={styles.next}><p>Lời nhắc tiếp theo hôm nay</p><strong>{time(upcoming[0].scheduledAt)}</strong><h2>{upcoming[0].title}</h2><span>{upcoming.length} lời nhắc còn lại</span></section>}</aside></div>
    {reminders.value !== null && !reminders.error && <>{projection.attention.length > 0 && <section className={styles.attention} aria-label="Lời nhắc cần kiểm tra"><div className={styles.sectionHead}><h2>Cần kiểm tra · {projection.attention.length}</h2></div><p className={styles.captureHelp}>Đã đến giờ hoặc gửi chưa thành công. Đây không phải lời nhắc sắp tới.</p><div className={styles.timeline}>{projection.attention.map(item => <article className={styles.reminder} key={item.publicId}><time>{time(item.scheduledAt)}</time><span className={styles.dot} aria-hidden="true" /><div><h3>{item.title}</h3><p>{fullDate(item.scheduledAt)} · {["FAILED", "UNCERTAIN"].includes(item.status) ? status(item.status) : "Đã đến giờ · đang chờ gửi"}</p></div></article>)}</div></section>}{projection.future.length > 0 && <section className={styles.attention} aria-label="Lời nhắc những ngày tới"><div className={styles.sectionHead}><h2>Những ngày tới</h2><a href="/app/reminders">Xem tất cả →</a></div><div className={styles.timeline}>{projection.future.slice(0, 5).map(item => <article className={styles.reminder} key={item.publicId}><time>{time(item.scheduledAt)}</time><span className={styles.dot} aria-hidden="true" /><div><h3>{item.title}</h3><p>{fullDate(item.scheduledAt)} · {status(item.status)}</p></div></article>)}</div></section>}<p className={styles.history}>{projection.sentToday.length} lời nhắc hôm nay đã gửi · <a href="/app/reminders">Xem lịch sử lời nhắc</a></p></>}
    <section className={styles.attention} aria-labelledby="attention-title"><div className={styles.sectionHead}><div><h2 id="attention-title">Cần bạn xác nhận</h2></div></div>{actions.error ? <LocalError message={actions.error} onRetry={() => void loadActions(epoch.current)} /> : actions.value === null ? <Skeleton /> : actions.value.length === 0 ? <Empty title="Không có gì cần bạn xác nhận." text="Đề xuất mới sẽ xuất hiện ở đây." /> : <div className={styles.actions}>{actions.value.map((candidate) => <article className={styles.proposal} key={candidate.id}><span className={styles.proposalLabel}>Calenote đề xuất</span><h3>{candidate.title}</h3><p>{humanTime(candidate.scheduledAt)} · Chưa tạo lời nhắc</p><div><button type="button" aria-label={`Đồng ý ${candidate.title}`} disabled={decidingId === candidate.id} onClick={() => void decide(candidate, "approve")}><Check aria-hidden="true" size={17} />{decidingId === candidate.id ? "Đang xử lý…" : "Đồng ý"}</button><button type="button" aria-label={`Bỏ qua ${candidate.title}`} disabled={decidingId === candidate.id} onClick={() => void decide(candidate, "reject")}>Bỏ qua</button></div></article>)}</div>}</section>
  </main></AppShell>;
}

function Skeleton() { return <div className={styles.skeleton} aria-label="Đang tải"><span /><span /><span /></div>; }
function Empty({ title, text }: { title: string; text: string }) { return <div className={styles.empty}><h3>{title}</h3><p>{text}</p></div>; }
function LocalError({ message, onRetry }: { message: string; onRetry: () => void }) { return <div className={styles.localError} role="alert"><CircleAlert aria-hidden="true" size={19} /><p>{message}</p><button type="button" onClick={onRetry}><RefreshCw aria-hidden="true" size={16} />Thử lại</button></div>; }
