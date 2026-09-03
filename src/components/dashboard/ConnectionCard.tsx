"use client";

import { useEffect, useState } from "react";
import { Bot, Check, Copy, Link2, RefreshCw, ShieldAlert } from "lucide-react";
import type { PublicConnection } from "./DashboardShell";
import styles from "./DashboardShell.module.css";

export interface ConnectCommand {
  value: string;
  expiresAt: number;
}

interface ConnectionCardProps {
  connection: PublicConnection;
  command?: ConnectCommand;
  busy: boolean;
  onRotate: () => void;
  onRetryWebhook: () => void;
}

const STATE_COPY = {
  VALIDATING: {
    label: "Đang hoàn tất kích hoạt",
    detail: "Calenote đang kiểm tra kết nối an toàn với bot.",
    tone: "neutral",
  },
  ACTIVE_UNBOUND: {
    label: "Chờ lệnh kết nối riêng",
    detail: "Tạo mã rồi gửi lệnh trong cuộc chat riêng với bot.",
    tone: "waiting",
  },
  ACTIVE_BOUND: {
    label: "Đã kết nối chat riêng",
    detail: "Bot đã sẵn sàng nhận và gửi nhắc hẹn cho bạn.",
    tone: "success",
  },
  WEBHOOK_FAILED: {
    label: "Đường nhận tin cần mở lại",
    detail: "Token mã hóa vẫn được lưu; bạn có thể yêu cầu Calenote mở lại đường nhận tin.",
    tone: "danger",
  },
  SUSPENDED: {
    label: "Token không còn hiệu lực",
    detail: "Nền tảng bot không chấp nhận token hiện tại. Hãy kiểm tra token trước khi kết nối lại.",
    tone: "danger",
  },
} as const;

export function ConnectionCard({
  connection,
  command,
  busy,
  onRotate,
  onRetryWebhook,
}: ConnectionCardProps) {
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  const stateCopy = STATE_COPY[connection.state];
  const activeCommand = command && command.expiresAt > now ? command : undefined;

  useEffect(() => {
    if (!command) return;
    const remaining = command.expiresAt - Date.now();
    if (remaining <= 0) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(remaining + 25, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [command]);

  async function copyCommand() {
    if (!activeCommand) return;
    try {
      await navigator.clipboard.writeText(activeCommand.value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const providerLabel = connection.provider === "zalo" ? "Zalo Bot Platform" : "Telegram Bot API";

  return (
    <article className={styles.connectionCard}>
      <header>
        <span className={styles.botAvatar} aria-hidden="true"><Bot size={19} /></span>
        <div>
          <h3>{connection.displayName}</h3>
          <p>{providerLabel}{connection.handle ? ` · ${connection.handle}` : ""}</p>
        </div>
      </header>
      <div className={`${styles.connectionState} ${styles[stateCopy.tone]}`}>
        {connection.state === "ACTIVE_BOUND"
          ? <Check size={16} aria-hidden="true" />
          : <ShieldAlert size={16} aria-hidden="true" />}
        <div><strong>{stateCopy.label}</strong><span>{stateCopy.detail}</span></div>
      </div>

      {connection.state === "ACTIVE_UNBOUND" && (
        <div className={styles.connectionAction}>
          {activeCommand ? (
            <div className={styles.commandBox}>
              <p>Lệnh dùng một lần</p>
              <code>{activeCommand.value}</code>
              <button type="button" onClick={copyCommand} aria-label="Sao chép lệnh kết nối">
                {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
                {copied ? "Đã sao chép" : "Sao chép"}
              </button>
              <small>Chỉ gửi lệnh này trong cuộc chat riêng với đúng bot.</small>
            </div>
          ) : command ? (
            <p className={styles.expiredCommand}>Mã trước đã hết hạn và không còn hiển thị.</p>
          ) : null}
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={onRotate}
            disabled={busy}
            aria-label={`${activeCommand ? "Tạo mã mới" : "Tạo mã kết nối"} cho ${connection.displayName}`}
          >
            <Link2 size={16} aria-hidden="true" />
            {busy ? "Đang tạo mã…" : activeCommand ? "Tạo mã mới" : "Tạo mã kết nối"}
          </button>
        </div>
      )}

      {connection.state === "WEBHOOK_FAILED" && (
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={onRetryWebhook}
          disabled={busy}
          aria-label={`Mở lại đường nhận tin cho ${connection.displayName}`}
        >
          <RefreshCw size={16} aria-hidden="true" />
          {busy ? "Đang mở lại…" : "Mở lại đường nhận tin"}
        </button>
      )}
    </article>
  );
}
