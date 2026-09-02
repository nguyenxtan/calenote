# Calenote

**Lịch bắt đầu từ một câu chat.** Calenote là khung sản phẩm thư ký lịch cá nhân theo mô hình BYOB: mỗi người tự tạo bot Zalo hoặc Telegram, xác minh token với Calenote, rồi dùng chính cuộc chat đó để tạo và nhận nhắc hẹn.

Repo này là **foundation v0.1**, tập trung vào account/onboarding, kết nối provider và kiến trúc trước khi xây parser lịch, scheduler và mobile app.

## Trạng thái thật

| Capability | Trạng thái v0.1 |
|---|---|
| UI thiết lập tài khoản/workspace cá nhân | Có, chưa phải auth production |
| Chọn Zalo Bot Platform hoặc Telegram | Có |
| Gọi `getMe` thật để xác minh token | Có |
| Trả về bot name/id/capability đã chuẩn hóa | Có |
| Lưu bot token | Không; token bị loại khỏi UI sau khi xác minh |
| Đăng ký webhook / polling worker | Chưa; đã có contract và runbook |
| `/connect` bind chat identity | Chưa; đã thiết kế mã một lần |
| Hiểu câu chat, ghi lịch, scheduler, notification | Chưa |
| Team, Pair, Thu chi, iOS/Android | Roadmap |

“Token hợp lệ” chỉ có nghĩa provider chấp nhận credential. Nó không có nghĩa bot đang nhận tin hoặc gửi reminder.

## Chạy local

Yêu cầu Node.js 22+ và pnpm 10+.

```bash
pnpm install
pnpm dev
```

Mở [http://localhost:3000](http://localhost:3000):

- `/` — onboarding BYOB và xác minh token thật.
- `/dashboard` — dashboard UX bằng dữ liệu minh họa.
- `/docs` — UI giải thích pipeline kết nối Zalo/Telegram.

Kiểm tra repo:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

## API đang hoạt động

`POST /api/v1/bot-connections/verify`

Request:

```json
{
  "provider": "zalo",
  "token": "<write-only-bot-token>"
}
```

Success:

```json
{
  "data": {
    "bot": {
      "provider": "zalo",
      "providerBotId": "...",
      "displayName": "...",
      "handle": null,
      "accountType": "BASIC",
      "canJoinGroups": true
    }
  },
  "meta": {
    "tokenStored": false
  }
}
```

API chỉ gọi hai hostname cố định bằng Node HTTPS, dùng POST, không theo redirect,
có deadline tuyệt đối 8 giây, giới hạn request/response và trả lỗi đã làm sạch. Body
client chậm bị hủy sau 5 giây. Transport không dùng
global `fetch`; auto HTTP tracing bị suppress và span thủ công không chứa URL/path
có token. Response API có `Cache-Control: no-store`, không chứa token hoặc error
description gốc từ provider.

## Pipeline Zalo Bot Platform

Tích hợp này dùng **Zalo Bot Platform mới**, không dùng Zalo OA OpenAPI.

```text
Zalo app → Zalo Bot Manager → Bot Creator → copy token
    ↓
Calenote POST .../getMe                       [v0.1 đã có]
    ↓
Encrypt token + unique bot ownership          [production gate]
    ↓
Local: getUpdates  |  Production: setWebhook [production gate]
    ↓
Verify X-Bot-Api-Secret-Token
    ↓
Direct chat: /connect <one-time-code>
    ↓
Inbound → CommandDraft → Task/Event → ReminderRule → Delivery
```

Group chat của Zalo Bot Platform đang Beta; Calenote mặc định direct chat và không hứa khả năng phân biệt mention/reply khi schema chính thức chưa công bố field tương ứng.

## Pipeline Telegram

```text
Telegram → @BotFather → /newbot → copy HTTP API token
    ↓
Calenote POST .../getMe                              [v0.1 đã có]
    ↓
Encrypt token + unique bot ownership                 [production gate]
    ↓
Local: getUpdates + offset | Production: setWebhook [production gate]
    ↓
Verify X-Telegram-Bot-Api-Secret-Token
    ↓
Private chat: /connect <one-time-code>
    ↓
Inbound update_id dedupe → calendar domain → scheduler → sendMessage
```

## Kiến trúc

v0.1 là một Next.js modular monolith:

```text
Browser
  ├── Onboarding / Dashboard / Pipeline UI
  └── POST /api/v1/bot-connections/verify
            └── Connections module
                  ├── Zalo adapter → bot-api.zaloplatforms.com
                  └── Telegram adapter → api.telegram.org
```

Đích production vẫn giữ domain boundary này, bổ sung PostgreSQL, KMS, webhook ingress, transactional outbox, queue/scheduler và delivery worker. Mobile client dùng chung API contract.

```text
src/
  app/                         Next routes và ba UI surface
  components/                  brand, onboarding, dashboard, pipeline guide
  modules/connections/         provider-neutral contract + adapters
docs/
  architecture/                system và domain model
  integrations/                Zalo / Telegram pipeline chi tiết
  security/                    BYOB credential threat model
  runbooks/                    phát triển local
  superpowers/                 approved design + implementation plan
```

## Bộ tài liệu

- [Foundation design](docs/superpowers/specs/2026-09-02-calenote-foundation-design.md)
- [Implementation plan](docs/superpowers/plans/2026-09-02-calenote-foundation.md)
- [System overview](docs/architecture/system-overview.md)
- [Domain model](docs/architecture/domain-model.md)
- [Zalo Bot Platform](docs/integrations/zalo-bot-platform.md)
- [Telegram Bot API](docs/integrations/telegram-bot.md)
- [BYOB credential security](docs/security/byob-credentials.md)
- [Local development runbook](docs/runbooks/local-development.md)
- [Roadmap](docs/roadmap.md)

## Nguồn provider chính thức

- Zalo: [Bot Platform](https://docs.zaloplatforms.com/docs/BOT), [`getMe`](https://docs.zaloplatforms.com/docs/BOT/apis/getMe), [`setWebhook`](https://docs.zaloplatforms.com/docs/BOT/apis/setWebhook), [webhook](https://docs.zaloplatforms.com/docs/BOT/webhook).
- Telegram: [Bot API](https://core.telegram.org/bots/api), [`getMe`](https://core.telegram.org/bots/api#getme), [`setWebhook`](https://core.telegram.org/bots/api#setwebhook), [`sendMessage`](https://core.telegram.org/bots/api#sendmessage).

## Production gates bắt buộc

Trước khi cho người dùng kết nối bot thật lâu dài:

1. Auth/session, tenant authorization, rate limit và concurrency quota cho endpoint verify.
2. PostgreSQL migrations + unique ownership constraints.
3. KMS envelope encryption và HMAC token fingerprint.
4. HTTPS webhook, secret validation, body/rate limits và idempotent inbound store.
5. `/connect` 128-bit, hash, TTL 10 phút, one-use, direct-chat only.
6. Outbox/queue/scheduler/delivery worker có retry giới hạn và audit đã redact.
7. Rotate/revoke token cùng privacy policy cho group/team/pair.
