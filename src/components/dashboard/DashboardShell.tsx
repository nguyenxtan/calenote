"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Bot, CalendarClock, LogOut, Plus, ShieldCheck } from "lucide-react";
import { CalenoteMark } from "@/components/brand/CalenoteMark";
import {
  AmbiguousMutationError,
  ApiResponseError,
  apiRequest,
} from "@/lib/client-api";
import { ConnectionCard, type ConnectCommand } from "./ConnectionCard";
import { TodayTimeline } from "./TodayTimeline";
import styles from "./DashboardShell.module.css";

const VIETNAM_TIMEZONE = "Asia/Ho_Chi_Minh" as const;

export type ConnectionState =
  | "VALIDATING"
  | "ACTIVE_UNBOUND"
  | "ACTIVE_BOUND"
  | "WEBHOOK_FAILED"
  | "SUSPENDED";

export interface PublicConnection {
  publicId: string;
  provider: "zalo" | "telegram";
  displayName: string;
  handle: string | null;
  state: ConnectionState;
}

export type ReminderStatus =
  | "PENDING"
  | "CLAIMED"
  | "RETRYABLE"
  | "SENT"
  | "FAILED"
  | "UNCERTAIN"
  | "CANCELLED";

export interface PublicReminder {
  publicId: string;
  title: string;
  scheduledAt: number;
  timezone: typeof VIETNAM_TIMEZONE;
  status: ReminderStatus;
}

interface SessionUser {
  displayName: string;
  email: string;
  timezone: typeof VIETNAM_TIMEZONE;
}

type EntryState = "checking" | "ready" | "error" | "redirecting";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function parseSession(data: unknown): SessionUser {
  if (!isRecord(data) || !isRecord(data.user)) throw new Error("invalid session");
  const { displayName, email, timezone } = data.user;
  if (
    typeof displayName !== "string"
    || displayName.length < 1
    || displayName.length > 80
    || typeof email !== "string"
    || email.length < 3
    || email.length > 254
    || timezone !== VIETNAM_TIMEZONE
  ) throw new Error("invalid session");
  return { displayName, email, timezone };
}

const CONNECTION_STATES: readonly ConnectionState[] = [
  "VALIDATING",
  "ACTIVE_UNBOUND",
  "ACTIVE_BOUND",
  "WEBHOOK_FAILED",
  "SUSPENDED",
];

function parseConnections(data: unknown): PublicConnection[] {
  if (!isRecord(data) || !Array.isArray(data.connections)) throw new Error("invalid connections");
  return data.connections.map((item) => {
    if (!isRecord(item)) throw new Error("invalid connection");
    const { publicId, provider, displayName, handle, state } = item;
    if (
      typeof publicId !== "string"
      || publicId.length < 1
      || publicId.length > 128
      || (provider !== "zalo" && provider !== "telegram")
      || typeof displayName !== "string"
      || displayName.length < 1
      || displayName.length > 160
      || (handle !== null && (typeof handle !== "string" || handle.length > 160))
      || typeof state !== "string"
      || !CONNECTION_STATES.includes(state as ConnectionState)
    ) throw new Error("invalid connection");
    return { publicId, provider, displayName, handle, state: state as ConnectionState };
  });
}

const REMINDER_STATUSES: readonly ReminderStatus[] = [
  "PENDING",
  "CLAIMED",
  "RETRYABLE",
  "SENT",
  "FAILED",
  "UNCERTAIN",
  "CANCELLED",
];

function parseReminders(data: unknown): PublicReminder[] {
  if (!isRecord(data) || !Array.isArray(data.reminders)) throw new Error("invalid reminders");
  return data.reminders.map((item) => {
    if (!isRecord(item)) throw new Error("invalid reminder");
    const { publicId, title, scheduledAt, timezone, status } = item;
    if (
      typeof publicId !== "string"
      || publicId.length < 1
      || publicId.length > 128
      || typeof title !== "string"
      || title.length < 1
      || title.length > 500
      || typeof scheduledAt !== "number"
      || !Number.isSafeInteger(scheduledAt)
      || timezone !== VIETNAM_TIMEZONE
      || typeof status !== "string"
      || !REMINDER_STATUSES.includes(status as ReminderStatus)
    ) throw new Error("invalid reminder");
    return {
      publicId,
      title,
      scheduledAt,
      timezone,
      status: status as ReminderStatus,
    };
  });
}

export function vietnamWallClockToEpoch(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/u.exec(value);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  const normalized = new Date(wallClockAsUtc);
  if (
    normalized.getUTCFullYear() !== year
    || normalized.getUTCMonth() !== month - 1
    || normalized.getUTCDate() !== day
    || normalized.getUTCHours() !== hour
    || normalized.getUTCMinutes() !== minute
  ) return null;
  return wallClockAsUtc - 7 * 60 * 60_000;
}

function friendlyResourceError(resource: "connections" | "reminders"): string {
  return resource === "connections"
    ? "Chưa thể tải kết nối bot. Thông tin nhắc hẹn vẫn dùng được nếu đã tải xong."
    : "Chưa thể tải danh sách nhắc hẹn. Kết nối bot vẫn dùng được nếu đã tải xong.";
}

export function DashboardShell() {
  const { replace } = useRouter();
  const [entryState, setEntryState] = useState<EntryState>("checking");
  const [entryError, setEntryError] = useState<string | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [connections, setConnections] = useState<PublicConnection[] | null>(null);
  const [connectionLoading, setConnectionLoading] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [reminders, setReminders] = useState<PublicReminder[] | null>(null);
  const [reminderLoading, setReminderLoading] = useState(false);
  const [reminderError, setReminderError] = useState<string | null>(null);
  const [connectCommands, setConnectCommands] = useState<Record<string, ConnectCommand>>({});
  const [connectionBusyId, setConnectionBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [wallClock, setWallClock] = useState("");

  const epochRef = useRef(0);
  const redirectedRef = useRef(false);
  const sessionControllerRef = useRef<AbortController | null>(null);
  const connectionControllerRef = useRef<AbortController | null>(null);
  const reminderControllerRef = useRef<AbortController | null>(null);
  const mutationControllerRef = useRef<AbortController | null>(null);
  const mutationLockRef = useRef(false);
  const entryErrorHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const actionErrorRef = useRef<HTMLDivElement | null>(null);

  const clearPersonalAndRedirect = useCallback(() => {
    epochRef.current += 1;
    sessionControllerRef.current?.abort();
    connectionControllerRef.current?.abort();
    reminderControllerRef.current?.abort();
    mutationControllerRef.current?.abort();
    mutationLockRef.current = false;
    setUser(null);
    setConnections(null);
    setReminders(null);
    setConnectCommands({});
    setNotice(null);
    setActionError(null);
    setEntryState("redirecting");
    if (!redirectedRef.current) {
      redirectedRef.current = true;
      replace("/login");
    }
  }, [replace]);

  const loadConnections = useCallback(async (epoch: number): Promise<boolean> => {
    connectionControllerRef.current?.abort();
    const controller = new AbortController();
    connectionControllerRef.current = controller;
    setConnectionLoading(true);
    setConnectionError(null);
    try {
      const data = await apiRequest<unknown>("/api/connections", {
        signal: controller.signal,
        authenticated: true,
        onUnauthorized: clearPersonalAndRedirect,
      });
      const next = parseConnections(data);
      if (epochRef.current !== epoch) return false;
      setConnections(next);
      setConnectCommands((current) => Object.fromEntries(
        Object.entries(current).filter(([publicId, command]) =>
          next.some((connection) => connection.publicId === publicId && connection.state === "ACTIVE_UNBOUND")
          && command.expiresAt > Date.now(),
        ),
      ));
      return true;
    } catch (error) {
      if (isAbort(error) || epochRef.current !== epoch) return false;
      setConnectionError(friendlyResourceError("connections"));
      return false;
    } finally {
      if (epochRef.current === epoch && connectionControllerRef.current === controller) {
        setConnectionLoading(false);
      }
    }
  }, [clearPersonalAndRedirect]);

  const loadReminders = useCallback(async (epoch: number): Promise<boolean> => {
    reminderControllerRef.current?.abort();
    const controller = new AbortController();
    reminderControllerRef.current = controller;
    setReminderLoading(true);
    setReminderError(null);
    try {
      const data = await apiRequest<unknown>("/api/reminders", {
        signal: controller.signal,
        authenticated: true,
        onUnauthorized: clearPersonalAndRedirect,
      });
      const next = parseReminders(data);
      if (epochRef.current !== epoch) return false;
      setReminders(next);
      return true;
    } catch (error) {
      if (isAbort(error) || epochRef.current !== epoch) return false;
      setReminderError(friendlyResourceError("reminders"));
      return false;
    } finally {
      if (epochRef.current === epoch && reminderControllerRef.current === controller) {
        setReminderLoading(false);
      }
    }
  }, [clearPersonalAndRedirect]);

  const checkSession = useCallback(() => {
    sessionControllerRef.current?.abort();
    connectionControllerRef.current?.abort();
    reminderControllerRef.current?.abort();
    const controller = new AbortController();
    sessionControllerRef.current = controller;
    redirectedRef.current = false;
    const epoch = epochRef.current + 1;
    epochRef.current = epoch;

    void apiRequest<unknown>("/api/session", {
      signal: controller.signal,
      authenticated: true,
      onUnauthorized: clearPersonalAndRedirect,
    }).then((data) => {
      if (epochRef.current !== epoch) return;
      const nextUser = parseSession(data);
      setUser(nextUser);
      setEntryState("ready");
      void loadConnections(epoch);
      void loadReminders(epoch);
    }).catch((error: unknown) => {
      if (isAbort(error) || epochRef.current !== epoch) return;
      setEntryState("error");
      setEntryError("Chưa thể xác thực phiên. Vui lòng kiểm tra kết nối rồi thử lại.");
    });
  }, [clearPersonalAndRedirect, loadConnections, loadReminders]);

  function retrySessionCheck() {
    setEntryState("checking");
    setEntryError(null);
    setUser(null);
    setConnections(null);
    setReminders(null);
    checkSession();
  }

  useEffect(() => {
    checkSession();
    return () => {
      epochRef.current += 1;
      sessionControllerRef.current?.abort();
      connectionControllerRef.current?.abort();
      reminderControllerRef.current?.abort();
      mutationControllerRef.current?.abort();
    };
  }, [checkSession]);

  useEffect(() => {
    if (entryState === "error") entryErrorHeadingRef.current?.focus();
  }, [entryState]);

  useEffect(() => {
    if (actionError) actionErrorRef.current?.focus();
  }, [actionError]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutationLockRef.current || !user) return;
    const scheduledAt = vietnamWallClockToEpoch(wallClock);
    const trimmedTitle = title.trim();
    if (!trimmedTitle || scheduledAt === null) {
      setActionError("Vui lòng nhập nội dung và ngày giờ hợp lệ tại Việt Nam.");
      return;
    }

    mutationLockRef.current = true;
    const controller = new AbortController();
    mutationControllerRef.current = controller;
    const epoch = epochRef.current;
    setCreating(true);
    setActionError(null);
    setNotice(null);
    try {
      await apiRequest<unknown>("/api/reminders", {
        method: "POST",
        body: { title: trimmedTitle, scheduledAt, timezone: VIETNAM_TIMEZONE },
        signal: controller.signal,
        authenticated: true,
        onUnauthorized: clearPersonalAndRedirect,
      });
      const refreshed = await loadReminders(epoch);
      if (epochRef.current === epoch) {
        setTitle("");
        setWallClock("");
        if (refreshed) {
          setNotice("Nhắc hẹn đã được lưu.");
        } else {
          setActionError(
            "Máy chủ đã ghi nhận nhắc hẹn, nhưng danh sách chưa tải lại. Không tạo lại; hãy tải lại danh sách trước khi thao tác tiếp.",
          );
        }
      }
    } catch (error) {
      if (isAbort(error) || epochRef.current !== epoch) return;
      if (error instanceof AmbiguousMutationError) {
        await loadReminders(epoch);
        if (epochRef.current === epoch) {
          setActionError("Kết quả tạo nhắc chưa xác định. Danh sách đã được tải lại; đừng gửi lại trước khi kiểm tra.");
        }
      } else if (error instanceof ApiResponseError) {
        setActionError(error.message);
      } else {
        setActionError("Chưa thể tạo nhắc hẹn. Vui lòng kiểm tra thông tin và thử lại.");
      }
    } finally {
      if (epochRef.current === epoch) {
        setCreating(false);
        mutationLockRef.current = false;
      }
    }
  }

  async function handleCancel(reminder: PublicReminder) {
    if (mutationLockRef.current || !user) return;
    mutationLockRef.current = true;
    const controller = new AbortController();
    mutationControllerRef.current = controller;
    const epoch = epochRef.current;
    setCancellingId(reminder.publicId);
    setActionError(null);
    setNotice(null);
    try {
      await apiRequest<unknown>(`/api/reminders/${reminder.publicId}`, {
        method: "DELETE",
        body: {},
        signal: controller.signal,
        authenticated: true,
        onUnauthorized: clearPersonalAndRedirect,
      });
      const refreshed = await loadReminders(epoch);
      if (epochRef.current === epoch) {
        if (refreshed) {
          setNotice("Nhắc hẹn đã được hủy.");
        } else {
          setActionError(
            "Máy chủ đã ghi nhận việc hủy, nhưng danh sách chưa tải lại. Không hủy lại; hãy tải lại danh sách trước khi thao tác tiếp.",
          );
        }
      }
    } catch (error) {
      if (isAbort(error) || epochRef.current !== epoch) return;
      if (error instanceof AmbiguousMutationError) {
        await loadReminders(epoch);
        if (epochRef.current === epoch) {
          setActionError("Kết quả hủy chưa xác định. Danh sách đã được làm mới; vui lòng kiểm tra trạng thái trước khi thao tác tiếp.");
        }
      } else if (error instanceof ApiResponseError && (error.status === 404 || error.status === 409)) {
        await loadReminders(epoch);
        if (epochRef.current === epoch) {
          setActionError(`${error.message} Danh sách đã được làm mới theo trạng thái trên máy chủ.`);
        }
      } else if (error instanceof ApiResponseError) {
        setActionError(error.message);
      } else {
        setActionError("Chưa thể hủy nhắc hẹn. Vui lòng thử lại sau.");
      }
    } finally {
      if (epochRef.current === epoch) {
        setCancellingId(null);
        mutationLockRef.current = false;
      }
    }
  }

  async function handleConnectionAction(connection: PublicConnection, action: "connect" | "webhook") {
    if (mutationLockRef.current || !user) return;
    mutationLockRef.current = true;
    const controller = new AbortController();
    mutationControllerRef.current = controller;
    const epoch = epochRef.current;
    setConnectionBusyId(connection.publicId);
    setActionError(null);
    setNotice(null);
    try {
      const suffix = action === "connect" ? "connect-code" : "webhook-retry";
      const data = await apiRequest<unknown>(`/api/connections/${connection.publicId}/${suffix}`, {
        method: "POST",
        body: {},
        signal: controller.signal,
        authenticated: true,
        onUnauthorized: clearPersonalAndRedirect,
      });
      const refreshed = await loadConnections(epoch);
      if (epochRef.current !== epoch) return;
      if (!refreshed) {
        setActionError(
          "Máy chủ đã ghi nhận thao tác kết nối, nhưng trạng thái chưa tải lại. Không gửi lại yêu cầu; hãy tải lại kết nối trước khi thao tác tiếp.",
        );
        return;
      }
      if (action === "connect") {
        if (
          !isRecord(data)
          || typeof data.connectCommand !== "string"
          || data.connectCommand.length < 1
          || data.connectCommand.length > 160
          || typeof data.expiresAt !== "number"
          || !Number.isSafeInteger(data.expiresAt)
        ) throw new Error("invalid connect command");
        setConnectCommands((current) => ({
          ...current,
          [connection.publicId]: {
            value: data.connectCommand as string,
            expiresAt: data.expiresAt as number,
          },
        }));
        setNotice("Mã kết nối mới đã sẵn sàng. Hãy gửi lệnh trong cuộc chat riêng với bot.");
      } else {
        setNotice("Đã mở lại đường nhận tin và làm mới trạng thái kết nối.");
      }
    } catch (error) {
      if (isAbort(error) || epochRef.current !== epoch) return;
      if (error instanceof AmbiguousMutationError) {
        await loadConnections(epoch);
        if (epochRef.current === epoch) {
          setActionError("Kết quả thao tác kết nối chưa xác định. Trạng thái đã được tải lại; Calenote không tự gửi lại yêu cầu.");
        }
      } else if (error instanceof ApiResponseError) {
        setActionError(error.message);
      } else {
        setActionError("Chưa thể hoàn tất thao tác kết nối. Vui lòng thử lại sau.");
      }
    } finally {
      if (epochRef.current === epoch) {
        setConnectionBusyId(null);
        mutationLockRef.current = false;
      }
    }
  }

  async function handleLogout() {
    if (mutationLockRef.current || !user) return;
    mutationLockRef.current = true;
    const controller = new AbortController();
    mutationControllerRef.current = controller;
    const epoch = epochRef.current;
    setLoggingOut(true);
    setActionError(null);
    setNotice(null);
    try {
      await apiRequest<unknown>("/api/auth/logout", {
        method: "POST",
        body: {},
        signal: controller.signal,
        authenticated: true,
        onUnauthorized: clearPersonalAndRedirect,
      });
      if (epochRef.current === epoch) clearPersonalAndRedirect();
    } catch (error) {
      if (isAbort(error) || epochRef.current !== epoch) return;
      setActionError(
        error instanceof AmbiguousMutationError
          ? "Chưa thể xác nhận đã đăng xuất. Thông tin vẫn được giữ trên màn hình; hãy thử lại khi kết nối ổn định."
          : "Chưa thể đăng xuất. Phiên của bạn vẫn được giữ; vui lòng thử lại.",
      );
    } finally {
      if (epochRef.current === epoch) {
        setLoggingOut(false);
        mutationLockRef.current = false;
      }
    }
  }

  if (entryState !== "ready" || !user) {
    return (
      <main className={styles.entryPage}>
        <section className={styles.entryCard} aria-labelledby="dashboard-entry-title">
          <CalenoteMark />
          <h1
            id="dashboard-entry-title"
            ref={entryErrorHeadingRef}
            tabIndex={entryState === "error" ? -1 : undefined}
          >
            {entryState === "error" ? "Chưa mở được Calenote" : "Đang mở Calenote"}
          </h1>
          {entryState === "error" ? (
            <>
              <p role="alert">{entryError}</p>
              <button type="button" onClick={retrySessionCheck}>Thử lại</button>
              <Link href="/login">Đến trang đăng nhập</Link>
            </>
          ) : (
            <p role="status">Đang xác thực phiên…</p>
          )}
        </section>
      </main>
    );
  }

  const pendingCount = reminders?.filter((reminder) =>
    reminder.status === "PENDING" || reminder.status === "CLAIMED" || reminder.status === "RETRYABLE",
  ).length;

  return (
    <main className={styles.dashboard}>
      <aside className={styles.sidebar}>
        <Link href="/dashboard" className={styles.brandLink} aria-label="Calenote — Tổng quan">
          <CalenoteMark compact />
        </Link>
        <nav className={styles.nav} aria-label="Điều hướng chính">
          <Link href="/dashboard" aria-current="page">Tổng quan</Link>
          <Link href="/docs">Hướng dẫn kết nối</Link>
        </nav>
        <section className={styles.roadmap} aria-labelledby="roadmap-title">
          <p id="roadmap-title">Định hướng sau MVP</p>
          <ul>
            <li>Cặp đôi</li>
            <li>Nhóm</li>
            <li>Thu chi</li>
            <li>Lặp lại</li>
            <li>Ứng dụng di động</li>
          </ul>
        </section>
      </aside>

      <section className={styles.mainArea}>
        <header className={styles.topbar}>
          <div className={styles.mobileLogo}><CalenoteMark compact /></div>
          <div className={styles.accountState} data-testid="mobile-account-state">
            <span aria-hidden="true">{user.displayName.slice(0, 1).toLocaleUpperCase("vi")}</span>
            <div><strong>{user.displayName}</strong><small>{user.email}</small></div>
          </div>
          <button type="button" className={styles.logoutButton} onClick={handleLogout} disabled={loggingOut}>
            <LogOut size={17} aria-hidden="true" />
            {loggingOut ? "Đang đăng xuất…" : "Đăng xuất"}
          </button>
        </header>

        <div className={styles.content}>
          <header className={styles.pageHeader}>
            <div>
              <p className={styles.eyebrow}>Không gian cá nhân</p>
              <h1>Chào, {user.displayName}</h1>
              <p>
                {pendingCount === undefined
                  ? "Kết nối bot và các nhắc hẹn của bạn đang được tải riêng."
                  : pendingCount === 0
                    ? "Bạn không có nhắc hẹn đang chờ."
                    : `Bạn có ${pendingCount} nhắc hẹn đang chờ xử lý.`}
              </p>
            </div>
            <span className={styles.timezoneBadge}><ShieldCheck size={16} aria-hidden="true" /> Giờ Việt Nam</span>
          </header>

          {actionError && <div className={styles.actionError} role="alert" tabIndex={-1} ref={actionErrorRef}>{actionError}</div>}
          {notice && <div className={styles.notice} role="status">{notice}</div>}

          <div className={styles.dashboardGrid}>
            <div className={styles.primaryColumn}>
              <section className={`${styles.panel} ${styles.createPanel}`} aria-labelledby="create-title">
                <header className={styles.panelHeader}>
                  <span className={styles.panelIcon} aria-hidden="true"><Plus size={18} /></span>
                  <div><p>Tạo thủ công</p><h2 id="create-title">Thêm một nhắc hẹn</h2></div>
                </header>
                <form className={styles.reminderForm} onSubmit={handleCreate}>
                  <label>
                    <span>Nội dung nhắc</span>
                    <input
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      maxLength={500}
                      autoComplete="off"
                      required
                      disabled={creating}
                      placeholder="Ví dụ: Gọi cho mẹ"
                    />
                  </label>
                  <label>
                    <span>Ngày giờ tại Việt Nam</span>
                    <input
                      type="datetime-local"
                      step="60"
                      value={wallClock}
                      onChange={(event) => setWallClock(event.target.value)}
                      required
                      disabled={creating}
                    />
                  </label>
                  <button type="submit" disabled={creating}>
                    <CalendarClock size={17} aria-hidden="true" />
                    {creating ? "Đang lưu…" : "Tạo nhắc hẹn"}
                  </button>
                </form>
                <p className={styles.formHint}>Calenote dùng múi giờ Việt Nam và làm mới danh sách sau khi lưu.</p>
              </section>

              <TodayTimeline
                reminders={reminders}
                loading={reminderLoading}
                error={reminderError}
                cancellingId={cancellingId}
                onCancel={handleCancel}
                onRetry={() => void loadReminders(epochRef.current)}
              />
            </div>

            <aside className={styles.rightColumn} aria-label="Kết nối bot">
              <section className={`${styles.panel} ${styles.connectionsPanel}`} aria-labelledby="connections-title">
                <header className={styles.panelHeader}>
                  <span className={styles.panelIcon} aria-hidden="true"><Bot size={18} /></span>
                  <div><p>Kênh nhận nhắc</p><h2 id="connections-title">Bot của bạn</h2></div>
                </header>

                {connectionLoading && connections === null && <p className={styles.loadingText}>Đang tải kết nối…</p>}
                {connectionError && (
                  <div className={styles.resourceError} role="alert">
                    <p>{connectionError}</p>
                    <button type="button" onClick={() => void loadConnections(epochRef.current)}>Tải lại kết nối</button>
                  </div>
                )}
                {!connectionLoading && !connectionError && connections?.length === 0 && (
                  <div className={styles.emptyState}>
                    <p>Bạn chưa có kết nối bot.</p>
                    <Link href="/docs">Xem hướng dẫn kết nối</Link>
                  </div>
                )}
                {connections && connections.length > 0 && (
                  <div className={styles.connectionList}>
                    {connections.map((connection) => (
                      <ConnectionCard
                        key={connection.publicId}
                        connection={connection}
                        command={connectCommands[connection.publicId]}
                        busy={connectionBusyId === connection.publicId}
                        onRotate={() => void handleConnectionAction(connection, "connect")}
                        onRetryWebhook={() => void handleConnectionAction(connection, "webhook")}
                      />
                    ))}
                  </div>
                )}
                {connectionLoading && connections !== null && <p className={styles.refreshText}>Đang làm mới kết nối…</p>}
              </section>
            </aside>
          </div>
        </div>
      </section>
    </main>
  );
}
