"use client";

import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  LockKeyhole,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  UserRound,
  UsersRound,
  Webhook,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { BotProfile, BotProvider } from "@/modules/connections/contracts";
import { CalenoteMark } from "@/components/brand/CalenoteMark";
import { ProgressRail } from "./ProgressRail";
import { ProviderCard } from "./ProviderCard";
import styles from "./OnboardingWizard.module.css";

const steps = ["Tài khoản", "Kênh chat", "Kết nối bot", "Phạm vi", "Hoàn tất"] as const;
type WizardStep = "account" | "provider" | "token" | "scope" | "ready";
type Scope = "personal" | "group";

const stepOrder: WizardStep[] = ["account", "provider", "token", "scope", "ready"];

const providerGuides = {
  zalo: {
    heading: "Kết nối bot Zalo",
    sourceName: "Zalo Bot Manager",
    sourceUrl: "https://bot.zapps.me/",
    tokenHint: "Ví dụ: 12345678:abc-xyz",
    items: [
      "Mở Zalo Bot Manager trong ứng dụng Zalo.",
      "Chọn Bot Creator, tạo bot và đặt tên thư ký.",
      "Sao chép token rồi dán vào ô bên dưới.",
    ],
  },
  telegram: {
    heading: "Kết nối bot Telegram",
    sourceName: "@BotFather",
    sourceUrl: "https://t.me/BotFather",
    tokenHint: "Ví dụ: 123456789:AA...",
    items: [
      "Mở @BotFather trong Telegram.",
      "Gửi /newbot, đặt tên và username cho bot.",
      "Sao chép HTTP API token rồi dán vào ô bên dưới.",
    ],
  },
} as const;

interface VerifySuccess {
  data: { bot: BotProfile };
  meta: { tokenStored: false };
}

interface VerifyFailure {
  error?: { code?: string; message?: string };
}

export function OnboardingWizard() {
  const [step, setStep] = useState<WizardStep>("account");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [timezone, setTimezone] = useState("Asia/Ho_Chi_Minh");
  const [provider, setProvider] = useState<BotProvider>("zalo");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [bot, setBot] = useState<BotProfile | null>(null);
  const [scope, setScope] = useState<Scope>("personal");
  const [verifyState, setVerifyState] = useState<"idle" | "loading" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const requestAbortRef = useRef<AbortController | null>(null);

  const currentIndex = stepOrder.indexOf(step);
  const accountValid = name.trim().length >= 2 && /^\S+@\S+\.\S+$/.test(email);
  const guide = providerGuides[provider];
  const shortName = useMemo(() => name.trim().split(/\s+/).slice(-1)[0] || "bạn", [name]);

  useEffect(() => {
    return () => requestAbortRef.current?.abort();
  }, []);

  function selectProvider(nextProvider: BotProvider) {
    if (nextProvider !== provider) {
      requestAbortRef.current?.abort();
      requestAbortRef.current = null;
      setToken("");
      setBot(null);
      setScope("personal");
      setVerifyState("idle");
      setErrorMessage("");
    }
    setProvider(nextProvider);
  }

  function goBack() {
    if (verifyState === "loading") return;
    const previous = stepOrder[Math.max(0, currentIndex - 1)];
    setStep(previous);
    setErrorMessage("");
  }

  async function verifyToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || verifyState === "loading") return;

    setVerifyState("loading");
    setErrorMessage("");
    requestAbortRef.current?.abort();
    const controller = new AbortController();
    requestAbortRef.current = controller;
    const requestedProvider = provider;

    try {
      const response = await fetch("/api/v1/bot-connections/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: requestedProvider, token }),
        signal: controller.signal,
      });
      const payload = (await response.json()) as VerifySuccess | VerifyFailure;

      if (controller.signal.aborted) return;

      if (!response.ok || !("data" in payload) || !payload.data?.bot) {
        const message =
          "error" in payload && payload.error?.message
            ? payload.error.message
            : "Không thể xác minh token lúc này. Hãy thử lại.";
        setVerifyState("error");
        setErrorMessage(message);
        return;
      }

      if (payload.data.bot.provider !== requestedProvider) {
        setVerifyState("error");
        setErrorMessage("Kết quả xác minh không khớp kênh đã chọn. Hãy thử lại.");
        return;
      }

      setScope("personal");
      setBot(payload.data.bot);
      setToken("");
      setVerifyState("idle");
      setStep("scope");
    } catch {
      if (controller.signal.aborted) return;
      setVerifyState("error");
      setErrorMessage("Mất kết nối đến Calenote. Kiểm tra mạng rồi thử lại.");
    } finally {
      if (requestAbortRef.current === controller) {
        requestAbortRef.current = null;
      }
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.storyPanel} aria-label="Giới thiệu Calenote">
        <div className={styles.storyTop}>
          <CalenoteMark inverse />
          <span className={styles.foundationPill}>Foundation v0.1</span>
        </div>

        <div className={styles.storyCopy}>
          <p className={styles.eyebrow}>Lịch bắt đầu từ một câu chat</p>
          <h1>
            Nói việc cần nhớ.
            <br />
            <em>Calenote lo phần còn lại.</em>
          </h1>
          <p>
            Dùng chính bot Zalo hoặc Telegram của bạn làm thư ký cá nhân — gần gũi,
            riêng tư và luôn đúng giờ.
          </p>
        </div>

        <div className={styles.chatPreview} aria-label="Ví dụ hội thoại">
          <p className={styles.previewBoundary}>
            Minh họa · Chat và nhắc lịch chưa hoạt động trong v0.1
          </p>
          <div className={styles.chatUser}>Mai 8h nhắc tui gọi cho mẹ nha</div>
          <div className={styles.chatBot}>
            <span className={styles.miniBot} aria-hidden="true">
              <Sparkles size={14} />
            </span>
            <div>
              <span>Đã ghi lại</span>
              <strong>Gọi cho mẹ · 08:00 ngày mai</strong>
            </div>
            <CheckCircle2 size={18} />
          </div>
        </div>

        <div className={styles.storyFooter}>
          <ShieldCheck size={17} />
          Token được gửi thẳng đến server để kiểm tra và không được lưu trong bản này.
        </div>
      </section>

      <section className={styles.workspace}>
        <div className={styles.mobileBrand}>
          <CalenoteMark compact />
          <span>{currentIndex + 1}/{steps.length}</span>
        </div>

        <ProgressRail currentIndex={currentIndex} steps={steps} />

        <div className={styles.card}>
          {step !== "account" && (
            <button
              type="button"
              className={styles.backButton}
              onClick={goBack}
              disabled={verifyState === "loading"}
            >
              <ArrowLeft size={16} />
              Quay lại
            </button>
          )}

          {step === "account" && (
            <section className={styles.stepContent}>
              <StepHeader
                icon={<UserRound size={20} />}
                kicker="Bước 1 · Tài khoản"
                title="Thiết lập Calenote của bạn"
                description="Thông tin này định hình múi giờ và cách thư ký gọi bạn. Đăng nhập thật sẽ được bổ sung ở phase production."
              />

              <form
                className={styles.form}
                onSubmit={(event) => {
                  event.preventDefault();
                  if (accountValid) setStep("provider");
                }}
              >
                <label className={styles.field}>
                  <span>Tên hiển thị</span>
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Ví dụ: Bích Tuyền"
                    autoComplete="name"
                  />
                </label>

                <label className={styles.field}>
                  <span>Email</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="ban@example.com"
                    autoComplete="email"
                  />
                </label>

                <label className={styles.field}>
                  <span>Múi giờ</span>
                  <select value={timezone} onChange={(event) => setTimezone(event.target.value)}>
                    <option value="Asia/Ho_Chi_Minh">Việt Nam · GMT+7</option>
                    <option value="Asia/Bangkok">Bangkok · GMT+7</option>
                    <option value="Asia/Singapore">Singapore · GMT+8</option>
                    <option value="Asia/Tokyo">Tokyo · GMT+9</option>
                  </select>
                </label>

                <PrimaryButton disabled={!accountValid} label="Tiếp tục chọn kênh" />
              </form>
            </section>
          )}

          {step === "provider" && (
            <section className={styles.stepContent}>
              <StepHeader
                icon={<MessageCircle size={20} />}
                kicker="Bước 2 · Kênh chat"
                title="Bạn muốn chat ở đâu?"
                description="Mỗi workspace dùng bot do chính bạn tạo và sở hữu. Bạn có thể thêm kênh khác sau."
              />

              <fieldset className={styles.choiceFieldset}>
                <legend className={styles.visuallyHidden}>Chọn kênh bot</legend>
                <div className={styles.providerList}>
                <ProviderCard
                  provider="zalo"
                  selected={provider === "zalo"}
                  onSelect={() => selectProvider("zalo")}
                />
                <ProviderCard
                  provider="telegram"
                  selected={provider === "telegram"}
                  onSelect={() => selectProvider("telegram")}
                />
                </div>
              </fieldset>

              <div className={styles.callout}>
                <ShieldCheck size={18} />
                <div>
                  <strong>Bring Your Own Bot</strong>
                  <span>Calenote không dùng bot chung. Token và danh tính bot thuộc về bạn.</span>
                </div>
              </div>

              <button
                type="button"
                className={styles.primaryButton}
                onClick={() => setStep("token")}
              >
                Tiếp tục nhập token
                <ArrowRight size={17} />
              </button>
            </section>
          )}

          {step === "token" && (
            <section className={styles.stepContent}>
              <StepHeader
                icon={<KeyRound size={20} />}
                kicker="Bước 3 · Xác minh quyền sở hữu"
                title={guide.heading}
                description="Tạo bot ở nền tảng chính thức, rồi đưa token cho Calenote kiểm tra bằng getMe."
              />

              <ol className={styles.guideList}>
                {guide.items.map((item, index) => (
                  <li key={item}>
                    <span>{index + 1}</span>
                    <p>{item}</p>
                  </li>
                ))}
              </ol>

              <a
                href={guide.sourceUrl}
                className={styles.officialLink}
                target="_blank"
                rel="noreferrer"
              >
                Mở {guide.sourceName}
                <ExternalLink size={15} />
              </a>

              <form className={styles.form} onSubmit={verifyToken}>
                <div className={styles.field}>
                  <label htmlFor="bot-token">Bot token</label>
                  <span className={styles.secretInput}>
                    <LockKeyhole size={17} aria-hidden="true" />
                    <input
                      id="bot-token"
                      type={showToken ? "text" : "password"}
                      value={token}
                      onChange={(event) => setToken(event.target.value.trim())}
                      placeholder={guide.tokenHint}
                      autoComplete="off"
                      spellCheck={false}
                      aria-describedby="token-note"
                    />
                    <button
                      type="button"
                      onClick={() => setShowToken((visible) => !visible)}
                      aria-label={showToken ? "Ẩn token" : "Hiện token"}
                    >
                      {showToken ? <EyeOff size={17} /> : <Eye size={17} />}
                    </button>
                  </span>
                  <small id="token-note">
                    Chỉ dùng một lần để gọi API provider. v0.1 không lưu token.
                  </small>
                </div>

                {errorMessage && (
                  <div className={styles.errorMessage} role="alert">
                    {errorMessage}
                  </div>
                )}

                <PrimaryButton
                  disabled={!token || verifyState === "loading"}
                  label={verifyState === "loading" ? "Đang xác minh…" : "Xác minh token"}
                  loading={verifyState === "loading"}
                />
              </form>
            </section>
          )}

          {step === "scope" && bot && (
            <section className={styles.stepContent}>
              <StepHeader
                icon={<UsersRound size={20} />}
                kicker="Bước 4 · Phạm vi sử dụng"
                title={`Chào ${shortName}, bot của bạn đây rồi`}
                description="Chọn nơi bot được phép xử lý lịch. Cá nhân là lựa chọn an toàn mặc định."
              />

              <div className={styles.verifiedBot}>
                <span className={styles.botAvatar} aria-hidden="true">
                  <Bot size={24} />
                </span>
                <div>
                  <span>Đã xác minh qua {bot.provider === "zalo" ? "Zalo" : "Telegram"}</span>
                  <strong>{bot.displayName}</strong>
                  {bot.handle && <small>{bot.handle}</small>}
                </div>
                <CheckCircle2 size={22} className={styles.successIcon} />
              </div>

              <fieldset className={styles.choiceFieldset}>
                <legend className={styles.visuallyHidden}>Chọn phạm vi sử dụng</legend>
                <div className={styles.scopeGrid}>
                <label
                  className={`${styles.scopeCard} ${scope === "personal" ? styles.scopeSelected : ""}`}
                >
                  <input
                    type="radio"
                    name="bot-scope"
                    value="personal"
                    checked={scope === "personal"}
                    onChange={() => setScope("personal")}
                    className={styles.choiceInput}
                    aria-label="Dùng cho lịch cá nhân"
                  />
                  <span className={styles.scopeIcon}><UserRound size={20} /></span>
                  <strong>Dùng cho lịch cá nhân</strong>
                  <small>Chỉ xử lý tin nhắn trực tiếp của bạn.</small>
                  {scope === "personal" && <Check size={16} className={styles.scopeCheck} />}
                </label>
                <label
                  className={`${styles.scopeCard} ${scope === "group" ? styles.scopeSelected : ""}`}
                >
                  <input
                    type="radio"
                    name="bot-scope"
                    value="group"
                    checked={scope === "group"}
                    onChange={() => setScope("group")}
                    disabled={bot.canJoinGroups !== true}
                    className={styles.choiceInput}
                    aria-label="Dùng trong nhóm"
                  />
                  <span className={styles.scopeIcon}><UsersRound size={20} /></span>
                  <strong>Dùng trong nhóm</strong>
                  <small>
                    {bot.canJoinGroups !== true
                      ? "Bot này không được provider cho phép vào nhóm."
                      : bot.provider === "zalo"
                        ? "Zalo group hiện đang Beta."
                        : "Chỉ phản hồi khi được gọi."}
                  </small>
                  <span className={styles.betaBadge}>Beta</span>
                  {scope === "group" && <Check size={16} className={styles.scopeCheck} />}
                </label>
                </div>
              </fieldset>

              <button
                type="button"
                className={styles.primaryButton}
                onClick={() => setStep("ready")}
              >
                Hoàn tất thiết lập
                <ArrowRight size={17} />
              </button>
            </section>
          )}

          {step === "ready" && bot && (
            <section className={`${styles.stepContent} ${styles.readyContent}`}>
              <span className={styles.readyMark} aria-hidden="true">
                <Check size={28} strokeWidth={2.7} />
              </span>
              <p className={styles.kicker}>Foundation đã sẵn sàng</p>
              <h2>Bot đã được xác minh</h2>
              <p className={styles.readyLead}>
                Calenote nhận diện được <strong>{bot.displayName}</strong>. Token vừa nhập không được lưu.
              </p>

              <div className={styles.boundaryNotice}>
                <Webhook size={19} />
                <div>
                  <strong>Webhook chưa bật</strong>
                  <span>Deploy HTTPS + kho secret là bước bắt buộc trước khi chat thật.</span>
                </div>
              </div>

              <div className={styles.pipeline}>
                <PipelineItem icon={<UserRound size={17} />} label="Tài khoản Calenote" status="Đã nhập" done />
                <PipelineItem icon={<Bot size={17} />} label="Xác minh bot" status="Hoàn tất" done />
                <PipelineItem icon={<Webhook size={17} />} label="Đăng ký webhook" status="Production" />
                <PipelineItem icon={<MessageCircle size={17} />} label="/connect <mã-một-lần>" status="Một lần" />
              </div>

              <Link href="/dashboard" className={styles.primaryButton}>
                Xem dashboard mẫu
                <ArrowRight size={17} />
              </Link>
              <a href="/docs" className={styles.textLink}>
                Đọc pipeline triển khai trong repo
                <ChevronRight size={15} />
              </a>
            </section>
          )}
        </div>

        <div className={styles.workspaceFooter}>
          <Clock3 size={15} />
          Múi giờ đang chọn: {timezone.replace("Asia/", "")}
        </div>
      </section>
    </main>
  );
}

function StepHeader({
  icon,
  kicker,
  title,
  description,
}: {
  icon: React.ReactNode;
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

function PrimaryButton({
  disabled,
  label,
  loading = false,
}: {
  disabled: boolean;
  label: string;
  loading?: boolean;
}) {
  return (
    <button type="submit" className={styles.primaryButton} disabled={disabled}>
      {loading && <span className={styles.spinner} aria-hidden="true" />}
      {label}
      {!loading && <ArrowRight size={17} />}
    </button>
  );
}

function PipelineItem({
  icon,
  label,
  status,
  done = false,
}: {
  icon: React.ReactNode;
  label: string;
  status: string;
  done?: boolean;
}) {
  return (
    <div className={`${styles.pipelineItem} ${done ? styles.pipelineDone : ""}`}>
      <span aria-hidden="true">{done ? <Check size={16} /> : icon}</span>
      <strong>{label}</strong>
      <small>{status}</small>
    </div>
  );
}
