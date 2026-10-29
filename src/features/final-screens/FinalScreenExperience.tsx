"use client";
import {ConnectionLifecyclePanel} from "@/features/connections/ConnectionLifecyclePanel";

import { useCallback, useEffect, useRef, useState } from "react";
import { CircleAlert, Link2, RefreshCw, Clock3 } from "lucide-react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { ConnectionsResponseSchema, type PublicConnection } from "@/contracts/api/connections";
import { ActivityResponseSchema, type PublicActivity } from "@/contracts/api/activity";
import { PreferencesResponseSchema, type PublicPreferences } from "@/contracts/api/preferences";
import { SessionResponseSchema, type SessionUser } from "@/contracts/api/session";
import { ApiResponseError, apiRequest } from "@/lib/client-api";
import { AppShell } from "@/ui/shell/AppShell";
import { PrimaryLoginPanel } from "./PrimaryLoginPanel";
import { AddBotPanel } from "./AddBotPanel";
import { SettingsPanel } from "./SettingsPanel";
import styles from "./FinalScreenExperience.module.css";

export type FinalScreen = "connections" | "activity" | "settings";
const ConnectCodeResultSchema = z.object({ connectCommand: z.string().regex(/^\/connect [A-HJ-NP-Z2-9]{26}$/u), expiresAt: z.number().int().positive() }).strict();

function status(state: PublicConnection["state"]): string { if (state === "ACTIVE_BOUND") return "Đã kết nối"; if (state === "WEBHOOK_FAILED" || state === "SUSPENDED") return "Cần kiểm tra"; return "Chưa kết nối"; }
function safeMutationMessage(error: unknown, fallback: string): string { return error instanceof ApiResponseError ? error.message : fallback; }

export function FinalScreenExperience({ screen, allowAddConnection = false, allowPrimaryLogin = false }: { screen: FinalScreen; allowAddConnection?: boolean; allowPrimaryLogin?: boolean }) {
  const { replace } = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [error, setError] = useState(false);
  const [connections, setConnections] = useState<PublicConnection[] | null>(null);
  const [activities, setActivities] = useState<PublicActivity[] | null>(null);
  const [preferences, setPreferences] = useState<PublicPreferences | null>(null);
  const saveLock = useRef(false);const connectionMutationToken=useRef(0);
  const [saving, setSaving] = useState(false);
  const [settingsNotice, setSettingsNotice] = useState<string | null>(null);
  const [connectionNotice, setConnectionNotice] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [connectionMutationPending, setConnectionMutationPending] = useState(false);
  const [connectCodes, setConnectCodes] = useState<Record<string, { command: string; expiresAt: number }>>({});

  const loadEpoch=useRef(0), owner=useRef<string|null>(null);
  const load = useCallback(async () => {
    const current=++loadEpoch.current;
    const unauthorized=()=>{if(loadEpoch.current===current){loadEpoch.current++;owner.current=null;setUser(null);setConnections(null);setConnectCodes({});replace("/login");}};
    setError(false);
    try {
      const session = SessionResponseSchema.parse({ data: await apiRequest<unknown>("/api/session", { authenticated: true, onUnauthorized: unauthorized }) }).data.user;
      if(loadEpoch.current!==current)return;
      if(owner.current!==session.email){owner.current=session.email;setConnections(null);setActivities(null);setPreferences(null);setConnectCodes({});setSaving(false);setConnectionMutationPending(false);setSettingsNotice(null);setConnectionNotice(null);setConnectionError(null);}
      setUser(session);
      if (screen === "connections") {const value=ConnectionsResponseSchema.parse({data:await apiRequest<unknown>("/api/connections",{authenticated:true,onUnauthorized:unauthorized})}).data.connections;if(loadEpoch.current===current)setConnections(value);}
      if (screen === "activity") {const value=ActivityResponseSchema.parse({data:await apiRequest<unknown>("/api/activity",{authenticated:true,onUnauthorized:unauthorized})}).data.activities;if(loadEpoch.current===current)setActivities(value);}
      if (screen === "settings") {const value=PreferencesResponseSchema.parse({data:await apiRequest<unknown>("/api/preferences",{authenticated:true,onUnauthorized:unauthorized})}).data.preferences;if(loadEpoch.current===current)setPreferences(value);}
    } catch {if(loadEpoch.current===current)setError(true);}
  }, [replace, screen]);
  useEffect(() => {const guard=loadEpoch;let active=true;queueMicrotask(()=>{if(active)void load();});return()=>{active=false;guard.current++;};}, [load]);

  function mutationGuard(){const current=loadEpoch.current;return {valid:()=>loadEpoch.current===current,unauthorized:()=>{if(loadEpoch.current===current){loadEpoch.current++;setUser(null);setConnections(null);setConnectCodes({});replace("/login");}}};}
  async function save(patch: PublicPreferences): Promise<boolean> {
    if (saveLock.current) return false;
    const guard=mutationGuard();saveLock.current = true; setSaving(true); setSettingsNotice(null);
    try { const result = PreferencesResponseSchema.parse({ data: await apiRequest<unknown>("/api/preferences", { method: "PATCH", body: patch, authenticated: true, onUnauthorized: guard.unauthorized }) });if(!guard.valid())return false;setPreferences(result.data.preferences);setSettingsNotice("Cài đặt đã được lưu.");return true; }
    catch {if(guard.valid())setSettingsNotice("Chưa xác nhận được việc lưu. Hãy tải lại để kiểm tra trước khi thử lại.");return false;}
    finally {saveLock.current=false;setSaving(false);}
  }
  async function retryWebhook(publicId: string) {
    if(connectionMutationPending)return;const guard=mutationGuard(),token=++connectionMutationToken.current;setConnectionMutationPending(true);setConnectionError(null);setConnectionNotice(null);
    try {await apiRequest<unknown>(`/api/connections/${publicId}/webhook-retry`,{method:"POST",body:{},authenticated:true,onUnauthorized:guard.unauthorized});if(!guard.valid())return;setConnectionMutationPending(false);setConnectionNotice("Đường nhận tin đã được mở lại. Hãy tạo mã kết nối mới.");await load();}
    catch(reason){if(guard.valid())setConnectionError(safeMutationMessage(reason,"Chưa thể mở lại đường nhận tin. Vui lòng thử lại."));}
    finally{if(connectionMutationToken.current===token)setConnectionMutationPending(false);}
  }
  async function rotateConnectCode(publicId: string) {
    if(connectionMutationPending)return;const guard=mutationGuard(),token=++connectionMutationToken.current;setConnectionMutationPending(true);setConnectionError(null);setConnectionNotice(null);
    try{const data=ConnectCodeResultSchema.parse(await apiRequest<unknown>(`/api/connections/${publicId}/connect-code`,{method:"POST",body:{},authenticated:true,onUnauthorized:guard.unauthorized}));if(guard.valid())setConnectCodes(current=>({...current,[publicId]:{command:data.connectCommand,expiresAt:data.expiresAt}}));}
    catch(reason){if(guard.valid())setConnectionError(safeMutationMessage(reason,"Chưa thể tạo mã kết nối. Vui lòng thử lại."));}
    finally{if(connectionMutationToken.current===token)setConnectionMutationPending(false);}
  }
  async function copyConnectCode(command: string){const guard=mutationGuard();try{if(!navigator.clipboard?.writeText)throw new Error("Clipboard unavailable");await navigator.clipboard.writeText(command);if(guard.valid())setConnectionNotice("Đã sao chép mã kết nối.");}catch{if(guard.valid())setConnectionError("Chưa thể sao chép mã. Bạn có thể sao chép thủ công.");}}

  if (!user) return <main className={styles.entry}><section><h1>{error ? "Chưa mở được Calenote" : "Đang mở Calenote"}</h1>{error && <button onClick={() => void load()}>Thử lại</button>}</section></main>;
  return <AppShell user={user} activePath={`/app/${screen}`}><main className={styles.page}><header><p>{screen === "connections" ? "Kênh hỗ trợ" : screen === "activity" ? "Hoạt động" : "Không gian cá nhân"}</p><h1>{screen === "connections" ? "Kết nối" : screen === "activity" ? "Hoạt động" : "Cài đặt"}</h1><span>{screen === "connections" ? "Kết nối những nơi bạn muốn Calenote hỗ trợ." : screen === "activity" ? "Những thay đổi quan trọng gần đây." : "Điều chỉnh cách Calenote đồng hành cùng bạn."}</span></header>{error ? <LoadError retry={load} /> : screen === "connections" ? <>{allowPrimaryLogin && <PrimaryLoginPanel />}{allowAddConnection && <AddBotPanel onAdded={load} />}<Connections allowLifecycle={allowAddConnection&&allowPrimaryLogin} onLifecycleChanged={()=>void load()} value={connections} pending={connectionMutationPending} notice={connectionNotice} error={connectionError} connectCodes={connectCodes} retryWebhook={retryWebhook} rotateConnectCode={rotateConnectCode} copyConnectCode={copyConnectCode} /></> : screen === "activity" ? <ActivityFeed value={activities} /> : preferences ? <SettingsPanel primaryLoginEnabled={allowPrimaryLogin} user={user} value={preferences} save={save} notice={settingsNotice} busy={saving} /> : <Loading />}</main></AppShell>;
}

function ActivityFeed({ value }: { value: PublicActivity[] | null }) { if (value === null) return <Loading />; if (!value.length) return <Empty title="Chưa có hoạt động nào." text="Những thay đổi quan trọng sẽ xuất hiện ở đây." />; const copy = { REMINDER_CREATED: "Đã tạo lời nhắc", REMINDER_CANCELLED: "Đã huỷ lời nhắc", CONNECT_CODE_ROTATED: "Đã làm mới mã kết nối", CHAT_BOUND: "Đã kết nối kênh" } as const; return <ol className={styles.activityList}>{value.map((item, index) => <li className={styles.activityItem} key={`${item.createdAt}-${index}`}><span className={styles.iconTile}><Clock3 size={18} aria-hidden="true" /></span><div><h2>{copy[item.action]}</h2><time dateTime={new Date(item.createdAt).toISOString()}>{new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "medium", timeStyle: "short" }).format(item.createdAt)}</time></div></li>)}</ol>; }
type ConnectionsProps = {allowLifecycle?:boolean;onLifecycleChanged?:()=>void; value: PublicConnection[] | null; pending: boolean; notice: string | null; error: string | null; connectCodes: Record<string, { command: string; expiresAt: number }>; retryWebhook(publicId: string): Promise<void>; rotateConnectCode(publicId: string): Promise<void>; copyConnectCode(command: string): Promise<void> };
function Connections({allowLifecycle=false,onLifecycleChanged, value, pending, notice, error, connectCodes, retryWebhook, rotateConnectCode, copyConnectCode }: ConnectionsProps) { if (value === null) return <Loading />; if (!value.length) return <Empty title="Chưa có kết nối nào." text="Telegram và Zalo sẽ xuất hiện ở đây sau khi được thiết lập." />; return <div className={styles.cards}>{error && <p className={styles.mutationError} role="alert">{error}</p>}{notice && <p className={styles.notice} role="status">{notice}</p>}{value.map((connection) => { const code = connectCodes[connection.publicId]; return <article className={styles.card} key={connection.publicId}><Link2 aria-hidden="true" /><div><h2>{connection.provider === "telegram" ? "Telegram" : "Zalo"}</h2><p>{connection.displayName}</p><strong data-state={connection.state}>{status(connection.state)}</strong>{connection.state === "WEBHOOK_FAILED" && <><p>Kết nối cần được xác minh lại.</p><button className={styles.action} disabled={pending} onClick={() => void retryWebhook(connection.publicId)}>{pending ? "Đang mở lại…" : "Mở lại đường nhận tin"}</button></>}{connection.state === "ACTIVE_UNBOUND" && <><p>Hãy tạo mã kết nối rồi gửi trong cuộc trò chuyện riêng với bot.</p><button className={styles.action} disabled={pending} onClick={() => void rotateConnectCode(connection.publicId)}>{pending ? "Đang tạo…" : "Tạo mã kết nối"}</button>{code && <section className={styles.connectCode} aria-label="Mã kết nối"><code>{code.command}</code><button type="button" onClick={() => void copyConnectCode(code.command)}>Sao chép mã kết nối</button><p>Hết hạn lúc {new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(code.expiresAt)}.</p><p>Chỉ gửi mã này trong cuộc trò chuyện riêng với đúng bot.</p></section>}</>}{connection.state === "SUSPENDED" && <p>Thông tin xác thực của bot cần được xem lại.</p>}{allowLifecycle&&["ACTIVE_BOUND","SUSPENDED"].includes(connection.state)&&<ConnectionLifecyclePanel connection={connection} onChanged={onLifecycleChanged}/>}</div></article>; })}</div>; }
function Loading() { return <div className={styles.loading} aria-label="Đang tải"><span /><span /><span /></div>; }
function Empty({ title, text }: { title: string; text: string }) { return <section className={styles.empty}><h2>{title}</h2><p>{text}</p></section>; }
function LoadError({ retry }: { retry: () => void }) { return <section className={styles.error} role="alert"><CircleAlert aria-hidden="true" /><p>Chưa tải được dữ liệu.</p><button onClick={() => void retry()}><RefreshCw aria-hidden="true" />Thử lại</button></section>; }
