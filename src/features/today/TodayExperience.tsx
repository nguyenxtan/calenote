"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Check, CircleAlert, CircleCheck, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/ui/shell/AppShell";
import { ActionDecisionResponseSchema, ActionsResponseSchema, type PublicPendingAction } from "@/contracts/api/actions";
import { RemindersResponseSchema, type PublicReminder } from "@/contracts/api/reminders";
import { SessionResponseSchema, type SessionUser } from "@/contracts/api/session";
import { AmbiguousMutationError, ApiResponseError, apiRequest } from "@/lib/client-api";
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
  const [notice, setNotice] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const epoch = useRef(0);
  const mutationLocked = useRef(false);

  const clearAndRedirect = useCallback(() => {
    epoch.current += 1; setUser(null); setReminders(EMPTY_REMINDERS); setActions(EMPTY_ACTIONS); setSessionState("redirecting"); replace("/login");
  }, [replace]);

  const loadReminders = useCallback(async (current: number) => {
    setReminders((state) => ({ ...state, loading: true, error: null }));
    try { const data = await apiRequest<unknown>("/api/reminders", { authenticated: true, onUnauthorized: clearAndRedirect }); const next = RemindersResponseSchema.parse({ data }).data.reminders; if (epoch.current === current) setReminders({ value: next, loading: false, error: null }); }
    catch (error) { if (!isAbort(error) && epoch.current === current) setReminders((state) => ({ ...state, loading: false, error: error instanceof ApiResponseError ? error.message : "Chưa thể tải nhắc hẹn." })); }
  }, [clearAndRedirect]);
  const loadActions = useCallback(async (current: number) => {
    setActions((state) => ({ ...state, loading: true, error: null }));
    try { const data = await apiRequest<unknown>("/api/actions", { authenticated: true, onUnauthorized: clearAndRedirect }); const next = ActionsResponseSchema.parse({ data }).data.actions; if (epoch.current === current) setActions({ value: next, loading: false, error: null }); }
    catch (error) { if (!isAbort(error) && epoch.current === current) setActions((state) => ({ ...state, loading: false, error: error instanceof ApiResponseError ? error.message : "Chưa thể tải đề xuất." })); }
  }, [clearAndRedirect]);

  const start = useCallback(async () => {
    const current = epoch.current + 1; epoch.current = current; setSessionState("checking"); setUser(null); setReminders(EMPTY_REMINDERS); setActions(EMPTY_ACTIONS);
    try { const data = await apiRequest<unknown>("/api/session", { authenticated: true, onUnauthorized: clearAndRedirect }); const next = SessionResponseSchema.parse({ data }).data.user; if (epoch.current !== current) return; setUser(next); setSessionState("ready"); void loadReminders(current); void loadActions(current); }
    catch (error) { if (!isAbort(error) && epoch.current === current) { setSessionState("error"); setSessionError("Chưa thể xác thực phiên. Vui lòng thử lại."); } }
  }, [clearAndRedirect, loadActions, loadReminders]);
  useEffect(() => { void start(); return () => { epoch.current += 1; }; }, [start]);

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
    if (!user || mutationLocked.current) return; mutationLocked.current = true; setDecidingId(candidate.id); setNotice(null); const current = epoch.current;
    try { const data = await apiRequest<unknown>(`/api/actions/${candidate.id}/${decision}`, { method: "POST", body: {}, authenticated: true, onUnauthorized: clearAndRedirect }); ActionDecisionResponseSchema.parse({ data }); if (epoch.current === current) { setActions((state) => ({ ...state, value: state.value?.filter((item) => item.id !== candidate.id) ?? null })); setNotice(decision === "approve" ? "Đề xuất đã được duyệt và chuyển qua luồng nhắc hẹn." : "Đề xuất đã được bỏ qua."); if (decision === "approve") await loadReminders(current); } }
    catch (error) { if (epoch.current === current) setActions((state) => ({ ...state, error: error instanceof ApiResponseError ? error.message : "Chưa thể cập nhật đề xuất." })); }
    finally { if (epoch.current === current) { setDecidingId(null); mutationLocked.current = false; } }
  }

  if (sessionState !== "ready" || !user) return <main className={styles.entry}><section className={styles.entryCard}>{sessionState === "error" ? <><h1>Chưa mở được Calenote</h1><p>{sessionError}</p><button type="button" onClick={() => void start()}>Thử lại</button></> : <><h1>Đang mở Calenote</h1><p>Calenote chưa hiển thị dữ liệu cá nhân.</p></>}</section></main>;

  const upcoming = reminders.value?.filter((item) => item.status !== "CANCELLED").sort((a, b) => a.scheduledAt - b.scheduledAt) ?? [];
  return <AppShell user={user}><main className={styles.page}><header className={styles.header}><h1>Chào, {user.displayName}</h1><p>Một nơi nhẹ nhàng để biết điều gì đang chờ mình.</p></header>
    <section className={styles.captureSection} aria-labelledby="quick-capture-title"><h2 className={styles.visuallyHidden} id="quick-capture-title">Tạo lời nhắc nhanh</h2><form className={styles.quickCapture} onSubmit={createReminder}><label className={styles.visuallyHidden} htmlFor="capture-title">Nội dung nhắc hẹn</label><textarea id="capture-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Nhắc tui…" /><div className={styles.captureFoot}><div><label htmlFor="capture-time">Thời điểm nhắc</label><input id="capture-time" type="datetime-local" value={scheduledFor} onChange={(event) => setScheduledFor(event.target.value)} /></div><button type="submit" disabled={creating}>{creating ? "Đang lưu…" : "Tạo nhắc nhở"}</button></div>{captureError && <p className={styles.inlineError} role="alert">{captureError}</p>}</form></section>
    {notice && <p className={styles.notice} role="status"><CircleCheck aria-hidden="true" size={18} />{notice}</p>}
    <div className={styles.grid}><section aria-labelledby="today-title"><div className={styles.sectionHead}><div><p>Tiếp theo</p><h2 id="today-title">Hôm nay</h2></div></div>{reminders.error ? <LocalError message={reminders.error} onRetry={() => void loadReminders(epoch.current)} /> : reminders.value === null ? <Skeleton /> : upcoming.length === 0 ? <Empty title="Hôm nay đang khá thoáng." text="Tạo lời nhắc khi cần." /> : <div className={styles.timeline}>{upcoming.map((item) => <article className={styles.reminder} key={item.publicId}><time>{time(item.scheduledAt)}</time><span className={styles.dot} aria-hidden="true" /><div><h3>{item.title}</h3><p>{status(item.status)}</p></div><span className={styles.badge}>{status(item.status)}</span></article>)}</div>}</section>
      <aside className={styles.context}>{upcoming[0] && <section className={styles.next}><p>Nhịp hôm nay</p><strong>{time(upcoming[0].scheduledAt)}</strong><h2>{upcoming[0].title}</h2><span>{upcoming.length} lời nhắc còn lại</span></section>}</aside></div>
    <section className={styles.attention} aria-labelledby="attention-title"><div className={styles.sectionHead}><div><p>Cần bạn xác nhận</p><h2 id="attention-title">Needs Your Attention</h2></div></div>{actions.error ? <LocalError message={actions.error} onRetry={() => void loadActions(epoch.current)} /> : actions.value === null ? <Skeleton /> : actions.value.length === 0 ? <Empty title="Không có gì cần bạn xác nhận." text="Đề xuất mới sẽ xuất hiện ở đây." /> : <div className={styles.actions}>{actions.value.map((candidate) => <article className={styles.proposal} key={candidate.id}><span className={styles.proposalLabel}>Calenote đề xuất</span><h3>{candidate.title}</h3><p>Chưa tạo Reminder · cần bạn xác nhận</p><div><button type="button" aria-label={`Đồng ý ${candidate.title}`} disabled={decidingId === candidate.id} onClick={() => void decide(candidate, "approve")}><Check aria-hidden="true" size={17} />{decidingId === candidate.id ? "Đang xử lý…" : "Đồng ý"}</button><button type="button" aria-label={`Bỏ qua ${candidate.title}`} disabled={decidingId === candidate.id} onClick={() => void decide(candidate, "reject")}>Bỏ qua</button></div></article>)}</div>}</section>
  </main></AppShell>;
}

function Skeleton() { return <div className={styles.skeleton} aria-label="Đang tải"><span /><span /><span /></div>; }
function Empty({ title, text }: { title: string; text: string }) { return <div className={styles.empty}><h3>{title}</h3><p>{text}</p></div>; }
function LocalError({ message, onRetry }: { message: string; onRetry: () => void }) { return <div className={styles.localError} role="alert"><CircleAlert aria-hidden="true" size={19} /><p>{message}</p><button type="button" onClick={onRetry}><RefreshCw aria-hidden="true" size={16} />Thử lại</button></div>; }
