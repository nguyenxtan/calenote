# Personal Follow-through V1 — design for owner review

Status: DESIGN ONLY. No runtime, schema, scheduler, provider or production change.
Source inspected:96aa3786f3a09554932075265c5f1a44a3f43f69 (includes auth/Settings work in PR14). The older b11c7d4 audit supplied by the owner is historical; this design is grounded in current source.

## Outcome and scope

The owner asked to continue building the missing Never Drop loop. V1 makes a reminder into a trackable personal work item: mark done, explicitly postpone/reschedule, optionally follow up until completion within a visible finite limit. Web and provider-neutral Zalo/Telegram chat controls use the same state machine. No new LLM/provider is required for understanding these controls.

Included: one-off reminders and individual occurrences of existing finite series; Today and Reminders actions; a bounded follow-up policy; explicit chat references; ownership/race/idempotency tests. Completing one occurrence never completes/cancels an entire series.

Deferred: annual birthday/death-anniversary/renewal recurrence, passport30–7–1 strategies, morning/evening summaries, long-term memory, subscription billing, native apps, voice/email/calendar sync, quiet hours and unbounded persistent nagging.

## Product rules

1. Delivery and work progress are independent. Existing PENDING/CLAIMED/RETRYABLE/SENT/FAILED/UNCERTAIN/CANCELLED stay delivery states. SENT never means DONE.
2. New work progress: OPEN, DONE, STOPPED. DONE means the owner explicitly completed the work. STOPPED means stop tracking without claiming completion.
3. New reminders become OPEN work items in the same transaction as creation. Historical reminders remain visibly UNTRACKED until explicitly adopted; never infer that every old sent reminder remains unfinished.
4. Automatic follow-up is opt-in and off by default. The user sees the next follow-up time, interval, number used and maximum before enabling it. V1 offers30minutes,2hours or24hours; maximum3 automatic follow-ups per work item, then a visible limit-reached state with no further automatic sends.
5. Postpone presets:15minutes,1hour,tomorrow09:00 Vietnam time. Reschedule accepts a concrete future Vietnam civil date/time under existing scheduling bounds. Show the resolved absolute time before committing; no fuzzy date authority for a destructive change.
6. Done/Stop cancel unsent future runs of this work item. Already sent history stays intact. A provider send that started before the completion fence may still arrive; the UI must not promise recall.
7. An UNCERTAIN delivery never counts as proven sent and never triggers another automatic follow-up. Retain uncertainty until existing operator reconciliation, or let the user mark the actual work Done/Stopped without fabricating delivery results.
8. A disconnected/suspended channel blocks sending and keeps the work visible. Never reroute automatically to another bot, reactivate the bot, or replay elapsed runs. Changing delivery channel is outside V1.

## Architecture and data

Add separate append-only migration `0014_reminder_follow_through.sql`: work-item root, run lineage and action receipts. Do not rebuild the existing reminders/delivery CHECK constraints to add DONE.

- `follow_through_items`: opaque public ID, root reminder FK, owner/workspace derived from the reminder graph, OPEN/DONE/STOPPED, revision, current run FK, completion time, bounded follow-up policy/count. Only non-sensitive state/timestamps are plaintext.
- `follow_through_runs`: work item FK, reminder FK, kind ORIGINAL/SNOOZE/RESCHEDULE/FOLLOW_UP, ordinal and unique lineage key. Every new run uses the existing reminder scheduler and delivery ledger; never reset a SENT/UNCERTAIN row to PENDING or overwrite an old receipt.
- `follow_through_action_receipts`: owner/channel scope, idempotency key, payload digest, expected revision, resulting revision and non-sensitive result. A mutation, child reminder creation, cancellation/fence and receipt commit atomically.
- Keep encrypted title/details bound to their authenticated encryption entity IDs. A child cannot reuse ciphertext under a different reminder ID. Decrypt/re-encrypt through the existing keyring when creating a new run; never persist plaintext or expose another channel's content.
- Preserve ContextContract ownership/permits and finite-series lineage. Extra work tracking must join the canonical creation transaction without broadening dormant successor authority.

Legacy reminder APIs remain compatible. Add a versioned follow-through API rather than changing the meaning of existing status fields or silently breaking strict response schemas. New web UI consumes the work view and keeps delivery badges alongside progress.

## State transitions and concurrency

- OPEN -> DONE: explicit owner action, revision CAS, stop future unsent runs.
- OPEN -> STOPPED: explicit stop-tracking action; no completion claim.
- OPEN -> OPEN with new run: Snooze/Reschedule or enabled policy; revision CAS, one new run, old unsent run cancelled safely, immutable lineage/receipt.
- Reopen DONE/STOPPED is outside V1. The user may create another reminder explicitly.

Each action carries a durable idempotency key and expected revision. Replaying the same key/body returns its committed result, including after a lost HTTP response. Same key/different body or stale competing action returns409. An interrupted action cannot create a second child run. A fresh Done on an already Done work item is harmless and creates no repeated completion transition.

The pre-provider acquisition fence checks OPEN, matching revision/current run, active original connection and existing delivery guards atomically. Done/Stop prevents any later acquisition. If acquisition won first, record that ordering and allow the already-started attempt to settle; do not claim the network send was recalled. Cancel/Done, Snooze/Done, Cron/Done, two Snoozes and webhook retries need real concurrent SQLite/workerd tests.

Follow-up eligibility requires a definitively SENT last run, OPEN work, explicit enabled policy, quota below3 and no existing live next run. Scheduler redelivery cannot consume quota twice. Restart/recovery must never generate a backdated flood; exhausted or elapsed-policy cases remain visible for explicit user action.

## Web experience

- Today: “Việc cần hoàn tất” shows tracked OPEN work with last delivery/next reminder, clear overdue state and buttons “Đã xong”, “Hoãn”, “Đổi lịch”, “Dừng theo dõi”. Completed and stopped views remain available separately.
- Reminder detail: progress and delivery shown as different labels; immutable run history, current schedule and optional follow-up controls. Old untracked reminders offer “Theo dõi việc này”.
- Postpone/reschedule previews show the actual selected date/time and destination bot. Pending/ambiguous results disable blind duplicate submission and offer safe receipt lookup/readback.
- Accessible controls, keyboard operation,44px touch targets, responsive375px layout and current appearance preferences. No invented progress percentages or claimed human read receipts.

## Chat experience

Use explicit provider-neutral controls such as `xong <mã việc>`, `hoãn <mã việc> 15 phút`, `đổi lịch <mã việc> <ngày giờ>`, `dừng theo dõi <mã việc>`. Show short scoped references in bot reminder/follow-up text. A follow-up explicitly asks whether the work is complete and gives Done/Postpone/Stop commands; it is distinguishable from the original due reminder. Never put session credentials, bot tokens or private identity in those references.

Resolve a reference only within the authenticated private-chat identity and original connection; the code alone grants no authority. Bare “xong/chưa xong” without an unambiguous explicit work reference asks the user to select from a small list in that chat. It never guesses the most recent work or mutates another bot's item. Missing/invalid times clarify rather than writing. Use existing inbound dedup and durable action receipts so repeated provider messages cannot repeat an action. Native provider-specific interactive buttons may be a later adapter; V1 does not depend on them.

## Verification and acceptance

- RED/GREEN pure state/policy/normalization/UTC+7 boundary tests.
- Real D1/SQLite ownership, per-chat scope, canonical create, encryption roundtrip, atomic rollback, receipts, stale revisions and independent transaction races.
- Actual Worker route/session/keyring tests:401/403-or-scoped404, same-origin, bounded bodies, strict contracts, rate limits and no private identity/credential leaks.
- Scheduler/delivery workerd tests for disconnection, Done vs claimed/SENDING, UNCERTAIN, restart, limit3, finite-series occurrence isolation and no catch-up flood.
- Chat adapter tests for both Zalo/Telegram, explicit reference, ambiguity, repeated inbound and complete/invalid time.
- Synthetic desktop/mobile/keyboard/accessibility views and full regression suite on a clean frozen SHA; typecheck/lint/build/docs/Worker types/dry-run; independent task and whole-branch reviews.

No test calls a real paid provider or mutates production without separate authority. Production adoption requires reviewed migration0014, fresh inventory/compatible rollback, exact-SHA authorization and separately scoped live bot acceptance. PR14 remains a separate auth/Settings candidate until its own release is authorized.
