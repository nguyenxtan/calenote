# Calenote Foundation — Product & Architecture Design

**Ngày:** 2026-09-02  
**Trạng thái:** Approved for implementation  
**Mục tiêu bản đầu:** dựng một khung xương chạy được cho trải nghiệm BYOB (Bring Your Own Bot), ưu tiên Zalo Bot Platform mới và hỗ trợ Telegram Bot API.

## 1. Product thesis

Calenote là một thư ký lịch cá nhân theo hướng **chat-first**:

1. Người dùng tạo bot của riêng họ trên Zalo Bot Platform hoặc BotFather của Telegram.
2. Người dùng tạo tài khoản/workspace Calenote, chọn múi giờ và kênh chat.
3. Người dùng nhập bot token vào Calenote để xác minh quyền sở hữu bot.
4. Bản production đăng ký webhook, phát hành mã `/connect` dùng một lần và liên kết tài khoản chat với workspace.
5. Sau khi liên kết, người dùng nhắn tự nhiên để tạo lịch, ví dụ: “mai 8h nhắc tôi họp team”.
6. Đến giờ, Calenote gửi nhắc lại qua đúng bot và ghi nhận phản hồi như hoàn tất, hoãn hoặc hủy.

Web/mobile là nơi xem lại và quản lý. Chat là đường vào nhanh nhất.

## 2. Phạm vi v0.1 trong repo này

### Có thật, chạy được

- Onboarding responsive: hồ sơ Calenote, chọn Zalo/Telegram, hướng dẫn tạo bot, nhập token, chọn phạm vi cá nhân/nhóm.
- API server-side gọi `getMe` thật đến đúng provider để xác minh token.
- Kết quả chuẩn hóa về một kiểu `BotProfile` chung; token không được trả lại client và không được ghi log/lưu trữ.
- Dashboard mẫu cho lịch hôm nay, inbox chat, nhắc hẹn và trạng thái kết nối.
- Test cho adapter provider, API và luồng UI chính.
- Bộ tài liệu kiến trúc, pipeline kết nối, bảo mật, domain, vận hành local và roadmap.

### Được thiết kế đầy đủ nhưng chưa giả vờ là đã vận hành

- Lưu token mã hóa bền vững.
- Đăng ký/xóa webhook và xử lý webhook thật.
- Mã `/connect` một lần và ràng buộc user chat ↔ tài khoản Calenote.
- NLP/LLM hiểu câu lịch, hàng đợi lịch, scheduler và gửi nhắc.
- Đăng nhập production, mobile native, team/couple và thu chi.

UI phải ghi rõ ranh giới này. “Token hợp lệ” không được trình bày thành “webhook đang hoạt động”.

## 3. Quyết định sản phẩm

### 3.1 Zalo-first, không dùng Zalo OA API

Tích hợp Zalo nhắm đến **Zalo Bot Platform** mới tại `bot.zapps.me` và API `bot-api.zaloplatforms.com`. Không dùng Zalo OA OpenAPI.

### 3.2 BYOB

Mỗi người dùng tự tạo và sở hữu bot token. Calenote không dùng chung một bot tổng cho mọi tài khoản. Điều này cho phép nhận diện thương hiệu cá nhân/team và giảm phụ thuộc vận hành bot tập trung, nhưng yêu cầu quản lý secret nghiêm túc.

### 3.3 Personal trước, shared sau

MVP chỉ tạo workspace cá nhân. Domain được chuẩn bị cho:

- `PERSONAL`: một chủ sở hữu.
- `TEAM`: nhiều thành viên, vai trò và lịch chung.
- `PAIR`: tối đa hai người; một người chỉ có một liên kết cặp đôi đang hoạt động tại một thời điểm.

Không trộn quyền team/couple vào v0.1 để tránh làm sai mô hình sở hữu.

### 3.4 Task, Event và Reminder không phải một thứ

- `Task`: việc cần làm, có thể chưa có thời điểm cố định.
- `Event`: khoảng thời gian trên lịch, có start/end.
- `ReminderRule`: quy tắc báo trước hoặc lặp lại gắn với task/event.
- `ReminderDelivery`: một lần gửi cụ thể qua provider, có trạng thái retry/delivered/failed.

Câu chat được parse thành một `CommandDraft`; người dùng có thể xác nhận trước khi ghi dữ liệu nếu độ chắc chắn thấp.

## 4. Luồng kết nối chuẩn

```text
Calenote account
      │
      ▼
Choose provider ──► Create bot at provider ──► Paste token
                                               │
                                               ▼
                                      Server calls getMe
                                               │
                              invalid ◄────────┴────────► verified
                                                                  │
                                                                  ▼
                                                     Encrypt and store token
                                                                  │
                           local dev: getUpdates polling ◄────────┴────────► production: HTTPS webhook
                                                                  │
                                                                  ▼
                                                   Issue one-time /connect code
                                                                  │
                                                                  ▼
                                              User sends code in direct chat
                                                                  │
                                                                  ▼
                                             Bind provider user to workspace
```

Trạng thái kết nối production dự kiến:

`DRAFT → VALIDATING → VERIFIED → ACTIVATING → ACTIVE_UNBOUND → CHAT_BOUND`

Nhánh lỗi: `INVALID`, `CONFLICTED`, `SUSPENDED`, `REVOKED`.

## 5. Kiến trúc

Khởi đầu bằng **modular monolith** để tối ưu tốc độ học sản phẩm, nhưng giữ ranh giới để tách worker sau này.

```text
Browser / future mobile
          │
          ▼
     Calenote Web/API
      ├── Accounts & Workspaces
      ├── Bot Connections
      ├── Inbox / Command Drafts
      ├── Tasks / Events / Reminders
      └── Provider Adapters
             ├── Zalo Bot Platform
             └── Telegram Bot API

Production data plane (planned)
      ├── PostgreSQL
      ├── Queue / Outbox
      ├── Webhook ingress
      └── Scheduler + delivery workers
```

### Công nghệ v0.1

- Next.js App Router + React + TypeScript.
- Route Handler làm server boundary cho `getMe`; browser không bao giờ gọi provider bằng token trực tiếp.
- Vitest + Testing Library.
- CSS thuần với design tokens để khung nhẹ, dễ chuyển sang design system sau.

### Công nghệ production đề xuất

- PostgreSQL làm nguồn dữ liệu chuẩn.
- Queue có delayed jobs hoặc scheduler quét `next_run_at` với khóa phân tán.
- Transactional outbox để không mất nhắc hẹn giữa ghi DB và enqueue.
- KMS/secret manager để mã hóa envelope bot token.
- OpenTelemetry + structured audit events đã redact secret.
- React Native/Expo ở giai đoạn mobile, dùng chung API contract chứ không dùng chung toàn bộ UI web.

## 6. Provider contract

```ts
type Provider = "zalo" | "telegram";

interface BotProviderAdapter {
  verifyToken(token: string): Promise<BotProfile>;
  registerWebhook(input: RegisterWebhookInput): Promise<void>;
  removeWebhook(token: string): Promise<void>;
  parseInbound(request: Request): Promise<InboundMessage>;
  sendText(input: SendTextInput): Promise<ProviderMessageReceipt>;
}
```

v0.1 chỉ hiện thực `verifyToken`; các method khác là contract và pipeline docs, không phải capability claim.

### Zalo

- Base URL: `https://bot-api.zaloplatforms.com/bot<TOKEN>/<method>`.
- Xác minh: `POST getMe`.
- Production: `POST setWebhook` với URL HTTPS công khai và `secret_token`; kiểm tra header `X-Bot-Api-Secret-Token` trên mọi webhook.
- Local: `getUpdates`; không dùng đồng thời polling và webhook.
- Gửi: `POST sendMessage`, `text` tối đa 2.000 ký tự.
- Group chat đang Beta; onboarding mặc định direct chat và phải gắn nhãn rõ khi bật group.

### Telegram

- Base URL: `https://api.telegram.org/bot<TOKEN>/<method>`.
- Xác minh: `POST getMe`.
- Production: `setWebhook` với HTTPS và `secret_token`; kiểm tra `X-Telegram-Bot-Api-Secret-Token`.
- Local: `getUpdates`; không dùng đồng thời polling và webhook.
- Gửi: `sendMessage`, `text` tối đa 4.096 ký tự.

## 7. Mô hình dữ liệu đích

Các bảng lõi dự kiến:

- `users`, `sessions`
- `workspaces`, `workspace_members`
- `pair_links` với unique active membership constraint
- `bot_connections` (provider, provider_bot_id, encrypted credential, state)
- `chat_identities` (provider user/chat id ↔ workspace member)
- `connect_codes` (hash, expires_at, used_at)
- `inbound_updates` (provider update id unique để idempotent)
- `command_drafts`
- `tasks`, `events`, `reminder_rules`, `reminder_deliveries`
- `outbox_events`, `audit_events`

Mọi provider identifier được lưu dạng string; không giả định integer JavaScript an toàn.

## 8. Security baseline

- Token đi qua same-origin (HTTPS bắt buộc ở production; HTTP chỉ dùng loopback local), password input và server runtime; không nằm trong URL Calenote, analytics, localStorage hoặc log/trace.
- Production lưu ciphertext bằng envelope encryption; khóa dữ liệu không nằm cùng database.
- Dùng HMAC fingerprint để phát hiện một bot bị gắn cho hai workspace mà không cần so sánh plaintext.
- Chỉ gọi đến hai hostname provider cố định, không theo redirect, đặt deadline tuyệt đối và giới hạn body để giảm SSRF/DoS.
- Webhook URL dùng `connectionPublicId` ngẫu nhiên, không lộ tenant id; secret header được so sánh constant-time.
- Mã `/connect` tối thiểu 128 bit, hash khi lưu, TTL 10 phút, một lần dùng.
- Direct chat là mặc định. Group phải có opt-in, quyền tối thiểu và không gửi nội dung lịch cá nhân ngoài ý muốn.
- Rotate/revoke token phải ngừng giao hàng đang chờ và để lại audit event.

## 9. UX v0.1

### Onboarding

1. Hồ sơ: tên, email, múi giờ.
2. Chọn kênh: Zalo ưu tiên, Telegram thay thế.
3. Tạo bot: hướng dẫn đúng provider và ô token bảo mật.
4. Xác minh: server gọi `getMe`, hiển thị bot name/handle/type.
5. Phạm vi: cá nhân mặc định; nhóm Zalo gắn nhãn Beta.
6. Kết quả: phân biệt “đã xác minh token” với “đã đăng ký webhook”.

### Dashboard

- Tổng quan hôm nay.
- Reminder timeline.
- Chat inbox / command draft.
- Connection health.
- Preview Tasks; Team/Pair/Expense hiển thị “sắp tới”, không giả làm tính năng hoạt động.

## 10. Nguồn chính thức

### Zalo Bot Platform

- Tổng quan: https://docs.zaloplatforms.com/docs/BOT
- Xác thực/token: https://docs.zaloplatforms.com/docs/BOT/authorize
- Gọi API: https://docs.zaloplatforms.com/docs/BOT/call_api
- `getMe`: https://docs.zaloplatforms.com/docs/BOT/apis/getMe
- Webhook: https://docs.zaloplatforms.com/docs/BOT/webhook
- `setWebhook`: https://docs.zaloplatforms.com/docs/BOT/apis/setWebhook
- `sendMessage`: https://docs.zaloplatforms.com/docs/BOT/apis/sendMessage
- Group guide: https://docs.zaloplatforms.com/docs/BOT/best-practices/build-bot-interaction-with-group

### Telegram Bot API

- Bot API: https://core.telegram.org/bots/api
- `getMe`: https://core.telegram.org/bots/api#getme
- `setWebhook`: https://core.telegram.org/bots/api#setwebhook
- `sendMessage`: https://core.telegram.org/bots/api#sendmessage
- Rate-limit FAQ: https://core.telegram.org/bots/faq#my-bot-is-hitting-limits-how-do-i-avoid-this

## 11. Definition of done cho bản foundation

- `pnpm dev` mở được onboarding và dashboard.
- Token Zalo/Telegram hợp lệ được xác minh bằng API thật; lỗi được hiển thị an toàn.
- Không có token trong response, client storage hoặc log do ứng dụng tạo.
- Test, typecheck, lint và production build đều qua.
- Giao diện được kiểm tra ở desktop và mobile.
- README chỉ rõ đâu là chạy được và đâu là roadmap production.
