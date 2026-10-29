"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { ConnectionsResponseSchema, PublicConnectionSchema, type PublicConnection } from "@/contracts/api/connections";
import { ApiResponseError, apiRequest } from "@/lib/client-api";
import styles from "./FinalScreenExperience.module.css";

// Local UI adapter for backend fe7aa6d. Shared API contracts remain backend-owned.
const LoginChannelSchema = z.object({ connection: PublicConnectionSchema.nullable() }).strict();
const platform = (bot: PublicConnection) => bot.provider === "telegram" ? "Telegram" : "Zalo";
export function PrimaryLoginPanel() {
  const { replace } = useRouter();
  const [primary, setPrimary] = useState<PublicConnection | null>(null);
  const [candidates, setCandidates] = useState<PublicConnection[] | null>(null);
  const [choice, setChoice] = useState<PublicConnection | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const locked = useRef(false);
  const alive = useRef(true);
  const epoch = useRef(0);
  const chooser = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const unauthorized = useCallback(() => { alive.current = false; epoch.current++; setCandidates(null); setPrimary(null); setChoice(null); replace("/login"); }, [replace]);
  const load = useCallback(async () => {
    const requestEpoch = ++epoch.current;
    const currentRequest = () => alive.current && requestEpoch === epoch.current;
    const onUnauthorized = () => { if (currentRequest()) unauthorized(); };
    setLoading(true); setError(null); setChoice(null);
    try {
      const [list, current] = await Promise.all([
        apiRequest<unknown>("/api/connections", { authenticated: true, onUnauthorized }),
        apiRequest<unknown>("/api/connections/login-channel", { authenticated: true, onUnauthorized }),
      ]);
      const next = ConnectionsResponseSchema.parse({ data: list }).data.connections;
      const selected = LoginChannelSchema.parse(current).connection;
      if (currentRequest()) { setCandidates(next); setPrimary(selected); setUncertain(false); }
    } catch { if (currentRequest()) { setUncertain(true); setError("Chưa thể kiểm tra bot nhận mã đăng nhập. Hãy tải lại trạng thái."); } }
    finally { if (currentRequest()) setLoading(false); }
  }, [unauthorized]);
  useEffect(() => { let cancelled = false; const requestEpoch = epoch; alive.current = true; queueMicrotask(() => { if (!cancelled) void load(); }); return () => { cancelled = true; alive.current = false; requestEpoch.current++; }; }, [load]);
  useEffect(() => { if (choice) confirm.current?.focus(); }, [choice]);

  async function select() {
    if (!choice || locked.current || loading || uncertain || choice.state !== "ACTIVE_BOUND") return;
    const target = choice;
    const requestEpoch = ++epoch.current;
    const currentRequest = () => alive.current && requestEpoch === epoch.current;
    const onUnauthorized = () => { if (currentRequest()) unauthorized(); };
    locked.current = true; setBusy(true); setNotice(null); setError(null);
    try {
      const result = LoginChannelSchema.parse(await apiRequest<unknown>(`/api/connections/${target.publicId}/login-channel`, { method: "POST", body: {}, authenticated: true, onUnauthorized })).connection;
      if (!result || result.publicId !== target.publicId || result.state !== "ACTIVE_BOUND") throw new Error("Invalid selection result");
      const confirmed = LoginChannelSchema.parse(await apiRequest<unknown>("/api/connections/login-channel", { authenticated: true, onUnauthorized })).connection;
      if (!confirmed || confirmed.publicId !== target.publicId || confirmed.state !== "ACTIVE_BOUND") throw new Error("Selection changed during read-back");
      if (currentRequest()) { setPrimary(confirmed); setChoice(null); setNotice("Đã xác nhận bot nhận mã đăng nhập."); }
    } catch (reason) {
      if (currentRequest() && !(reason instanceof ApiResponseError && reason.status === 401)) {
        setChoice(null); setUncertain(true);
        setError("Chưa xác nhận được việc đổi bot. Hãy tải lại trạng thái trước khi thử tiếp.");
      }
    } finally { locked.current = false; if (currentRequest()) setBusy(false); }
  }
  return <section className={styles.settingsCard} id="primary-login" aria-labelledby="primary-login-title">
    <h2 id="primary-login-title">Bot nhận mã đăng nhập</h2>
    <p>Chọn bot riêng nhận mã khi bạn đăng nhập lần sau. Việc chọn bot này không đổi kênh nhận lời nhắc.</p>
    {loading ? <p role="status">Đang kiểm tra bot đăng nhập…</p> : <><p className={styles.primaryBot}>{primary ? `${primary.displayName} · ${platform(primary)}` : "Chưa có bot đăng nhập chính."}</p>{primary && primary.state !== "ACTIVE_BOUND" && <p>Bot đang cần kiểm tra. Mở Kết nối để xem trạng thái trước khi đăng nhập lần sau.</p>}</>}
    {error && <p role="alert" className={styles.mutationError}>{error}</p>}
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    {candidates && <ul className={styles.loginCandidates}>{candidates.map(bot => <li key={bot.publicId}><div><strong>{bot.displayName}</strong><small>{platform(bot)} · {bot.publicId === primary?.publicId ? "Đang chọn" : bot.state === "ACTIVE_BOUND" ? "Đã liên kết chat riêng" : "Chưa sẵn sàng nhận mã"}</small></div><button ref={choice?.publicId === bot.publicId ? chooser : undefined} type="button" className={styles.action} aria-label={`Chọn ${bot.displayName}`} disabled={busy || loading || uncertain || bot.state !== "ACTIVE_BOUND" || bot.publicId === primary?.publicId} onClick={event => { chooser.current = event.currentTarget; setNotice(null); setChoice(bot); }}>Chọn bot</button></li>)}</ul>}
    {choice && <div className={styles.loginConfirmation} role="group" aria-label="Xác nhận bot nhận mã"><p>Đổi bot nhận mã sang <strong>{choice.displayName} · {platform(choice)}</strong>? Mã đăng nhập cũ chưa dùng sẽ không còn dùng được.</p><button ref={confirm} type="button" className={styles.primary} disabled={busy} onClick={() => void select()}>{busy ? "Đang xác nhận…" : "Xác nhận đổi bot"}</button><button type="button" className={styles.action} disabled={busy} onClick={() => { setChoice(null); chooser.current?.focus(); }}>Giữ bot hiện tại</button></div>}
    <div className={styles.saveRow}><button type="button" className={styles.action} disabled={busy || loading} onClick={() => { setNotice(null); void load(); }}>Tải lại trạng thái</button><Link className={styles.textLink} href="/app/connections">Xem Kết nối</Link></div>
  </section>;
}
