# Rate-aware fresh Pilot38 implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline. Root implements; existing strict_date_review reviews. No new agents.

**Goal:** Implement the independently reviewed owner-scope v2 as an inactive, source-bound versioned harness; no paid activation while owner approval is pending.

**Architecture:** New rate policy primitives validate finite Retry-After and independent scheduling clocks. A durable exclusive batch controller admits at most two full runs, enforces the shared conservative subcap, and permits only settled matched-429 successors. A new Formal/debug authority version bridges that controller into existing campaign execution, with awaited admission before claim/reservation and an explicit new 45-minute ledger timing policy. Old authorities and ledger formats remain unchanged.

**Tech Stack:** TypeScript/Node22, existing Zod, Vitest, append-only/fsync durable records.

**Spec:** /Users/bichtuyen/Documents/Codex/2026-10-24/calenote-rate-limit-completion-strategy38-13804ae/owner-decision-v2/OWNER_SCOPE_V2.json (SHA256 b1e65bab69808e635c52137d29926afd13951514dbb0f5f0321ffc7e29147e7d).

## Global Constraints

- Evaluated app13804ae8962852cc1e9108d0d166e4ade90e511d byte-identical; only genuine harness/docs changes. No src/package/config/oracle/corpus change.
- Max2 fresh complete runs,76 physical/run,152/batch; concurrency1; spacing15000ms plus0..3000ms additive jitter.
- Run2700000ms/batch10800000ms; request30000ms, input12000/output1536/response32768 unchanged. Frozen semantic clocks never follow scheduler time.
- Shared500000µ inside10000000µ; baseline retained7767153, UNKNOWN64 floor, full105472µ prospective exposure each physical request. Wait precedes zero-dollar target claim, reserve, dispatch.
- Cooldown receipt-anchored900000ms floor; required>1800000ms stops. Missing/not-captured labelled fallback; malformed/oversized/overflow present hint stops. Clock rollback/skew>5000ms stops; no rebase.
- Only closed UNKNOWN_RESERVED/STOP UNKNOWN_USAGE matched shared-pool429 with prior all-oracle PASS progress may parent a successor. Exact37 parent first, same-batch sole child second. No retry/fallback/replay/prefix stitching/controller restart.
- Missing reviewed owner batch approval fails before credentials/consumption/dispatch. This implementation task does not mint a grant or modify historical account records.

## Review Focus

- Abort or expiry while waiting: no target claim, reserve, physical request or new UNKNOWN.
- Concurrent controllers and crash/persistence failure: exclusive claim and durable counter journal; no stale-lock repair or reopened batch.
- Changed budget/source/route after wait: fresh trusted verification immediately before claim; no earlier snapshot admission.
- Rollback/overflow/forward wall jump: monotonic deadline plus wall bound, including actual run start full-window fit.
- Parent UNKNOWN is lifecycle settled, not known cost: exact receipts/ledger/oracles/route pins required, first-call429 opens circuit.

### Task1: Policy primitives and tests
**Files:** create tools/benchmark/context-rate-policy.ts and .test.ts.
**Interfaces:** parseRateHint(raw receipt), scheduling clock validation, cooldown plan/readiness, pacing calculation; strict finite parsed outputs never raw header logs. Export fixed versioned policy constants.
- [ ] Write parser/calendar/overflow/128char/longhint/cooldown/rollback/monotonic/expiry failing tests, run RED.
- [ ] Implement pure primitives and run GREEN. Preserve distinct missing/notCaptured states; strict IMF-fixdate only.

### Task2: Durable batch controller and tests
**Files:** create tools/benchmark/context-rate-batch.ts and .test.ts.
**Interfaces:** reviewed loader with immutable record/owner/proposal/source/account pins returns branded capability; acquire exclusive batch claim; beginFreshRun, awaitAdmission, recordDispatch, settle, terminal operations. No capability from booleans/CLI.
- [ ] RED real temporary filesystem concurrency/crash/duplicate/invalid-path/claim tests, fake scheduling-clock waits/abort, fresh accounting reserve and successor tests.
- [ ] Implement append-only fsync hash chain and exclusive claim; persistence failure retains claim, never repair; two runs/152 calls/45m/180m/shared+global caps. Account verification callback in reviewed bridge re-reads existing conservative ledger; typed controller cannot accept caller budget numbers at dispatch.
- [ ] Parent37 reviewed evidence hashes bind immutable terminal/ledger/report/responses/action facts; subsequent successor evidence derives actual settled result and raw finite429 diagnostic, never a caller-supplied eligibility boolean. All non429/semantic/oracle failures close batch.

### Task3: Versioned campaign timing and awaited runner admission
**Files:** modify context-contract-live.ts/.test.ts, context-contract-runner.ts/.test.ts; new tests in context-rate-batch.test.ts as appropriate.
**Interfaces:** explicit RATE_AWARE_FRESH_V2 timing on BEGIN with source-bound debug/BOUNDED_PILOT context; helper resolves old20min vs new45min consistently in reserve/dispatch/validation/complete. Runner hook beforeDispatch may return Promise<void>, always awaited before target claims and reserve. New rate timing only with branded controller bridge, not arbitrary numeric override.
- [ ] RED deadline2700000new/1200000legacy and invalid timing-context tests; wait/abort before claim/reserve and frozen request context identity tests.
- [ ] Implement narrow version branches; no rewriting historical rows or global20min patch. Rerun existing ledger/runner tests.

### Task4: Version5 Formal/debug bridge and finite receipts
**Files:** modify context-formal-pilot-launcher.ts/.test.ts, context-debug-loop.ts/.test.ts; new controller exports.
**Interfaces:** formal-pilot-launch-authority-5 + t11-debug-loop-authority-5 bind batch record digest/owner decision/policy/source/harness/child ordinal. Existing versions refuse batch fields. New paths derive run identity from batch+ordinal, avoiding reuse of37 owner/proposal markers. Batch journal is authoritative one-owner/two-child consumption; existing per-run markers retained.
- [ ] RED missing owner approval, wrong hash/harness/app/privacy/source/corpus, concurrent entry, once-only child, no hidden HTTP retry, no credential before durable consumption tests.
- [ ] Harness wrapper captures finite Retry-After and duplicate-free complete <=8192B error category without changing app transport or printing raw error. Header missing vs oversized remain distinct. Bind finite receipt to actual physical response and durable hash before terminal assessment.
- [ ] Fake full76call run with virtual pacing and ledger clocks demonstrates strict standalone PASS; fake prior progress429 opens at most one fresh successor, first-call429 circuit closes; no prefix credit.

### Task5: Qualification, review and exact CI
**Files:** plan/checklist plus immutable external local evidence packet; no live account artifacts.
- [ ] Run full prior25 exact qualification plus new rate/controller/ledger/debug suites, typecheck, full ESLint and docs. Run complete normal Vitest suite; name any failures.
- [ ] Independent source review all changed file hashes; fix findings with regression tests. Verify git diff app13804ae unchanged and candidateValidationProof genuine app/harness split.
- [ ] Commit/push actual harness SHA and inspect exact CI read-only. Record local/CI readiness separately from missing owner paid approval. Do not bind live grant, read credentials or run paid.

## Execution boundary

Parent explicitly delegated local harness implementation inline and asked existing reviewer to review plan before code. No repeated human confirmation needed for local work. Paid owner decision is still pending and cannot be inferred from this plan, approval text draft, agent review or green tests.

## Reviewed architecture amendment (append-only)

Existing reviewer accepted a separate branded `context-rate-launcher.ts` v5 boundary that invokes the observable campaign directly and leaves old Formal/debug loaders unchanged. It holds the existing physical account lock across the entire batch, including cooldowns; this deliberately supersedes earlier OUTSIDE-lock cooldown mechanics in the offline addendum. It is stricter serialization, not extra spend authority. No nested account-lock calls; keys cleared per child before cooldown; normal settled STOP releases the lock, persistence or uncertain accounting retains it. No restart/stale-lock repair. Fixed180min scheduling gate bounds the batch. Shared runner awaits admission and accepts the explicit45min timing only from a privately minted active execution capability.

Finalization contract: timely COMPLETE is the sole single-run credit commitpoint, after complete evidence fsync/source/budget/window/abort checks. RUN_END eligible=true is the sole successor permission commitpoint, checked after all failed-child proof and metadata writes; it cannot be manufactured by a public scheduling controller. Final summary binds complete audit/diagnostics through byte-bounded evidence-index chunks, never by dropping fields or silently truncating to16KiB.
