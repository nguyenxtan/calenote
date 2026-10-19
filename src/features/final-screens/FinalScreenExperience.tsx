"use client";

import { AppLoading } from "@/ui/loading/AppLoading";
import { useCallback, useEffect, useRef, useState } from "react";
import { CircleAlert, Link2, RefreshCw, Clock3 } from "lucide-react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { ConnectionsResponseSchema, type PublicConnection } from "@/contracts/api/connections";
import { ActivityResponseSchema, type PublicActivity } from "@/contracts/api/activity";
import { PreferencesResponseSchema, type PublicPreferences } from "@/contracts/api/preferences";
import { ProfileResponseSchema, SessionsResponseSchema, RevokeSessionsResponseSchema, type PublicSession } from "@/contracts/api/account";
import { SessionResponseSchema, type SessionUser } from "@/contracts/api/session";
import { ApiResponseError, apiRequest } from "@/lib/client-api";
import { AppShell } from "@/ui/shell/AppShell";
import { PrimaryLoginPanel } from "./PrimaryLoginPanel";
import { AddBotPanel } from "./AddBotPanel";
import { DisconnectBotButton } from "./DisconnectBotButton";
import { SettingsPanel } from "./SettingsPanel";
import styles from "./FinalScreenExperience.module.css";

export type FinalScreen = "connections" | "activity" | "settings";
const ConnectCodeResultSchema = z.object({ connectCommand: z.string().regex(/^\/connect [A-HJ-NP-Z2-9]{26}$/u), expiresAt: z.number().int().positive() }).strict();

function status(state: PublicConnection["state"]): string { if (state === "ACTIVE_BOUND") return "Đã kết nối"; if (state === "WEBHOOK_FAILED" || state === "SUSPENDED") return "Cần kiểm tra"; return "Chưa kết nối"; }
function safeMutationMessage(error: unknown, fallback: string): string { return error instanceof ApiResponseError ? error.message : fallback; }

export function FinalScreenExperience({ screen }: { screen: FinalScreen }) {
  const { replace } = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [error, setError] = useState(false);
  const [connections, setConnections] = useState<PublicConnection[] | null>(null);
  const [activities, setActivities] = useState<PublicActivity[] | null>(null);
  const [preferences, setPreferences] = useState<PublicPreferences | null>(null);
  const [sessions, setSessions] = useState<PublicSession[]>([]);
  const profileLock = useRef(false);
  const revokeLock = useRef(false);
  const saveLock = useRef(false);
  const [saving, setSaving] = useState(false);
  const [settingsNotice, setSettingsNotice] = useState<string | null>(null);
  const [connectionNotice, setConnectionNotice] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [connectionMutationPending, setConnectionMutationPending] = useState(false);
  const [connectCodes, setConnectCodes] = useState<Record<string, { command: string; expiresAt: number }>>({});

  const load = useCallback(async () => {
    setError(false);
    try {
      const session = SessionResponseSchema.parse({ data: await apiRequest<unknown>("/api/session", { authenticated: true, onUnauthorized: () => replace("/login") }) }).data.user;
      setUser(session);
      if (screen === "connections") setConnections(ConnectionsResponseSchema.parse({ data: await apiRequest<unknown>("/api/connections", { authenticated: true, onUnauthorized: () => replace("/login") }) }).data.connections);
      if (screen === "activity") setActivities(ActivityResponseSchema.parse({ data: await apiRequest<unknown>("/api/activity", { authenticated: true, onUnauthorized: () => replace("/login") }) }).data.activities);
      if (screen === "settings") {
        const [prefs, channels, activeSessions] = await Promise.all([
          apiRequest<unknown>("/api/preferences", { authenticated: true, onUnauthorized: () => replace("/login") }),
          apiRequest<unknown>("/api/connections", { authenticated: true, onUnauthorized: () => replace("/login") }),
          apiRequest<unknown>("/api/account/sessions", { authenticated: true, onUnauthorized: () => replace("/login") }),
        ]);
        setPreferences(PreferencesResponseSchema.parse({data:prefs}).data.preferences);
        setConnections(ConnectionsResponseSchema.parse({data:channels}).data.connections);
        setSessions(SessionsResponseSchema.parse({data:activeSessions}).data.sessions);
      }
    } catch { setError(true); }
  }, [replace, screen]);
  useEffect(() => { queueMicrotask(() => { void load(); }); }, [load]);

  async function save(patch: PublicPreferences): Promise<boolean> {
    if (saveLock.current) return false;
    saveLock.current = true; setSaving(true); setSettingsNotice(null);
    try { const result = PreferencesResponseSchema.parse({ data: await apiRequest<unknown>("/api/preferences", { method: "PATCH", body: patch, authenticated: true, onUnauthorized: () => replace("/login") }) }); setPreferences(result.data.preferences); setSettingsNotice("Cài đặt đã được lưu."); return true; }
    catch { setSettingsNotice("Chưa xác nhận được việc lưu. Hãy tải lại để kiểm tra trước khi thử lại."); return false; }
    finally { saveLock.current = false; setSaving(false); }
  }
  async function saveProfile(displayName: string): Promise<boolean> {
    if (profileLock.current) return false;
    profileLock.current = true;
    try {
      const result = ProfileResponseSchema.parse({ data: await apiRequest<unknown>("/api/account/profile", { method: "PATCH", body: { displayName }, authenticated: true, onUnauthorized: () => replace("/login") }) });
      setUser(result.data.user); return true;
    } catch { return false; } finally { profileLock.current = false; }
  }
  async function revokeOthers(): Promise<boolean> {
    if (revokeLock.current) return false;
    revokeLock.current = true;
    try {
      RevokeSessionsResponseSchema.parse({ data: await apiRequest<unknown>("/api/account/sessions/revoke-others", { method: "POST", body: {}, authenticated: true, onUnauthorized: () => replace("/login") }) });
      const result = SessionsResponseSchema.parse({ data: await apiRequest<unknown>("/api/account/sessions", { authenticated: true, onUnauthorized: () => replace("/login") }) });
      setSessions(result.data.sessions); return true;
    } catch { return false; } finally { revokeLock.current = false; }
  }
  async function disconnectConnection(publicId:string) {
    if(connectionMutationPending)return;
    setConnectionMutationPending(true);setConnectionError(null);setConnectionNotice(null);
    try {
      await apiRequest(`/api/connections/${publicId}/disconnect`,{method:"POST",body:{},authenticated:true,onUnauthorized:()=>replace("/login")});
      await load();setConnectionNotice("Đã ngắt kết nối trong Calenote. Lịch sử, lời nhắc và token mã hoá được giữ lại; bot trên nền tảng không thay đổi.");
    } catch(reason) {setConnectionError(safeMutationMessage(reason,"Chưa xác nhận được việc ngắt kết nối. Hãy tải lại danh sách trước khi thử lại."));}
    finally {setConnectionMutationPending(false);}
  }
  async function retryWebhook(publicId: string) { if (connectionMutationPending) return; setConnectionMutationPending(true); setConnectionError(null); setConnectionNotice(null); try { await apiRequest<unknown>(`/api/connections/${publicId}/webhook-retry`, { method: "POST", body: {}, authenticated: true, onUnauthorized: () => replace("/login") }); await load(); setConnectionNotice("Đường nhận tin đã được mở lại. Hãy tạo mã kết nối mới."); } catch (reason) { setConnectionError(safeMutationMessage(reason, "Chưa thể mở lại đường nhận tin. Vui lòng thử lại.")); } finally { setConnectionMutationPending(false); } }
  async function rotateConnectCode(publicId: string) { if (connectionMutationPending) return; setConnectionMutationPending(true); setConnectionError(null); setConnectionNotice(null); try { const data = ConnectCodeResultSchema.parse(await apiRequest<unknown>(`/api/connections/${publicId}/connect-code`, { method: "POST", body: {}, authenticated: true, onUnauthorized: () => replace("/login") })); setConnectCodes((current) => ({ ...current, [publicId]: { command: data.connectCommand, expiresAt: data.expiresAt } })); } catch (reason) { setConnectionError(safeMutationMessage(reason, "Chưa thể tạo mã kết nối. Vui lòng thử lại.")); } finally { setConnectionMutationPending(false); } }
  async function copyConnectCode(command: string) { try { if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable"); await navigator.clipboard.writeText(command); setConnectionNotice("Đã sao chép mã kết nối."); } catch { setConnectionError("Chưa thể sao chép mã. Bạn có thể sao chép thủ công."); } }

  if (!user && !error) return <AppLoading />;
  if (!user) return <main className={styles.entry}><section><h1>{error ? "Chưa mở được Calenote" : "Đang mở Calenote"}</h1>{error && <button onClick={() => void load()}>Thử lại</button>}</section></main>;
  return <AppShell user={user} activePath={`/app/${screen}`}><main className={styles.page}><header><p>{screen === "connections" ? "Kênh hỗ trợ" : screen === "activity" ? "Hoạt động" : "Không gian cá nhân"}</p><h1>{screen === "connections" ? "Kết nối" : screen === "activity" ? "Hoạt động" : "Cài đặt"}</h1><span>{screen === "connections" ? "Kết nối những nơi bạn muốn Calenote hỗ trợ." : screen === "activity" ? "Những thay đổi quan trọng gần đây." : "Điều chỉnh cách Calenote đồng hành cùng bạn."}</span></header>{error ? <LoadError retry={load} /> : screen === "connections" ? <><AddBotPanel onAdded={load}/>{connections&&<PrimaryLoginPanel connections={connections}/>}<Connections disconnectConnection={disconnectConnection} value={connections} pending={connectionMutationPending} notice={connectionNotice} error={connectionError} connectCodes={connectCodes} retryWebhook={retryWebhook} rotateConnectCode={rotateConnectCode} copyConnectCode={copyConnectCode} /></> : screen === "activity" ? <ActivityFeed value={activities} /> : preferences ? <SettingsPanel user={user} saveProfile={saveProfile} sessions={sessions} revokeOthers={revokeOthers} connections={connections ?? undefined} value={preferences} save={save} notice={settingsNotice} busy={saving} /> : <Loading />}</main></AppShell>;
}

function ActivityFeed({ value }: { value: PublicActivity[] | null }) { if (value === null) return <Loading />; if (!value.length) return <Empty title="Chưa có hoạt động nào." text="Những thay đổi quan trọng sẽ xuất hiện ở đây." />; const copy = { REMINDER_CREATED: "Đã tạo lời nhắc", REMINDER_CANCELLED: "Đã huỷ lời nhắc", CONNECT_CODE_ROTATED: "Đã làm mới mã kết nối", CHAT_BOUND: "Đã kết nối kênh" } as const; return <ol className={styles.activityList}>{value.map((item, index) => <li className={styles.activityItem} key={`${item.createdAt}-${index}`}><span className={styles.iconTile}><Clock3 size={18} aria-hidden="true" /></span><div><h2>{copy[item.action]}</h2><time dateTime={new Date(item.createdAt).toISOString()}>{new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "medium", timeStyle: "short" }).format(item.createdAt)}</time></div></li>)}</ol>; }
type ConnectionsProps = { disconnectConnection(publicId:string):Promise<void>; value: PublicConnection[] | null; pending: boolean; notice: string | null; error: string | null; connectCodes: Record<string, { command: string; expiresAt: number }>; retryWebhook(publicId: string): Promise<void>; rotateConnectCode(publicId: string): Promise<void>; copyConnectCode(command: string): Promise<void> };
function Connections({ disconnectConnection, value, pending, notice, error, connectCodes, retryWebhook, rotateConnectCode, copyConnectCode }: ConnectionsProps) { if (value === null) return <Loading />; if (!value.length) return <Empty title="Chưa có kết nối nào." text="Telegram và Zalo sẽ xuất hiện ở đây sau khi được thiết lập." />; return <div className={styles.cards}>{error && <p className={styles.mutationError} role="alert">{error}</p>}{notice && <p className={styles.notice} role="status">{notice}</p>}{value.map((connection) => { const code = connectCodes[connection.publicId]; return <article className={styles.card} key={connection.publicId}><Link2 aria-hidden="true" /><div><h2>{connection.provider === "telegram" ? "Telegram" : "Zalo"}</h2><p>{connection.displayName}</p><strong data-state={connection.state}>{connection.disconnected ? "Đã ngắt trong Calenote" : status(connection.state)}</strong>{connection.state === "WEBHOOK_FAILED" && <><p>Kết nối cần được xác minh lại.</p><button className={styles.action} disabled={pending} onClick={() => void retryWebhook(connection.publicId)}>{pending ? "Đang mở lại…" : "Mở lại đường nhận tin"}</button></>}{connection.state === "ACTIVE_UNBOUND" && <><p>Hãy tạo mã kết nối rồi gửi trong cuộc trò chuyện riêng với bot.</p><button className={styles.action} disabled={pending} onClick={() => void rotateConnectCode(connection.publicId)}>{pending ? "Đang tạo…" : "Tạo mã kết nối"}</button>{code && <section className={styles.connectCode} aria-label="Mã kết nối"><code>{code.command}</code><button type="button" onClick={() => void copyConnectCode(code.command)}>Sao chép mã kết nối</button><p>Hết hạn lúc {new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(code.expiresAt)}.</p><p>Chỉ gửi mã này trong cuộc trò chuyện riêng với đúng bot.</p></section>}</>}{connection.disconnected ? <p>Đã dừng nhận và gửi tin. Lịch sử, lời nhắc và token mã hoá được giữ lại; bot trên nền tảng không thay đổi.</p> : <>{connection.state === "SUSPENDED" && <p>Thông tin xác thực của bot cần được xem lại.</p>}{connection.state !== "VALIDATING" && <DisconnectBotButton name={connection.displayName} pending={pending} disconnect={()=>disconnectConnection(connection.publicId)}/>}</>}</div></article>; })}</div>; }
function Loading() { return <div className={styles.loading} aria-label="Đang tải"><span /><span /><span /></div>; }
function Empty({ title, text }: { title: string; text: string }) { return <section className={styles.empty}><h2>{title}</h2><p>{text}</p></section>; }
function LoadError({ retry }: { retry: () => void }) { return <section className={styles.error} role="alert"><CircleAlert aria-hidden="true" /><p>Chưa tải được dữ liệu.</p><button onClick={() => void retry()}><RefreshCw aria-hidden="true" />Thử lại</button></section>; }
