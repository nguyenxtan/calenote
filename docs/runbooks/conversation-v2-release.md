# Conversation V2 release / UAT gate

Current package is local and default-off. The user intends to review the full
package at `https://calenote.iconiclogs.com` as UAT. That does not create an
isolated database: reviewed resources still have production names. Do not
silently reuse credentials or relabel data isolation.

## Before activation

1. Require fresh whole-branch review and resolve Critical/Important findings;
   run focused tests, typecheck, full check and diff validation on exact content.
2. Approve and run a provenance-bound **V2** live model evaluation (corpus,
   metrics, request/cost caps, no fallback). V1 success and mock V2 success are
   insufficient. Revalidate pinned model/provider metadata without printing keys.
3. Recheck feature/master heads, worktree, remote CI and migration filenames.
   If another branch consumed 0007/0008, reconcile numbering before any remote
   application; never rewrite an already applied migration.
4. Read-only verify exact account, Worker, D1 migration history, secret names,
   bindings, cron/Queue and active serving Worker versions. Record rollback
   baseline from active allocation, not latest uploaded version.
5. Obtain explicit authority for remote changes. Apply only reviewed pending
   additive migrations to the verified database, then verify read-only.
6. Activate `conversationV2` coherently in the HTTP and Queue/scheduled
   composition through reviewed code. Defaults are deliberately false in
   `createRuntimeOperations` and `createSeriesOperations`; there is **no**
   unreviewed environment-variable shortcut or admin switch.
7. Require exact-head CI and normal reviewed promotion to master. Obtain explicit
   deployment approval for that immutable **new master SHA**, per AGENTS.md.
8. Upload once from that verified master, record the immutable Worker version,
   promote only that version, and read back the serving allocation. No unrelated
   DNS, webhook, Queue, DLQ, cron, credentials or fallback changes.

Do not advertise lunar/series availability while the capability is disabled.
Budgets remain 50 owner calls/day, 500000 owner monthly microunits and 2000000
global daily microunits. Runtime remains `AI_MODE=privacy`, Gemini 2.5 Flash Lite
on `google-vertex/eu`, ZDR, no fallback.

## Migration and rollback compatibility

- 0007 adds owner/chat-scoped encrypted conversation contexts and content-free
  revision/outcome history; no replacement crypto and no destructive rewrite.
- 0008 adds encrypted series proposals, canonical series/occurrence lineage and
  encrypted calendar provenance. Existing reminders remain delivery authority.
  Additive draft triggers copy provenance and close transferred V2 context in
  the same confirmation transaction; failures roll the transaction back.
- Worker rollback never reverses D1. Retain both migrations, keys and encrypted
  provenance. Old scheduling predicates honor cancelled children; old code does
  not understand new pending V2 conversations or provide series management UI.
- Already-confirmed future reminders may continue delivery after rollback.
  Rollback is **not** cancellation or a send kill-switch. In-flight/uncertain
  sends cannot be recalled, and must not be retried blindly.
- During disable/rollback, freeze new V2 proposals and communicate unavailable
  pending controls. Preserve evidence; do not drop tables or bulk-cancel records.

## Post-deployment checks

Verify origin, health/readiness, assets, auth, D1, Queue/DLQ and cron with safe
read-back. Verify both V2 composition entry points are active. Provider-free
checks cannot prove client typing animation or actual Gemini interpretation.

Then ask the human to test these flows on the UAT domain/Zalo:

1. `xin chào` — natural greeting, no reminder or model call for a clear greeting.
2. `thi hết môn ngày 11/10 ở Quang Trung` — retain event date; ask reminder time.
3. `12h trưa, nhắc liên tục 3 ngày` — retain date/time/count; ask anchor relation.
4. `3 ngày trước ngày thi` — preview all three exact dates, excluding event day;
   no canonical reminder yet. Use a safely future event date for the live test.
5. `có` once — exactly one series with three children; replay cannot duplicate.
6. Web Lời nhắc — inspect all dates/states. Hủy các lần còn lại opens a proposal;
   only its explicit confirmation cancels future unclaimed occurrences.
7. `có lưu âm lịch không?` — explain only on request; do not activate calendar.
8. `âm lịch 1/1 lúc 8h nhắc chuẩn bị lễ` then a future supported year — ask missing
   year and show both lunar and solar dates. Never guess a leap month.
9. `mai nhắc gọi mẹ`, then `9h` — retain date/title, propose only. A new unrelated
   request defaults back to Gregorian and does not borrow earlier facts.
10. `mai tui có gì?` — read-only list. `thế thôi` ambiguous while pending should
    clarify intent, not repeat the missing-time question mechanically.

Record `TYPING_INDICATOR_VISIBLE = YES/NO`, error/stale-state behavior and web
mobile layout. Also verify login/logout, Today, existing reminders, settings,
one-off confirmation, cancellation, /connect and ownership regressions.

## Known bounded scope

Vietnamese lunar years 1900–2100, UTC+7 convention; one-off lunar dates and finite
daily 2–30 series only. No automatic cadence from “urgent”, no indefinite or
yearly recurrence, no astronomical moon-phase feature. Every proposed date is
inspectable. The web list shows ten recent series plus ten pending proposals;
older-series pagination is not part of this release.

Context is encrypted, ≤6 turns/16 KiB, idle 30 minutes/absolute 2 hours; draft
confirmation remains shorter. Reply wording is locally composed, not free-form
AI generation. Server dispatch timing is not Zalo client animation latency.
Admin Releases & Features and continuous-message orchestration remain separate
backlog work, with admin preceding burst handling.
