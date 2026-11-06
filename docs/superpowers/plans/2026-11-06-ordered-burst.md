# Ordered burst Implementation Plan

> Execute task-by-task natively with superpowers:executing-plans. Root owns code and verification; one bounded independent whole-branch review at the final all-five freeze.

**Goal:** Preserve quick successive inputs, group eligible fragments, and require a visible preview before bare confirmation.
**Architecture:** Migration0024 delivery holds + existing inbound CAS/leases; reply-less NONE-context transitions and explicit source-bound burst input metadata.
**Tech Stack:** Worker/D1/Queues, TypeScript, Vitest/SQLite/Workerd.
**Spec:** docs/superpowers/specs/2026-11-06-ordered-burst-design.md

## Constraints/review focus
No fabricated receipts, text concatenation, Queue concurrency change, retry exhaustion or new processing authority. Preserve source relative dates and control barriers. Production requires0024 and exact-SHA release consent. Model route/reservations/cap4USD unchanged.

### Task1: FIFO, holds and recovery
Files: migration0024, new inbound chain SQL helper/tests, inbound/processor.ts, reminders/scheduler.ts, worker/composition-root.ts and queue tests.
- [x] RED reversed/tied jobs, late older date behind live owner, scope isolation/unbound, expired/reclaimed marker, exhausted head, blocked dispatch counters, cron fairness and slow-send hold.
- [x] Implement selected SQL guard/BLOCKED acknowledgement, marker release/finally and next-head kick; no processing while send/receipt unsettled.
- [x] GREEN focused store/queue/processor and real Workerd fixture tests, types/lint; commit.

### Task2: Confirmation visibility
Files: state.ts, control-proof.ts/confirmation.ts, D1 context store and service; focused tests.
- [x] RED bare approval received before/equal delivery, no delivered timestamp, token/reply/web exceptions; premature rejection keeps decision and later approval saves once.
- [x] Implement deliveredAt receipt stamp and proof/final SQL checks; safe no-draft-mutation response.
- [x] GREEN confirmation/service/store regressions; no historical snapshot rewrite, commit.

### Task3: Reply-less fold and eligibility
Files: new burst-policy.ts, runtime-store.ts/service.ts/context.ts/state schemas, pure command parser exports, webhook delay plumbing.
- [x] Spike apply NONE snapshot with only USER receipt, re-observe and idempotent replay; prove the store supports the mechanism before relying on it.
- [x] RED source-preserving2/3fragment fold,10s/3turn bounds, pending/ownership/barrier/follower-race/decrypt failure and cross-midnight cases.
- [x] Implement atomically guarded follower deferral, eligibility and quiet delay; tail reaches one model call and one reply. GREEN focused tests.

### Task4: Source/wire qualification
Files: input/currentBurstTurns, evidence/completeness/field capability, conditional prompts/digests and fixtures/tests; combined release note.
- [x] RED NEW evidence from eligible member versus foreign old fact, retained CURRENT restriction, omitted details, exact source dates and single-message byte identity.
- [x] Implement bounded backend membership and conditional prompt, preserve146anchors, qualify grouped wire offline.
- [x] Bounded synthetic live interpretation under remaining approved4USD cap with reservations for unknown calls; truthful accounting/evidence, no production reminder mutation.
- [x] Commit source/notes/ledger and continue area5; final fullcheck/review after allfive stable.
