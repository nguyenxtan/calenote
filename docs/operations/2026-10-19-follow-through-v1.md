# Follow-through V1 candidate

The owner approved the V1 design and implementation on October19. This is a development candidate on `codex/follow-through-v1`, dependent on the separate auth/Settings PR14 (`96aa378`). No production rollout or remote migration is implied by source or local test results.

## Behavior

New reminder inserts become independent OPEN work items atomically. Historical reminders stay UNTRACKED until explicitly adopted. Progress OPEN/DONE/STOPPED remains separate from delivery PENDING/CLAIMED/RETRYABLE/SENT/FAILED/UNCERTAIN/CANCELLED. Each finite-series occurrence is independent.

Today and Reminders offer completion,15-minute/1-hour/tomorrow09:00 Vietnam postpone, explicit reschedule, stop, legacy adoption, and immutable history. Mutations preview absolute time and original bot; durable request keys survive an uncertain response and failed recovery attempts. Do not blindly submit a new key after a lost response.

Follow-up defaults off, offers30minutes/2hours/24hours, and allows at most3 automatic children over the work item's lifetime. It requires definitive SENT, OPEN progress, original active channel and an available quota. An elapsed policy pauses visibly for manual action, rather than generating catch-up messages. UNCERTAIN never starts a chain.

Zalo/Telegram private chat controls use explicit scoped work references: `xong <mã>`, `hoãn <mã> 15 phút`, `đổi lịch <mã> YYYY-MM-DD HH:mm`, `dừng theo dõi <mã>`. Scheduling previews a resolved Vietnam time and gives an explicit confirmation command. A code grants no authority; ambiguous references request selection in the original bound chat. These controls use no new LLM calls.

## Persistence and deployment constraints

Migration0014 is append-only and requires migrations0001–0013, including ContextContract schema. It adds work/run/receipt tables and narrowly scoped child creation permits, preserving existing delivery status constraints. Children and canonical details are re-encrypted under their own authenticated entity IDs; receipt snapshots are encrypted. Work changes, receipt, child creation and cancellation commit together. A pre-provider atomic fence enforces progress, revision, current run and original connection; a send already acquired before Done/Stop may still settle.

Versioned authenticated APIs are under `/api/v1/follow-through`. List and immutable history are paged to respect the browser response budget. Existing reminder contracts remain unchanged. Mutations require same-origin requests, bounded JSON, a valid session and a per-user rate limit.

Before any production release: qualify a clean immutable SHA, review0014 and fresh remote schema/inventory, obtain exact-SHA deployment and remote-migration authority, preserve immutable Worker version/rollback evidence, and separately scope real private-bot acceptance. Worker rollback does not undo D1 migration; retain forward-compatible schema and original historical rows. Never delete sent/uncertain history as rollback. Production credentials/provider access are excluded from local qualification.

## Verification record

The source includes real SQLite ownership/receipt/rollback/encryption/independent transaction races, actual workerd D1 migration/CAS/long-history checks, actual Worker session routes, and Telegram/Zalo runtime composition with mocked transport. Synthetic browser checks and the final full regression/engineering gate are recorded in the external immutable-candidate evidence packet; source tests do not assert production or human acceptance.

Deferred from V1: reopen, annual recurrence, long-term memory, daily summaries, billing, native apps, voice/email/calendar sync, quiet hours and unlimited follow-up.
