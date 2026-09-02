# Tổng quan hệ thống Calenote

## Trạng thái hiện tại: v0.1

Calenote hiện là Next.js/React/TypeScript **modular monolith**. Browser gọi
Route Handler của Calenote; Route Handler gọi provider adapter server-side để
xác minh token bằng `getMe`; adapter trả về `BotProfile` chuẩn hóa. Chỉ Zalo
Bot Platform và Telegram Bot API được hỗ trợ.

```text
Browser -> Next.js Web/API -> Connections module -> Provider adapter -> getMe
```

Đây là prototype/onboarding verification, không phải control plane production:
không có credential persistence, webhook/polling thật, inbound inbox,
`/connect`, scheduler, queue hoặc reminder delivery. Token là input write-only:
không đi browser -> provider trực tiếp, không lưu, echo lại hay log.

## Modular monolith đích

Giữ một deployable codebase ban đầu nhưng phân ranh module bằng domain contract,
transaction boundary và ownership rõ ràng để worker có thể tách sau:

```text
Web / future mobile
        |
Calenote API (auth, tenant authorization, rate limits)
  |- Accounts & Workspaces
  |- Bot Connections / Credential Vault
  |- Provider adapters (Zalo, Telegram)
  |- Webhook ingress / Inbound updates / Command drafts
  |- Calendar domain (tasks, events, reminder rules)
  |- Reminder delivery
  `- Audit and outbox publisher
        |
 PostgreSQL (canonical state) <-> Queue workers / Scheduler
        |
 KMS/secret manager; fixed provider egress; HTTPS webhook ingress
```

Mỗi request/job mang tenant context. Module không query tùy tiện bảng module
khác: service boundary kiểm authorization và publish domain event qua outbox.
Provider identifiers luôn là string, không giả định safe integer JavaScript.

## Production data plane

- **PostgreSQL** là nguồn trạng thái chuẩn: tenant, connection, credential
  metadata/ciphertext, chat identity, task/event/reminder, inbound update,
  audit và outbox. Transaction + unique constraints bảo vệ ownership bot,
  consume connect code và dedupe update.
- **Transactional outbox** được ghi cùng transaction nghiệp vụ; publisher mới
  đẩy event sang queue, tránh mất event giữa DB commit và enqueue.
- **Queue/worker** xử lý webhook đã xác thực, command parsing và delivery bằng
  idempotency key, retry backoff có giới hạn và dead-letter/alert. Worker chỉ
  decrypt credential tại thời điểm gọi provider.
- **Scheduler** dùng delayed queue hoặc quét `next_run_at` với row locking/
  distributed lease. Nó tạo `ReminderDelivery` idempotent, không gửi tin trong
  transaction business.
- **KMS/secret manager** thực hiện envelope encryption; database chỉ giữ
  ciphertext, wrapped data key và version metadata.

## Delivery, connection và API boundary

Production ưu tiên webhook HTTPS. Mỗi connection có public ID ngẫu nhiên,
webhook path secret và provider secret/header độc lập; ingress xác minh trước
parse/enqueue. Local có thể polling `getUpdates` bằng sandbox credential,
nhưng polling và webhook không chạy đồng thời. Adapter egress chỉ gọi hostname
HTTPS cố định, không nhận URL do người dùng nhập.

```text
DRAFT -> VALIDATING -> VALIDATED -> ACTIVATING -> ACTIVE_UNBOUND -> CHAT_BOUND
                         |              |                 |
                    INVALID        CONFLICTED         SUSPENDED
                                                  -> ROTATING -> ACTIVE_UNBOUND
                                                  -> REVOKING -> REVOKED
```

`ACTIVE_UNBOUND` chỉ nghĩa delivery active, chưa có chat/user tin cậy.
`/connect` dùng mã 128-bit, hash khi lưu, TTL 10 phút và one-use; direct chat
mặc định, group là scope opt-in riêng có privacy guard.

- `POST /api/v1/bot-connections/verify` là boundary v0.1: provider + token
  vào, `BotProfile` ra, `tokenStored: false`.
- Production thêm command đã auth tenant-admin để create/activate, issue connect
  code, rotate và revoke. Browser không bao giờ nhận token decrypted.
- Inbound provider chỉ vào webhook route; provider adapter chứa
  endpoint/signature/payload riêng, domain calendar chỉ thấy model chuẩn hóa.

## Vận hành

Health/readiness tách API, outbox publisher, queue worker và scheduler; alert
trên backlog, dead-letter, webhook signature failure, delivery retry và KMS
failure. Structured log/trace/audit phải redact token, authorization header,
webhook secret/path, `/connect` code và nội dung chat. Một test `getMe` không
là bằng chứng webhook, scheduler hoặc production readiness. Chi tiết security ở
`docs/security/byob-credentials.md`.

