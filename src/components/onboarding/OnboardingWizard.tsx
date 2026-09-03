"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  Clock3,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  LockKeyhole,
  MessageCircle,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UserRound,
  Webhook,
} from "lucide-react";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { BotProvider } from "@/modules/connections/contracts";
import { CalenoteMark } from "@/components/brand/CalenoteMark";
import {
  AmbiguousMutationError,
  ApiResponseError,
  apiRequest,
} from "@/lib/client-api";
import { ProgressRail } from "./ProgressRail";
import { ProviderCard } from "./ProviderCard";
import styles from "./OnboardingWizard.module.css";

const steps = ["Tài khoản", "Kênh chat", "Kích hoạt"] as const;
const stepOrder = ["account", "provider", "token"] as const;
const VIETNAM_TIMEZONE = "Asia/Ho_Chi_Minh" as const;

type WizardStep = (typeof stepOrder)[number];
type PublicConnectionState =
  | "VALIDATING"
  | "ACTIVE_UNBOUND"
  | "ACTIVE_BOUND"
  | "WEBHOOK_FAILED"
  | "SUSPENDED";

interface PublicBot {
  publicId: string;
  provider: BotProvider;
  displayName: string;
  handle: string | null;
  state: Exclude<PublicConnectionState, "VALIDATING">;
}

interface ActivationState {
  bot: PublicBot;
  connectCommand: string | null;
  expiresAt: number | null;
  confirmingBound: boolean;
  canonicalUnknown: boolean;
}

const providerGuides = {
  zalo: {
    heading: "Kết nối Zalo Bot Platform",
    sourceName: "hướng dẫn tạo Zalo bot",
    sourceUrl: "https://docs.zaloplatforms.com/docs/BOT/create_bot",
    tokenHint: "Dán token do Zalo Bot Platform cấp",
    items: [
      "Mở Zalo Bot Manager bằng tài khoản Zalo của bạn.",
      "Tạo bot riêng và sao chép Bot Token được cấp.",
      "Dán token ở đây để Calenote kiểm tra và mở đường nhận tin.",
    ],
  },
  telegram: {
    heading: "Kết nối Telegram Bot API",
    sourceName: "@BotFather",
    sourceUrl: "https://t.me/BotFather",
    tokenHint: "Dán HTTP API token do BotFather cấp",
    items: [
      "Mở @BotFather trong Telegram và gửi /newbot.",
      "Đặt tên, username rồi sao chép HTTP API token.",
      "Dán token ở đây để Calenote kiểm tra và mở đường nhận tin.",
    ],
  },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseBot(value: unknown): PublicBot {
  if (!isRecord(value)) throw new ApiResponseError(502, "INVALID_RESPONSE", "Phản hồi từ Calenote chưa hợp lệ.");
  const state = value.state;
  if (
    typeof value.publicId !== "string"
    || (value.provider !== "zalo" && value.provider !== "telegram")
    || typeof value.displayName !== "string"
    || !(value.handle === null || typeof value.handle === "string")
    || !["ACTIVE_UNBOUND", "ACTIVE_BOUND", "WEBHOOK_FAILED", "SUSPENDED"].includes(String(state))
  ) {
    throw new ApiResponseError(502, "INVALID_RESPONSE", "Phản hồi từ Calenote chưa hợp lệ.");
  }
  return value as unknown as PublicBot;
}

function parseOnboardingResult(value: unknown): ActivationState {
  if (!isRecord(value)) throw new ApiResponseError(502, "INVALID_RESPONSE", "Phản hồi từ Calenote chưa hợp lệ.");
  const command = value.connectCommand;
  const expiresAt = value.connectCodeExpiresAt;
  if (
    !(command === null || typeof command === "string")
    || !(expiresAt === null || (typeof expiresAt === "number" && Number.isSafeInteger(expiresAt)))
  ) {
    throw new ApiResponseError(502, "INVALID_RESPONSE", "Phản hồi từ Calenote chưa hợp lệ.");
  }
  const bot = parseBot(value.bot);
  return {
    bot,
    connectCommand: command,
    expiresAt,
    confirmingBound: bot.state === "ACTIVE_BOUND",
    canonicalUnknown: false,
  };
}

function parseConnections(value: unknown): PublicBot[] {
  if (!isRecord(value) || !Array.isArray(value.connections)) {
    throw new ApiResponseError(502, "INVALID_RESPONSE", "Phản hồi từ Calenote chưa hợp lệ.");
  }
  return value.connections.map(parseBot);
}

function parseRetryResult(value: unknown): ActivationState {
  if (!isRecord(value)) throw new ApiResponseError(502, "INVALID_RESPONSE", "Phản hồi từ Calenote chưa hợp lệ.");
  const command = value.connectCommand;
  const expiresAt = value.expiresAt;
  if (
    !(command === null || typeof command === "string")
    || !(expiresAt === null || (typeof expiresAt === "number" && Number.isSafeInteger(expiresAt)))
  ) {
    throw new ApiResponseError(502, "INVALID_RESPONSE", "Phản hồi từ Calenote chưa hợp lệ.");
  }
  return {
    bot: parseBot(value.connection),
    connectCommand: command,
    expiresAt,
    confirmingBound: false,
    canonicalUnknown: false,
  };
}

function parseConnectCode(value: unknown): { connectCommand: string; expiresAt: number } {
  if (
    !isRecord(value)
    || typeof value.connectCommand !== "string"
    || typeof value.expiresAt !== "number"
    || !Number.isSafeInteger(value.expiresAt)
  ) {
    throw new ApiResponseError(502, "INVALID_RESPONSE", "Phản hồi từ Calenote chưa hợp lệ.");
  }
  return { connectCommand: value.connectCommand, expiresAt: value.expiresAt };
}

function isExpired(expiresAt: number | null, now: number): boolean {
  return expiresAt === null || expiresAt <= now;
}

function formatExpiry(value: number): string {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: VIETNAM_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
  }).format(value);
}

export function OnboardingWizard() {
  const { replace } = useRouter();
  const [entryState, setEntryState] = useState<"checking" | "onboarding" | "error" | "redirecting">("checking");
  const [step, setStep] = useState<WizardStep>("account");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [provider, setProvider] = useState<BotProvider>("zalo");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [activation, setActivation] = useState<ActivationState | null>(null);
  const [resultBusy, setResultBusy] = useState<"retry" | "rotate" | "refresh" | null>(null);
  const [resultError, setResultError] = useState("");
  const [resultNotice, setResultNotice] = useState("");
  const [copied, setCopied] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const sessionAbortRef = useRef<AbortController | null>(null);
  const mutationAbortRef = useRef<AbortController | null>(null);
  const submitLockRef = useRef(false);
  const resultLockRef = useRef(false);
  const sessionErrorHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const errorRef = useRef<HTMLDivElement | null>(null);

  const accountValid = displayName.trim().length >= 1 && /^\S+@\S+\.\S+$/u.test(email.trim());
  const currentIndex = stepOrder.indexOf(step);
  const guide = providerGuides[provider];
  const commandExpired = activation
    ? isExpired(activation.expiresAt, clock)
    : true;

  const checkSession = useCallback(() => {
    sessionAbortRef.current?.abort();
    const controller = new AbortController();
    sessionAbortRef.current = controller;
    void apiRequest("/api/session", { signal: controller.signal }).then(() => {
      if (controller.signal.aborted) return;
      setEntryState("redirecting");
      replace("/dashboard");
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      if (error instanceof ApiResponseError && error.status === 401) {
        setEntryState("onboarding");
        return;
      }
      setEntryState("error");
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
    if (entryState === "error") sessionErrorHeadingRef.current?.focus();
  }, [entryState]);

  useEffect(() => {
    if (errorMessage || resultError) errorRef.current?.focus();
  }, [errorMessage, resultError]);

  useEffect(() => {
    if (!activation?.expiresAt || commandExpired) return;
    const delay = Math.min(60_000, Math.max(0, activation.expiresAt - Date.now()));
    const timer = window.setTimeout(() => setClock(Date.now()), delay);
    return () => window.clearTimeout(timer);
  }, [activation?.expiresAt, commandExpired, clock]);

  function clearPersonalState() {
    setActivation(null);
    setDisplayName("");
    setEmail("");
    setToken("");
    setResultError("");
    setResultNotice("");
    replace("/login");
  }

  async function canonicalConnectionRefresh(publicId: string): Promise<PublicBot | null> {
    const data = await apiRequest<unknown>("/api/connections", {
      authenticated: true,
      onUnauthorized: clearPersonalState,
    });
    return parseConnections(data).find((connection) => connection.publicId === publicId) ?? null;
  }

  async function confirmCanonicalBound(result: ActivationState) {
    try {
      const canonical = await canonicalConnectionRefresh(result.bot.publicId);
      if (!canonical) {
        setActivation({ ...result, confirmingBound: false, canonicalUnknown: true });
        setResultError("Không tìm thấy kết nối vừa kích hoạt. Hãy đăng nhập lại để kiểm tra.");
        return;
      }
      setActivation({
        bot: canonical,
        connectCommand: canonical.state === "ACTIVE_UNBOUND" ? result.connectCommand : null,
        expiresAt: canonical.state === "ACTIVE_UNBOUND" ? result.expiresAt : null,
        confirmingBound: false,
        canonicalUnknown: false,
      });
    } catch (error) {
      if (error instanceof ApiResponseError && error.status === 401) return;
      setActivation({ ...result, confirmingBound: false, canonicalUnknown: true });
      setResultError("Chưa thể xác nhận trạng thái kết nối. Mở trang tổng quan sau khi đăng nhập để kiểm tra lại.");
    }
  }

  async function submitOnboarding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || submitLockRef.current) return;
    submitLockRef.current = true;
    setSubmitting(true);
    setErrorMessage("");
    setResultError("");
    const submittedToken = token;
    const controller = new AbortController();
    mutationAbortRef.current?.abort();
    mutationAbortRef.current = controller;
    try {
      const value = await apiRequest<unknown>("/api/onboarding", {
        method: "POST",
        body: {
          displayName: displayName.trim(),
          email: email.trim().toLowerCase(),
          timezone: VIETNAM_TIMEZONE,
          provider,
          token: submittedToken,
        },
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const result = parseOnboardingResult(value);
      setActivation(result);
      setClock(Date.now());
      if (result.confirmingBound) await confirmCanonicalBound(result);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof AmbiguousMutationError) {
        setErrorMessage(
          "Kết quả chưa xác định vì kết nối bị gián đoạn. Tài khoản có thể đã được tạo; hãy nhập lại cùng email và token để Calenote khôi phục an toàn.",
        );
      } else if (error instanceof ApiResponseError) {
        setErrorMessage(error.message);
      } else {
        setErrorMessage("Calenote chưa thể kích hoạt bot. Hãy kiểm tra thông tin và thử lại.");
      }
    } finally {
      setToken("");
      setShowToken(false);
      setSubmitting(false);
      submitLockRef.current = false;
      if (mutationAbortRef.current === controller) mutationAbortRef.current = null;
    }
  }

  async function runResultMutation(kind: "retry" | "rotate" | "refresh") {
    if (!activation || resultLockRef.current) return;
    resultLockRef.current = true;
    setResultBusy(kind);
    setResultError("");
    setResultNotice("");
    try {
      if (kind === "refresh") {
        const canonical = await canonicalConnectionRefresh(activation.bot.publicId);
        if (!canonical) {
          setResultError("Không tìm thấy kết nối này trong tài khoản.");
          return;
        }
        setActivation((current) => current ? {
          ...current,
          bot: canonical,
          connectCommand: canonical.state === "ACTIVE_UNBOUND" ? current.connectCommand : null,
          expiresAt: canonical.state === "ACTIVE_UNBOUND" ? current.expiresAt : null,
          confirmingBound: false,
          canonicalUnknown: false,
        } : current);
        setResultNotice(
          canonical.state === "ACTIVE_BOUND"
            ? "Đã xác nhận cuộc chat riêng."
            : "Chưa thấy cuộc chat được kết nối. Hãy gửi đúng lệnh cho bot rồi kiểm tra lại.",
        );
      } else if (kind === "retry") {
        const value = await apiRequest<unknown>(
          `/api/connections/${activation.bot.publicId}/webhook-retry`,
          {
            method: "POST",
            body: {},
            authenticated: true,
            onUnauthorized: clearPersonalState,
          },
        );
        const result = parseRetryResult(value);
        setActivation(result);
        setClock(Date.now());
      } else {
        const value = await apiRequest<unknown>(
          `/api/connections/${activation.bot.publicId}/connect-code`,
          {
            method: "POST",
            body: {},
            authenticated: true,
            onUnauthorized: clearPersonalState,
          },
        );
        const result = parseConnectCode(value);
        setActivation((current) => current ? {
          ...current,
          connectCommand: result.connectCommand,
          expiresAt: result.expiresAt,
        } : current);
        setClock(Date.now());
      }
    } catch (error) {
      if (error instanceof ApiResponseError && error.status === 401) return;
      if (error instanceof AmbiguousMutationError) {
        setResultError("Kết quả thao tác chưa xác định. Calenote sẽ không tự gửi lại; hãy kiểm tra trạng thái trước khi thử lần nữa.");
      } else {
        setResultError(error instanceof ApiResponseError ? error.message : "Chưa thể hoàn tất thao tác.");
      }
    } finally {
      resultLockRef.current = false;
      setResultBusy(null);
    }
  }

  async function copyCommand() {
    if (!activation?.connectCommand || commandExpired) return;
    try {
      await navigator.clipboard.writeText(activation.connectCommand);
      setCopied(true);
    } catch {
      setResultError("Trình duyệt chưa cho phép sao chép. Hãy chọn và sao chép lệnh thủ công.");
    }
  }

  if (entryState === "checking" || entryState === "redirecting") {
    return (
      <main className={styles.sessionPage}>
        <CalenoteMark />
        <div className={styles.sessionCard} role="status" aria-live="polite">
          <span className={styles.loader} aria-hidden="true" />
          <h1>Đang kiểm tra phiên đăng nhập…</h1>
          <p>Calenote chưa hiển thị thông tin cá nhân trong lúc chờ.</p>
        </div>
      </main>
    );
  }

  if (entryState === "error") {
    return (
      <main className={styles.sessionPage}>
        <CalenoteMark />
        <section className={styles.sessionCard}>
          <h1 ref={sessionErrorHeadingRef} tabIndex={-1}>Chưa thể kiểm tra phiên</h1>
          <p>Kiểm tra kết nối mạng rồi thử lại. Calenote chưa tải bất kỳ dữ liệu cá nhân nào.</p>
          <button type="button" className={styles.primaryButton} onClick={retrySessionCheck}>
            <RefreshCw size={17} />
            Thử kiểm tra lại
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <section className={styles.storyPanel} aria-label="Calenote hoạt động như thế nào">
        <div className={styles.storyTop}>
          <CalenoteMark inverse />
          <Link href="/login" className={styles.loginLink}>Đăng nhập</Link>
        </div>

        <div className={styles.storyCopy}>
          <p className={styles.eyebrow}>Lịch bắt đầu từ một câu chat</p>
          <h1>Nói việc cần nhớ.<br /><em>Calenote nhắc đúng lúc.</em></h1>
          <p>
            Dùng bot Zalo hoặc Telegram do chính bạn sở hữu để tạo lời nhắc riêng tư,
            xác nhận ngay trong chat và nhận tin quanh phút đã hẹn.
          </p>
        </div>

        <div className={styles.chatPreview} aria-label="Ví dụ quy trình xác nhận trong chat">
          <p className={styles.previewBoundary}>Ví dụ cách hoạt động</p>
          <div className={styles.chatUser}>Mai 8h nhắc tôi chuẩn bị cuộc hẹn</div>
          <div className={styles.chatBot}>
            <span className={styles.miniBot} aria-hidden="true"><Sparkles size={14} /></span>
            <div>
              <span>Mình hiểu: 08:00 ngày mai</span>
              <strong>Trả lời “có” để xác nhận hoặc “hủy” để bỏ.</strong>
            </div>
          </div>
          <div className={styles.chatUser}>có</div>
          <div className={styles.chatBot}>
            <span className={styles.miniBot} aria-hidden="true"><Check size={14} /></span>
            <div><strong>Đã đặt lịch. Mình sẽ gửi quanh phút đã hẹn.</strong></div>
            <CheckCircle2 size={18} />
          </div>
        </div>

        <div className={styles.storyFooter}>
          <ShieldCheck size={17} />
          Bot token được mã hóa khi lưu để Calenote có thể tiếp tục vận hành bot của bạn.
        </div>
      </section>

      <section className={styles.workspace} aria-label="Thiết lập tài khoản">
        <div className={styles.mobileBrand}>
          <CalenoteMark compact />
          <Link href="/login">Đăng nhập</Link>
        </div>

        {!activation && <ProgressRail currentIndex={currentIndex} steps={steps} />}

        <div className={styles.card}>
          {!activation && step !== "account" && (
            <button
              type="button"
              className={styles.backButton}
              onClick={() => {
                if (submitting) return;
                setStep(stepOrder[Math.max(0, currentIndex - 1)]);
                setErrorMessage("");
              }}
              disabled={submitting}
            >
              <ArrowLeft size={16} /> Quay lại
            </button>
          )}

          {!activation && step === "account" && (
            <section className={styles.stepContent}>
              <StepHeader
                icon={<UserRound size={20} />}
                kicker="Bước 1 · Tài khoản"
                title="Tạo không gian Calenote của bạn"
                description="Một tài khoản cá nhân, một múi giờ Việt Nam và một bot do bạn sở hữu."
              />
              <form className={styles.form} aria-label="Thông tin tài khoản" onSubmit={(event) => {
                event.preventDefault();
                if (accountValid) setStep("provider");
              }}>
                <label className={styles.field}>
                  <span>Tên bạn</span>
                  <input
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    autoComplete="name"
                    maxLength={80}
                    required
                  />
                </label>
                <label className={styles.field}>
                  <span>Email</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="email"
                    maxLength={254}
                    required
                  />
                </label>
                <div className={styles.timezoneCard}>
                  <Clock3 size={18} aria-hidden="true" />
                  <div><strong>Múi giờ</strong><span>Việt Nam · GMT+7</span></div>
                </div>
                <PrimaryButton disabled={!accountValid} label="Chọn kênh chat" />
              </form>
            </section>
          )}

          {!activation && step === "provider" && (
            <section className={styles.stepContent}>
              <StepHeader
                icon={<MessageCircle size={20} />}
                kicker="Bước 2 · Kênh chat"
                title="Chọn bot bạn đang sở hữu"
                description="Calenote hỗ trợ trò chuyện riêng qua Zalo Bot Platform và Telegram Bot API."
              />
              <fieldset className={styles.choiceFieldset}>
                <legend className={styles.visuallyHidden}>Chọn nền tảng bot</legend>
                <div className={styles.providerList}>
                  <ProviderCard provider="zalo" selected={provider === "zalo"} onSelect={() => setProvider("zalo")} />
                  <ProviderCard provider="telegram" selected={provider === "telegram"} onSelect={() => setProvider("telegram")} />
                </div>
              </fieldset>
              <div className={styles.callout}>
                <ShieldCheck size={18} />
                <div><strong>Bot của riêng bạn</strong><span>Calenote không dùng bot chung và không tạo bot thay bạn.</span></div>
              </div>
              <button type="button" className={styles.primaryButton} onClick={() => setStep("token")}>
                Nhập bot token <ArrowRight size={17} />
              </button>
            </section>
          )}

          {!activation && step === "token" && (
            <section className={styles.stepContent}>
              <StepHeader
                icon={<KeyRound size={20} />}
                kicker="Bước 3 · Kích hoạt"
                title={guide.heading}
                description="Một yêu cầu duy nhất sẽ kiểm tra token, tạo tài khoản, mã hóa token khi lưu và mở đường nhận tin."
              />
              <ol className={styles.guideList}>
                {guide.items.map((item, index) => <li key={item}><span>{index + 1}</span><p>{item}</p></li>)}
              </ol>
              <a href={guide.sourceUrl} className={styles.officialLink} target="_blank" rel="noreferrer">
                Mở {guide.sourceName} <ExternalLink size={15} />
              </a>
              <form className={styles.form} onSubmit={submitOnboarding} aria-label="Kích hoạt bot">
                <div className={styles.field}>
                  <label htmlFor="bot-token">Bot token</label>
                  <span className={styles.secretInput}>
                    <LockKeyhole size={17} aria-hidden="true" />
                    <input
                      id="bot-token"
                      type={showToken ? "text" : "password"}
                      value={token}
                      onChange={(event) => setToken(event.target.value)}
                      placeholder={guide.tokenHint}
                      autoComplete="off"
                      spellCheck={false}
                      maxLength={512}
                      required
                      aria-describedby="token-note"
                    />
                    <button type="button" onClick={() => setShowToken((visible) => !visible)} aria-label={showToken ? "Ẩn token" : "Hiện token"}>
                      {showToken ? <EyeOff size={17} /> : <Eye size={17} />}
                    </button>
                  </span>
                  <small id="token-note">Token được gửi đúng một lần trong thao tác này và luôn được xóa khỏi biểu mẫu khi yêu cầu kết thúc.</small>
                </div>
                {errorMessage && <div className={styles.errorMessage} role="alert" tabIndex={-1} ref={errorRef}>{errorMessage}</div>}
                <PrimaryButton disabled={!token || submitting} label={submitting ? "Đang kích hoạt…" : "Kích hoạt bot"} loading={submitting} />
              </form>
            </section>
          )}

          {activation && (
            <ActivationPanel
              activation={activation}
              busy={resultBusy}
              commandExpired={commandExpired}
              copied={copied}
              error={resultError}
              notice={resultNotice}
              errorRef={errorRef}
              onCopy={() => void copyCommand()}
              onAction={(kind) => void runResultMutation(kind)}
            />
          )}
        </div>

        <div className={styles.workspaceFooter}><Clock3 size={15} /> Múi giờ: Asia/Ho_Chi_Minh</div>
      </section>
    </main>
  );
}

function StepHeader({ icon, kicker, title, description }: {
  icon: ReactNode;
  kicker: string;
  title: string;
  description: string;
}) {
  return (
    <header className={styles.stepHeader}>
      <span className={styles.stepIcon} aria-hidden="true">{icon}</span>
      <p className={styles.kicker}>{kicker}</p>
      <h2>{title}</h2>
      <p>{description}</p>
    </header>
  );
}

function PrimaryButton({ disabled, label, loading = false }: {
  disabled: boolean;
  label: string;
  loading?: boolean;
}) {
  return (
    <button type="submit" className={styles.primaryButton} disabled={disabled}>
      {loading ? <span className={styles.spinner} aria-hidden="true" /> : null}
      {label}
      {!loading ? <ArrowRight size={17} /> : null}
    </button>
  );
}

function ActivationPanel({
  activation,
  busy,
  commandExpired,
  copied,
  error,
  notice,
  errorRef,
  onCopy,
  onAction,
}: {
  activation: ActivationState;
  busy: "retry" | "rotate" | "refresh" | null;
  commandExpired: boolean;
  copied: boolean;
  error: string;
  notice: string;
  errorRef: React.RefObject<HTMLDivElement | null>;
  onCopy: () => void;
  onAction: (kind: "retry" | "rotate" | "refresh") => void;
}) {
  const { bot } = activation;
  if (activation.confirmingBound) {
    return (
      <section className={`${styles.stepContent} ${styles.readyContent}`}>
        <span className={styles.readyMark} aria-hidden="true"><RefreshCw size={26} /></span>
        <div role="status" aria-live="polite">
          <p className={styles.kicker}>Đã nhận phản hồi kích hoạt</p>
          <h2>Đang xác nhận trạng thái kết nối…</h2>
          <p className={styles.readyLead}>Calenote đang đọc lại trạng thái đã lưu trước khi hiển thị cuộc chat của bạn.</p>
        </div>
      </section>
    );
  }

  if (activation.canonicalUnknown) {
    return (
      <section className={`${styles.stepContent} ${styles.readyContent}`}>
        <span className={styles.readyMark} aria-hidden="true"><RefreshCw size={26} /></span>
        <p className={styles.kicker}>Cần kiểm tra lại</p>
        <h2>Chưa xác nhận được kết nối</h2>
        <p className={styles.readyLead}>Calenote chưa đọc được trạng thái đã lưu nên không kết luận bot đã kết nối hay bị tạm dừng.</p>
        {error ? <div className={styles.errorMessage} role="alert" tabIndex={-1} ref={errorRef}>{error}</div> : null}
        <button type="button" className={styles.primaryButton} disabled={busy !== null} onClick={() => onAction("refresh")}>
          {busy === "refresh" ? <span className={styles.spinner} /> : <RefreshCw size={17} />}
          Kiểm tra lại trạng thái
        </button>
        <div className={styles.resultLinks}>
          <Link href="/dashboard" className={styles.textLink}>Mở trang tổng quan <ArrowRight size={15} /></Link>
          <Link href="/docs" className={styles.textLink}>Xem hướng dẫn kết nối</Link>
        </div>
      </section>
    );
  }

  const heading = bot.state === "ACTIVE_UNBOUND"
    ? "Kết nối cuộc chat riêng"
    : bot.state === "ACTIVE_BOUND"
      ? "Cuộc chat riêng đã kết nối"
      : bot.state === "WEBHOOK_FAILED"
        ? "Đường nhận tin chưa được kích hoạt"
        : "Kết nối đã tạm dừng";

  return (
    <section className={`${styles.stepContent} ${styles.readyContent}`}>
      <span className={styles.readyMark} aria-hidden="true">
        {bot.state === "ACTIVE_BOUND" ? <Check size={28} /> : bot.state === "ACTIVE_UNBOUND" ? <Bot size={28} /> : <Webhook size={28} />}
      </span>
      <p className={styles.kicker}>{bot.provider === "zalo" ? "Zalo Bot Platform" : "Telegram Bot API"}</p>
      <h2>{heading}</h2>
      <div className={styles.botIdentity}>
        <strong>{bot.displayName}</strong>
        {bot.handle ? <span>{bot.handle}</span> : null}
      </div>

      {bot.state === "ACTIVE_UNBOUND" && (
        <>
          <p className={styles.readyLead}>Gửi lệnh dưới đây trong cuộc trò chuyện riêng với bot. Mã chỉ dùng một lần.</p>
          {!commandExpired && activation.connectCommand && activation.expiresAt ? (
            <div className={styles.commandBox}>
              <code>{activation.connectCommand}</code>
              <button type="button" onClick={onCopy} aria-label="Sao chép lệnh kết nối"><Copy size={17} /></button>
              <small>Hết hạn lúc {formatExpiry(activation.expiresAt)}</small>
            </div>
          ) : (
            <div className={styles.expiredNotice}>Mã kết nối đã hết hạn và không còn được hiển thị.</div>
          )}
          {copied ? <p className={styles.successMessage} role="status">Đã sao chép lệnh kết nối.</p> : null}
          <div className={styles.privateSteps}>
            <div><span>1</span><p><strong>Mở bot của bạn</strong><small>Dùng cuộc trò chuyện riêng, không dùng nhóm.</small></p></div>
            <div><span>2</span><p><strong>Gửi nguyên lệnh một lần</strong><small>Không chia sẻ mã với người khác.</small></p></div>
            <div><span>3</span><p><strong>Quay lại kiểm tra</strong><small>Calenote chỉ báo đã kết nối sau khi đọc lại trạng thái.</small></p></div>
          </div>
          {commandExpired ? (
            <button type="button" className={styles.primaryButton} disabled={busy !== null} onClick={() => onAction("rotate")}>
              {busy === "rotate" ? <span className={styles.spinner} /> : <RefreshCw size={17} />}
              Tạo mã kết nối mới
            </button>
          ) : (
            <button type="button" className={styles.primaryButton} disabled={busy !== null} onClick={() => onAction("refresh")}>
              {busy === "refresh" ? <span className={styles.spinner} /> : <RefreshCw size={17} />}
              Kiểm tra trạng thái kết nối
            </button>
          )}
        </>
      )}

      {bot.state === "ACTIVE_BOUND" && (
        <p className={styles.readyLead}>Bot đã nhận diện cuộc trò chuyện riêng. Bạn có thể tạo và quản lý lời nhắc trong dashboard.</p>
      )}

      {bot.state === "WEBHOOK_FAILED" && (
        <>
          <p className={styles.readyLead}>Tài khoản và token mã hóa đã được lưu, nhưng nền tảng bot chưa xác nhận đường nhận tin. Chưa có mã kết nối nào được phát hành.</p>
          <button type="button" className={styles.primaryButton} disabled={busy !== null} onClick={() => onAction("retry")}>
            {busy === "retry" ? <span className={styles.spinner} /> : <RefreshCw size={17} />}
            Thử mở lại đường nhận tin
          </button>
        </>
      )}

      {bot.state === "SUSPENDED" && (
        <p className={styles.readyLead}>Nền tảng bot không còn chấp nhận token. Hãy kiểm tra lại token tại nền tảng bot; Calenote chưa hỗ trợ đổi token tại trang tổng quan.</p>
      )}

      {error ? <div className={styles.errorMessage} role="alert" tabIndex={-1} ref={errorRef}>{error}</div> : null}
      {notice ? <p className={styles.successMessage} role="status" aria-live="polite">{notice}</p> : null}

      <div className={styles.resultLinks}>
        <Link href="/dashboard" className={styles.textLink}>Mở trang tổng quan <ArrowRight size={15} /></Link>
        <Link href="/docs" className={styles.textLink}>Xem hướng dẫn kết nối</Link>
      </div>
    </section>
  );
}
