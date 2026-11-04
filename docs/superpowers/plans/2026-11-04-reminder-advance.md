# Reminder advance settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add useful advance settings and repair the failed create/confirm paths so scheduled delivery can be retested.
**Architecture:** Preserve structured preview integrity and D1 fences. Store optional advance offsets and schedule via backend code with explicit-input precedence and event linkage.
**Tech Stack:** TypeScript, React19, Next16 static app, Cloudflare Worker/D1, Vitest/Miniflare.
**Spec:** docs/superpowers/specs/2026-11-04-reminder-advance-design.md

## Global Constraints
- Work on feature branch; files inside Calenote. No secret disclosure.
- Cumulative paid-test cap4USD, synthetic inputs only, existing EU/ZDR route.
- Existing reminders unchanged; no infinite cadence or reinterpretation of reminder-only timestamps.
- Production promotion/migration requires reviewed concrete release and authorization; migrations immutable.

## Review Focus
- Addressed one-off/series preview confirmation preserves exact text, hash, and owner authority.
- Manual create after contract ownership cannot bypass another owner's/channel's write fence.
- Settings persist1/7day and1/24hour boundaries, reject fractions/out-of-range; both off preserves behavior.
- Past/duplicate advances, explicit offsets, cancellation/completion leave no unintended sends.
- Retest delivery, snooze and complete with real synthetic reminder; no false pass if blocked.

### Task1: Restore confirmations with saved addressing
Files: service.ts and service-addressed-confirmation.test.ts in src/modules/conversation/context-contract.
- [x] Write service+D1 regression for addressed one-off and finite series through token confirm; assert reminders actually saved and exact persisted preview receipt valid.
- [x] Run new test RED; fix addressing before storing preview/hash, without weakening validator; run focused GREEN.
- [x] Commit fix and tests; ledger result.

### Task2: Restore manual create for owned conversations
Files: src/modules/reminders/infrastructure/d1/api-store.ts, real D1 integration tests; new migration only if required.
- [x] Reproduce manual create after a real context service turn; assert authenticated create succeeds once and intent replay returns same result.
- [x] Observe RED; introduce narrowly scoped manual authority under existing owner/channel checks; test forged/cross-owner/rollback negative paths.
- [x] Focused GREEN, commit and ledger.

### Task3: Add persisted advance preferences and scheduler
Files: preferences contract/service/D1 store, SettingsPanel; event/reminder creation and cancellation domain; additive migration as needed.
- [x] Confirm independent-offset interpretation from pending answer or ledger reasonable assumption.
- [x] Write range/persistence/UI save tests and real-D1 scheduling tests with known event time, explicit override, past/duplicate/cancel cases; observe RED.
- [x] Implement validated controls and deterministic event-linked scheduling; observe GREEN; commit and ledger.

### Task4: Repair and recheck recurrence findings
Files: semantic generation/resolution files identified by reproductions for A06/A07/A08/A10; source fixtures from cost report.
- [x] Reproduce grounded finite daily inputs; preserve unsupported weekly/minute behavior with useful answers.
- [x] Add failing regressions for confirmed causes, minimal fix, focused GREEN; commit and ledger.

### Task5: Verify and finish release work
- [ ] Run project check, fresh whole-branch independent review, resolve material findings and reverify changed paths.
- [ ] Prepare immutable release/migration evidence; honor production authorization policy at exact SHA.
- [ ] Retest paid synthetic cases only within cap, then real delivery/snooze/complete after production approval; record cost and cleanup. Report any remaining blocker honestly.
