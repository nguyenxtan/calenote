# Bảo mật credential BYOB

## Ranh giới v0.1

Trong v0.1, `POST /api/v1/bot-connections/verify` nhận token qua same-origin
(HTTPS bắt buộc ở production; HTTP chỉ chấp nhận trên loopback local), gọi
`getMe` qua adapter Zalo hoặc Telegram, rồi trả về `BotProfile` chuẩn hóa.
Token không được lưu bền vững, trả về browser, ghi log, đưa vào analytics hay
đưa vào URL. Vì vậy v0.1 **không** có webhook, polling, `/connect`, gửi tin,
rotation hay revoke thực tế; “token hợp lệ” không đồng nghĩa bot đang hoạt động.

Transport v0.1 không dùng global `fetch`: nó gọi Node HTTPS với hostname cố
định, deadline tuyệt đối 8 giây, socket-idle timeout và response byte cap.
Request body vào có cap 2 KiB và deadline 5 giây. Automatic HTTP tracing bị suppress quanh
request chứa token; span thủ công chỉ ghi provider, operation, hostname và mã
HTTP, không ghi URL/path, exception thô hay token. `401` được xem là credential
bị từ chối; `403` Zalo, `429`, `5xx`, timeout và lỗi mạng là provider tạm thời
không sẵn sàng để tránh yêu cầu người dùng reset token sai nguyên nhân.

Các phần dưới đây là thiết kế bắt buộc trước khi production lưu credential.

## Threat model

Tài sản cần bảo vệ: bot token, khóa mã hóa, mã `/connect`, danh tính chat,
nội dung inbound/chat và quyền sở hữu bot theo workspace. Rủi ro chính gồm
tenant khác chiếm bot, mã kết nối bị lộ, webhook giả/replay, secret lọt qua
log/trace/analytics, SSRF qua URL provider/callback, và người đọc database
nhưng không có quyền KMS.

Mục tiêu là token không đọc được từ database/log, mỗi bot chỉ có một chủ sở hữu
active, inbound phải được xác thực provider, và lỗi không tiết lộ bot thuộc
tenant khác. Người dùng vẫn phải thu hồi token tại provider khi token lộ.

## Token lifecycle và state machine

State machine canonical nằm tại
[domain-model.md](../architecture/domain-model.md#luồng-trạng-thái-chuẩn):

```text
DRAFT -> VALIDATING -> VERIFIED -> ACTIVATING -> ACTIVE_UNBOUND -> CHAT_BOUND
```

`TOKEN_SUBMITTED` là audit event tạm thời. `CONNECT_CODE_ISSUED` là lifecycle
của thực thể `ConnectCode`; trong thời gian mã còn hiệu lực, connection vẫn là
`ACTIVE_UNBOUND`. Hai tên này không được thêm vào enum `BotConnection.state`.

- `VALIDATING` chỉ gọi `getMe` và ghi nhận `provider_bot_id` đã xác minh.
- `VERIFIED` chỉ ghi nhận provider chấp nhận token; chưa có delivery mode.
- `ACTIVATING` lấy khóa sở hữu nguyên tử, cấu hình **một** delivery mode
  (webhook production hoặc polling local), rồi mới nhận inbound.
- `SUSPENDED` dừng inbound/outbound khi token/signature không còn hợp lệ.
- `REVOKED` vô hiệu hóa credential version, delivery và công việc đang chờ;
  chỉ giữ audit tối thiểu theo retention.

## KMS envelope encryption và uniqueness

Production dùng envelope encryption: service xin data-encryption key từ
KMS/secret manager, mã hóa token bằng AEAD với associated data
`tenant_id + connection_id + credential_version + provider`, và chỉ lưu
ciphertext, wrapped data key, key version cùng metadata. Raw token chỉ nằm
trong bộ nhớ ngắn hạn của server/worker có quyền decrypt; không có API đọc lại.

Tạo `token_fingerprint = HMAC-SHA-256(dedup_key, raw_token)` bằng khóa KMS
riêng, không export và không dùng làm encryption key. Unique index toàn cục
`(provider, token_fingerprint)` chặn reuse token mà không lưu plaintext/hash
có thể đoán được. Unique partial index trên `(provider, provider_bot_id)` cho
state active/rotating chặn hai workspace cùng sở hữu bot. Mọi record, event,
job và query worker phải mang `tenant_id`; kiểm authorization tại
service/repository boundary và database policy khi khả dụng, không chỉ ở UI.

## Webhook, egress và inbound

Calenote tự dựng callback, không nhận URL từ người dùng:

```text
POST /webhooks/{provider}/{connectionPublicId}/{webhookPathSecret}
```

`connectionPublicId` và `webhookPathSecret` ngẫu nhiên, không chứa tenant ID
hay token. Mỗi credential version có path secret và provider secret header
riêng; so sánh secret constant-time. Adapter xác minh chữ ký/secret provider
trước parse payload; giới hạn body, dedupe update ID, kiểm replay theo timestamp
khi provider hỗ trợ, rate-limit và enqueue với idempotency key.

Egress adapter v0.1 chỉ gọi HTTPS hostname cố định: `api.telegram.org` và
`bot-api.zaloplatforms.com`, không theo redirect, có deadline/response limit.
Trước production, network policy còn phải pin allowlist DNS/egress và chặn IP
private, loopback, link-local, metadata, reserved sau mỗi lần resolve để chống
DNS rebinding. Fixed hostname hiện tại không được trình bày như bằng chứng rằng
network-level guard này đã hoàn tất.

Trước khi public endpoint verify, bắt buộc thêm rate limit theo IP/user/provider,
concurrency quota và alert quota provider ở gateway hoặc store dùng chung; limiter
in-memory của một instance không được coi là đủ trong môi trường nhiều replica.

## /connect, group privacy, redaction

Endpoint đã xác thực tạo mã ngẫu nhiên 128-bit, TTL 10 phút, one-use, bound với
tenant, connection, Calenote user khởi tạo và scope dự kiến. Chỉ lưu hash/HMAC,
`expires_at`, `used_at`, attempt counter. Giới hạn tạo/thử mã và hủy mã khi
rotate, revoke, transfer hoặc recovery. Khi nhận `/connect <code>`, chỉ
inbound đã xác thực mới consume code nguyên tử để tạo binding
`(tenant, bot, provider_chat_id, provider_user_id)`.

Direct message là mặc định. Group cần opt-in riêng, xác nhận của Calenote admin
đã link, scope group tách DM, và quyền admin provider nếu sản phẩm cần; không
trả nội dung lịch, thành viên hay trạng thái sở hữu bot vào group. Lỗi phải
trung tính để không tiết lộ tenant khác.

Redact trước log/trace/error reporting/audit export: token, `Authorization`,
URL có token, webhook path/header secret, connect code và nội dung chat. Audit
chỉ giữ actor, tenant, connection public ID, credential version, action, kết quả
và thời điểm.

## Rotation, recovery và revoke

Rotation yêu cầu step-up auth: validate token mới, tạo credential version mới,
cấu hình delivery mới, chuyển đổi nguyên tử, rồi gỡ delivery cũ và hủy job dùng
version cũ. Không overwrite token tại chỗ. Revoke disable inbound/outbound
trước, cleanup provider, loại ciphertext/wrapped-key theo retention và ghi
audit. Recovery dùng tài khoản Calenote đã xác thực; không bao giờ hiển thị lại
token hoặc chứng minh bot cho người không có quyền.
