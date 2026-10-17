# Product completion status — 2026-10-17

Scope: existing Calenote product and PR #11, offline fixes only. Source remains on
the feature branch; master, production resources, provider configuration,
model/prompt/oracle, financial ledgers and authorization markers are unchanged.

## Completed implementation

- Durable owner-scoped CREATE/recovery, mismatch/abandon conflicts, atomic
  reminder/audit/receipt, concurrency and reload recovery through actual Worker
  and SQLite. Legacy clients may omit intent IDs; this is not global dedup.
- Production local read-only date/calendar/help paths preserved; cancellation
  uses canonical DELETE; legacy pagination and ordering fences retained.
- Actual Context Contract API factory opt-in wiring; default runtime/UI off,
  legacy schema reads supported. Existing UI branch is already in production
  ancestry and needs no redundant port.
- Ledger evidence classified29 terminal prospective UNKNOWN claims without
  numeric cost proof; zero financial settlements fabricated. Paid HOLD retained.
- Migration0009/0010 syntax/data-preservation tests, dated read-only production
  baseline/schema inventory, immutable release preparation and rollback limits.

## October17 bugfix regression evidence

1. **Malformed successful CREATE/recovery receipt loses intent.** Today previously
   trusted any envelope with `data` or only the CREATED state. A committed CREATE
   followed by `{data:{}}`, or CREATED without publicId, cleared recovery state.
   Strict result validation now raises ambiguity and retains the same opaque
   intent. Actual session→Worker→SQLite tests demonstrate RED before the fix,
   recovery after remount, one reminder/one audit and canonical cancellation.
2. **Reminder/calendar state stays stale after delivery.** Core screens previously
   only loaded on mount/mutation. Visible focus/visibility/60-second refresh now
   reloads through existing read paths with epoch/request/mutation fences.
   Regression tests failed before the fix for legacy and opt-in reads and timed
   refresh; targeted suite passed afterward. Listeners and timers are removed.
3. **Body limits hang on stalled cancellation.** Request timeout/overflow and
   response overflow awaited stream cancellation, which can remain pending.
   Best-effort cancellation no longer blocks or replaces the bounded error;
   rejections are suppressed. Pending/rejected cancellation tests cover request
   timeout/size and client GET/POST size overflow. POST stays ambiguous without
   auto-retry. RED then GREEN recorded in targeted tests.

The eb8f66e full gate is historical evidence only. For this follow-up use the PR's
exact current HEAD CI and final reviewer result, not that prior green SHA.

## Still gated or future work

- **PAID HOLD / UNKNOWN:**29 prospective terminal UNKNOWN claims plus12 historical
  UNKNOWN remain immutable. Existing cost metadata cannot resolve them. A reviewed
  append-only reconciliation mechanism with genuine bound billing evidence is a
  separate task; there is no current financial resolution or budget grant.
- **Wire104/Formal Pilot/Full:** not qualified; no paid request, quota probe,
  replay, namespace reset or authority consumption is permitted by completion work.
- **Production migration/release:**0009/0010 were pending at the October16 read-back.
  Fresh inventory and separately authorized exact migration/SHA are required;
  no remote apply, master promotion, upload or deploy is part of these fixes.
- **Successor activation:** remains off, requires qualification, explicit policy
  and compatible config, plus a successor-capable rollback/drain plan. Default
  AI_MODE=privacy does not enforce a blanket paid kill switch.
- **Planned integrations/policies:** Telegram live acceptance, additional source
  integrations and bot takeover policy remain explicitly PLANNED/design work in
  current-state. No missing production implementation is inferred solely from
  unchecked historical planning checkboxes.

This document records bounded completed work and gates; it does not certify an
absence of all bugs or production AI acceptance.
