# Góp ý & báo lỗi V1

Member đăng nhập mở Trợ giúp → Góp ý & báo lỗi (`/app/feedback`). Form chỉ nhận văn bản và pathname được chọn, không lấy log/chat/URL hiện tại/đính kèm. Sau receipt hợp lệ, mã yêu cầu và trạng thái nằm trong danh sách của chính người gửi. Đã nhận không hứa sẽ triển khai; bấm Làm mới để đọc trạng thái hiện tại.

Admin hiện có mở `/app/admin/feedback` từ dashboard, lọc Bug/Đề xuất và trạng thái, mở chi tiết, cập nhật phản hồi/trạng thái. Đóng cần kết quả và phản hồi ít nhất5 ký tự. Revision cũ trả409; mở lại chi tiết trước khi xử lý tiếp. Không thêm quyền admin, email hay bot notification.

## Data and security

- Authenticated server principal owns every member query. Foreign-owned ticket404; existing server admin allowlist controls administrative routes. The browser's opaque reader digest is only for UI isolation, not authorization.
- POST `/api/feedback`, GET `/api/feedback[/:id]`; GET `/api/admin/feedback[/:id]`; PATCH `/api/admin/feedback/:id`. Admin detail GET is the minimal endpoint needed to open a queue item without putting full descriptions into list responses.
- Mutations require same origin; strict JSON16KiB; title5–120 and description20–4000 characters. No owner/status injection. All responses/errors no-store, Vary Cookie.
- Encrypted JSON contains title, description, page, disposition and reply. AES-GCM AAD binds owner + ticket. No contents in audit/logging. Metadata includes internal actor IDs, kind/status/revision/time and per-owner idempotency digest.
- Mutations carry the expected opaque reader ID, checked after server authentication before storage; a cookie/principal change returns409 IDENTITY_CHANGED and clears the client. GET detail/list from an already open panel also carries it. On tab blur/hidden private UI is obscured; focus/visible rechecks the session and reader before revealing it, preserving a RAM draft only for the same owner.
- Unique owner/request ID; identical retry returns same record. Different payload409. Atomic insert permits only3 committed tickets per rolling10min,20 per rolling24h. Replay consumes no extra slot. Retry-After reflects relevant reset, approximate when concurrent traffic changes it.
- Audit triggers run in the same transaction as insert/CAS update; audit failure rolls back ticket mutation. No DELETE route, purge/retention job, archive/restore or automatic deletion. Closing does not delete content. Retention policy remains separately undecided.
- UI keeps draft/id/submitted payload only in RAM. Unknown POST result freezes the submitted payload for same-ID retry. Do not assume cancellation means rollback. After remount/login, inspect own list before sending again. No automatic replay on remount or under another account.
- Opaque reader identity keys panel state; session-generation events clear every private state. Request guards and AbortSignal cover obsolete success/error/auth responses, without a stale401 globally invalidating a newer session. Current401/403 discards current state and asks to recheck session.

## Qualification and integration

Base `f11b19d223ddb01abfe9bc1c096d07fc331b8c51`. New migration `0019_feedback_intake.sql` is only prepared and tested against disposable local D1 after0018. Number and lineage must be reconciled against other candidates at combined integration. No remote apply or deployment in this work.

Tests: contracts/owner isolation, real disposable D1 encryption, concurrent replay/rate/CAS, atomic rollback on failed audit, pagination, all migrations baseline preservation/FK; route auth/origin/method/body/size/filter and safe errors; UI receipt/ambiguous retry/account switch/late responses/admin permission loss/escaped content. Browser synthetic evidence is local only. Full suite/check results belong to candidate evidence, not a live claim.

No AI/provider/paid call, email, attachment or new dependency/binding. Feature CI is separate from Pilot qualification. Combined release requires Pilot PASS, all parts' tests/review, compatible exact-source lineage, migration/config/binding refresh, and separately authorized exact SHA. Do not treat prior production receipts or local UI mocks as current live evidence.

Known V1 limits: no anonymous intake for login failure; no threaded discussion, public votes, assignment, exports, real-time refresh, external notifications or hard-delete. Text pasted by users may contain secrets; the warning is not a claim of comprehensive automatic redaction.
