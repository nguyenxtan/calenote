# Calenote feature inventory — 2026-11-04

Source baseline: master `76d37411a89e94f8f7d57637fd11aa32890354c6`. This is a bounded source inventory, not a fresh production inspection. The latest recorded production source is 463b0dc, with 18 migrations; advance settings and migrations 0019–0022 await release authorization. Historical roadmap/README entries must not be treated as current absence claims.

## Already implemented in source

- Zalo/Telegram BYOB, email registration, bound private chat and authenticated web controls.
- AI reminder interpretation, exact preview/confirmation, manual web creation, deterministic schedule/dispatch, finite daily series, cancellation and pagination.
- Follow-through completion/stop/snooze/reschedule, opt-in follow-ups at 30/120/1440 minutes, at most 3 follow-ups; this is not arbitrary interval recurrence.
- Solar/lunar annual or one-off life events, event categories, explicit lead-day offsets, private user-edited memories and deterministic retrieval, daily morning/evening summaries.
- Personalization, appearance, owned sessions/revoke-other-sessions, account-scoped release updates and admin release/accounting views.
- New advance defaults: independent 1–7 days/1–24 hours, dedupe, explicit-input precedence and captured policy. Source and CI verified; this is still a release/live-acceptance gap.

Evidence: contracts/api/{personal-assistant,follow-through,account,preferences}.ts, modules/personal-assistant, features/personal-assistant, modules/conversation/context-contract and the 76d CI/release receipts under artifacts/diagnostics/advance-settings-20261104.

## Remaining work, prioritized

| Priority | Capability/gap | Current evidence and bounded next slice |
| --- | --- | --- |
| Release gate | Deploy approved source and run real acceptance |30 synthetic cases are prepared; live acceptance is not complete. Production mutations still require exact-SHA authorization. |
| P1 — execute first | Finite weekly/monthly reminders | Frequency enums already exist but resolve.ts returns UNSUPPORTED. Reuse canonical exact occurrences and existing series authority, with explicit finite limits. |
| P1 — next | Explicit hour/minute lead instructions in chat | Settings can subtract hours in backend, but semantic contract exposes leadOffsetDays only and advertises HOUR_OFFSET unsupported. Design a typed duration before allowing arithmetic. |
| P2 | Owner-visible AI usage/cost | Budget ledger and admin accounting exist; no dedicated customer usage API/UI found. Show known charges separately from retained unknown reservations; never label held funds as actual provider spend. |
| P2 | Messages sent in quick succession | Existing ownership, revision and stale-response fences are present. Debounce/grouping needs a separate ordering/confirmation/cancellation design; never change Queue concurrency ad hoc. |
| P2 | Calendar export, then optional external sync | No .ics/CalDAV or external calendar synchronization surface found in inspected source. Start with owner-scoped export; OAuth sync is a separate privacy/resource scope. |
| Later | Arbitrary interval recurrence, sharing, voice/native apps, billing | Existing fixed follow-through intervals are not arbitrary recurrence; teams, payments and external authority require separate product contracts. Do not make them prerequisites for this personal-reminder slice. |

## Execution decision

The user explicitly requested listing gaps, Claude cross-review and immediate autonomous implementation, and previously delegated ordinary product/engineering choices. Start with finite weekly/monthly reminders, implemented by Codex after one bounded Claude design review. Use a second bounded Claude diff review only when source changes are ready. Do not consume quota on parallel broad audits or rebuilding features already present.

This inventory does not authorize production deployment, paid tests beyond the existing cumulative USD4 ceiling, secret changes, provider-route changes or resource creation. It also does not promise all later integrations in one release.
