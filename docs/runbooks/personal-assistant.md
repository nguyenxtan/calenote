# Personal assistant — implementation and release gates

Implemented in the feature branch after source c8c522b. This document is not a deployment record.

## Product behavior

`/app/personal` provides annual or one-off solar/lunar events, five explicit lead offsets (0–365 days), birthday/memorial/renewal presets, explicit encrypted personal notes and search, and daily briefing preferences. New events and daily automatic delivery start off. Years1900–2100 and Vietnam civil timezone are supported. Leap lunar month and missing day policies are explicit; no inferred calendar fallback.

Users can retrieve notes via `trí nhớ <query>` or `/memory <query>` in an authenticated bound private chat. Retrieval is deterministic, bounded, owner-scoped and read-only. Notes are not automatically inferred, not injected into paid AI and not used to autonomously change schedules.

The daily panel aggregates owned follow-through OPEN/overdue/DONE-today tasks, showing up to five titles. Bot briefs show counts and up to three titles; they are delivery messages, excluded from follow-through task/adoption lists. Each daily summary describes current task state, not a reconstructed historical snapshot. Completion still requires an explicit user action; the brief does not mark tasks done.

## Persistence and dispatch

Migrations0015/0016 must both be applied locally for qualification and remotely only with release authorization. They introduce encrypted per-owner documents, revision CAS, keyed schedule fingerprints, dispatch metadata/capabilities and an indexed durable occurrence ledger. Documents are bounded to100KiB UTF8 within the128KiB request limit. Plaintext event titles and memories are not stored in the new tables.

Cron processes20 owners and at most20 new targets per owner per run. The owner cursor and per-owner watermark prevent healthy slow rotations from silently dropping events; annual/one-off event catch-up is bounded to7days. Daily brief catch-up is limited to the current Vietnam day to avoid sending a backlog of old briefings. More than20 simultaneous targets drain on subsequent owner scans without moving the watermark prematurely. No guarantee is made for downtime exceeding these bounds.

Dispatch requires exactly one bound private identity on the existing primary login bot and an owned personal workspace. Missing/ambiguous/inactive channels do not grant authority or choose another bot. Existing reminder claim, queue, delivery, retries and uncertain-outcome fences remain authoritative. No new provider endpoint, queue configuration, credential or paid-AI activation is introduced.

The same occurrence cannot spawn twice under concurrent/repeated cron. Editing only memory leaves schedules intact. Schedule edits revoke not-yet-acquired generated reminders and their current snoozed child, where applicable. Acquired sends cannot be recalled. Sent/claimed/uncertain lineages never respawn; user snooze/reschedule overrides never automatically respawn after a later edit. Daily preference changes after a briefing was sent do not produce a second same-kind briefing for that Vietnam day. Changing an event time also does not resend an already consumed event/date/lead-offset occurrence.

## Qualification

Focused regression tests exercise actual disposable SQLite/Miniflare storage, CAS/ownership/encryption, trigger cancellation, concurrent dispatch, delayed scans, >20 target drainage, sent/uncertain/manual-lineage protection, calendar edges, route/session/origin boundaries, UI drafts and payload budget. Typecheck, scoped lint, static export, docs test and Worker dry-run are separate gates. Synthetic desktop/mobile screenshots and CUA modal/keyboard checks do not prove production authentication or Zalo/Telegram delivery.

Before production: full CI for the immutable candidate, independent review, exact-SHA human release approval, fresh baseline/schema/binding readback, migrations0015+0016, immutable version upload and promotion. Then verify live owner flows, other-account isolation, both relevant bot paths and a real opt-in scheduled briefing/event without claiming that local tests prove these. Do not send real provider messages merely to discover readiness.
