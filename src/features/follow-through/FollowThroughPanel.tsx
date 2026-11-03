"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { FollowThroughHistorySchema, FollowThroughActionSchema, FollowThroughItemSchema, FollowThroughListSchema, type FollowThroughAction, type FollowThroughItem } from '@/contracts/api/follow-through';
import { AmbiguousMutationError, ApiResponseError, apiRequest } from '@/lib/client-api';
import { absoluteTime, postponeAt, vietnamTime } from './time';
import { loadFollowThroughHistory, loadFollowThroughPage } from './list-client';
import styles from './FollowThroughPanel.module.css';
const labels = { OPEN: 'Chưa xong', DONE: 'Đã xong', STOPPED: 'Đã dừng', UNTRACKED: 'Chưa theo dõi' };
const delivery = (value: string) => ({ SENT: 'Đã gửi', PENDING: 'Chờ gửi', CLAIMED: 'Đang chuẩn bị', RETRYABLE: 'Chờ thử lại', FAILED: 'Gửi thất bại', UNCERTAIN: 'Chưa xác định', CANCELLED: 'Đã huỷ' }[value] ?? value);
const actionLabel = (value: FollowThroughAction) => ({ ADOPT: 'Theo dõi việc này', DONE: 'Đã xong', STOP: 'Dừng theo dõi', SNOOZE: 'Hoãn', RESCHEDULE: 'Đổi lịch', POLICY: value.enabled ? 'Bật nhắc tiếp' : 'Tắt nhắc tiếp' }[value.action]);
export function FollowThroughPanel({ ownerKey, onUnauthorized, onChanged, reloadVersion }: {
    ownerKey: string;
    reloadVersion?: number;
    onUnauthorized?: () => void;
    onChanged?: () => void;
}) {
    const [items, setItems] = useState<FollowThroughItem[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState<FollowThroughItem['progress']>('OPEN');
    const [preview, setPreview] = useState<{
        request: FollowThroughAction;
        title: string;
        destination: string;
        policyPreview?: string;
    } | null>(null);
    const [pending, setPending] = useState<FollowThroughAction | null>(null);
    const [busy, setBusy] = useState(false);
    const [storageBlocked, setStorageBlocked] = useState(false);
    const confirmationRef=useRef<HTMLButtonElement>(null);const triggerRef=useRef<HTMLElement|null>(null);
    useEffect(()=>{if(preview)confirmationRef.current?.focus();else triggerRef.current?.focus();},[preview]);
    const cancelPreview=()=>setPreview(null);
    const [notice, setNotice] = useState<string | null>(null);
    const requestNumber = useRef(0);
    const lock = useRef(false);
    const active = useRef(true);
    const callbacks = useRef({ onUnauthorized, onChanged });
    useEffect(() => { callbacks.current = { onUnauthorized, onChanged }; }, [onUnauthorized, onChanged]);
    const storageKey = `calenote-follow-through-v1:${ownerKey}`;
    const load = useCallback(async () => { const request = ++requestNumber.current; try {
        const data = FollowThroughListSchema.parse(await loadFollowThroughPage(undefined, () => callbacks.current.onUnauthorized?.()));
        if (active.current && request === requestNumber.current) {
            setItems(data.items);
            setNextCursor(data.nextCursor);
            setLoaded(true);
            setError(null);
        }
    }
    catch {
        if (active.current && request === requestNumber.current) {
            setError('Chưa thể tải việc cần hoàn tất.');
            setLoaded(true);
        }
    } }, []);
    useEffect(() => { active.current = true; void Promise.resolve().then(() => { if (!active.current)
        return; try {
        const saved = sessionStorage.getItem(storageKey);
        if (saved)
            setPending(FollowThroughActionSchema.parse(JSON.parse(saved)));
    }
    catch {
        setStorageBlocked(true);
        setError('Không thể đọc yêu cầu trước. Hãy kiểm tra lại trạng thái trước khi thao tác.');
    } }); void load(); const refresh = () => { if (!lock.current)
        void load(); }; window.addEventListener('focus', refresh); return () => { active.current = false; window.removeEventListener('focus', refresh); }; }, [load, storageKey, reloadVersion]);
    const loadMore = async () => { const generation=requestNumber.current; if (loadingMore || !nextCursor)
        return; setLoadingMore(true); try {
        const data = FollowThroughListSchema.parse(await loadFollowThroughPage(nextCursor, () => callbacks.current.onUnauthorized?.()));
        if (active.current && generation===requestNumber.current) {
            setItems(old => [...old, ...data.items.filter(item => !old.some(existing => existing.publicId === item.publicId))]);
            setNextCursor(data.nextCursor);
        }
    }
    catch {
        if (active.current && generation===requestNumber.current)
            setError('Chưa thể tải thêm việc. Hãy thử lại.');
    }
    finally {
        if (active.current)
            setLoadingMore(false);
    } };
    const prepare = (item: FollowThroughItem, action: FollowThroughAction['action'], extra: Partial<FollowThroughAction> = {}) => {
        if (lock.current || pending || storageBlocked)
            return;
        setError(null);
        setNotice(null);
        triggerRef.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
        setPreview({ request: { action, publicId: item.publicId, expectedRevision: item.revision, idempotencyKey: crypto.randomUUID(), ...extra }, title: item.title, destination: item.destinationLabel, ...(action === 'POLICY' && extra.enabled ? { policyPreview: `Đã dùng ${item.followUpCount}/3. ${item.deliveryStatus === 'SENT' ? `Dự kiến ${absoluteTime(Date.now() + (extra.intervalMinutes ?? item.intervalMinutes) * 60000)}; thời điểm chính xác được xác nhận sau khi lưu.` : 'Lần nhắc tiếp bắt đầu tính sau khi lời nhắc gửi thành công; chưa có thời điểm gửi xác định.'}` } : {}) });
    };
    const submit = async (request: FollowThroughAction) => {
        const recovering=pending!==null;
        if (lock.current)
            return;
        lock.current = true;
        requestNumber.current += 1;
        setBusy(true);
        setError(null);
        try {
            // Save the exact non-content request before sending; a lost response must reuse its receipt.
            sessionStorage.setItem(storageKey, JSON.stringify(request));
            setPending(request);
            setPreview(null);
            const data = await apiRequest<unknown>('/api/v1/follow-through/actions', { method: 'POST', body: request, authenticated: true, onUnauthorized: () => callbacks.current.onUnauthorized?.() });
            const result = z.object({ item: FollowThroughItemSchema }).strict().safeParse(data);
            if (!result.success)
                throw new AmbiguousMutationError();
            sessionStorage.removeItem(storageKey);
            if (!active.current)
                return;
            setPending(null);
            setItems(old => old.map(item => item.publicId === request.publicId ? result.data.item : item));
            setNotice('Đã cập nhật tiến độ.');
            callbacks.current.onChanged?.();
            void load();
        }
        catch (cause) {
            if (!active.current)
                return;
            if (cause instanceof ApiResponseError && !recovering && [400,404,409].includes(cause.status) && ['INVALID','NOT_FOUND','CONFLICT','BLOCKED'].includes(cause.code)) {
                sessionStorage.removeItem(storageKey);
                setPending(null);
                setError(cause.status === 409 ? 'Việc đã thay đổi. Đã tải lại; hãy kiểm tra trước khi thao tác.' : cause.message);
                void load();
            }
            else
                setError('Kết quả chưa xác định. Kiểm tra yêu cầu trước bằng cùng mã và nội dung; chưa tạo yêu cầu mới.');
        }
        finally {
            lock.current = false;
            if (active.current)
                setBusy(false);
        }
    };
    return <section className={styles.panel} aria-label="Việc cần hoàn tất"><header><div><p className={styles.eyebrow}>Theo dõi đến khi hoàn tất</p><h2>Việc cần hoàn tất</h2></div><button type="button" disabled={busy} onClick={() => void load()}>Làm mới</button></header><p className={styles.help}>Đã gửi lời nhắc chưa có nghĩa là công việc đã xong.</p>
 <div className={styles.filters} aria-label="Lọc tiến độ">{(['OPEN', 'DONE', 'STOPPED', 'UNTRACKED'] as const).map(value => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{labels[value]}</button>)}</div>
 {storageBlocked && <p role="alert">Không thể đọc bộ nhớ yêu cầu trước. Các thao tác tạm khoá; hãy khôi phục quyền lưu trữ và tải lại trang.</p>}{error && <p role="alert" className={styles.message}>{error}</p>}{notice && <p role="status">{notice}</p>}{pending && <div className={styles.message}><p>Yêu cầu trước đang chờ xác nhận. Các thao tác mới tạm khoá.</p><button type="button" disabled={busy} onClick={() => void submit(pending)}>{busy ? 'Đang kiểm tra…' : 'Kiểm tra yêu cầu trước'}</button></div>}
 {preview && <section aria-label="Xác nhận thay đổi" className={styles.preview}><h3>{actionLabel(preview.request)} · {preview.title}</h3><p>Bot: {preview.destination}</p>{preview.request.scheduledAt && <p>Thời điểm mới: <strong>{absoluteTime(preview.request.scheduledAt)}</strong></p>}{preview.request.action === 'POLICY' && preview.request.enabled && <p>Nhắc tiếp sau {preview.request.intervalMinutes} phút kể từ lần gửi thành công, tối đa 3 lần. Bot giữ nguyên. {preview.policyPreview}</p>}{['DONE', 'STOP'].includes(preview.request.action) && <p>Các lần gửi chưa bắt đầu sẽ dừng. Lời nhắc đã bắt đầu gửi vẫn có thể đến.</p>}<div className={styles.actions}><button ref={confirmationRef} type="button" onClick={() => void submit(preview.request)}>Xác nhận</button><button type="button" onClick={cancelPreview}>Quay lại</button></div></section>}
 {!loaded ? <p>Đang tải tiến độ…</p> : items.filter(item => item.progress === filter).length === 0 ? <p className={styles.empty}>Không có việc trong mục này.</p> : <div className={styles.list}>{items.filter(item => item.progress === filter).map(item => <WorkItem key={`${item.publicId}:${item.revision}:${JSON.stringify(item.history)}`} onUnauthorized={()=>callbacks.current.onUnauthorized?.()} item={item} disabled={Boolean(pending) || busy || Boolean(preview) || storageBlocked} prepare={prepare}/>)}</div>}
 {nextCursor && <button type="button" disabled={loadingMore || busy} onClick={() => void loadMore()}>{loadingMore ? 'Đang tải thêm…' : 'Tải thêm việc'}</button>}
 </section>;
}
function WorkItem({ item, disabled, prepare, onUnauthorized }: {
    item: FollowThroughItem;
    onUnauthorized: () => void;
    disabled: boolean;
    prepare: (item: FollowThroughItem, action: FollowThroughAction['action'], extra?: Partial<FollowThroughAction>) => void;
}) {
    const [history,setHistory]=useState(item.history);
    const [historyCursor,setHistoryCursor]=useState(item.historyCursor);
    const [historyBusy,setHistoryBusy]=useState(false);
    const [historyError,setHistoryError]=useState(false);
    const loadHistory=async()=>{if(historyBusy||!historyCursor)return;setHistoryBusy(true);setHistoryError(false);try{const page=FollowThroughHistorySchema.parse(await loadFollowThroughHistory(item.publicId,historyCursor,onUnauthorized));setHistory(old=>[...old,...page.history.filter(run=>!old.some(prior=>prior.publicId===run.publicId))]);setHistoryCursor(page.nextCursor);}catch{setHistoryError(true);}finally{setHistoryBusy(false);}};
    const [when, setWhen] = useState('');
    const [invalid, setInvalid] = useState(false);
    const [interval, setFollowInterval] = useState<30 | 120 | 1440>(item.intervalMinutes);
    const [now,setNow] = useState(() => Date.now());
    useEffect(()=>{const update=()=>setNow(Date.now());const timer=setInterval(update,30000);window.addEventListener('focus',update);return()=>{clearInterval(timer);window.removeEventListener('focus',update);};},[]);
    return <article className={styles.item}><h3>{item.title}</h3><p>Tiến độ: {labels[item.progress]}</p><p>Gửi nhắc: {delivery(item.deliveryStatus)}</p><p>Bot: {item.destinationLabel}</p><p>{item.progress === 'OPEN' && item.scheduledAt < now ? 'Đã đến hạn · ' : ''}{absoluteTime(item.scheduledAt)}</p>
 {item.progress === 'UNTRACKED' && <button type="button" disabled={disabled} onClick={() => prepare(item, 'ADOPT')}>Theo dõi việc này</button>}
 {item.progress === 'OPEN' && <><div className={styles.actions}><button type="button" disabled={disabled} onClick={() => prepare(item, 'DONE')}>Đã xong</button>{([['15m', 'Hoãn 15 phút'], ['1h', 'Hoãn 1 giờ'], ['tomorrow', 'Ngày mai 09:00']] as const).map(([preset, label]) => <button key={preset} type="button" disabled={disabled} onClick={() => prepare(item, 'SNOOZE', { scheduledAt: postponeAt(preset, Date.now()) })}>{label}</button>)}<button type="button" disabled={disabled} onClick={() => prepare(item, 'STOP')}>Dừng theo dõi</button></div>
 <details><summary>Đổi lịch và nhắc tiếp</summary><label>Ngày giờ Việt Nam<input type="datetime-local" value={when} disabled={disabled} onChange={event => { setWhen(event.target.value); setInvalid(false); }}/></label><button type="button" disabled={disabled} onClick={() => { const at = vietnamTime(when); if (at === null || at <= Date.now()) {
            setInvalid(true);
            return;
        } prepare(item, 'RESCHEDULE', { scheduledAt: at }); }}>Đổi lịch</button>{invalid && <p role="alert">Chọn ngày giờ hợp lệ trong tương lai, theo giờ Việt Nam.</p>}
 <label>Khoảng nhắc tiếp<select value={interval} disabled={disabled} onChange={event => setFollowInterval(Number(event.target.value) as 30 | 120 | 1440)}><option value={30}>30 phút</option><option value={120}>2 giờ</option><option value={1440}>24 giờ</option></select></label><p>Nhắc tiếp: {item.followUpEnabled ? 'Đang bật' : 'Đang tắt'} · Đã dùng {item.followUpCount}/3</p>{item.followUpCount >= 3 ? <><p>Đã đạt giới hạn 3 lần. Không tự gửi thêm.</p>{item.followUpEnabled && <button type="button" disabled={disabled} onClick={() => prepare(item, 'POLICY', { enabled: false, intervalMinutes: interval })}>Tắt nhắc tiếp</button>}</> : <button type="button" disabled={disabled} onClick={() => prepare(item, 'POLICY', { enabled: !item.followUpEnabled, intervalMinutes: interval })}>{item.followUpEnabled ? 'Tắt nhắc tiếp' : 'Bật nhắc tiếp'}</button>}{item.nextFollowUpAt !== null && <p>{item.nextFollowUpAt<now?'Thời điểm nhắc tiếp đã qua · đang tạm dừng. Hãy đổi lịch hoặc tắt/bật lại chính sách để tiếp tục.':'Nhắc tiếp dự kiến:'} {absoluteTime(item.nextFollowUpAt)}</p>}{item.deliveryStatus === 'UNCERTAIN' && <p>Chưa xác định kết quả gửi; không tự nhắc tiếp.</p>}</details></>}
 <details><summary>Lịch sử gửi nhắc · {history.length}</summary><ol>{history.map(run => <li key={run.publicId}>{absoluteTime(run.scheduledAt)} · {({ ORIGINAL: 'Lời nhắc gốc', SNOOZE: 'Hoãn', RESCHEDULE: 'Đổi lịch', FOLLOW_UP: 'Nhắc tiếp' }[run.kind] ?? run.kind)} · {delivery(run.deliveryStatus)}</li>)}</ol>{historyError&&<p role="alert">Chưa thể tải lịch sử. Hãy thử lại.</p>}{historyCursor&&<button type="button" disabled={historyBusy} onClick={()=>void loadHistory()}>{historyBusy?'Đang tải lịch sử…':'Tải lịch sử cũ hơn'}</button>}</details></article>;
}
