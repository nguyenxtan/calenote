# Canonical series controls — completion of the finite recurrence workflow

## Why this is part of the slice

The Task2 real service test confirmed that canonical weekly/monthly series save correctly, but `D1SeriesStore.listWeb()` intentionally hides contract_version2 rows via legacyContractGuard. The former assumption that the legacy panel could list/cancel these series was wrong. Preserve that guard. Add a selected canonical reader and cancellation path, including for already supported canonical daily/advance series. Ordinary design decisions are delegated by the user's request to implement and cross-review; source work only, no production authority.

## API and UI

- A separate authenticated same-origin `/api/v2/reminder-series` GET/POST path; legacy `/api/reminder-series` remains unchanged.
- GET returns at most10owned canonical series per page/view, with safe public IDs, decrypted owned title/calendar details and up to30actual occurrence statuses/times. Use current canonical companion decryption/protocol helpers; do not run the legacy payload decoder against successor bytes. No decrypted content in logs, no credential/provider/private identity output. No external/provider call.
- POST cancels remaining occurrences using strict `{publicId,expectedRevision}` input, selected runtime capability and authenticated unrevoked/unexpired session, owner/personal-workspace/membership fences, revision CAS and durable audit. Public ID is not authority. Define clear NOT_FOUND/CONFLICT and idempotent already-cancelled outcomes.
- Cancellation is a bounded atomic D1 batch with a fresh unique marker and an audit proving the CAS winner; no partial per-child HTTP loop. Do not touch protected proposals, confirmation previews or conversation ownership. `reminder_series` status/revision can change under its owned authorization; proposal rows remain the creation lineage.
- Cancel only unacquired PENDING/CLAIMED/RETRYABLE reminders and their PENDING/RETRYABLE deliveries, including current snoozed/rescheduled descendants of series tasks. Preserve acquired SENDING/SENT/UNCERTAIN (and existing FAILED fences); do not claim that sent/in-flight messages were recalled. Stop OPEN follow-through/future follow-ups consistently. Preserve completed/history/audit.
- Both authority and child mutations must recheck owner. Concurrent/repeated cancels must not repeat unrelated updates or affect another series/owner. Missing/corrupt companion metadata fails closed. No trigger weakening or new migration is expected.
- Add a canonical series panel to the existing owned Reminders screen. Show exact dates/statuses and a local explicit confirmation step before POST. Use actual result/readback, disable duplicate submissions, retain a clear error on stale/unknown results and require reload before an uncertain retry. Clear owner data on unauthorized/session change and ignore stale late responses. No optimistic claim of cancellation.
- Read local Next16 guidance before UI edits. Preserve existing UI patterns and accessibility; no new dependency, scope-wide redesign or global Queue change.

## Evidence

Real SQLite/Miniflare tests: canonical list/metadata, correct and foreign owner/session, legacy filtering, CAS/idempotency, pending and unacquired claimed cancellation, acquired/uncertain preservation, snoozed child and follow-up stopping, other-series isolation, rollback when a later batch statement fails. Test stored weekly/monthly via actual context service where practical. UI tests cover confirmation, error/unknown state and auth clearing. Typecheck/scoped lint. Full pnpm check remains a final root gate after all source is frozen.

## Root integration rulings and evidence

Canonical controls keep owner authorization after a bot disconnects: an authenticated owner can still stop their own outstanding work. The list remains explicitly bounded to ten recent series; current snoozed/rescheduled heads and planned follow-ups keep the group active and visible even after original occurrences finish. Root tests enforce membership revocation, FAILED-delivery parity with individual cancellation, transaction-marker-scoped delivery changes, auth403 clearing and truthful refresh failure copy. Real Workerd/D1 with all migrations exposed trigger-inclusive meta.changes; affected tasks are pre-marked and counted from actual post-state, not that counter. Source scope verified by local tests, not production or provider delivery.
