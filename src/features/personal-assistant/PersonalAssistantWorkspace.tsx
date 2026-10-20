"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { PersonalAssistantDocumentSchema, PersonalAssistantEnvelopeSchema, type PersonalAssistantDocument, type PersonalAssistantEnvelope, type PersonalLifeEvent } from "@/contracts/api/personal-assistant";
import { SessionResponseSchema, type SessionUser } from "@/contracts/api/session";
import { ApiResponseError, apiRequest } from "@/lib/client-api";
import { planLifeEvents } from "@/modules/personal-assistant/calendar";
import { AppShell } from "@/ui/shell/AppShell";
import styles from "./PersonalAssistantWorkspace.module.css";

const BriefSchema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u), openCount: z.number().int().nonnegative(), overdueCount: z.number().int().nonnegative(), doneTodayCount: z.number().int().nonnegative(), next: z.array(z.object({ title: z.string().min(1).max(500), scheduledAt: z.number().int() }).strict()).max(5) }).strict();
const kinds = { BIRTHDAY: "Sinh nhật", MEMORIAL: "Ngày giỗ", RENEWAL: "Gia hạn", OTHER: "Ngày khác" };
const dateTime = (time: number) => new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "medium", timeStyle: "short" }).format(time);
export function PersonalAssistantWorkspace() {
  const { replace } = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loadError, setLoadError] = useState(false);
  const load = useCallback(async () => {
    setLoadError(false);
    try { setUser(SessionResponseSchema.parse({ data: await apiRequest("/api/session", { authenticated: true, onUnauthorized: () => replace("/login") }) }).data.user); }
    catch { setLoadError(true); }
  }, [replace]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  if (!user) return <main className={styles.page}>{loadError ? <><p role="alert">Chưa thể xác nhận phiên đăng nhập.</p><button onClick={() => void load()}>Thử lại</button></> : <p role="status">Đang mở không gian cá nhân…</p>}</main>;
  return <AppShell user={user} activePath="/app/personal"><PersonalAssistantPanel onUnauthorized={() => replace("/login")} /></AppShell>;
}

export function PersonalAssistantPanel({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [saved, setSaved] = useState<PersonalAssistantEnvelope | null>(null);
  const [draft, setDraft] = useState<PersonalAssistantDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const unauthorized = useRef(onUnauthorized);
  const [now] = useState(() => Date.now());
  const [progress, setProgress] = useState<z.infer<typeof BriefSchema> | null>(null);
  const [progressError, setProgressError] = useState(false);
  const [memoryQuery, setMemoryQuery] = useState("");
  useEffect(() => { unauthorized.current = onUnauthorized; }, [onUnauthorized]);
  const load = useCallback(async () => {
    try {
      const envelope = PersonalAssistantEnvelopeSchema.parse(await apiRequest("/api/v1/personal-assistant", { authenticated: true, onUnauthorized: () => unauthorized.current() }));
      setSaved(envelope); setDraft(envelope.document); setError(null); setNotice(null);
    } catch { setError("Chưa thể tải dữ liệu cá nhân. Hãy thử lại."); }
  }, []);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(load);
    void apiRequest("/api/v1/personal-assistant/brief", { authenticated: true, onUnauthorized: () => unauthorized.current() }).then(value => { if (active) setProgress(BriefSchema.parse(value)); }).catch(() => { if (active) setProgressError(true); });
    return () => { active = false; };
  }, [load]);
  async function save() {
    if (!draft || !saved || lock.current) return;
    const parsed = PersonalAssistantDocumentSchema.safeParse(draft);
    if (!parsed.success) { setError(parsed.error.issues.some(issue => issue.code === "custom" && issue.path.length === 0) ? "Không gian cá nhân vượt giới hạn 100 KiB. Hãy rút gọn nội dung hoặc xóa bớt thông tin rồi lưu lại. Bản nháp vẫn được giữ." : "Kiểm tra tên, nội dung, ngày và giờ. Mỗi sự kiện cần 1–5 mốc nhắc khác nhau; ngày âm tối đa 30."); return; }
    lock.current = true; setBusy(true); setError(null); setNotice(null);
    try {
      const envelope = PersonalAssistantEnvelopeSchema.parse(await apiRequest("/api/v1/personal-assistant", { method: "PUT", body: { expectedRevision: saved.revision, document: parsed.data }, authenticated: true, onUnauthorized: () => unauthorized.current() }));
      setSaved(envelope); setDraft(envelope.document); setNotice("Đã lưu không gian cá nhân.");
    } catch (reason) {
      setError(reason instanceof ApiResponseError && reason.status === 409 ? "Dữ liệu đã thay đổi ở nơi khác. Bản nháp vẫn được giữ tại đây. Sao chép phần cần giữ trước khi tải bản mới; chưa có thay đổi nào bị ghi đè." : "Chưa xác nhận được việc lưu. Bản nháp vẫn còn tại đây. Kiểm tra bản mới trước khi thử lại.");
    } finally { lock.current = false; setBusy(false); }
  }
  function eventPatch(id: string, patch: Partial<PersonalLifeEvent>) { setDraft(old => old && ({ ...old, events: old.events.map(event => event.id === id ? { ...event, ...patch } : event) })); }
  const valid = draft && PersonalAssistantDocumentSchema.safeParse(draft);
  const upcoming = valid?.success ? planLifeEvents(valid.data, now).slice(0, 8) : [];
  const dirty = saved && draft && JSON.stringify(saved.document) !== JSON.stringify(draft);
  return <main className={styles.page}>
    <header className={styles.hero}><p className={styles.eyebrow}>NHỮNG ĐIỀU QUAN TRỌNG</p><h1>Trợ lý cá nhân</h1><p>Chăm chút những ngày đáng nhớ, thông tin bạn muốn lưu và nhịp sinh hoạt mỗi ngày.</p></header>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    {!draft ? <section className={styles.card}><p role="status">{error ? "Dữ liệu chưa sẵn sàng." : "Đang tải dữ liệu cá nhân…"}</p>{error && <button onClick={() => void load()}>Thử tải lại</button>}</section> : <>
      <form onSubmit={event => { event.preventDefault(); void save(); }}>
        <fieldset disabled={busy} className={styles.formBody}>
          <section className={styles.card}><div className={styles.sectionHead}><div><h2>Ngày đáng nhớ</h2><p>Sự kiện mới mặc định tắt. Lịch và giờ Việt Nam. Sự kiện đã lưu và bật sẽ tạo lời nhắc theo các mốc bạn chọn, gửi đến bot chính đã kết nối. Chọn trước cách xử lý tháng nhuận và ngày không có trong tháng.</p></div><button type="button" disabled={draft.events.length >= 100} onClick={() => setDraft({ ...draft, events: [...draft.events, { id: crypto.randomUUID(), title: "", kind: "BIRTHDAY", calendar: "SOLAR", month: 1, day: 1, time: "08:00", leapPolicy: "REGULAR", missingDayPolicy: "SKIP", leadDays: [0, 1, 7], enabled: false }] })}>Thêm ngày</button></div>
          {draft.events.length === 0 && <p className={styles.empty}>Sinh nhật người thân, ngày giỗ hay kỳ gia hạn đầu tiên của bạn.</p>}
          {draft.events.map((item, index) => <fieldset className={styles.entry} key={item.id}><legend>Sự kiện {index + 1}</legend><div className={styles.grid}>
            <label>Tên sự kiện<input required maxLength={200} value={item.title} onChange={e => eventPatch(item.id, { title: e.target.value })} /></label>
            <label>Loại<select value={item.kind} onChange={e => eventPatch(item.id, { kind: e.target.value as PersonalLifeEvent["kind"] })}>{Object.entries(kinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label>Lịch<select value={item.calendar} onChange={e => eventPatch(item.id, { calendar: e.target.value as PersonalLifeEvent["calendar"] })}><option value="SOLAR">Dương lịch</option><option value="LUNAR">Âm lịch Việt Nam</option></select></label>
            <div className={styles.grid}><label>Ngày<input required type="number" min={1} max={item.calendar === "LUNAR" ? 30 : 31} value={item.day} onChange={e => eventPatch(item.id, { day: Number(e.target.value) })} /></label><label>Tháng<input required type="number" min={1} max={12} value={item.month} onChange={e => eventPatch(item.id, { month: Number(e.target.value) })} /></label></div>
            <label>Lặp lại<select value={item.year === undefined ? "ANNUAL" : "ONCE"} onChange={e => eventPatch(item.id, { year: e.target.value === "ANNUAL" ? undefined : new Date(now + 7 * 3600000).getUTCFullYear() })}><option value="ANNUAL">Hằng năm</option><option value="ONCE">Một lần</option></select></label>
            {item.year !== undefined && <label>Năm {item.calendar === "LUNAR" ? "âm lịch" : "dương lịch"}<input required type="number" min={1900} max={2100} value={item.year} onChange={e => eventPatch(item.id, { year: Number(e.target.value) })} /></label>}
            <label>Giờ nhắc<input required type="time" value={item.time} onChange={e => eventPatch(item.id, { time: e.target.value })} /></label>
            <label>Nếu tháng thiếu ngày<select value={item.missingDayPolicy} onChange={e => eventPatch(item.id, { missingDayPolicy: e.target.value as PersonalLifeEvent["missingDayPolicy"] })}><option value="SKIP">Bỏ qua năm đó</option><option value="LAST_DAY">Dùng ngày cuối tháng</option></select></label>
            {item.calendar === "LUNAR" && <label>Tháng nhuận<select value={item.leapPolicy} onChange={e => eventPatch(item.id, { leapPolicy: e.target.value as PersonalLifeEvent["leapPolicy"] })}><option value="REGULAR">Luôn dùng tháng thường</option><option value="LEAP_OR_REGULAR">Dùng tháng nhuận nếu có</option></select></label>}
          </div><fieldset className={styles.offsets}><legend>Nhắc trước ngày sự kiện (chọn tối đa 5)</legend><button type="button" onClick={() => eventPatch(item.id, { leadDays: item.kind === "RENEWAL" ? [30, 7, 1] : [7, 1, 0] })}>{item.kind === "RENEWAL" ? "Dùng mốc gia hạn: 30, 7, 1 ngày" : "Dùng mốc: 7, 1 ngày và đúng ngày"}</button>{Array.from(new Set([0, 1, 3, 7, 14, 30, ...item.leadDays])).sort((a,b) => a-b).map(days => <label key={days}><input type="checkbox" checked={item.leadDays.includes(days)} disabled={!item.leadDays.includes(days) && item.leadDays.length >= 5} onChange={e => eventPatch(item.id, { leadDays: e.target.checked ? [...item.leadDays, days] : item.leadDays.filter(day => day !== days) })} />{days === 0 ? "Đúng ngày" : `${days} ngày`}</label>)}</fieldset><div className={styles.row}><label className={styles.check}><input className={styles.switch} role="switch" aria-checked={item.enabled} type="checkbox" checked={item.enabled} onChange={e => eventPatch(item.id, { enabled: e.target.checked })} />Bật sự kiện</label><button type="button" onClick={() => setDraft({ ...draft, events: draft.events.filter(event => event.id !== item.id) })}>Xóa sự kiện {index + 1}</button></div></fieldset>)}
          </section>
          <section className={styles.card}><div className={styles.sectionHead}><div><h2>Thông tin muốn ghi nhớ</h2><p>Bạn tự chọn nội dung lưu, sửa hoặc xóa. Không tự suy đoán thông tin cá nhân từ trò chuyện. Nội dung được mã hóa khi lưu. Trên bot, nhập “trí nhớ &lt;từ khóa&gt;” để tìm thông tin bạn đã lưu.</p></div><button type="button" disabled={draft.memories.length >= 100} onClick={() => { setMemoryQuery(""); setDraft({ ...draft, memories: [...draft.memories, { id: crypto.randomUUID(), label: "", value: "" }] }); }}>Thêm thông tin</button></div>
          {draft.memories.length === 0 && <p className={styles.empty}>Chỉ lưu những điều bạn chủ động muốn trợ lý ghi nhớ.</p>}
          <label>Tìm thông tin đã ghi nhớ<input type="search" value={memoryQuery} onChange={e => setMemoryQuery(e.target.value)} placeholder="Tìm theo nhãn hoặc nội dung" /></label>
          {memoryQuery && !draft.memories.some(memory => `${memory.label} ${memory.value}`.toLocaleLowerCase("vi").includes(memoryQuery.trim().toLocaleLowerCase("vi"))) && <p role="status">Không có thông tin phù hợp.</p>}
          {draft.memories.map((memory, index) => <fieldset hidden={!`${memory.label} ${memory.value}`.toLocaleLowerCase("vi").includes(memoryQuery.trim().toLocaleLowerCase("vi"))} key={memory.id} className={styles.entry}><legend>Thông tin {index + 1}</legend><label>Nhãn<input required maxLength={100} value={memory.label} onChange={e => setDraft({ ...draft, memories: draft.memories.map(item => item.id === memory.id ? { ...item, label: e.target.value } : item) })} /></label><label>Nội dung<textarea required maxLength={2000} rows={3} value={memory.value} onChange={e => setDraft({ ...draft, memories: draft.memories.map(item => item.id === memory.id ? { ...item, value: e.target.value } : item) })} /></label><button type="button" onClick={() => setDraft({ ...draft, memories: draft.memories.filter(item => item.id !== memory.id) })}>Xóa thông tin {index + 1}</button></fieldset>)}
          </section>
          <section className={styles.card}><h2>Nhịp mỗi ngày</h2><p>Bật để nhận bản tin buổi sáng hoặc nhìn lại buổi tối qua bot chính đã kết nối, theo giờ Việt Nam. Việc lưu thiết lập không xác nhận bot đã gửi tin.</p><div className={styles.grid}>{(["morning", "evening"] as const).map(period => <div className={styles.entry} key={period}><label className={styles.check}><input className={styles.switch} role="switch" aria-checked={draft.daily[`${period}Enabled`]} type="checkbox" checked={draft.daily[`${period}Enabled`]} onChange={e => setDraft({ ...draft, daily: { ...draft.daily, [`${period}Enabled`]: e.target.checked } })} />{period === "morning" ? "Bản tin buổi sáng" : "Nhìn lại buổi tối"}</label><label>Giờ {period === "morning" ? "buổi sáng" : "buổi tối"}<input required type="time" value={draft.daily[`${period}Time`]} onChange={e => setDraft({ ...draft, daily: { ...draft.daily, [`${period}Time`]: e.target.value } })} /></label></div>)}</div></section>
          <div className={styles.savebar}><span>{dirty ? "Có thay đổi chưa lưu" : "Đã đồng bộ bản lưu"}</span><button className={styles.primary} type="submit" disabled={!dirty || busy}>{busy ? "Đang lưu…" : "Lưu thay đổi"}</button></div>
        </fieldset>
      </form>
      <section className={styles.card}><h2>Sắp tới</h2><p>Dự tính từ bản nháp trong 366 ngày, theo giờ Việt Nam. Đây là lịch dự kiến, chưa phải xác nhận gửi.</p>{!valid?.success ? <p>Hoàn tất thông tin hợp lệ để xem lịch dự kiến.</p> : upcoming.length ? <ul className={styles.list}>{upcoming.map(item => <li key={item.occurrenceKey}><strong>{item.title}</strong><span>{dateTime(item.scheduledAt)} · {item.leadDays ? `trước ${item.leadDays} ngày` : "đúng ngày"} · sự kiện {item.eventDate}</span></li>)}</ul> : <p className={styles.empty}>Chưa có mốc nhắc sắp tới.</p>}</section>
    </>}
    <section className={styles.card}><h2>Hôm nay cần gì, tối nay nhìn lại</h2><p>Tiến độ từ danh sách công việc của bạn. Mở Hôm nay để quyết định bước tiếp theo.</p>{progressError ? <p role="status">Chưa thể tải tiến độ. Bạn vẫn có thể mở Hôm nay để kiểm tra.</p> : progress ? <><div className={styles.stats}><span><strong>{progress.openCount}</strong> Chưa xong</span><span><strong>{progress.overdueCount}</strong> Quá hạn</span><span><strong>{progress.doneTodayCount}</strong> Đã xong hôm nay</span></div><p>Tiến độ ngày {progress.date}, theo giờ Việt Nam.</p>{progress.next.length > 0 && <ul className={styles.list}>{progress.next.map((item, index) => <li key={`${item.scheduledAt}:${index}`}><strong>{item.title}</strong><span>{dateTime(item.scheduledAt)}</span></li>)}</ul>}</> : <p role="status">Đang tải tiến độ…</p>}<Link href="/app/today">Mở Hôm nay →</Link></section>
    {draft && <section className={styles.card}><h2>Kiểm tra bản đã lưu</h2><p>Tải lại sẽ thay thế bản nháp trên màn hình. Sao chép thông tin cần giữ trước khi tiếp tục.</p><button disabled={busy} onClick={() => { if (!dirty || window.confirm("Thay bản nháp bằng dữ liệu đã lưu? Các thay đổi chưa lưu trên màn hình sẽ bị bỏ.")) void load(); }}>Tải bản đã lưu</button></section>}
  </main>;
}
