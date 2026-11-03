"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { PublicConnectionSchema } from "@/contracts/api/connections";
import { AmbiguousMutationError, ApiResponseError, apiRequest } from "@/lib/client-api";
import styles from "./FinalScreenExperience.module.css";

// Public result data never accepts a token.
const ResultSchema = z.object({
  bot: PublicConnectionSchema.extend({ state: z.enum(["ACTIVE_UNBOUND", "WEBHOOK_FAILED", "SUSPENDED"]) }),
  connectCommand: z.string().regex(/^\/connect [A-HJ-NP-Z2-9]{26}$/u).nullable(),
  connectCodeExpiresAt: z.number().int().positive().nullable(),
  activationCode: z.literal("WEBHOOK_ACTIVATION_FAILED").nullable(),
}).strict().superRefine((result, context) => {
  const active = result.bot.state === "ACTIVE_UNBOUND";
  if (active !== (result.connectCommand !== null && result.connectCodeExpiresAt !== null && result.activationCode === null)) context.addIssue({ code: "custom", message: "Invalid activation result" });
  if (!active && (result.connectCommand !== null || result.connectCodeExpiresAt !== null || result.activationCode !== "WEBHOOK_ACTIVATION_FAILED")) context.addIssue({ code: "custom", message: "Invalid failed activation result" });
});
type Result = z.infer<typeof ResultSchema>;

export function AddBotPanel({ onAdded }: { onAdded: () => void | Promise<void> }) {
  const { replace } = useRouter();
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<"telegram" | "zalo">("telegram");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const locked = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked.current) return;
    const submittedToken = token.trim();
    if (!submittedToken || submittedToken.length > 512) { setError("Hãy nhập token hợp lệ của đúng nền tảng."); return; }
    locked.current = true; setBusy(true); setToken(""); setError(null); setResult(null);
    try {
      const data = await apiRequest<unknown>("/api/connections", { method: "POST", body: { provider, token: submittedToken }, authenticated: true, onUnauthorized: () => replace("/login") });
      const next = ResultSchema.parse(data);
      if (next.bot.provider !== provider || next.bot.displayName.includes(submittedToken) || next.bot.handle?.includes(submittedToken)) throw new Error("Invalid public bot result");
      setResult(next);
      await onAdded();
    } catch (reason) {
      // Never echo server messages: credential endpoints may return unsafe provider text.
      if (reason instanceof ApiResponseError && reason.status === 401) return;
      setError(reason instanceof ApiResponseError && reason.status === 429
        ? "Bạn đã thử nhiều lần. Hãy chờ rồi thử lại."
        : reason instanceof ApiResponseError && reason.status >= 400 && reason.status < 500
          ? "Chưa thể thêm bot. Kiểm tra nền tảng và token trước khi thử lại."
          : reason instanceof AmbiguousMutationError || !(reason instanceof ApiResponseError)
            ? "Kết quả chưa xác định. Hãy kiểm tra danh sách kết nối trước khi gửi lại."
            : "Chưa thể hoàn tất. Hãy kiểm tra danh sách kết nối trước khi gửi lại.");
    } finally { locked.current = false; setBusy(false); }
  }

  return <section className={styles.addBot} aria-label="Thêm bot riêng">
    <button type="button" className={styles.action} aria-expanded={open} aria-controls="add-bot-form" disabled={busy} onClick={() => { setToken(""); setError(null); setOpen(value => !value); }}>Thêm bot</button>
    {open && <form id="add-bot-form" aria-label="Thêm bot riêng" onSubmit={submit}>
      <h2>Bot của riêng bạn</h2><p>Chọn nền tảng và nhập token được cấp cho bot bạn sở hữu. Sau khi thêm, bạn cần liên kết cuộc chat riêng.</p>
      <label>Nền tảng<select value={provider} disabled={busy} onChange={event => { setProvider(event.target.value as "telegram" | "zalo"); setToken(""); setResult(null); setError(null); }}><option value="telegram">Telegram</option><option value="zalo">Zalo Bot Platform</option></select></label>
      <label>Bot token<input type="password" autoComplete="off" spellCheck={false} maxLength={512} value={token} disabled={busy} onChange={event => setToken(event.target.value)} aria-describedby="token-help" required /></label>
      <p id="token-help">Token được gửi qua yêu cầu thêm bot và mã hoá khi lưu để Calenote vận hành bot. Không gửi token qua chat, email hoặc ảnh chụp.</p>
      <button type="submit" className={styles.primary} disabled={busy || !token.trim()}>{busy ? "Đang kiểm tra…" : "Kiểm tra và thêm bot"}</button>
    </form>}
    {error && <p className={styles.mutationError} role="alert">{error}</p>}
    {result && <div className={styles.connectCode}>
      <p role="status">{result.bot.state === "ACTIVE_UNBOUND" ? "Đã thêm bot, chưa liên kết chat riêng." : "Bot đã được ghi nhận nhưng cần kiểm tra đường nhận tin hoặc token. Xem trạng thái trong danh sách."}</p>
      {result.connectCommand && <><p>Sao chép lệnh dưới đây và gửi trong cuộc chat riêng với đúng bot.</p><code>{result.connectCommand}</code><p>Mã hết hạn lúc {new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "short" }).format(result.connectCodeExpiresAt!)} · Giờ Việt Nam.</p></>}
    </div>}
  </section>;
}
