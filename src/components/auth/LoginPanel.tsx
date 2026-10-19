"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  CheckCircle2,
  KeyRound,
  Mail,
  MessageCircle,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { CalenoteMark } from "@/components/brand/CalenoteMark";
import {
  AmbiguousMutationError,
  ApiResponseError,
  apiRequest,
} from "@/lib/client-api";
import { ContinueEmailResponseSchema } from "@/contracts/api/auth-continue";
import { getDefaultAppPath } from "@/lib/appearance-preferences";
import styles from "./LoginPanel.module.css";

const GENERIC_ACCEPTED =
  "Nếu email có kết nối hợp lệ, mã 6 số đã được gửi đến cuộc chat riêng với bot.";
const SAFE_CODE_ERROR = "Mã đăng nhập không hợp lệ hoặc đã hết hạn.";

export function LoginPanel() {
  const { replace } = useRouter();
  const [entryState, setEntryState] = useState<"checking" | "login" | "error" | "redirecting">("checking");
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [submittedEmail, setSubmittedEmail] = useState("");
  const [code, setCode] = useState("");
  const [requesting, setRequesting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [recovery, setRecovery] = useState(false);
  const sessionAbortRef = useRef<AbortController | null>(null);
  const mutationAbortRef = useRef<AbortController | null>(null);
  const requestLockRef = useRef(false);
  const verifyLockRef = useRef(false);
  const bootstrapErrorRef = useRef<HTMLHeadingElement | null>(null);
  const stepHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const errorRef = useRef<HTMLDivElement | null>(null);

  const normalizedEmail = email.trim().toLowerCase();
  const emailValid = /^\S+@\S+\.\S+$/u.test(normalizedEmail);
  const codeValid = /^[0-9]{6}$/u.test(code);

  const checkSession = useCallback(() => {
    sessionAbortRef.current?.abort();
    const controller = new AbortController();
    sessionAbortRef.current = controller;
    void apiRequest("/api/session", { signal: controller.signal }).then(() => {
      if (controller.signal.aborted) return;
      setEntryState("redirecting");
      replace(getDefaultAppPath());
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      if (error instanceof ApiResponseError && error.status === 401) {
        setEntryState("login");
      } else {
        setEntryState("error");
      }
    }).finally(() => {
      if (sessionAbortRef.current === controller) sessionAbortRef.current = null;
    });
  }, [replace]);

  function retrySessionCheck() {
    setEntryState("checking");
    checkSession();
  }

  useEffect(() => {
    checkSession();
    return () => {
      sessionAbortRef.current?.abort();
      mutationAbortRef.current?.abort();
    };
  }, [checkSession]);

  useEffect(() => {
    if (entryState === "error") bootstrapErrorRef.current?.focus();
  }, [entryState]);

  useEffect(() => {
    if (step === "code") stepHeadingRef.current?.focus();
  }, [step]);

  useEffect(() => {
    if (errorMessage) errorRef.current?.focus();
  }, [errorMessage]);

  async function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!emailValid || requestLockRef.current) return;
    requestLockRef.current = true;
    setRequesting(true);
    setErrorMessage("");
    setMessage("");
    setRecovery(false);
    const controller = new AbortController();
    mutationAbortRef.current?.abort();
    mutationAbortRef.current = controller;
    let requestingCode = false;
    try {
      const submitted = normalizedEmail;
      const value = await apiRequest<unknown>("/api/auth/continue", {
        method: "POST", body: { email: submitted }, signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const { data: { next } } = ContinueEmailResponseSchema.parse({ data: value });
      if (next === "SETUP") {
        try { sessionStorage.setItem("calenote:onboarding-email", submitted); } catch { /* The user can re-enter the email if browser storage is unavailable. */ }
        replace("/onboarding");
        return;
      }
      if (next === "RECOVERY") {
        setRecovery(true);
        setErrorMessage("Email này đã có tài khoản nhưng kênh nhận mã chưa sẵn sàng. Chỉ có thể tiếp tục thiết lập với token của đúng bot đã sở hữu. Email hoặc token bot mới không cấp quyền truy cập. Nếu không còn token cũ, hiện chưa thể khôi phục tại đây.");
        return;
      }
      requestingCode = true;
      await apiRequest("/api/auth/request-code", {
        method: "POST",
        body: { email: normalizedEmail },
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setSubmittedEmail(normalizedEmail);
      setMessage(GENERIC_ACCEPTED);
      setStep("code");
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof AmbiguousMutationError && !requestingCode) {
        setErrorMessage("Chưa thể kiểm tra email. Hãy thử lại để tiếp tục; chưa yêu cầu gửi mã đăng nhập.");
      } else if (error instanceof AmbiguousMutationError) {
        setErrorMessage(
          "Không rõ yêu cầu gửi mã đã hoàn tất hay chưa. Calenote sẽ không tự gửi lại; hãy kiểm tra cuộc chat trước khi chủ động thử lần nữa.",
        );
      } else {
        setErrorMessage(error instanceof ApiResponseError ? error.message : "Chưa thể yêu cầu mã đăng nhập.");
      }
    } finally {
      requestLockRef.current = false;
      setRequesting(false);
      if (mutationAbortRef.current === controller) mutationAbortRef.current = null;
    }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!codeValid || verifyLockRef.current) return;
    verifyLockRef.current = true;
    setVerifying(true);
    setErrorMessage("");
    const submittedCode = code;
    const controller = new AbortController();
    mutationAbortRef.current?.abort();
    mutationAbortRef.current = controller;
    try {
      await apiRequest("/api/auth/verify-code", {
        method: "POST",
        body: { email: submittedEmail, code: submittedCode },
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      replace(getDefaultAppPath());
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof ApiResponseError && error.status === 401) {
        setErrorMessage(SAFE_CODE_ERROR);
      } else if (error instanceof AmbiguousMutationError) {
        setErrorMessage(
          "Kết quả đăng nhập chưa xác định. Calenote sẽ không tự gửi lại mã; hãy tải lại trang để kiểm tra phiên trước khi thử tiếp.",
        );
      } else {
        setErrorMessage(error instanceof ApiResponseError ? error.message : "Chưa thể xác nhận mã đăng nhập.");
      }
    } finally {
      setCode("");
      verifyLockRef.current = false;
      setVerifying(false);
      if (mutationAbortRef.current === controller) mutationAbortRef.current = null;
    }
  }

  function changeEmail() {
    if (requesting || verifying) return;
    setStep("email");
    setSubmittedEmail("");
    setCode("");
    setMessage("");
    setErrorMessage("");
  }

  if (entryState === "checking" || entryState === "redirecting") {
    return (
      <main className={styles.page}>
        <CalenoteMark />
        <div className={styles.stateCard} role="status" aria-live="polite">
          <span className={styles.spinnerDark} aria-hidden="true" />
          <h1>Đang kiểm tra phiên đăng nhập…</h1>
          <p>Thông tin tài khoản chưa được hiển thị trong lúc chờ.</p>
        </div>
      </main>
    );
  }

  if (entryState === "error") {
    return (
      <main className={styles.page}>
        <CalenoteMark />
        <section className={styles.stateCard}>
          <h1 ref={bootstrapErrorRef} tabIndex={-1}>Chưa thể kiểm tra phiên</h1>
          <p>Kiểm tra kết nối mạng rồi thử lại. Calenote chưa tải dữ liệu cá nhân.</p>
          <button type="button" className={styles.primaryButton} onClick={retrySessionCheck}>
            <RefreshCw size={17} /> Thử kiểm tra lại
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <Link href="/" aria-label="Về trang chủ Calenote"><CalenoteMark /></Link>
        <Link href="/docs" className={styles.docsLink}>Hướng dẫn kết nối</Link>
      </header>

      <div className={styles.layout}>
        <section className={styles.story} aria-label="Cách đăng nhập">
          <p className={styles.eyebrow}>Đăng nhập không cần mật khẩu</p>
          <h1>Mã đến từ chính bot của bạn.</h1>
          <p>Calenote gửi mã dùng một lần tới cuộc chat riêng đã kết nối. Mã có hiệu lực mười phút và chỉ dùng được một lần.</p>
          <div className={styles.securityList}>
            <div><MessageCircle size={18} /><span>Nhận mã trong cuộc chat riêng</span></div>
            <div><KeyRound size={18} /><span>Sáu chữ số, không đưa vào đường dẫn</span></div>
            <div><ShieldCheck size={18} /><span>Phiên đăng nhập được giữ bằng cookie bảo mật</span></div>
          </div>
        </section>

        <section className={styles.card} aria-labelledby="login-title">
          <div className={styles.cardIcon} aria-hidden="true">{step === "email" ? <Mail size={22} /> : <Bot size={22} />}</div>
          {step === "email" ? (
            <>
              <p className={styles.eyebrow}>Bước 1 · Email</p>
              <h2 id="login-title">Đăng nhập vào Calenote</h2>
              <p className={styles.lead}>Nhập email để tiếp tục. Email mới sẽ bắt đầu kết nối bot; tài khoản đã có bot sẽ nhận mã đăng nhập.</p>
              <form className={styles.form} onSubmit={requestCode}>
                <label>
                  <span>Email</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => { setEmail(event.target.value); setRecovery(false); setErrorMessage(""); }}
                    disabled={requesting}
                    autoComplete="email"
                    maxLength={254}
                    required
                  />
                </label>
                {errorMessage ? <div className={styles.error} role="alert" tabIndex={-1} ref={errorRef}>{errorMessage}</div> : null}
                {recovery ? <Link href="/onboarding">Tiếp tục với đúng bot đã kết nối</Link> : null}
                <button type="submit" className={styles.primaryButton} disabled={!emailValid || requesting}>
                  {requesting ? <span className={styles.spinner} aria-hidden="true" /> : <MessageCircle size={17} />}
                  {requesting ? "Đang yêu cầu…" : "Tiếp tục"}
                  {!requesting ? <ArrowRight size={17} /> : null}
                </button>
              </form>
            </>
          ) : (
            <>
              <button type="button" className={styles.backButton} onClick={changeEmail} disabled={verifying}>
                <ArrowLeft size={16} /> Đổi email
              </button>
              <p className={styles.eyebrow}>Bước 2 · Mã dùng một lần</p>
              <h2 id="login-title" ref={stepHeadingRef} tabIndex={-1}>Nhập mã đăng nhập</h2>
              <p className={styles.accepted} role="status" aria-live="polite"><CheckCircle2 size={17} />{message}</p>
              <form className={styles.form} onSubmit={verifyCode}>
                <label>
                  <span>Mã 6 số</span>
                  <input
                    className={styles.codeInput}
                    value={code}
                    onChange={(event) => setCode(event.target.value.replace(/[^0-9]/gu, "").slice(0, 6))}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    aria-describedby="code-note"
                    required
                  />
                </label>
                <small id="code-note" className={styles.fieldNote}>Không chia sẻ mã này. Mã cũ sẽ không dùng lại được sau khi đăng nhập.</small>
                {errorMessage ? <div className={styles.error} role="alert" tabIndex={-1} ref={errorRef}>{errorMessage}</div> : null}
                <button type="submit" className={styles.primaryButton} disabled={!codeValid || verifying}>
                  {verifying ? <span className={styles.spinner} aria-hidden="true" /> : <KeyRound size={17} />}
                  {verifying ? "Đang xác nhận…" : "Xác nhận đăng nhập"}
                </button>
              </form>
            </>
          )}
          <p className={styles.newAccount}>Chưa có tài khoản? <Link href="/onboarding">Kết nối bot của bạn</Link></p>
        </section>
      </div>
    </main>
  );
}
