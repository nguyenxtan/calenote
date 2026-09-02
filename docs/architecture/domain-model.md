# Calenote domain model

**Phạm vi:** mô hình đích cho sản phẩm chat-first, BYOB (Bring Your Own Bot). Đây là ranh giới domain và các bất biến cần giữ; không có nghĩa mọi capability đã được triển khai trong v0.1.

## Bối cảnh và ranh giới

Calenote nhận lệnh từ một `ChatIdentity`, chuyển câu lệnh thành `CommandDraft`, rồi chỉ khi người dùng xác nhận mới ghi `Task`, `Event` hoặc `ReminderRule`. Một lần gửi cụ thể là `Delivery`. Bot token thuộc `BotConnection`, không thuộc nội dung lịch.

```text
ChatIdentity -> CommandDraft -> Task / Event -> ReminderRule -> Delivery
                     ^                              ^
                     |                              |
              WorkspaceMember ---------------- BotConnection
```

`PERSONAL`, `TEAM` và `PAIR` là các loại workspace. v0.1 chỉ vận hành trải nghiệm cá nhân; `TEAM` và `PAIR` là ranh giới dữ liệu để không phải đổi mô hình về sau.

## Thực thể cốt lõi

### Workspace và thành viên

- `Workspace`: `{ id, kind, name, timezone, status, created_at }`.
- `Workspace.kind`: `PERSONAL | TEAM | PAIR`.
- `WorkspaceMember`: `{ workspace_id, user_id, role, status, joined_at }`.
- `PERSONAL` có đúng một owner đang hoạt động.
- `TEAM` có thể có nhiều member và vai trò; quyền chi tiết là phần của phase sau.
- `PAIR` có tối đa hai member.

### Pair constraint

Một người chỉ được có **một pair đang hoạt động** tại một thời điểm, kể cả khi người đó tham gia với vai trò khác nhau. Ở tầng dữ liệu cần một unique partial constraint tương đương:

```sql
unique (user_id) where workspace_kind = 'PAIR' and membership_status = 'ACTIVE'
```

Nếu database không hỗ trợ partial unique index theo join, materialize `active_pair_user_id` trong `pair_links` và đặt unique index trên cột đó. Mọi thao tác tạo/đổi pair phải chạy trong transaction và trả lỗi xung đột thay vì tạo bản ghi thứ hai.

### BotConnection

`BotConnection` đại diện cho bot do người dùng tự tạo:

`{ id, workspace_id, provider, provider_bot_id, display_name, handle, state, scope, token_fingerprint, encrypted_token_ref, verified_at, revoked_at }`

- `provider`: `ZALO | TELEGRAM`.
- `scope`: `DIRECT | GROUP_BETA` (direct là mặc định; group Beta phải opt-in).
- Token thô chỉ tồn tại trong request/runtime ngắn hạn; không trả về client, không log, không lưu localStorage hay URL.
- `state` phân biệt `DRAFT`, `VALIDATING`, `VERIFIED`, `ACTIVE_UNBOUND`, `CHAT_BOUND`, `INVALID`, `REVOKED`; `VERIFIED` chỉ chứng minh token hợp lệ, không chứng minh webhook hoặc chat đã hoạt động.
- Fingerprint dùng để phát hiện một bot bị gắn vào nhiều workspace mà không cần so sánh plaintext.

### ChatIdentity

`ChatIdentity` là danh tính phía provider được bind vào member:

`{ id, workspace_id, member_id, provider, provider_user_id, provider_chat_id, chat_type, display_name, bound_at, unbound_at }`

`provider_user_id` và `provider_chat_id` lưu dạng string. Một identity đang hoạt động chỉ thuộc một workspace/member tương ứng với chính sách provider. Không suy ra quyền team/pair chỉ từ việc nhận được một message.

Mã `/connect` là thực thể tạm thời riêng (`ConnectCode`): chỉ lưu hash, thời hạn, trạng thái đã dùng và connection id; mã một lần không phải `ChatIdentity` và không được lưu plaintext.

### CommandDraft

`CommandDraft` giữ ý định chưa được ghi thành dữ liệu lịch:

`{ id, workspace_id, chat_identity_id, raw_text, parsed_intent, confidence, status, proposed_at, confirmed_at, expires_at }`

- `status`: `RECEIVED | NEEDS_CONFIRMATION | CONFIRMED | REJECTED | EXPIRED`.
- `raw_text` gắn với identity và workspace để audit; loại bỏ token/secret nếu parser nhận nhầm dữ liệu nhạy cảm.
- Draft có thể đề xuất tạo Task, Event hoặc ReminderRule nhưng chưa tạo bản ghi đó trước khi xác nhận.

### Task và Event

- `Task`: việc cần làm, có `title`, `status`, `due_at` tùy chọn, `owner/member`, workspace.
- `Event`: sự kiện có `title`, `start_at`, `end_at`, timezone và participant/scope tùy chính sách workspace.
- Task không tự biến thành Event chỉ vì có `due_at`; Event luôn có khoảng thời gian.

### ReminderRule và Delivery

`ReminderRule` là quy tắc báo trước/lặp lại gắn với **Task hoặc Event**:

`{ id, target_type, target_id, schedule, timezone, channel_connection_id, status }`

`Delivery` là một lần thực thi của rule:

`{ id, reminder_rule_id, scheduled_at, attempt_count, provider_message_id, status, last_error, delivered_at }`

- `status`: `PENDING | SENDING | DELIVERED | FAILED | CANCELED`.
- Delivery phải idempotent theo rule + occurrence; retry không tạo thêm nhắc trùng.
- Không coi việc tạo rule là đã gửi thành công. Chỉ `DELIVERED` sau receipt từ provider.

## Luồng trạng thái chuẩn

```text
message -> CommandDraft(RECEIVED)
        -> NEEDS_CONFIRMATION
        -> CONFIRMED -> Task/Event + ReminderRule
        -> Delivery(PENDING -> SENDING -> DELIVERED | FAILED)
```

Ngắt kết nối hoặc revoke `BotConnection` phải chặn Delivery mới, hủy/đánh dấu các delivery đang chờ theo chính sách, và ghi audit event. Dữ liệu Task/Event không tự xóa khi bot bị revoke.

## Nguyên tắc nguồn sự thật

Workspace và membership quyết định quyền; ChatIdentity quyết định message thuộc ai; CommandDraft quyết định ý định đã được xác nhận chưa; Task/Event là dữ liệu lịch; ReminderRule là lịch báo; Delivery là bằng chứng gửi. Không dùng dashboard snapshot, provider message hay token verification để thay thế các nguồn sự thật này.
