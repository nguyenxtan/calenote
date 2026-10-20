"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Mail, ShieldCheck } from "lucide-react";
import { CalenoteMark } from "@/components/brand/CalenoteMark";
import { AmbiguousMutationError, apiRequest } from "@/lib/client-api";
import { RequestEmailRegistrationResponseSchema, VerifyEmailRegistrationResponseSchema } from "@/contracts/api/email-registration";
import styles from "./LoginPanel.module.css";
import registrationStyles from "./RegistrationPanel.module.css";

interface Challenge { challengeId: string; expiresAt: number }

export function RegistrationPanel() {
  const { replace } = useRouter();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [expired, setExpired] = useState(false);
  const lock = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const errorRef = useRef<HTMLDivElement | null>(null);
  const normalizedEmail = email.trim().toLowerCase();
  const valid = /^\S+@\S+\.\S+$/u.test(normalizedEmail) && displayName.trim().length > 0;

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      try {
        const saved = sessionStorage.getItem("calenote:registration-email");
        sessionStorage.removeItem("calenote:registration-email");
        if (saved) setEmail(saved);
      } catch { /* Email can be entered manually. */ }
    });
    return () => { active = false; controller.current?.abort(); };
  }, []);
  useEffect(() => {
    if (!challenge) return;
    heading.current?.focus();
    const timer = window.setInterval(() => {
      setCooldown((remaining) => Math.max(0, remaining - 1));
      setExpired(Date.now() >= challenge.expiresAt);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [challenge]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  async function requestCode(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!valid || lock.current || cooldown > 0) return;
    lock.current = true;
    setBusy(true); setError("");
    const abort = new AbortController(); controller.current = abort;
    try {
      const value = await apiRequest<unknown>("/api/auth/register/request", {
        method: "POST", body: { email: normalizedEmail, displayName: displayName.trim() }, signal: abort.signal,
      });
      if (abort.signal.aborted) return;
      const { data: result } = RequestEmailRegistrationResponseSchema.parse({ data: value });
      setChallenge(result); setCooldown(60); setCode(""); setExpired(Date.now() >= result.expiresAt);
    } catch (cause) {
      if (!abort.signal.aborted) setError(cause instanceof AmbiguousMutationError
        ? "Chưa xác định được yêu cầu gửi mã. Hãy kiểm tra hộp thư trước khi chủ động thử lại."
        : "Chưa thể gửi mã xác minh. Vui lòng thử lại sau.");
    } finally { lock.current = false; setBusy(false); }
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!challenge || !/^[0-9]{6}$/u.test(code) || expired || lock.current) return;
    lock.current = true; setBusy(true); setError("");
    const abort = new AbortController(); controller.current = abort;
    try {
      const value = await apiRequest<unknown>("/api/auth/register/verify", {
        method: "POST", body: { challengeId: challenge.challengeId, email: normalizedEmail, code }, signal: abort.signal,
      });
      if (abort.signal.aborted) return;
      VerifyEmailRegistrationResponseSchema.parse({ data: value });
      replace("/app/connections");
    } catch (cause) {
      if (!abort.signal.aborted) setError(cause instanceof AmbiguousMutationError
        ? "Chưa xác định được kết quả xác minh. Hãy đăng nhập để kiểm tra phiên trước khi thử tiếp."
        : "Không thể xác minh mã này. Mã có thể không hợp lệ, đã hết hạn hoặc không dùng được cho đăng ký. Bạn có thể thử lại hoặc đăng nhập tài khoản đã có.");
    } finally { setCode(""); lock.current = false; setBusy(false); }
  }

  return <main className={styles.page}>
    <header className={styles.topbar}><Link href="/" aria-label="Về trang chủ Calenote"><CalenoteMark /></Link><Link href="/login">Đăng nhập</Link></header>
    <div className={styles.layout}>
      <section className={styles.story} aria-label="Cách đăng ký"><p className={styles.eyebrow}>Bắt đầu với email</p><h1>Tài khoản trước. Kết nối bot khi bạn sẵn sàng.</h1><p>Dùng Gmail hoặc địa chỉ email của bạn. Xác minh email để tạo tài khoản, sau đó thêm Telegram hoặc Zalo nếu muốn nhận nhắc lịch qua chat.</p><div className={styles.securityList}><div><ShieldCheck size={18} /><span>Chỉ tạo tài khoản sau khi xác minh mã email</span></div><div><Mail size={18} /><span>Không cần token bot để đăng ký</span></div></div></section>
      <section className={styles.card} aria-labelledby="registration-title">
        <p className={styles.eyebrow}>{challenge ? "Bước 2 · Xác minh email" : "Bước 1 · Thông tin tài khoản"}</p>
        <h2 id="registration-title" ref={heading} tabIndex={-1}>{challenge ? "Nhập mã trong email" : "Đăng ký hoặc tiếp tục bằng email đã xác minh"}</h2>
        {!challenge ? <form className={styles.form} onSubmit={requestCode}>
          <label><span>Tên bạn</span><input autoComplete="name" maxLength={80} required value={displayName} onChange={(event) => setDisplayName(event.target.value)} disabled={busy} /></label>
          <label><span>Email</span><input type="email" autoComplete="email" maxLength={254} required value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy} /></label>
          <button className={styles.primaryButton} disabled={!valid || busy}>{busy ? "Đang yêu cầu…" : "Gửi mã xác minh"}</button>
        </form> : <>
          <p className={styles.lead} role="status">Nếu email đủ điều kiện đăng ký, mã 6 số đã được gửi. Hãy kiểm tra cả thư rác. Tài khoản đã xác minh email có thể tiếp tục tại đây; tài khoản dùng bot vẫn đăng nhập qua bot.</p>
          <form className={styles.form} onSubmit={verify}>
            <label><span>Mã 6 số</span><input className={styles.codeInput} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required value={code} onChange={(event) => setCode(event.target.value.replace(/[^0-9]/gu, "").slice(0, 6))} disabled={busy || expired} aria-describedby="registration-code-note" /></label>
            <small id="registration-code-note" className={styles.fieldNote}>{expired ? "Mã đã hết hạn. Hãy yêu cầu mã mới." : "Không chia sẻ mã. Mã chỉ dùng một lần trên trình duyệt này."}</small>
            <button className={styles.primaryButton} disabled={busy || expired || !/^[0-9]{6}$/u.test(code)}>{busy ? "Đang xác minh…" : "Xác minh và tạo tài khoản"}</button>
          </form>
          <div className={registrationStyles.actions} aria-label="Tùy chọn xác minh email">
            <button type="button" className={registrationStyles.secondaryButton} onClick={() => void requestCode()} disabled={busy || cooldown > 0}>{cooldown > 0 ? `Gửi lại sau ${cooldown} giây` : "Gửi lại mã"}</button>
            <button type="button" className={registrationStyles.secondaryButton} disabled={busy} onClick={() => { setChallenge(null); setCode(""); setError(""); setCooldown(0); }}>Đổi email</button>
          </div>
        </>}
        {error ? <div className={styles.error} role="alert" tabIndex={-1} ref={errorRef}>{error}</div> : null}
        <p className={styles.newAccount}>Đã có tài khoản? <Link href="/login">Đăng nhập</Link></p>
      </section>
    </div>
  </main>;
}
