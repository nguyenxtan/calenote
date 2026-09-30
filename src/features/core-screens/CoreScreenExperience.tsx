"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, CircleCheck, RotateCcw, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { ActionDecisionResponseSchema, ActionsResponseSchema, type PublicPendingAction } from "@/contracts/api/actions";
import type { ReminderDetailsResponseV2 } from "@/contracts/api/reminders-v2";
import type { PublicPreviewV1 } from "@/contracts/api/conversation-previews";
import { SessionResponseSchema, type SessionUser } from "@/contracts/api/session";
import { AmbiguousMutationError, ApiResponseError, apiRequest, decideConversationPreview, loadConversationPreviews, loadDetailedReminders } from "@/lib/client-api";
import { AppShell } from "@/ui/shell/AppShell";
import { isActiveReminder } from "@/features/today/projection";
import { calendarDayPresentation, calendarMonth, shiftCalendarMonth, vietnamCivilDate } from "@/modules/conversation/calendar-presentation";
import styles from "./CoreScreenExperience.module.css";
import { ReminderSeriesPanel } from "./ReminderSeriesPanel";
import { ContextPreviewPanel } from "./ContextPreviewPanel";

export type CoreScreen = "calendar" | "inbox" | "reminders";
type Resource<T> = { value: T | null; error: string | null };
const empty = <T,>(): Resource<T> => ({ value: null, error: null });
const status = (value: ReminderDetailsResponseV2["status"]) => ({ PENDING: "Sắp tới", CLAIMED: "Đang chuẩn bị", RETRYABLE: "Sắp thử lại", SENT: "Đã nhắc", FAILED: "Chưa gửi được", UNCERTAIN: "Cần kiểm tra", CANCELLED: "Đã huỷ" })[value];
const clock = (value: number) => new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(value);
const dateKey = vietnamCivilDate;
const dateLabel = (value: number) => new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "numeric", month: "long", year: "numeric", weekday: "long" }).format(value);
function humanDate(value: number) { const now = Date.now(); return dateKey(value) === dateKey(now) ? `Hôm nay · ${clock(value)}` : dateKey(value) === dateKey(now + 86_400_000) ? `Ngày mai · ${clock(value)}` : `${new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "numeric", month: "long" }).format(value)} · ${clock(value)}`; }
function LocalError({ message, retry }: { message: string; retry: () => void }) { return <div className={styles.error} role="alert"><span>{message}</span><button type="button" onClick={retry}><RotateCcw size={16} aria-hidden="true" />Thử lại</button></div>; }
function Empty({ title, text }: { title: string; text: string }) { return <div className={styles.empty}><h2>{title}</h2><p>{text}</p><a href="/app/today">Tạo lời nhắc mới →</a></div>; }
function Loading() { return <div className={styles.loading} aria-label="Đang tải"><span /><span /><span /></div>; }

export function CoreScreenExperience({ screen }: { screen: CoreScreen }) {
  const { replace } = useRouter(); const epoch = useRef(0);
  const [user, setUser] = useState<SessionUser | null>(null); const [sessionError, setSessionError] = useState<string | null>(null);
  const [reminders, setReminders] = useState<Resource<ReminderDetailsResponseV2[]>>(empty()); const [actions, setActions] = useState<Resource<PublicPendingAction[]>>(empty());
  const [previews, setPreviews] = useState<Resource<{ previews: PublicPreviewV1[]; hasMore: boolean }>>(empty());
  const [reminderHasMore, setReminderHasMore] = useState(false);
  const [notice, setNotice] = useState<string | null>(null); const [busyId, setBusyId] = useState<string | null>(null);
  const path = `/app/${screen}`;
  const redirect = useCallback(() => { epoch.current += 1; setUser(null); replace("/login"); }, [replace]);
  const loadReminders = useCallback(async (current: number) => { setReminders((old) => ({ ...old, error: null })); try { const data = await loadDetailedReminders({ onUnauthorized: redirect }); if (epoch.current === current) { setReminders({ value: data.reminders, error: null }); setReminderHasMore(data.hasMore); } } catch (error) { if (epoch.current === current) setReminders((old) => ({ ...old, error: error instanceof ApiResponseError ? error.message : "Chưa thể tải lời nhắc." })); } }, [redirect]);
  const loadPreviews = useCallback(async (current: number) => { setPreviews((old) => ({ ...old, error: null })); try { const data = await loadConversationPreviews({ onUnauthorized: redirect }); if (epoch.current === current) setPreviews({ value: { previews: data.previews, hasMore: data.hasMore }, error: null }); } catch (error) { if (epoch.current === current) setPreviews((old) => ({ ...old, error: error instanceof ApiResponseError ? error.message : "Chưa thể tải bản xem trước." })); } }, [redirect]);
  const loadActions = useCallback(async (current: number) => { setActions((old) => ({ ...old, error: null })); try { const data = await apiRequest<unknown>("/api/actions", { authenticated: true, onUnauthorized: redirect }); const value = ActionsResponseSchema.parse({ data }).data.actions; if (epoch.current === current) setActions({ value, error: null }); } catch (error) { if (epoch.current === current) setActions((old) => ({ ...old, error: error instanceof ApiResponseError ? error.message : "Chưa thể tải đề xuất." })); } }, [redirect]);
  useEffect(() => { const current = epoch.current + 1; epoch.current = current; void (async () => { try { const data = await apiRequest<unknown>("/api/session", { authenticated: true, onUnauthorized: redirect }); const next = SessionResponseSchema.parse({ data }).data.user; if (epoch.current !== current) return; setUser(next); if (screen === "inbox") { void loadActions(current); void loadPreviews(current); } else void loadReminders(current); } catch (error) { if (epoch.current === current) setSessionError(error instanceof ApiResponseError ? error.message : "Chưa thể mở Calenote."); } })(); }, [loadActions, loadPreviews, loadReminders, redirect, screen]);
  const decidePreview = async (preview: PublicPreviewV1, action: "SAVE_PREVIEW" | "DECLINE") => {
    const current = epoch.current;
    try {
      const result = await decideConversationPreview({ schemaVersion: "conversation-previews-1", publicId: preview.publicId,
        draftRevision: preview.draftRevision, previewHash: preview.previewHash, decisionToken: preview.decisionToken,
        action, idempotencyKey: crypto.randomUUID() }, { onUnauthorized: redirect });
      if (epoch.current === current) { void loadPreviews(current); if (action === "SAVE_PREVIEW") void loadReminders(current); }
      return result;
    } catch (error) {
      if (error instanceof ApiResponseError) {
        if (error.code === "PREVIEW_UNCERTAIN") return { status: "UNCERTAIN" as const };
        if (error.code === "PREVIEW_UNAVAILABLE") return { status: "UNAVAILABLE" as const };
        if (["PREVIEW_STALE", "PREVIEW_EXPIRED", "PREVIEW_REJECTED"].includes(error.code)) return { status: "STALE" as const };
      }
      throw error;
    }
  };
  const decide = async (candidate: PublicPendingAction, decision: "approve" | "reject") => { const current = epoch.current; setBusyId(candidate.id); try { const data = await apiRequest<unknown>(`/api/actions/${candidate.id}/${decision}`, { method: "POST", body: {}, authenticated: true, onUnauthorized: redirect }); ActionDecisionResponseSchema.parse({ data }); if (epoch.current === current) { setActions((old) => ({ ...old, value: old.value?.filter((value) => value.id !== candidate.id) ?? null })); setNotice(decision === "approve" ? "Đề xuất đã được duyệt." : "Đề xuất đã được bỏ qua."); } } catch (error) { if (epoch.current === current) setNotice(error instanceof AmbiguousMutationError ? "Kết quả chưa xác định. Hãy làm mới trước khi thử lại." : "Chưa thể xử lý đề xuất."); } finally { if (epoch.current === current) setBusyId(null); } };
  const cancel = async (reminder: ReminderDetailsResponseV2) => { const current = epoch.current; setBusyId(reminder.publicId); try { await apiRequest<unknown>(`/api/reminders/${reminder.publicId}/cancel`, { method: "POST", body: {}, authenticated: true, onUnauthorized: redirect }); if (epoch.current === current) { setReminders((old) => ({ ...old, value: old.value?.map((value) => value.publicId === reminder.publicId ? { ...value, status: "CANCELLED" } : value) ?? null })); setNotice("Lời nhắc đã được huỷ."); } } catch { if (epoch.current === current) setNotice("Chưa thể huỷ lời nhắc."); } finally { if (epoch.current === current) setBusyId(null); } };
  if (sessionError) return <main className={styles.entry}><LocalError message={sessionError} retry={() => location.reload()} /></main>;
  if (!user) return <main className={styles.entry}><Loading /></main>;
  return <AppShell user={user} activePath={path}><main className={styles.page}>{notice && <p className={styles.notice} role="status"><CircleCheck size={17} aria-hidden="true" />{notice}</p>}{screen === "calendar" ? <Calendar reminders={reminders} hasMore={reminderHasMore} retry={() => void loadReminders(epoch.current)} /> : screen === "inbox" ? <><Inbox actions={actions} busyId={busyId} decide={decide} retry={() => void loadActions(epoch.current)} /><ContextPreviewPanel previews={previews.value?.previews ?? []} loading={previews.value === null && previews.error === null} error={previews.error} hasMore={previews.value?.hasMore ?? false} onDecision={decidePreview} onRetry={() => void loadPreviews(epoch.current)} /></> : <Reminders reminders={reminders} hasMore={reminderHasMore} busyId={busyId} cancel={cancel} retry={() => void loadReminders(epoch.current)} />}{screen !== "calendar" && <ReminderSeriesPanel onUnauthorized={redirect} onChanged={() => void loadReminders(epoch.current)} />}</main></AppShell>;
}

function ReminderDetail({ reminder, close }: { reminder: ReminderDetailsResponseV2; close: () => void }) {
  const details = reminder.details;
  const source = details?.calendarProvenance.sourceDate;
  return <section className={styles.detail} aria-label="Chi tiết lời nhắc">
    <button type="button" aria-label="Đóng chi tiết" onClick={close}><X aria-hidden="true" /></button>
    <p>{humanDate(reminder.scheduledAt)} · {status(reminder.status)}</p>
    <h2>{reminder.title}</h2>
    {details ? <>
      {details.location !== null && <p>Địa điểm: {details.location}</p>}
      {details.notes !== null && <p>Ghi chú: {details.notes}</p>}
      {details.eventDate !== null && <p>Sự kiện: {details.eventDate}{details.eventTime ? ` ${details.eventTime}` : " (chưa có giờ sự kiện)"}</p>}
      <p>Lịch nguồn: {details.calendarProvenance.calendar === "LUNAR_VN" ? "Âm lịch Việt Nam" : "Dương lịch"}{source?.kind === "CIVIL_DATE" && source.calendar === "LUNAR_VN" ? ` · ${source.day}/${source.month}/${source.year}${source.leapMonth ? " nhuận" : ""}` : ""}</p>
    </> : <p>Chi tiết bổ sung chưa có cho lời nhắc cũ.</p>}
    <p>Thông báo: {dateKey(reminder.scheduledAt)} {clock(reminder.scheduledAt)}</p>
  </section>;
}

function Calendar({ reminders, hasMore, retry }: { reminders: Resource<ReminderDetailsResponseV2[]>; hasMore: boolean; retry: () => void }) {
  const [month, setMonth] = useState(() => `${vietnamCivilDate(Date.now()).slice(0, 7)}-01`);
  const [selected, setSelected] = useState(() => vietnamCivilDate(Date.now()));
  const [detail, setDetail] = useState<ReminderDetailsResponseV2 | null>(null);
  const { year, month: monthNumber, days, firstWeekday } = calendarMonth(month);
  const title = new Intl.DateTimeFormat("vi-VN", { timeZone: "UTC", month: "long", year: "numeric" }).format(Date.UTC(year, monthNumber - 1, 1));
  const selectedItems = reminders.value?.filter(item => dateKey(item.scheduledAt) === selected).sort((a, b) => a.scheduledAt - b.scheduledAt) ?? [];
  const selectedDay = calendarDayPresentation(selected);
  return <>
    <header className={styles.header}><p>Lịch cá nhân</p><h1>Lịch</h1><span>Những lời nhắc bạn đã tạo cho mình.</span></header>
    {hasMore && <p className={styles.partialNotice}>Danh sách lời nhắc của chủ tài khoản chỉ hiển thị một phần. Lịch có thể còn lời nhắc khác; cuộc trò chuyện chỉ thấy kênh đang dùng.</p>}
    <section className={styles.calendar}>
      <div className={styles.period}>
        <button type="button" aria-label="Tháng trước" onClick={() => setMonth(shiftCalendarMonth(month, -1))}><ChevronLeft aria-hidden="true" /></button>
        <h2>{title}</h2>
        <button type="button" aria-label="Tháng sau" onClick={() => setMonth(shiftCalendarMonth(month, 1))}><ChevronRight aria-hidden="true" /></button>
        <button type="button" onClick={() => { const today = vietnamCivilDate(Date.now()); setMonth(`${today.slice(0, 7)}-01`); setSelected(today); }}>Hôm nay</button>
      </div>
      <div className={styles.week} aria-label="Các ngày trong tuần">{"T2 T3 T4 T5 T6 T7 CN".split(" ").map(day => <span key={day}>{day}</span>)}</div>
      <div className={styles.month}>{Array.from({ length: firstWeekday }, (_, index) => <span key={`empty-${index}`} aria-hidden="true" />)}
        {Array.from({ length: days }, (_, index) => {
          const day = index + 1;
          const key = `${year}-${String(monthNumber).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const count = reminders.value?.filter(item => dateKey(item.scheduledAt) === key).length ?? 0;
          const presentation = calendarDayPresentation(key, day === 1);
          return <button key={key} type="button" aria-label={`${presentation.accessibleText}, ${count} lời nhắc${selected === key ? ", đã chọn" : ""}`} aria-pressed={selected === key} className={selected === key ? styles.selectedDay : undefined} onClick={() => { setSelected(key); setDetail(null); }}>
            <span className={styles.solarDay}>{day}</span><span className={styles.lunarDay}>{presentation.lunarLabel}</span>{count > 0 && <i aria-hidden="true" />}
          </button>;
        })}</div>
    </section>
    <section className={styles.agenda} aria-labelledby="agenda-title"><h2 id="agenda-title">{dateLabel(Date.parse(`${selected}T05:00:00Z`))}</h2><p>{selectedDay.fullLabel}</p>
      {reminders.error ? <LocalError message={reminders.error} retry={retry} /> : reminders.value === null ? <Loading /> : selectedItems.length === 0 ? <Empty title="Ngày này đang khá thoáng." text="Chưa có lời nhắc nào." /> : selectedItems.map(item => <button className={styles.agendaItem} key={item.publicId} type="button" onClick={() => setDetail(item)}><time>{clock(item.scheduledAt)}</time><span><strong>{item.title}</strong><small>{status(item.status)}</small></span></button>)}
    </section>
    {detail && <ReminderDetail reminder={detail} close={() => setDetail(null)} />}
  </>;
}
function Inbox({ actions, busyId, decide, retry }: { actions: Resource<PublicPendingAction[]>; busyId: string | null; decide: (candidate: PublicPendingAction, decision: "approve" | "reject") => void; retry: () => void }) { return <><header className={styles.header}><p>Không gian quyết định</p><h1>Hộp thư</h1><span>Những việc đang chờ bạn.</span></header><section aria-labelledby="pending-title"><h2 className={styles.sectionTitle} id="pending-title">Cần xác nhận</h2>{actions.error ? <LocalError message={actions.error} retry={retry} /> : actions.value === null ? <Loading /> : actions.value.length === 0 ? <Empty title="Không có gì đang chờ bạn." text="Khi Calenote cần bạn xác nhận, nội dung sẽ xuất hiện ở đây." /> : <div className={styles.cards}>{actions.value.map((item) => <article className={styles.proposal} key={item.id}><span>Calenote đề xuất</span><h2>{item.title}</h2><p>{humanDate(item.scheduledAt)} · Chưa tạo lời nhắc</p><div><button type="button" aria-label={`Đồng ý ${item.title}`} disabled={busyId === item.id} onClick={() => decide(item, "approve")}><Check size={17} aria-hidden="true" />Đồng ý</button><button type="button" aria-label={`Bỏ qua ${item.title}`} disabled={busyId === item.id} onClick={() => decide(item, "reject")}>Bỏ qua</button></div></article>)}</div>}</section></> }
function Reminders({ reminders, hasMore, busyId, cancel, retry }: { reminders: Resource<ReminderDetailsResponseV2[]>; hasMore: boolean; busyId: string | null; cancel: (reminder: ReminderDetailsResponseV2) => void; retry: () => void }) {
  const [filter, setFilter] = useState<"upcoming" | "all">("upcoming");
  const [detail, setDetail] = useState<ReminderDetailsResponseV2 | null>(null);
  const visible = (reminders.value ?? []).filter(item => filter === "all" || isActiveReminder(item)).sort((a, b) => a.scheduledAt - b.scheduledAt);
  return <><header className={styles.header}><p>Không gian nhắc hẹn</p><h1>Lời nhắc</h1><span>Những điều bạn đã nhờ Calenote ghi nhớ.</span></header>
    {hasMore && <p className={styles.partialNotice}>Danh sách lời nhắc của chủ tài khoản chỉ hiển thị một phần; cuộc trò chuyện chỉ thấy kênh đang dùng.</p>}
    <div className={styles.tabs} role="tablist" aria-label="Lọc lời nhắc"><button role="tab" aria-selected={filter === "upcoming"} type="button" onClick={() => setFilter("upcoming")}>Đang chờ</button><button role="tab" aria-selected={filter === "all"} type="button" onClick={() => setFilter("all")}>Tất cả</button></div>
    {reminders.error ? <LocalError message={reminders.error} retry={retry} /> : reminders.value === null ? <Loading /> : visible.length === 0 ? <Empty title={filter === "upcoming" ? "Không có lời nhắc đang chờ gửi." : "Chưa có lời nhắc nào."} text={filter === "upcoming" ? "Chọn Tất cả để xem lịch sử, hoặc tạo một lời nhắc mới." : "Bắt đầu với một việc bạn muốn Calenote ghi nhớ."} /> : <div className={styles.reminderList}>{visible.map(item => <article className={styles.reminder} key={item.publicId}><time>{humanDate(item.scheduledAt)}</time><div><h2>{item.title}</h2><p>{status(item.status)}</p></div><button type="button" aria-label={`Xem chi tiết ${item.title}`} onClick={() => setDetail(item)}>Chi tiết</button>{["PENDING", "CLAIMED", "RETRYABLE"].includes(item.status) && <button type="button" aria-label={`Huỷ ${item.title}`} disabled={busyId === item.publicId} onClick={() => cancel(item)}>Huỷ</button>}</article>)}</div>}
    {detail && <ReminderDetail reminder={detail} close={() => setDetail(null)} />}
  </>;
}
