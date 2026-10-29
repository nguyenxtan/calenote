"use client";

import { useRef, useState } from "react";
import styles from "./BotCreationGuide.module.css";

type Provider = "zalo" | "telegram";
const guides = {
  zalo: {
    source: "https://docs.zaloplatforms.com/docs/BOT/create_bot",
    steps: [
      { action: "Tìm Zalo Bot Manager", detail: "Trong ứng dụng Zalo, tìm OA Zalo Bot Manager.", result: "Bạn thấy cuộc chat quản lý bot." },
      { action: "Chọn Tạo bot", detail: "Trong menu của Zalo Bot Manager, chọn Tạo bot.", result: "Zalo Bot Creator mở ra." },
      { action: "Đặt tên bot", detail: "Nhập tên bắt đầu bằng Bot.", result: "Tên bot của bạn đã được điền." },
      { action: "Bấm Tạo Bot", detail: "Hoàn tất tạo bot trong Zalo Bot Creator.", result: "Token được gửi riêng cho bạn qua Zalo." },
    ],
  },
  telegram: {
    source: "https://core.telegram.org/bots/tutorial#obtain-your-bot-token",
    steps: [
      { action: "Mở BotFather", detail: "Mở tài khoản BotFather chính thức trong Telegram.", result: "Bạn đang ở cuộc chat với @BotFather.", href: "https://t.me/BotFather" },
      { action: "Bấm Start", detail: "Bắt đầu cuộc chat với BotFather.", result: "BotFather hiển thị các lệnh quản lý bot." },
      { action: "Gửi /newbot", detail: "Gửi lệnh /newbot cho BotFather.", result: "BotFather hỏi tên bot mới." },
      { action: "Đặt tên hiển thị", detail: "Gửi tên bạn muốn hiển thị cho bot.", result: "BotFather hỏi username của bot." },
      { action: "Chọn username", detail: "Dùng 5–32 chữ Latin, số hoặc dấu gạch dưới; kết thúc bằng bot.", result: "Khi username được chấp nhận, BotFather gửi token riêng cho bạn." },
    ],
  },
} satisfies Record<Provider, { source: string; steps: { action: string; detail: string; result: string; href?: string }[] }>;

export function BotCreationGuide({ provider }: { provider?: Provider }) {
  const [selected, setSelected] = useState<Provider>(provider ?? "zalo");
  const [index, setIndex] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const guide = guides[provider ?? selected];
  const step = guide.steps[Math.min(index, guide.steps.length - 1)];
  function move(next: number) { setIndex(next); queueMicrotask(() => heading.current?.focus()); }
  return <div className={styles.guide}>
    {!provider && <div className={styles.providers} role="group" aria-label="Chọn nền tảng tạo bot">{(["zalo", "telegram"] as const).map(value => <button key={value} type="button" aria-pressed={selected === value} onClick={() => { setSelected(value); setIndex(0); }}>{value === "zalo" ? "Zalo" : "Telegram"}</button>)}</div>}
    <div className={styles.step}>
      <p className={styles.progress}>Bước {index + 1} / {guide.steps.length}</p>
      <h3 ref={heading} tabIndex={-1}>{step.action}</h3>
      <p>{step.detail}</p>
      {"href" in step && <a href={step.href} target="_blank" rel="noreferrer">{step.action} ↗</a>}
      <p className={styles.result}><strong>Kết quả cần thấy</strong><span>{step.result}</span></p>
      <div className={styles.controls}><button type="button" disabled={index === 0} onClick={() => move(index - 1)}>Quay lại</button>{index < guide.steps.length - 1 ? <button type="button" onClick={() => move(index + 1)}>Tiếp theo</button> : <span>Đã có token? Tiếp tục với Calenote bên dưới.</span>}</div>
    </div>
    <details className={styles.reference}><summary>Tài liệu chính thức & lưu ý</summary><a href={guide.source} target="_blank" rel="noreferrer">Cách tạo bot trên {provider === "telegram" || (!provider && selected === "telegram") ? "Telegram" : "Zalo"} ↗</a><p>Token là thông tin bí mật. Chỉ tự nhập vào ô Bot token của Calenote; không gửi qua chat, email hay ảnh chụp.</p>{(provider ?? selected) === "zalo" && <p>Luồng này dùng Zalo Bot Platform. Không cần tạo OA doanh nghiệp hoặc ứng dụng OAuth. Xem tài liệu chính thức để kiểm tra điều kiện và giới hạn hiện hành.</p>}</details>
  </div>;
}
