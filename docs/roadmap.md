# Calenote roadmap

Roadmap này mô tả thứ tự phát triển, không phải danh sách capability hiện có. Tại thời điểm hiện tại, repo có khung onboarding/dashboard và xác minh token server-side; các mục còn lại là kế hoạch.

## Phase 0 — Foundation (hiện tại)

- Next.js modular monolith, contracts provider Zalo/Telegram.
- BYOB onboarding và `getMe` token verification.
- Token không trả lại client, không log/lưu trữ trong luồng hiện tại.
- Domain boundary cho Workspace, Task, Event, ReminderRule, Delivery, CommandDraft và ChatIdentity.
- Dashboard mẫu và test adapter/API/UI chính.

Không gọi Phase 0 là webhook hoạt động, chat binding hoàn tất hay scheduler production.

## Phase 1 — Account và connection persistence

- Đăng nhập/session production và PostgreSQL schema.
- Lưu BotConnection bằng envelope encryption/KMS.
- Fingerprint chống gắn trùng bot; revoke/rotate token và audit event.
- Enforce workspace membership và constraint một active pair/người ngay từ schema.

## Phase 2 — Chat binding và inbound pipeline

- Webhook ingress có secret header validation; local dùng polling có kiểm soát.
- Mã `/connect` một lần, hash + TTL, idempotent binding vào ChatIdentity.
- Lưu inbound update theo provider update id để chống xử lý trùng.
- Tách rõ `DIRECT` và `GROUP_BETA`; chỉ mở group khi có policy và kiểm thử phù hợp.

## Phase 3 — Command-to-calendar

- Parser tạo CommandDraft từ tin nhắn.
- Màn hình/chat confirmation trước khi ghi Task hoặc Event khi confidence thấp.
- CRUD Task/Event; timezone và quyền workspace được kiểm tra tại domain boundary.

## Phase 4 — Reminder execution

- ReminderRule và occurrence calculation.
- Transactional outbox, queue/scheduler và Delivery retry/idempotency.
- Provider receipts, trạng thái delivered/failed và giao diện retry/cancel.

## Phase 5 — Shared workspaces

- TEAM: invitation, role, quyền lịch chung và audit.
- PAIR: invite/accept/unlink, enforcement một pair active/người và conflict UX.
- Không mở rộng thành tính năng team/pair chỉ bằng cách đổi nhãn UI trước khi policy và persistence hoàn tất.

## Phase 6 — Mở rộng có kiểm chứng

- Mobile client dùng chung API contract.
- Cải thiện ngôn ngữ tự nhiên, recurring events và observability.
- Đánh giá group Zalo sau beta bằng dữ liệu lỗi, quyền và privacy; không mặc định coi group là GA.

## Tiêu chí chuyển phase

Chỉ chuyển phase sau khi có migration/contract tương ứng, test hành vi ở boundary thật hoặc staging phù hợp, runbook rollback, và bằng chứng không làm lộ secret. Một UI placeholder, mock provider hoặc token hợp lệ không đủ để đánh dấu phase hoàn tất.
