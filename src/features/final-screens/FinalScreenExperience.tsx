"use client";

import { useCallback, useEffect, useState } from "react";
import { CircleAlert, Link2, RefreshCw, Settings2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { ConnectionsResponseSchema, type PublicConnection } from "@/contracts/api/connections";
import { ActivityResponseSchema, type PublicActivity } from "@/contracts/api/activity";
import { PreferencesResponseSchema, type PublicPreferences } from "@/contracts/api/preferences";
import { SessionResponseSchema, type SessionUser } from "@/contracts/api/session";
import { ApiResponseError, apiRequest } from "@/lib/client-api";
import { AppShell } from "@/ui/shell/AppShell";
import styles from "./FinalScreenExperience.module.css";

export type FinalScreen = "connections" | "activity" | "settings";

const ConnectCodeResultSchema = z.object({
  connectCommand: z.string().regex(/^\/connect [A-HJ-NP-Z2-9]{26}$/u),
  expiresAt: z.number().int().positive(),
}).strict();

function status(state: PublicConnection["state"]): string {
  if (state === "ACTIVE_BOUND") return "Đã kết nối";
  if (state === "WEBHOOK_FAILED" || state === "SUSPENDED") return "Cần kiểm tra";
  return "Chưa kết nối";
}

function safeMutationMessage(error: unknown, fallback: string): string {
  return error instanceof ApiResponseError ? error.message : fallback;
}

export function FinalScreenExperience({ screen }: { screen: FinalScreen }) {
  const { replace } = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [error, setError] = useState(false);
  const [connections, setConnections] = useState<PublicConnection[] | null>(null);
  const [activities, setActivities] = useState<PublicActivity[] | null>(null);
  const [preferences, setPreferences] = useState<PublicPreferences | null>(null);
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
      if (screen === "connections") {
        const result = ConnectionsResponseSchema.parse({ data: await apiRequest<unknown>("/api/connections", { authenticated: true, onUnauthorized: () => replace("/login") }) });
        setConnections(result.data.connections);
      }
      if (screen === "activity") {
        const result = ActivityResponseSchema.parse({ data: await apiRequest<unknown>("/api/activity", { authenticated: true, onUnauthorized: () => replace("/login") }) });
        setActivities(result.data.activities);
      }
      if (screen === "settings") {
        const result = PreferencesResponseSchema.parse({ data: await apiRequest<unknown>("/api/preferences", { authenticated: true, onUnauthorized: () => replace("/login") }) });
        setPreferences(result.data.preferences);
      }
    } catch {
      setError(true);
    }
  }, [replace, screen]);

  useEffect(() => { queueMicrotask(() => { void load(); }); }, [load]);

  async function save(patch: Partial<PublicPreferences>) {
    try {
      const result = PreferencesResponseSchema.parse({ data: await apiRequest<unknown>("/api/preferences", { method: "PATCH" as never, body: patch, authenticated: true, onUnauthorized: () => replace("/login") }) });
      setPreferences(result.data.preferences);
      setSettingsNotice("Cài đặt đã được lưu.");
    } catch {
      setSettingsNotice("Chưa thể lưu cài đặt. Vui lòng thử lại.");
    }
  }

  async function retryWebhook(publicId: string) {
    if (connectionMutationPending) return;
    setConnectionMutationPending(true);
    setConnectionError(null);
    setConnectionNotice(null);
    try {
      await apiRequest<unknown>(`/api/connections/${publicId}/webhook-retry`, { method: "POST", body: {}, authenticated: true, onUnauthorized: () => replace("/login") });
      await load();
      setConnectionNotice("Đường nhận tin đã được mở lại. Hãy tạo mã kết nối mới.");
    } catch (reason) {
      setConnectionError(safeMutationMessage(reason, "Chưa thể mở lại đường nhận tin. Vui lòng thử lại."));
    } finally {
      setConnectionMutationPending(false);
    }
  }

  async function rotateConnectCode(publicId: string) {
    if (connectionMutationPending) return;
    setConnectionMutationPending(true);
    setConnectionError(null);
    setConnectionNotice(null);
    try {
      const data = ConnectCodeResultSchema.parse(await apiRequest<unknown>(`/api/connections/${publicId}/connect-code`, { method: "POST", body: {}, authenticated: true, onUnauthorized: () => replace("/login") }));
      setConnectCodes((current) => ({ ...current, [publicId]: { command: data.connectCommand, expiresAt: data.expiresAt } }));
    } catch (reason) {
      setConnectionError(safeMutationMessage(reason, "Chưa thể tạo mã kết nối. Vui lòng thử lại."));
    } finally {
      setConnectionMutationPending(false);
    }
  }

  async function copyConnectCode(command: string) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(command);
      setConnectionNotice("Đã sao chép mã kết nối.");
    } catch {
      setConnectionError("Chưa thể sao chép mã. Bạn có thể sao chép thủ công.");
    }
  }

  if (!user) return <main className={styles.entry}><section><h1>{error ? "Chưa mở được Calenote" : "Đang mở Calenote"}</h1>{error && <button onClick={() => void load()}>Thử lại</button>}</section></main>;

  return <AppShell user={user} activePath={`/app/${screen}`}><main className={styles.page}><header><p>{screen === "connections" ? "Kênh hỗ trợ" : screen === "activity" ? "Dòng thời gian" : "Không gian cá nhân"}</p><h1>{screen === "connections" ? "Kết nối" : screen === "activity" ? "Hoạt động" : "Cài đặt"}</h1><span>{screen === "connections" ? "Kết nối những nơi bạn muốn Calenote hỗ trợ." : screen === "activity" ? "Những thay đổi quan trọng gần đây." : "Điều chỉnh cách Calenote đồng hành cùng bạn."}</span></header>{error ? <LoadError retry={load} /> : screen === "connections" ? <Connections value={connections} pending={connectionMutationPending} notice={connectionNotice} error={connectionError} connectCodes={connectCodes} retryWebhook={retryWebhook} rotateConnectCode={rotateConnectCode} copyConnectCode={copyConnectCode} /> : screen === "activity" ? <ActivityFeed value={activities} /> : <Settings user={user} value={preferences} save={save} notice={settingsNotice} />}</main></AppShell>;
}

function ActivityFeed({ value }: { value: PublicActivity[] | null }) {
  if (value === null) return <Loading />;
  if (!value.length) return <Empty title="Chưa có hoạt động nào." text="Những thay đổi quan trọng sẽ xuất hiện ở đây." />;
  const copy = { REMINDER_CREATED: "Đã tạo lời nhắc", REMINDER_CANCELLED: "Đã huỷ lời nhắc", CONNECT_CODE_ROTATED: "Đã làm mới mã kết nối", CHAT_BOUND: "Đã kết nối kênh" } as const;
  return <ol className={styles.cards}>{value.map((item, index) => <li className={styles.card} key={`${item.createdAt}-${index}`}><div><h2>{copy[item.action]}</h2><time dateTime={new Date(item.createdAt).toISOString()}>{new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(item.createdAt)}</time></div></li>)}</ol>;
}

function Connections({ value, pending, notice, error, connectCodes, retryWebhook, rotateConnectCode, copyConnectCode }: { value: PublicConnection[] | null; pending: boolean; notice: string | null; error: string | null; connectCodes: Record<string, { command: string; expiresAt: number }>; retryWebhook(publicId: string): Promise<void>; rotateConnectCode(publicId: string): Promise<void>; copyConnectCode(command: string): Promise<void> }) {
  if (value === null) return <Loading />;
  if (!value.length) return <Empty title="Chưa có kết nối nào." text="Telegram và Zalo sẽ xuất hiện ở đây sau khi được thiết lập." />;
  return <div className={styles.cards}>{error && <p className={styles.mutationError} role="alert">{error}</p>}{notice && <p className={styles.notice} role="status">{notice}</p>}{value.map((connection) => { const code = connectCodes[connection.publicId]; return <article className={styles.card} key={connection.publicId}><Link2 aria-hidden="true" /><div><h2>{connection.provider === "telegram" ? "Telegram" : "Zalo"}</h2><p>{connection.displayName}</p><strong data-state={connection.state}>{status(connection.state)}</strong>{connection.state === "WEBHOOK_FAILED" && <><p>Kết nối cần được xác minh lại.</p><button className={styles.action} disabled={pending} onClick={() => void retryWebhook(connection.publicId)}>{pending ? "Đang mở lại…" : "Mở lại đường nhận tin"}</button></>}{connection.state === "ACTIVE_UNBOUND" && <><p>Hãy tạo mã kết nối rồi gửi trong cuộc trò chuyện riêng với bot.</p><button className={styles.action} disabled={pending} onClick={() => void rotateConnectCode(connection.publicId)}>{pending ? "Đang tạo…" : "Tạo mã kết nối"}</button>{code && <section className={styles.connectCode} aria-label="Mã kết nối"><code>{code.command}</code><button type="button" onClick={() => void copyConnectCode(code.command)}>Sao chép mã kết nối</button><p>Hết hạn lúc {new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(code.expiresAt)}.</p><p>Chỉ gửi mã này trong cuộc trò chuyện riêng với đúng bot.</p></section>}</>}{connection.state === "SUSPENDED" && <p>Thông tin xác thực của bot cần được xem lại.</p>}</div></article>; })}</div>;
}

function Settings({ user, value, save, notice }: { user: SessionUser; value: PublicPreferences | null; save: (patch: Partial<PublicPreferences>) => Promise<void>; notice: string | null }) {
  if (!value) return <Loading />;
  return <div className={styles.cards}><section className={styles.card}><div><h2>Hồ sơ</h2><label>Tên hiển thị<input readOnly value={user.displayName} /></label><label>Email<input readOnly value={user.email} /></label></div></section><section className={styles.card}><div><h2>Cá nhân hoá</h2><label>Cách xưng hô<select value={value.addressStyle} onChange={(event) => void save({ addressStyle: event.target.value as PublicPreferences["addressStyle"] })}><option value="ban">Bạn / mình</option><option value="anh_chi">Anh / chị</option><option value="ong_tui">Ông / tui</option><option value="minh">Mình</option></select></label><label>Giọng điệu<select value={value.tone} onChange={(event) => void save({ tone: event.target.value as PublicPreferences["tone"] })}><option value="concise">Ngắn gọn</option><option value="friendly">Thân thiện</option><option value="professional">Chuyên nghiệp</option><option value="playful">Vui vẻ</option></select></label></div></section><section className={styles.card}><Settings2 aria-hidden="true" /><div><h2>Hỗ trợ thông minh</h2><p>Calenote ưu tiên cách xử lý miễn phí; khi được cấu hình, có thể dùng lựa chọn chi phí rất thấp. Bạn luôn xác nhận đề xuất trước khi tạo lời nhắc.</p></div></section><section className={styles.card}><div><h2>Quyền riêng tư</h2><p>Thông tin đăng nhập không được hiển thị sau khi lưu. Nội dung nhạy cảm không được gửi vào Hỗ trợ thông minh tùy chọn.</p></div></section>{notice && <p role="status">{notice}</p>}</div>;
}

function Loading() { return <div className={styles.loading} aria-label="Đang tải"><span /><span /><span /></div>; }
function Empty({ title, text }: { title: string; text: string }) { return <section className={styles.empty}><h2>{title}</h2><p>{text}</p></section>; }
function LoadError({ retry }: { retry: () => void }) { return <section className={styles.error} role="alert"><CircleAlert aria-hidden="true" /><p>Chưa tải được dữ liệu.</p><button onClick={() => void retry()}><RefreshCw aria-hidden="true" />Thử lại</button></section>; }
